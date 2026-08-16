# REQUEST: 가족 구성원 1회용 초대 링크 기반 참여 플로우 구현

## 0. 목적

현재 가족 구성원 초대가 이메일 문자열 매칭에 의존하면 다음 문제가 반복될 수 있다.

- 가족 오너가 상대방의 실제 로그인 이메일을 정확히 모름
- 초대한 이메일과 실제 Google/Kakao 로그인 계정 이메일이 다름
- 초대 레코드의 `target_user_id`가 NULL로 남음
- 참여자가 초대를 조회하거나 수락하지 못함
- pending 초대만 남고 `family_members` 연결은 생성되지 않음

따라서 가족 구성원 초대 방식을 **이메일 매칭 중심 구조에서 1회용 초대 링크 중심 구조로 전환**한다.

핵심 원칙:

> 초대 링크는 “어느 가족에 참여할 권한이 있는지”를 증명하고, 실제 가족 구성원 신원은 링크를 연 뒤 Google/Kakao 등으로 로그인한 `auth.user.id`로 확정한다.

이메일 주소는 초대 대상 매칭 조건으로 사용하지 않는다.

---

## 1. 최종 정책

가족 오너가 생성한 가족 구성원 초대 링크는 반드시 **1회용(one-time)** 으로 동작한다.

정상 흐름:

```text
가족 오너
→ 가족 구성원 초대하기
→ 1회용 초대 링크 생성
→ 카카오톡/공유하기/링크 복사/QR로 전달

초대받은 보호자
→ 초대 링크 클릭
→ Google 또는 Kakao 로그인
→ 서버에서 실제 auth.user.id 확인
→ 초대 대상 가족 확인
→ 가족 보호자 구성원(parent)으로 연결
→ 연결 성공과 동시에 초대 토큰 CONSUMED 처리
→ 보호자 홈
```

한 번 성공적으로 사용된 링크는 그 이후 누구도 다시 사용할 수 없다.

예:

```text
엄마가 초대 링크 생성
→ 아빠가 링크로 로그인 및 가족 연결 성공
→ 링크 폐기

아빠가 같은 링크를 할머니에게 전달
→ 사용 불가
→ "이미 사용된 초대 링크입니다. 새로운 초대를 받아 주세요."
```

---

## 2. 절대 금지 사항

다음 방식은 구현하지 않는다.

- 초대 대상 이메일과 로그인 이메일 일치 여부로 가족 연결
- `target_email`을 가족 구성원 identity로 사용
- 링크 URL에 family_id를 평문 권한키처럼 사용
- 링크 URL에 `user_id`, access token, refresh token, session, service_role key 포함
- 로그인하지 않은 사용자를 링크 클릭만으로 가족에 연결
- 한 링크로 여러 가족 구성원을 추가
- 한 번 사용된 링크 재사용
- 사용 성공 전에 토큰을 무조건 폐기
- 프런트엔드에서만 used 상태를 판단
- 클라이언트가 전달한 family_id/role을 신뢰하여 연결
- 직접 `family_members` INSERT를 여러 단계로 나누어 부분 성공 상태 생성
- 실제 사용자 데이터를 자동 삭제/병합

---

## 3. 기존 구현 조사 우선

코드 수정 전 현재 프로젝트의 가족 초대/참여 구조를 먼저 조사한다.

최소 확인 대상:

- `family_members`
- 기존 `owner_invite`
- 기존 `member_request`
- `accept_family_invite`
- `invite-member`
- `invite-parent`
- `pending-invite`
- 가족 참여/초대 관련 RPC
- 현재 가족 역할 enum
- 보호자 membership 라우팅
- `resolveMembershipState`
- 기존 `/signup` 3/4 가족 설정
- 보호자 설정의 가족 관리 UI

기존 초대 테이블/RPC가 재사용 가능하면 우선 재사용하고, 동일 목적의 신규 테이블을 불필요하게 중복 생성하지 않는다.

단, 기존 구조가 이메일 매칭을 전제로 하여 안전한 1회용 token consumption을 지원하지 못한다면 최소 범위로 확장한다.

---

## 4. 초대 생성 UX — 가족 오너

