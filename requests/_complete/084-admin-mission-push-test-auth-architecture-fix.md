# Request: 관리자 `미션 푸시 발송 테스트` 401 Unauthorized 근본 수정 — 관리자 전용 API + 공통 푸시 서비스 분리

## 0. 배경

Production 관리자 `미션 푸시 발송 테스트` 화면에서 `미션 1 즉시 발송` 또는 `미션 2 즉시 발송` 클릭 시 다음 오류가 발생한다.

```text
401 Unauthorized
```

Antigravity 읽기 전용 감사 결과, 원인은 명확하다.

현재 관리자 UI는 아래 Cron 전용 엔드포인트를 브라우저에서 직접 호출하고 있다.

```text
GET /api/cron/mission-start?missionType=1|2&testChildId=...
```

하지만 `/api/cron/mission-start`는 관리자 세션을 확인하지 않고 오직 다음 인증만 허용한다.

```text
Authorization: Bearer <CRON_SECRET | BATCH_SECRET>
```

관리자 브라우저에는 이 Secret이 노출되면 안 되므로 Authorization header가 없고, 결과적으로 401이 발생한다.

더 큰 문제는 현재 Cron route가 `testChildId`를 읽지도 않기 때문에, 단순히 401만 우회하면 실제 Production 대상 전체에게 미션 시작 푸시가 발송될 위험이 있다.

이번 작업은 단순 401 해제가 아니라 아래 구조로 근본 수정한다.

```text
관리자 UI
→ 관리자 전용 인증 API
→ 공통 미션 푸시 서비스
→ Web Push Provider

Vercel Cron
→ Cron Secret 인증
→ 공통 미션 푸시 서비스
→ Web Push Provider
```

---

## 1. 절대 금지사항

다음 방식으로 401을 해결하면 안 된다.

- `/api/cron/mission-start`의 `CRON_SECRET` 검증 제거
- 관리자 세션을 Cron endpoint 인증 대체 수단으로 추가
- 클라이언트에 `CRON_SECRET` 전달
- `NEXT_PUBLIC_*` 환경변수에 Cron Secret 저장
- 관리자 브라우저에서 Bearer Secret 생성/주입
- `testChildId` 필터가 없는 상태로 Cron endpoint 직접 호출 유지
- Production 실제 아이를 푸시 테스트 대상으로 허용

Cron endpoint는 계속 Vercel Cron 전용 보안 경계로 유지한다.

---

## 2. 최종 권장 아키텍처

### 관리자 테스트 흐름

```text
PushTestTab.tsx
  ↓
POST /api/admin/push-test/send
  ↓
requireAdmin()
  ↓
childId / missionType 검증
  ↓
QA/Internal Test 계정 검증
  ↓
sendMissionStartPushToChild()
  ↓
sendPushNotificationWithRetry()
```

### 정기 Cron 흐름

```text
Vercel Cron
  ↓
GET /api/cron/mission-start
  ↓
CRON_SECRET / BATCH_SECRET 검증
  ↓
정기 발송 대상 조회
  ↓
sendMissionStartPushToChild()
  ↓
sendPushNotificationWithRetry()
```

Cron과 관리자 테스트는 인증과 대상 선정 로직만 다르고, 실제 한 아이에게 미션 시작 푸시를 보내는 핵심 도메인 로직은 공유한다.

---

## 3. 관리자 UI 수정

대상:

```text
app/admin/(dashboard)/PushTestTab.tsx
```

현재:

```text
fetch(`/api/cron/mission-start?missionType=${missionType}&testChildId=${childId}`)
```

변경:

```text
POST /api/admin/push-test/send
```

request body:

```json
{
  "childId": "...",
  "missionType": 1
}
```

또는:

```json
{
  "childId": "...",
  "missionType": 2
}
```

브라우저에서 Cron Secret을 다루지 않는다.

same-origin 관리자 세션 cookie를 사용한다.

