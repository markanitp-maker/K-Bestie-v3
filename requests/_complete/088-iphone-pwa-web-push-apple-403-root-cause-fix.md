# Request 088 — iPhone PWA Web Push Apple 403 원인 확정 및 최종 수정

## 1. 목적

iPhone 홈 화면 PWA에서 Web Push가 실제 수신되지 않는 문제를 이번 작업에서 끝낸다.

과거 여러 차례 수정이 있었지만 실제 Apple Web Push 발송 단계에서 계속 HTTP 403이 발생했고,
현재 코드는 Apple이 반환하는 상세 `reason`을 버리고 있어 정확한 원인을 확인하지 못한 상태다.

이번 작업은 추측성 수정 금지다.

반드시:

```text
Apple 403 상세 reason 확보
→ reason에 따른 정확한 원인 확정
→ 최소 수정
→ 실제 iPhone Push 수신 확인
```

순서로 진행한다.

---

# 2. 현재까지 확정된 사실

현재까지 READ-ONLY RCA로 다음은 확정됐다.

## 2.1 기능 자체

iPhone 홈 화면 PWA Web Push는 지원되는 기능이며 구현 가능하다.

현재 문제는 iOS에서 Web Push가 원래 불가능해서 발생한 것이 아니다.

---

## 2.2 실제 실패 경계

현재 실패 경계:

```text
iPhone PWA Push Subscription
→ DB push_subscriptions 등록
→ 서버 발송 로직
→ webPush.sendNotification()
→ Apple web.push.apple.com
→ HTTP 403 Forbidden
```

즉 현재 1차 장애는:

```text
K-Bestie Server
→ Apple Web Push 인증 단계
```

에서 발생한다.

Service Worker까지 Push가 도착하기 이전 단계의 문제다.

---

## 2.3 현재 확정 코드 결함

### 결함 A — Apple 상세 오류 reason 유실

현재:

`lib/notifications/push.ts`

에서 `webPush.sendNotification()` 실패 시:

- statusCode만 읽음
- Apple response body를 버림
- headers도 충분히 보존하지 않음

결과:

```text
PUSH_403
```

만 알 수 있고,

실제 Apple reason인:

```text
VapidPkHashMismatch
BadJwtToken
BadVapidPublicKey
BadAuthorizationHeader
```

등을 확인할 수 없다.

---

### 결함 B — 403에서 subscription 비활성화

현재 일부 배포 코드에서:

```typescript
status === 404 || status === 410 || status === 403
```

인 경우 subscription을 비활성화하는 로직이 존재한다.

403은 인증 문제일 수 있으므로
유효한 사용자 subscription을 stale subscription으로 처리하면 안 된다.

정상적인 stale/expired subscription 비활성화 기준은 우선:

```text
404
410
```

으로 한정한다.

---

### 결함 C — Web Push timeout 부재

현재 `webPush.sendNotification()`에 명시적 network timeout이 없어
Apple endpoint 응답 지연 시 관리자 화면이:

```text
발송 중...
```

상태로 오래 고착될 수 있다.

---

# 3. 매우 중요한 작업 원칙

이번 작업에서 절대로 처음부터 다음을 하지 않는다.

- VAPID 키 무작정 재발급
- Production subscription 일괄 삭제
- iPhone PWA 재설치부터 요구
- Service Worker 전체 재작성
- Push DB 구조 전면 변경
- `.local` subject만 원인이라고 단정
- Production 바로 수정/배포

이번에는 반드시 Apple의 실제 `reason`을 먼저 확보한다.

---

# 4. 작업 범위

이번 작업은 3단계로 진행한다.

```text
Phase 1
진단 가능하도록 최소 수정

Phase 2
Development + 실제 iPhone 1회 발송

Phase 3
Apple reason에 따른 원인 수정 및 재검증
```

Production 배포는 이번 Request에서 금지한다.

---

# 5. Phase 1 — Apple 오류 reason 계측

대상:

`lib/notifications/push.ts`

현재 `webPush.sendNotification()` catch를 보완한다.

## 필수 수집 정보

실패 시 다음만 안전하게 기록한다.