보호자 설정 또는 가족 관리 화면에서 가족 오너에게 다음 액션을 제공한다.

```text
가족 구성원

박지현
가족 오너

[ + 가족 구성원 초대하기 ]
```

버튼 클릭 시 이메일 입력창을 보여주지 않는다.

대신 다음 UI를 제공한다.

```text
가족 구성원을 초대해 주세요

아래 초대 링크를 가족에게 보내주세요.
상대방은 본인이 사용하는 Google 또는 Kakao 계정으로 로그인하면 됩니다.

[ 카카오톡으로 공유 ]
[ 링크 공유 ]
[ 초대 링크 복사 ]

또는

[ QR 코드 보여주기 ]

초대 코드
K7P4-29DX
[복사]
```

### 4.1 공유 방식

우선순위:

1. Web Share API 기반 `공유하기`
   - 모바일에서 카카오톡/문자/AirDrop 등 OS 공유 시트 사용 가능
2. `초대 링크 복사`
3. QR 표시
4. 필요 시 짧은 초대 코드 입력 fallback

카카오톡 SDK가 기존 프로젝트에 이미 안정적으로 연결되어 있으면 `카카오톡으로 공유` 전용 버튼을 제공할 수 있다.

카카오 SDK가 없다면 이번 작업에서 카카오 SDK를 새로 크게 도입하지 말고 Web Share API를 기본으로 사용한다.

---

## 5. 초대 링크 형식

예시:

```text
https://app.k-bestie.com/family/invite/<opaque-token>
```

또는:

```text
https://app.k-bestie.com/join/<opaque-token>
```

현재 routing convention에 맞는 짧고 명확한 경로를 사용한다.

### 금지

다음과 같은 구조는 금지한다.

```text
/family/join?family_id=<uuid>
```

family_id만 알면 참여할 수 있는 구조로 만들지 않는다.

---

## 6. 초대 토큰 보안

초대 토큰은 충분히 예측 불가능한 cryptographically secure random 값이어야 한다.

권장:

- 최소 128-bit 이상의 랜덤 entropy
- URL-safe token
- 원문 token을 DB에 평문 저장하지 않는 방식을 우선 검토
- DB에는 token hash 저장
- 사용자가 보낸 token을 서버에서 hash 후 비교

예:

```text
raw token → 사용자에게 전달
SHA-256(token) → DB 저장
```

토큰 관련 필드 예시:

```text
id
family_id
created_by_user_id
token_hash
status
expires_at
consumed_at
consumed_by_user_id
revoked_at
created_at
```

상태 예시:

```text
PENDING
CONSUMED
REVOKED
EXPIRED
```

기존 초대 테이블에 동일 역할 컬럼이 있으면 재사용한다.

---

## 7. 1회용 소비 정책

링크는 **클릭 시점이 아니라 가족 구성원 연결 성공 시점**에 소비한다.

잘못된 흐름:

```text
링크 클릭
→ 즉시 USED
→ OAuth 취소
→ 사용자는 다시 못 들어옴
```

정상 흐름:

```text
링크 클릭
→ PENDING 확인
→ 로그인
→ 가족 연결 검증
→ family_members 생성 성공
→ 토큰 CONSUMED
```

---

## 8. 멱등성 정책

다음 상황을 모두 안전하게 처리해야 한다.

### 같은 사용자가 성공 직후 같은 요청을 재전송

예:

- 더블클릭
- 모바일 네트워크 재시도
- 브라우저 refresh
- callback 중복 호출

처리:

```text
이미 동일 invite를 동일 user가 소비했고
동일 family_members 연결이 존재
→ idempotent success
→ 중복 family_members 생성 금지
```

### 다른 사용자가 이미 소비된 링크 사용

```text
CONSUMED
consumed_by_user_id != current_user.id
→ 무조건 거부
```

사용자 문구:

`이미 사용된 초대 링크입니다. 새로운 초대를 받아 주세요.`

---

## 9. 만료 정책

1회용이어도 무기한 링크는 사용하지 않는다.

권장 기본값:

```text
72시간
```

운영 설정값으로 관리 가능하게 구현할 수 있다.

예:

```text
FAMILY_INVITE_TTL_HOURS=72
```