---

## 4. 관리자 전용 API 신규 구현

신규 권장 경로:

```text
app/api/admin/push-test/send/route.ts
```

Method:

```text
POST
```

필수 흐름:

1. `requireAdmin()` 또는 현재 관리자 공통 인증 helper 실행
2. JSON body validation
3. `childId` 존재 확인
4. `missionType`이 `1 | 2`인지 확인
5. 대상 아이 조회
6. 내부 테스트/QA 계정 여부 검증
7. push subscription 존재 확인
8. 공통 푸시 서비스 호출
9. 발송 결과 반환
10. 관리자 감사 로그 기록

---

## 5. 테스트 대상 안전 가드

`미션 푸시 발송 테스트`는 운영 이름 그대로 테스트 기능이므로 **실사용자 발송을 원천 차단**한다.

허용 대상:

```text
child_profiles.is_internal_test = true
또는
child_profiles.is_test_account = true
또는
기존 공통 내부 테스트 가족 판정 helper 결과가 true
```

단, 공식 운영 테스트 계정 판정은 가능하면 기존 공통 helper를 우선 재사용한다.

실사용자 선택 시:

```text
403 Forbidden
```

또는 적절한 4xx와 함께:

```text
테스트 계정만 발송할 수 있습니다.
```

반환.

---

## 6. 공통 미션 푸시 서비스 분리

현재 `/api/cron/mission-start/route.ts` 안에 아래 로직이 직접 결합돼 있다.

- 시간대 체크
- 대상 아이 조회
- round_type 결정
- 미션 푸시 제목/본문 생성
- push_subscriptions 조회
- push 발송
- mission_notification_logs 기록

이 중 **한 아이에게 한 번의 미션 시작 푸시를 보내는 부분**을 공통 서비스로 추출한다.

신규 권장 파일:

```text
lib/mission/missionPushService.ts
```

권장 함수 예:

```ts
sendMissionStartPushToChild({
  childId,
  missionType,
  source,
  adminUserId?,
})
```

`source` 예:

```text
cron
admin_test
```

---

## 7. 공통 서비스 책임

공통 서비스는 최소 아래 책임을 갖는다.

- child 존재 확인
- missionType 1/2 validation
- round_type 계산
- 제목/본문 템플릿 결정
- push subscription 조회
- `sendPushNotificationWithRetry()` 호출
- 성공/실패 결과 수집
- `mission_notification_logs` 기록
- 중복 발송 방지에 필요한 기존 idempotency 규칙 유지

Cron과 관리자 API가 같은 핵심 로직을 복사해 갖지 않게 한다.

---

## 8. 미션 1 / 미션 2 차이 유지

### 미션 1

```text
missionType = 1
round_type = round1_day
제목 = "미션 시작 시간이야!"
```

정기 Cron 시간:

```text
방학: 10시
학기: 13시
```

### 미션 2

```text
missionType = 2
round_type = round2_night
제목 = "저녁 미션 시작 시간이야!"
```

정기 Cron 시간:

```text
18시
```

관리자 테스트 API에서는 **시간대 제한을 적용하지 않는다.**

이유:

```text
"즉시 발송 테스트"
```

기능이기 때문.

단, 제목/본문/round_type은 실제 정기 푸시와 동일해야 한다.

---

## 9. Cron endpoint 유지 및 리팩터링

대상:

```text
app/api/cron/mission-start/route.ts
```

반드시 유지:

```text
CRON_SECRET
BATCH_SECRET
Authorization Bearer 검증
```

변경:

- 정기 실행 대상 조회
- 시간대 체크
- 대상 순회

는 Cron route에서 유지 가능.

각 child 발송은 새 공통 서비스 호출.

Cron route는 `testChildId`에 의존하지 않는다.

관리자 테스트 기능과 완전히 분리한다.

---

## 10. `testChildId` 제거