- HTTP statusCode
- Apple response body의 `reason`
- 필요한 최소 response header
- elapsed time
- provider host 구분

절대 기록 금지:

- endpoint 전체 URL
- p256dh
- auth
- VAPID private key
- VAPID public key 원문
- Authorization header
- JWT 전체 문자열
- 사용자 개인정보

---

## 5.1 Apple reason parsing

`err.body`가 문자열/Buffer 어느 형태이든 안전하게 읽고,
JSON이면 `reason`만 추출한다.

예상:

```json
{
  "reason": "VapidPkHashMismatch"
}
```

로그 예:

```text
[push] provider_error {
  statusCode: 403,
  reason: "VapidPkHashMismatch",
  provider: "apple",
  elapsedMs: 842
}
```

Apple body 전체를 무조건 로그에 덤프하지 않는다.

`reason` 중심으로 최소 정보만 남긴다.

---

# 6. Phase 1 — timeout 적용

`web-push`의 공식 timeout option을 사용한다.

개념:

```typescript
webPush.sendNotification(subscription, payload, {
  timeout: 10000
})
```

AbortController 기반 임의 API를 만들지 않는다.

timeout 발생 시 명확한 내부 오류 코드로 분류한다.

예:

```text
PUSH_TIMEOUT
```

관리자 UI 역시 무한 `발송 중...` 상태로 남지 않아야 한다.

---

# 7. Phase 1 — 403 subscription revoke 제거

`missionPushService.ts`의 subscription 비활성화 조건을 점검한다.

403을 자동 revoke 조건에서 제거한다.

기본 정책:

```text
404 → stale subscription → deactivate
410 → expired subscription → deactivate

403 → 인증/권한 문제 → subscription 유지
```

403 발생 시:

- failedSubscriptions 증가
- `PUSH_403` 기록
- Apple reason 가능하면 함께 진단 로그에 기록
- subscription은 유지

---

# 8. VAPID Subject

현재 코드의:

```text
mailto:admin@kbestie.local
```

을 확인한다.

단 `.local`이라는 이유만으로 이번 장애의 ROOT CAUSE라고 먼저 단정하지 않는다.

운영상 실제 연락 가능한 VAPID subject 사용이 적절하다면:

```text
VAPID_SUBJECT
```

환경변수 기반으로 변경하는 것을 검토한다.

예:

```text
mailto:support@k-bestie.com
```

단 실제 변경 여부는 Apple reason을 확인한 뒤 결정한다.

---

# 9. Phase 2 — Development 실제 iPhone 테스트

Phase 1 진단 수정 후 Development에서만 테스트한다.

Production 배포 금지.

실제 iPhone PWA에서 테스트한다.

## 테스트 조건

- iPhone
- 홈 화면 PWA
- Notification permission = granted
- PushManager subscription 존재
- Development 환경에서 생성된 subscription 사용
- 테스트 대상 계정 명확히 확인

---

## 테스트 실행

관리자 Push Test에서 한 번 발송한다.

한 번의 테스트에서 반드시 다음 중 하나를 확보한다.

### 실패

```text
HTTP 403
reason = VapidPkHashMismatch
```

또는:

```text
HTTP 403
reason = BadJwtToken
```

또는:

```text
HTTP 403
reason = BadVapidPublicKey
```

또는:

```text
HTTP 403
reason = BadAuthorizationHeader
```

또는 기타 Apple reason.

### 성공

```text
HTTP 201 / 2xx
```

---

# 10. reason별 수정 정책

## Case A — VapidPkHashMismatch

의미:

subscription 생성 시 사용한 public VAPID key와
현재 발송 서버가 사용하는 VAPID key가 일치하지 않음.

확인:

- NEXT_PUBLIC_VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY에서 파생되는 public key
- iPhone subscription applicationServerKey
- Development / Production 환경 분리

수정:

정확히 동일한 VAPID pair를 client/server에서 사용.

키 변경이 실제 필요하다고 확정된 경우에만
기존 subscription 재등록 전략을 설계한다.

키를 무작정 재발급하지 않는다.

---