만료된 링크:

```text
이 초대 링크는 만료되었습니다.
가족 오너에게 새로운 초대를 요청해 주세요.
```

오너는 새 링크를 발급할 수 있어야 한다.

---

## 10. 초대 취소 및 재발급

가족 오너는 사용되지 않은 초대를 취소할 수 있어야 한다.

```text
초대 대기 중
생성: 2026-08-08
만료: 2026-08-11

[초대 링크 다시 보기]
[초대 취소]
```

취소 후:

```text
status = REVOKED
revoked_at = now()
```

기존 링크는 즉시 사용 불가.

새 구성원을 추가하려면 반드시 새로운 링크를 생성한다.

---

## 11. 초대받은 사용자 — 로그인 전 화면

초대 링크를 열면 바로 가족에 연결하지 않는다.

로그인 전:

```text
가족에 초대받았어요

가족에 참여하려면
본인이 사용하는 계정으로 로그인해 주세요.

[ Google로 계속하기 ]
[ Kakao로 계속하기 ]
```

가능하면 오너 이름 또는 가족 표시명을 과도한 개인정보 없이 표시한다.

예:

```text
박지현님의 가족에 초대받았어요.
```

단, token 유효성 확인 전에 가족 상세정보를 과도하게 노출하지 않는다.

---

## 12. OAuth 이후 invite context 유지

Google/Kakao OAuth로 외부 이동 후 callback을 거쳐도 invite token context가 유지되어야 한다.

예:

```text
/family/invite/<token>
→ Google login
→ /auth/callback?next=/family/invite/<token>
→ token 재검증
→ 가족 연결
```

보안 규칙:

- `next`는 내부 allowlist 경로만 허용
- open redirect 금지
- token은 서버에서 재검증
- 로그인 전 token 검증 결과를 신뢰한 채 재사용하지 않음

---

## 13. 가족 연결 처리

로그인 완료 후 서버에서:

1. 현재 세션 검증
2. `auth.user.id` 확인
3. invite token 재검증
4. token status = PENDING 확인
5. expires_at 확인
6. revoked 여부 확인
7. invite family 확인
8. 현재 사용자가 이미 다른 가족에 활성 보호자로 속하는지 기존 정책 확인
9. 동일 family에 이미 연결되어 있는지 확인
10. `family_members` parent 연결
11. invite token CONSUMED 처리
12. 보호자 membership 상태 갱신
13. 완료 후 `/parent/home`

### role

초대된 보호자는 기본:

```text
role = parent
```

가족 오너 권한을 자동 부여하지 않는다.

기존 프로젝트의 parent role 이름이 다르면 현재 enum을 재사용한다.

---

## 14. 트랜잭션 필수

다음은 반드시 하나의 서버 트랜잭션/RPC 안에서 처리한다.

```text
invite 잠금
→ invite 유효성 재확인
→ family_members 생성/복원
→ membership 상태 갱신
→ invite CONSUMED 처리
```

중간에 실패하면 전체 rollback.

절대 다음 상태가 남으면 안 된다.

```text
family_members는 생성됐는데 invite는 PENDING
```

또는:

```text
invite는 CONSUMED인데 family_members 생성 실패
```

동시 요청 방지를 위해:

- `SELECT ... FOR UPDATE`
- 또는 적절한 advisory lock

중 현재 DB 구조에 맞는 방식을 사용한다.

---

## 15. 기존 가족 데이터 공유

초대된 보호자가 가족에 연결되면:

- 새 family 생성 금지
- 새 child 생성 금지
- 기존 아이 그대로 사용
- 기존 가족 관계 유지
- 기존 아이 리포트/설정 접근은 기존 보호자 권한 정책에 따름

즉:

```text
엄마 family_id = F1
아빠 invite 수락
→ 아빠 family_members.family_id = F1
```

이다.

F2를 새로 만들면 FAIL.

---

## 16. 회원가입 3/4 가족 설정과 연결

신규 보호자 온보딩 3/4는 두 선택지를 유지한다.

```text
3 / 4 가족 설정

[ 새로운 가족 만들기 ]

[ 기존 가족에 참여하기 ]
```

### 새로운 가족 만들기