현재 관리자 호출에서 사용하고 있지만 Cron route는 실제로 읽지 않는:

```text
testChildId
```

query parameter를 관리자 테스트 흐름에서 제거한다.

Cron endpoint에도 테스트 목적으로 새로 구현하지 않는다.

관리자 테스트는 전용 POST API만 사용한다.

---

## 11. Low-level push 유틸 재사용

기존:

```text
lib/notifications/push.ts
sendPushNotificationWithRetry()
```

는 그대로 재사용한다.

이번 작업에서 Web Push provider 구현을 새로 만들지 않는다.

---

## 12. 관리자 대상 선택 UX 유지

현재 구현된:

```text
아이 검색
→ 아이 선택
→ 미션 1 즉시 발송
→ 미션 2 즉시 발송
```

UX를 유지한다.

다만 검색 모달에서 가능하면 테스트 계정을 명확히 표시한다.

권장:

```text
TestA [테스트]
TestB [테스트]
```

테스트 전용 화면이므로 검색 결과 자체를 내부 테스트 계정으로 제한하는 것을 우선 권장한다.

---

## 13. 검색 API 안전성

현재 아이 검색이 전체 아이를 반환한다면 아래 중 하나로 수정한다.

권장안:

```text
푸시 테스트 모달에서는 테스트 계정만 조회
```

또는:

```text
전체 조회 가능
but 실사용자 선택 시 발송 버튼 disabled
```

운영 실수 방지 측면에서 첫 번째 방식을 우선한다.

---

## 14. 실행 결과 UI

성공:

```text
발송 성공
아이: TestA
미션: 1
성공 구독: N
실패 구독: 0
```

실패:

```text
발송 실패
원인: 푸시 구독 없음
```

또는:

```text
테스트 계정만 발송할 수 있습니다.
```

`Unauthorized` 같은 기술 문자열만 그대로 노출하지 않는다.

---

## 15. 감사 로그

관리자 수동 푸시 테스트는 감사 가능한 액션으로 기록한다.

예:

```text
action = ADMIN_MISSION_PUSH_TEST
admin_user_id
child_id
mission_type
result
sent_at
request_id
```

Secret, endpoint, subscription 원문은 감사 로그에 저장하지 않는다.

실제 프로젝트의 `admin_audit_log` helper가 있으면 재사용한다.

---

## 16. 푸시 로그와 관리자 감사 로그 구분

도메인 발송 로그:

```text
mission_notification_logs
```

관리자 행위 감사:

```text
admin_audit_log
```

둘을 목적에 맞게 별도 기록.

---

## 17. 발송 멱등성

관리자 테스트는 버튼을 빠르게 두 번 누르는 실수를 방지한다.

필수:

- 요청 중 버튼 disabled
- 동일 child + missionType에 대한 동시 요청 방지
- 서버에서 짧은 시간의 중복 요청 방어 여부 검토
- 기존 정기 발송 원장과 테스트 발송을 구분

필요하면 로그 `source=admin_test`를 명시한다.

---

## 18. 정기 Cron idempotency 보호

관리자 테스트를 실행해도 정기 발송 시간이 되었을 때 실제 정기 미션 알림이 누락되지 않도록 한다.

확인:

```text
mission_notification_logs
round_type
date
source
```

현재 Cron 중복 방지 기준을 확인한 뒤 테스트 발송과 production scheduled 발송을 분리한다.

테스트 로그 때문에 정기 발송이 skip되면 실패다.

---

## 19. 실제 사용자 오발송 방지

E2E에서 반드시 검증:

1. 내부 테스트 아이 선택 → 발송 가능
2. 실제 아이 ID 강제 입력 → 서버가 403/4xx 거부
3. invalid childId → 404/400
4. missionType=3 → 400
5. 관리자 세션 없음 → 401/403

클라이언트 UI만 믿지 않고 서버에서 재검증한다.

---