## Case B — BadJwtToken

다음 항목을 각각 검증한다.

- JWT signature
- private key
- `aud`
- `exp`
- `sub`

특히:

```text
aud = https://web.push.apple.com
```

인지 확인한다.

`exp`가 허용 범위인지 확인한다.

`sub`가 유효한 contact URI인지 확인한다.

확정된 실패 요소만 수정한다.

---

## Case C — BadVapidPublicKey

확인:

- public key 형식
- URL-safe Base64
- P-256 public key
- client/server public key 동일성

필요한 부분만 수정한다.

---

## Case D — BadAuthorizationHeader

`web-push`의 VAPID header 생성 과정과
setVapidDetails 설정을 확인한다.

직접 Authorization header를 새로 구현하지 않는다.

공식 `web-push` 구현을 우선 사용한다.

---

## Case E — HTTP 201/2xx

이 경우:

```text
Server
→ Apple
```

은 정상이다.

그 다음에만:

```text
Apple
→ iPhone
→ Service Worker
→ showNotification
```

단계로 QA 범위를 이동한다.

403 상태에서 Service Worker를 또 수정하지 않는다.

---

# 11. Production VAPID 키 검증

Development에서 원인 수정이 확인된 뒤에만
Production 설정을 READ-ONLY로 비교한다.

확인:

```text
NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
```

실제 값은 로그/보고서에 절대 출력하지 않는다.

검증 결과만:

```text
MATCH
MISMATCH
```

형태로 보고한다.

Production 키 변경은 별도 승인 없이 하지 않는다.

---

# 12. 실제 성공 판정

코드상:

```text
successfulSubscriptions = 1
```

만으로 PASS 판정하지 않는다.

최종 PASS는 실제 iPhone에서 확인한다.

## 반드시 테스트

### Test 1

PWA foreground

→ Push 수신

### Test 2

PWA background

→ Push 수신

### Test 3

PWA 강제 종료

→ Push 수신

### Test 4

iPhone 잠금

→ 잠금 화면 / Notification Center Push 수신

최소 background / 강제 종료 / 잠금 상태는 실기기 확인 필수.

---

# 13. 관리자 Push Test 결과 개선

현재 관리자 화면:

```text
발송 성공
성공 구독 N
실패 구독 N
```

에 더해 Development/Admin 진단용으로
민감정보 없이 최소 오류 reason을 보여줄 수 있게 검토한다.

예:

```text
발송 실패
HTTP: 403
Provider reason: BadJwtToken
```

Production 사용자 화면에는 상세 내부 오류를 노출하지 않는다.

---

# 14. 일일 부모 리포트 Push 영향

현재 RCA 결과:

`일일 리포트 도착 알림`

은:

```text
UI
→ DB preference
→ batch
→ push subscription
→ Web Push 발송
```

까지 연결되어 있다.

따라서 공통 Apple Push transport가 해결되면
부모 일일 리포트 Push도 동일 인프라에서 재검증한다.

별도의 일일 리포트 시스템 전체 재작성 금지.

---

# 15. 주간 종합 요약 알림

현재 별도 확인 결과:

`주간 종합 요약 알림`

은 현재 Dead Toggle이다.

즉:

- localStorage UI state 존재
- DB preference 없음
- 서버 batch 없음
- 실제 Push 없음

이 기능은 Apple 403 수정과 별도 작업이다.

이번 088에서는 주간 알림 신규 구현을 하지 않는다.

별도 Request로 분리한다.

---

# 16. 이번 작업에서 변경 가능한 최소 파일

우선 예상:

```text
lib/notifications/push.ts
lib/mission/missionPushService.ts
```

Apple reason에 따라 필요할 경우:

```text
lib/notifications/usePushSubscription.ts
환경변수 정의/검증 파일
```

까지 최소 확대한다.

Service Worker, 부모 리포트, 미션 비즈니스 로직 등
관련 없는 코드는 건드리지 않는다.

---

# 17. 금지사항

이번 작업에서는 다음 금지:

- Production Vercel 배포
- Production VAPID key 변경
- Production subscription 대량 삭제
- Production DB 수동 수정
- Service Worker 전면 재작성
- 알림 시스템 전체 리팩터링
- 추측에 따른 VAPID key 재발급
- Apple reason 확인 전 여러 원인 동시 수정

---

# 18. Acceptance Criteria

## AC-01
Apple 403 발생 시 exact `reason`을 안전하게 확인할 수 있다.

## AC-02
403에서 subscription이 자동 비활성화되지 않는다.

## AC-03
404/410 stale subscription 처리 기능은 유지된다.

## AC-04
sendNotification에 명시적인 timeout이 적용된다.

## AC-05
관리자 Push Test가 무한 `발송 중...`에 고착되지 않는다.

## AC-06
Development iPhone 실기기 테스트에서 Apple response 결과가 확인된다.

## AC-07
Apple reason에 맞는 단일 원인이 확정된다.

## AC-08
해당 원인만 최소 수정한다.

## AC-09
수정 후 Apple endpoint가 201/2xx를 반환한다.

## AC-10
실제 iPhone에서 Push를 수신한다.

## AC-11
PWA background 상태에서 Push 수신.

## AC-12
PWA 강제 종료 상태에서 Push 수신.

## AC-13
iPhone 잠금 상태에서 Push 수신.

## AC-14
아이 미션 Push 기존 기능 회귀 없음.

## AC-15
부모 일일 리포트 Push도 동일 transport 기준으로 재검증 가능.

## AC-16
Production에는 이번 작업에서 배포하지 않는다.

---

# 19. 완료 보고

완료 시 반드시 아래 순서로 보고한다.

1. 기존 Apple HTTP status
2. 새로 확보한 Apple exact reason
3. 최종 ROOT CAUSE
4. 기존 4번 수정이 해결하지 못했던 이유
5. 변경 파일
6. 403 revoke 수정 내용
7. timeout 설정
8. VAPID 관련 실제 수정 여부
9. Development Apple HTTP 결과
10. successfulSubscriptions
11. iPhone foreground 결과
12. iPhone background 결과
13. iPhone 강제 종료 결과
14. iPhone 잠금 결과
15. 부모 일일 리포트 Push 영향
16. 남아 있는 별도 문제
17. Production 미배포 확인

최종적으로 실제 iPhone Push가 수신되기 전에는
`완료`로 판정하지 않는다.
```

[Claude Code]

```text
088 Request를 기준으로 iPhone PWA Web Push 장애를 이번에는 추측 수정하지 말고 Development에서 Apple의 실제 HTTP 403 reason을 먼저 확보한 뒤 원인별 최소 수정으로 해결하라; 우선 lib/notifications/push.ts에서 web-push WebPushError의 statusCode와 Apple response body의 reason만 민감정보 없이 안전하게 기록하고 sendNotification에 공식 timeout 옵션 10000ms를 적용하며, lib/mission/missionPushService.ts에서 403을 stale subscription으로 비활성화하는 조건을 제거해 404/410에서만 deactivate되게 하라; 이 단계에서는 VAPID 키 재발급, subject 변경, subscription 일괄 삭제, Service Worker 재작성 등 추측성 수정은 하지 마라; Development에서 실제 iPhone PWA로 관리자 Push Test를 단 1회 실행하여 VapidPkHashMismatch/BadJwtToken/BadVapidPublicKey/BadAuthorizationHeader 또는 201/2xx 중 실제 결과를 확보하고, reason이 확보되면 해당 원인에 대응하는 최소 수정만 수행하라; 수정 후 Apple endpoint 201/2xx와 실제 iPhone foreground/background/강제종료/잠금 상태 Push 수신까지 실기기로 확인해야 PASS이며, 부모 일일 리포트 Push는 동일 transport 장애 영향만 재검증하고 주간 종합 요약 알림 Dead Toggle 구현은 이번 범위에서 제외하라; Production Vercel 배포, Production env/VAPID 변경, Production DB/subscription 수정은 절대 하지 말고 최종 보고에 Apple exact reason, 확정 ROOT CAUSE, 변경 파일, Dev 실기기 수신 결과를 명시하라.
```