기존 확정 흐름 유지:

```text
가족 생성
→ owner_parent
→ 4/4 아이 등록
```

### 기존 가족에 참여하기

다음 UI 제공:

```text
기존 가족에 참여하기

가족에게 받은 초대 링크를 열어주세요.

[ 초대 코드 입력 ]

또는

이미 초대 링크로 들어오셨다면
로그인 후 자동으로 연결됩니다.
```

이메일 입력 방식은 제거한다.

`가족 오너 이메일 입력` UI/API는 신규 경로에서 사용하지 않는다.

---

## 17. 초대 코드 fallback

링크/QR 사용이 어려운 사용자를 위해 짧은 코드도 제공할 수 있다.

예:

```text
K7P4-29DX
```

코드는 invite token과 1:1 대응한다.

코드 역시:

- 1회용
- 동일 expires_at
- 동일 status
- 링크 소비 시 코드도 소비됨
- 코드 소비 시 링크도 소비됨

즉 “링크와 코드가 별도 초대권”이 아니라 **같은 invite record의 표현만 다름**.

---

## 18. QR fallback

QR은 invite URL을 표현한다.

```text
QR
→ https://app.k-bestie.com/family/invite/<token>
```

QR도 별도 권한이 아니다.

링크가 소비되면 QR도 즉시 무효화된다.

---

## 19. 보호자 설정 UI

가족 오너:

```text
가족 구성원

박지현
가족 오너

황두훈
보호자

[ + 가족 구성원 초대하기 ]
```

pending invite가 있으면:

```text
초대 대기 중

2026-08-08 생성
72시간 이내 사용 가능

[ 공유하기 ]
[ 링크 복사 ]
[ QR ]
[ 초대 취소 ]
```

소비 완료:

```text
황두훈
보호자
```

초대 링크 자체를 계속 노출하지 않는다.

---

## 20. 사용된 링크 화면

이미 소비된 링크를 다른 사람이 열면:

```text
이미 사용된 초대 링크예요

이 링크는 한 명의 가족 구성원만 사용할 수 있어요.
가족 오너에게 새로운 초대를 요청해 주세요.

[ 로그인 화면으로 ]
```

현재 소비자가 다시 같은 링크를 열었고 이미 가족 연결이 정상이라면:

```text
이미 가족에 참여되어 있어요.

[ 보호자 홈으로 이동 ]
```

으로 멱등 UX를 제공할 수 있다.

단, 다른 사용자에게는 절대 이 메시지로 우회 연결하지 않는다.

---

## 21. 보안 규칙

필수:

1. service_role client 노출 금지
2. invite token 평문 로그 출력 금지
3. token query/path 전체를 analytics/log에 남길 경우 마스킹 검토
4. family_id는 서버에서 invite record를 통해 결정
5. client가 family_id 변경 불가
6. role은 서버 고정 `parent`
7. 현재 user는 검증된 OAuth session에서 획득
8. 이메일 매칭 금지
9. consumed/revoked/expired token 거부
10. invite create 권한은 family owner만
11. 다른 parent가 무단 invite 생성 불가
12. 다른 가족 invite 조회 금지
13. 링크 사용 성공 후 재사용 차단
14. token brute force 방지
15. rate limiting 기존 인프라가 있으면 적용
16. Production 로그에 token 원문 금지

---

## 22. 기존 이메일 초대 데이터 처리

기존 Production에 `target_email` 기반 pending 초대가 존재할 수 있다.

자동으로 잘못된 계정에 연결하지 않는다.

정책:

- 기존 pending 이메일 초대는 legacy 상태로 구분
- 신규 UI에서는 이메일 초대 생성 금지
- 오너가 기존 pending 초대를 취소하고 새 1회용 링크를 발급할 수 있게 한다
- 이메일 불일치 데이터를 자동 매칭/병합 금지
- 실제 사용자 데이터 임의 수정 금지

필요하면 운영자 화면에:

```text
기존 방식 초대
재발급 필요
```

로 표시한다.

---

## 23. 필수 QA 시나리오

### A. 정상 1회 사용

```text
오너 링크 생성
→ 아빠에게 공유
→ 아빠 Google 로그인
→ family_members 생성
→ invite CONSUMED
→ 보호자 홈
```