## 20. Cron 보안 회귀 테스트

```text
GET /api/cron/mission-start
Authorization 없음
→ 401
```

```text
잘못된 Bearer
→ 401
```

기존 Vercel Cron 정상 호출은 성공.

---

## 21. 관리자 API 인증 테스트

```text
POST /api/admin/push-test/send
관리자 세션 있음
+ QA child
→ 성공
```

```text
관리자 세션 없음
→ 거부
```

```text
일반 사용자 세션
→ 거부
```

---

## 22. Production 검증

Production에서는 기존 QA 계정만 사용한다.

허용:

```text
TestA
TestB
기타 is_internal_test=true 계정
```

실제 사용자에게 테스트 푸시 전송 금지.

검증:

- 미션1 1회
- 미션2 1회
- 실제 디바이스 수신 여부
- 로그
- Cron 정기 발송 영향 없음

---

## 23. 브라우저 Console 검증

현재:

```text
/api/cron/mission-start ... 401
```

수정 후 관리자 테스트 버튼 클릭 시 위 요청 자체가 발생하면 실패.

기대:

```text
POST /api/admin/push-test/send
2xx
```

Console 401 0건.

---

## 24. 수정 대상 파일

Antigravity 감사 기준 최소:

```text
app/admin/(dashboard)/PushTestTab.tsx
app/api/cron/mission-start/route.ts
lib/mission/missionPushService.ts
app/api/admin/push-test/send/route.ts
```

필요 시:

```text
관리자 아이 검색 API/컴포넌트
admin audit helper
```

---

## 25. 완료 조건

- 관리자 UI에서 Cron endpoint 직접 호출 제거
- 관리자 전용 POST API 구현
- `requireAdmin()` 적용
- QA/Internal Test 계정만 발송 가능
- 실사용자 서버 차단
- 공통 `missionPushService` 구현
- Cron route가 공통 서비스 재사용
- Cron Secret 검증 그대로 유지
- 클라이언트 Secret 노출 0건
- `testChildId` Cron query 의존 제거
- 미션1/2 실제 템플릿 유지
- 관리자 테스트 시간대 제한 없음
- 테스트 발송이 정기 Cron idempotency 오염하지 않음
- 감사 로그 기록
- UI 중복 클릭 방지
- Production QA 미션1 수신 PASS
- Production QA 미션2 수신 PASS
- Cron 인증 회귀 PASS
- Browser Console 401 0건
- TypeScript 오류 0건
- Build 성공
- Dev E2E PASS
- Production 배포 완료

---

## 26. 완료 보고 형식

1. 기존 401 원인
2. 기존 버튼→Cron 흐름
3. 신규 관리자 전용 API
4. 관리자 인증 방식
5. 테스트 계정 판정 기준
6. 공통 푸시 서비스 구조
7. Cron 리팩터링
8. 미션1/미션2 차이 유지 결과
9. 관리자 테스트와 정기 발송 idempotency 분리
10. 감사 로그
11. 실제 사용자 오발송 차단 테스트
12. Cron Secret 회귀 테스트
13. Dev QA 결과
14. Production QA 미션1/2 결과
15. Browser Console 401 제거
16. 수정 파일
17. TypeScript/Build
18. Production 배포 커밋
19. Deployment ID / READY
20. 남은 위험

---

## 27. 보안 및 작업 제한

- Cron 인증 제거/완화 금지
- CRON_SECRET 클라이언트 노출 금지
- BATCH_SECRET 클라이언트 노출 금지
- NEXT_PUBLIC Secret 생성 금지
- 실사용자 테스트 푸시 금지
- Cron endpoint에 관리자 테스트용 bypass 추가 금지
- `testChildId`만 붙여 Cron을 재사용하는 방식 금지
- 실제 정기 푸시 전체 대상 로직을 관리자 API에서 재사용 금지
- Production 신규 테스트 Auth/가족 생성 금지