PASS 조건:

- family 1개 유지
- child 추가 0건
- family_members parent 1건 추가
- invite CONSUMED
- consumed_by_user_id = 아빠
- consumed_at 존재

### B. Kakao 로그인

동일 링크 플로우를 Kakao 로그인으로 검증.

이메일 문자열 비교 없이 동작해야 함.

### C. 초대 이메일과 로그인 이메일 불일치

이번 구조에서는 초대 이메일 입력 자체가 없어야 한다.

Google/Kakao에서 반환된 실제 이메일이 어떤 값이어도 로그인된 user.id로 연결.

### D. 같은 링크를 다른 사람이 재사용

```text
아빠 소비 완료
→ 할머니 동일 링크 클릭
→ 로그인
```

결과:

```text
거부
family_members 추가 0건
```

### E. 같은 사용자의 중복 요청

```text
아빠 수락 버튼 더블클릭
```

결과:

- family_members 1건
- invite CONSUMED 1회
- 500 없음

### F. OAuth 취소

```text
링크 클릭
→ Google 로그인 취소
```

결과:

- invite PENDING 유지
- 다시 같은 링크 사용 가능

### G. 만료

expires_at 이후:

- 연결 불가
- EXPIRED 처리
- 새 초대 안내

### H. 오너 취소

REVOKED 이후:

- 링크/QR/코드 모두 사용 불가

### I. QR 사용

QR → 로그인 → 동일 invite consume.

### J. 초대 코드

코드 → 로그인 → 동일 invite consume.

### K. 기존 가족 데이터

두 보호자가 동일 family/child 조회.

새 family/child 생성 0건.

### L. 권한

일반 parent가 owner-only invite 기능을 사용할 수 없는지 현재 정책에 맞게 검증.

---

## 24. 완료 기준

다음 모두 PASS 시 완료.

- [ ] 이메일 입력 없는 가족 초대
- [ ] 오너만 초대 생성 가능
- [ ] 안전한 랜덤 1회용 invite token
- [ ] 링크 공유 가능
- [ ] Web Share API 정상
- [ ] 링크 복사 정상
- [ ] QR 정상
- [ ] 초대 코드 정상
- [ ] Google 로그인 후 실제 user.id로 연결
- [ ] Kakao 로그인 후 실제 user.id로 연결
- [ ] 가족 연결 성공 후 token CONSUMED
- [ ] 동일 링크 다른 사용자 재사용 차단
- [ ] 동일 사용자 재요청 멱등
- [ ] OAuth 실패 시 token 유지
- [ ] 만료 링크 차단
- [ ] 취소 링크 차단
- [ ] 신규 family 생성 0건
- [ ] 신규 child 생성 0건
- [ ] 기존 가족/아이 공유 정상
- [ ] 회원가입 3/4 기존 가족 참여와 연결
- [ ] 기존 이메일 초대 자동 오매칭 없음
- [ ] Dev 검증 PASS
- [ ] Production 검증 PASS
- [ ] 실제 브라우저 Google/Kakao 검증 PASS
- [ ] HIGH/BLOCKED 보안 이슈 0건

---

## 25. 결과 보고 형식

### 기존 구조 조사
- 기존 invite 테이블
- 기존 RPC/API
- 재사용 여부
- 이메일 매칭 의존 지점

### 변경 DB
- migration 파일
- 변경 테이블/컬럼/index/RPC
- token 저장 방식
- expires/consumed/revoked 정책

### 변경 API
- invite create
- invite resolve
- invite accept
- revoke
- code resolve

### 변경 UI
- 오너 초대
- 공유
- QR
- 코드
- 참여 화면
- 사용됨/만료/취소 화면

### 보안
- token 생성 방식
- token 로그 정책
- 권한 검증
- transaction/locking

### QA
- Google
- Kakao
- 재사용
- 중복 클릭
- OAuth 취소
- 만료
- revoke
- QR
- code
- 기존 가족 데이터

### 배포
- Dev
- Production
- commit SHA
- migration
- rollback

실제 브라우저와 Production DB 증거를 기반으로 PASS/FAIL을 보고한다.
