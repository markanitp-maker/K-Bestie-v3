# 퀴즈마스터 메인 앱 연동 구현

## 작업 정보

- 대상 프로젝트: `K-Bestie-v3` 메인 앱
- 우선순위: 높음
- 연동 대상: 별도 `quizmaster` 앱
- 선행 상태:
  - 퀴즈마스터 측 구현 완료
  - Dev Supabase 적용 및 검증 완료
  - 상세 계약 문서: 퀴즈마스터 저장소 `docs/reward-ownership-flow.md`

## 목적

퀴즈마스터 앱과 K-Bestie-v3 메인 앱 간 황금열쇠, 자녀 학년, 완료/환불 콜백 연동을 구현한다.

- 메인 앱이 퀴즈 시작 전 황금열쇠를 차감하고 자녀 학년을 포함한 handoff token을 발급한다.
- 퀴즈마스터가 보내는 완료 및 환불 콜백을 메인 앱이 중복 없이 안전하게 처리한다.
- 메인 앱이 황금열쇠 잔액과 거래 상태의 최종 소유권을 유지한다.

퀴즈마스터는 별도 서비스로 운영되며, 전달받은 handoff token 기준으로 실행한다.

---

## 핵심 책임 분리

### 메인 앱 책임

- 자녀 및 사용자 인증
- 자녀 실제 학년 조회
- 황금열쇠 잔액 확인 및 1개 차감
- `reward_transaction_id` 생성 및 거래 상태 관리
- `quiz_handoff_tokens` 발급
- 완료 및 환불 콜백 수신
- 콜백 인증과 멱등성 보장
- 정상 소비 확정 또는 환불 처리

### 퀴즈마스터 책임

- 전달받은 handoff token 검증 및 소비
- 학년에 맞는 퀴즈 실행
- 퀴즈 진행 및 제출 처리
- 정상 완료 또는 실패 환불 중 하나의 콜백만 전송

퀴즈마스터가 황금열쇠 잔액을 직접 수정하거나 자녀 학년을 추론하게 만들지 않는다. `child_id`, `reward_transaction_id`는 퀴즈마스터가 파싱하지 않는 불투명 값으로 전달만 한다.

---

## 작업 1. 퀴즈마스터 시작 및 handoff token 발급

사용자가 메인 앱에서 "퀴즈마스터 시작"을 선택하면 다음 순서로 처리한다.

1. 현재 로그인한 아이와 사용자 확인
2. 해당 아이의 실제 학년 조회
3. 학년이 1~6 범위인지 검증 (없으면 시작 차단)
4. 황금열쇠 잔액 확인
5. 황금열쇠 1개 차감
6. 이번 차감 거래의 고유 `reward_transaction_id` 생성
7. 60초 동안 유효한 일회용 token 생성
8. `quiz_handoff_tokens`에 필수 필드 저장
9. 저장 성공 후 퀴즈마스터 앱으로 이동

### 필수 저장 필드

```sql
insert into quiz_handoff_tokens
  (
    token,
    user_id,
    status,
    expires_at,
    child_id,
    grade,
    reward_transaction_id
  )
values
  (
    <일회용 토큰>,
    <auth.users.id>,
    'pending',
    <현재 시각 + 60초>,
    <자녀 프로필 id>,
    <자녀 실제 학년 1~6>,
    <황금열쇠 차감 거래 고유 id>
  );
```

### 필드 규칙

**`token`**
- 암호학적으로 충분히 예측 불가능한 일회용 값
- 원문/해시 저장 여부는 기존 퀴즈마스터 계약을 따른다.
- 재사용할 수 없어야 한다.

**`user_id`**
- 현재 인증된 메인 앱 사용자의 `auth.users.id`
- 클라이언트 요청값을 그대로 신뢰하지 않는다.

**`status`**
- 최초 발급 시 `pending`

**`expires_at`**
- 발급 시각(서버 시각 기준)으로부터 60초

**`child_id`**
- 현재 로그인한 아이의 자녀 프로필 ID
- 퀴즈마스터에서는 불투명 문자열로 취급
- 가능하면 반드시 전달하며, 메인 앱에서 현재 사용자와 자녀의 소유 관계를 검증한다.

**`grade`**
- 현재 자녀 프로필의 실제 학년 (허용값 1~6, 필수)
- 값이 없거나 범위를 벗어나면 퀴즈 시작을 차단한다.
- 기본 학년을 임의로 적용하지 않는다.
- 클라이언트가 전달한 학년이 아니라 서버에서 조회한 프로필 값을 사용한다.

**`reward_transaction_id`**
- 황금열쇠 차감 건을 식별하는 고유 문자열
- 퀴즈마스터가 파싱하지 않는 불투명 값
- 환불 및 완료 콜백의 `Idempotency-Key`로 재사용
- 동일한 시작 요청에서 중복 생성 및 중복 차감되지 않도록 관리한다.

### 원자성 및 실패 보상

황금열쇠 차감과 handoff token 생성 사이에 부분 실패가 발생하지 않도록 처리한다.

권장 우선순위:
1. 기존 Supabase RPC 또는 DB transaction 패턴이 있으면 재사용
2. 하나의 원자적 RPC에서 잔액 확인, 황금열쇠 차감, 보상 거래 생성, handoff token 생성을 함께 처리
3. 불가피하게 단계가 분리되면 token 생성 실패 시 즉시 동일 거래를 원복

다음 상태는 허용하지 않는다.
- 황금열쇠는 차감됐지만 token은 생성되지 않음
- token은 생성됐지만 황금열쇠 거래가 없음
- 같은 클릭으로 황금열쇠가 두 번 차감됨
- 만료 또는 실패한 token으로 퀴즈가 시작됨

---

## 작업 2. 환불 콜백 API 구현

### 엔드포인트

```text
POST /api/rewards/golden-key/refund
```

### 요청 헤더

```text
Authorization: Bearer <MAIN_APP_REWARDS_API_KEY>
Idempotency-Key: <reward_transaction_id>
Content-Type: application/json
```

### 요청 본문

```json
{
  "reward_transaction_id": "opaque-transaction-id",
  "user_id": "auth-user-id",
  "child_id": "child-profile-id-or-null",
  "quizmaster_attempt_id": "quizmaster-attempt-id",
  "reason": "quiz_engine"
}
```

### 처리 조건

- 서버 간 API 키가 일치해야 한다.
- `Idempotency-Key` 헤더가 필수이며, 헤더 값과 본문의 `reward_transaction_id`가 일치해야 한다.
- 실제 퀴즈마스터 시작 시 생성된 거래인지 확인한다.
- 요청의 `user_id`, `child_id`가 기존 거래와 일치하는지 확인한다.
- 필요하면 `quizmaster_attempt_id`를 거래 기록에 저장한다.
- 거래가 환불 가능한 상태이면 황금열쇠 1개를 환불한다.
- 동일 요청이 반복되어도 실제 환불은 정확히 한 번만 수행한다. 이미 환불된 거래에는 잔액을 추가하지 않고 성공 또는 명시적 중복 처리 응답을 반환한다.
- 이미 정상 완료로 확정된 거래는 환불하지 않는다.

### 상태 전이

허용: `reserved` 또는 `charged` → `refunded`
불허: `completed → refunded`, `refunded → refunded` 잔액 증가

---

## 작업 3. 완료 콜백 API 구현

### 엔드포인트

```text
POST /api/quiz/completion
```

### 요청 헤더

```text
Authorization: Bearer <MAIN_APP_REWARDS_API_KEY>
Idempotency-Key: <reward_transaction_id>
Content-Type: application/json
```

### 요청 본문

```json
{
  "reward_transaction_id": "opaque-transaction-id",
  "user_id": "auth-user-id",
  "child_id": "child-profile-id-or-null",
  "quizmaster_attempt_id": "quizmaster-attempt-id",
  "score": 80,
  "completed_at": "2026-07-25T00:00:00.000Z"
}
```

### 처리 조건

- 서버 간 API 키 검증
- `Idempotency-Key` 필수 검증 및 헤더/본문의 `reward_transaction_id` 일치 확인
- 기존 황금열쇠 거래와 사용자·자녀 정보 일치 확인
- `score` 타입 및 허용 범위 검증
- `completed_at` ISO 8601 검증
- 최초 완료 요청에서 황금열쇠 거래를 정상 소비 완료 상태로 확정
- 동일 요청이 반복되어도 완료 기록이나 추가 보상이 중복 생성되지 않아야 한다.
- 이미 환불된 거래는 완료 상태로 변경하지 않는다.
- 완료 이벤트 저장이 필요하면 기존 놀이 완료 이벤트 구조를 재사용한다. (추가 보상 로직 확장 가능하도록 구조화)

### 상태 전이

허용: `reserved` 또는 `charged` → `completed`
불허: `refunded → completed`, `completed → 중복 보상`

---

## 멱등성 스코프

퀴즈마스터는 두 콜백에 동일한 `reward_transaction_id`를 사용한다. 메인 앱의 멱등성 저장 키는 엔드포인트별로 분리한다.

```text
quiz_refund:<reward_transaction_id>
quiz_completion:<reward_transaction_id>
```

엔드포인트별 멱등 키가 분리되어 있어도 거래의 최종 상태는 하나만 허용해야 한다. 다음 조건을 모두 만족해야 한다.

- 같은 refund 요청 반복: 환불 1회
- 같은 completion 요청 반복: 완료 처리 1회
- 완료된 거래에 refund 도착: 환불 거부
- 환불된 거래에 completion 도착: 완료 거부
- 경합 요청 발생 시 DB 원자 조건으로 한쪽 상태 전이만 성공

퀴즈마스터 측에서 refund와 completion이 동시에 발생하지 않도록 보장하지만, 메인 앱도 독립적으로 방어해야 한다.

---

## 서버 간 인증

구현 규칙:
- `MAIN_APP_REWARDS_API_KEY`는 서버 전용 환경변수로 관리하고 `NEXT_PUBLIC_` 접두사를 사용하지 않는다.
- 로그에 전체 키를 출력하지 않는다.
- Bearer token 비교 시 가능한 경우 timing-safe 비교를 사용한다.

응답 코드:
- 인증 실패: `401`
- 권한 또는 계약 불일치: `403`
- 잘못된 요청: `400`
- 이미 처리된 동일 요청: 멱등 성공 응답 또는 계약에 정의된 동일 응답
- 내부 오류: 민감한 DB 정보 없이 `500`

---

## 환경변수 및 배포 설정

### 메인 앱

```text
MAIN_APP_REWARDS_API_KEY=<충분히 긴 서버 간 비밀키>
```

메인 앱은 콜백 수신 서버이므로 자기 자신의 API base URL이 필수는 아니다. 기존 코드나 운영 구조상 필요할 때만 추가한다.

### 퀴즈마스터

```text
MAIN_APP_REWARDS_API_BASE_URL=<메인 앱의 실제 API 베이스 URL>
MAIN_APP_REWARDS_API_KEY=<메인 앱과 동일한 서버 간 비밀키>
```

Dev와 Production 값을 분리한다.

```text
Dev:
MAIN_APP_REWARDS_API_BASE_URL=https://<dev-main-app-domain>

Production:
MAIN_APP_REWARDS_API_BASE_URL=https://app.k-bestie.com
```

Production 값은 대표님 승인 전 임의로 설정하거나 배포하지 않는다.

---

## 기존 구조 재사용 원칙

작업 전 다음 기존 구현을 조사한다.
- 황금열쇠 잔액 및 거래 테이블
- 황금열쇠 차감 RPC
- MBTI 놀이 시작 처리 및 `/api/play/consume`
- 놀이 완료 이벤트 처리
- 기존 idempotency 구현
- `playSessionId` 인증 구조, `k_play_sessions`
- `progress_state` 저장 구조
- 자녀 프로필 및 학년 조회 구조
- 부모 리포트용 놀이 이벤트 구조

이미 존재하는 공통 로직을 우회해 퀴즈 전용 황금열쇠 시스템을 새로 만들지 않는다. 단, 퀴즈마스터는 별도 앱으로 handoff 및 callback 계약을 사용하므로 MBTI의 내부 `/play/mbti` 화면 구조를 억지로 그대로 적용하지 않는다.

요구사항:
- 기존 MBTI 기능 회귀 방지
- 황금열쇠 중복 차감 방지
- 놀이별 데이터 namespace 충돌 방지 (헤어스타일/만화책 등 향후 놀이 확장성 고려)

---

## 데이터 모델 검토

기존 보상 거래 테이블이 아래 정보를 수용할 수 있는지 먼저 확인한다.
- `reward_transaction_id`
- 거래 대상 사용자 / 자녀
- 놀이 유형 `quiz`
- 차감 수량 `1`
- 거래 상태
- 외부 attempt ID
- 완료 시각
- 환불 사유
- 생성 및 갱신 시각

기존 테이블로 충분하면 재사용한다. 부족한 경우 최소 마이그레이션만 추가하고, 동일 목적의 보상 거래 테이블을 중복 생성하지 않는다.

---

## 보안 검증

- 콜백 body의 `user_id`만 믿고 잔액을 수정하지 않는다. 반드시 `reward_transaction_id`에 연결된 원래 사용자와 비교한다.
- `child_id` 역시 기존 거래 정보와 비교한다.
- 황금열쇠 수량은 요청 body에서 받지 않고 항상 해당 거래 계약의 1개로 처리한다.
- `reason`은 허용 길이를 제한하고 로그 인젝션을 방지한다.
- `quizmaster_attempt_id` 중복 또는 변조 여부를 확인한다.
- 서비스 역할 키는 서버에서만 사용한다.
- 클라이언트에서 직접 콜백 API를 호출해 보상을 조작할 수 없어야 한다.

---

## UX 처리

**학년 정보 없음**
퀴즈마스터를 시작시키지 않고 아이가 이해할 수 있는 안내를 표시한다.
```text
퀴즈를 시작하려면 보호자 설정에서 학년 정보를 먼저 확인해 주세요.
```

**황금열쇠 부족**
기존 놀이 공통 안내를 재사용한다.

**시작 처리 실패**
황금열쇠가 차감되지 않았거나 자동 원복됐음을 명확히 처리하고, 퀴즈마스터로 이동시키지 않는다.

**handoff token 만료**
퀴즈마스터에서 반환하는 에러 계약을 확인해 메인 앱 놀이 화면으로 안전하게 복귀시키고 재시작할 수 있도록 한다. 재시작 시 중복 차감을 막는다.

---

## 테스트 시나리오

### A. 정상 시작
1. 학년이 등록된 아이로 로그인
2. 황금열쇠 잔액 확인
3. 퀴즈마스터 시작 클릭
4. 황금열쇠 1개 차감
5. `reward_transaction_id` 생성
6. `quiz_handoff_tokens` 생성 및 `child_id`, `grade`, `reward_transaction_id` 정확성 확인
7. 퀴즈마스터 정상 진입 확인

### B. 학년 누락
1. 학년이 없는 테스트 아이로 시작
2. handoff token 미생성 및 황금열쇠 미차감 확인
3. 안내 문구 확인

### C. 황금열쇠 부족
1. 잔액 0인 아이로 시작
2. token 및 거래 미생성 확인
3. 기존 부족 안내 확인

### D. 중복 시작 클릭
1. 시작 버튼을 빠르게 여러 번 클릭
2. 황금열쇠 1개만 차감, 유효한 시작 거래 1건만 생성
3. 중복 이동 및 중복 token 발급 없음 확인

### E. 정상 완료
1. 퀴즈 정상 제출
2. `/api/quiz/completion` 수신
3. 거래 상태 `completed`, 점수와 attempt ID 저장 확인
4. 황금열쇠 추가 차감 없음 확인
5. 필요 시 완료 이벤트 1회 기록 확인

### F. 완료 콜백 중복
1. 동일 body와 동일 `Idempotency-Key`로 여러 번 호출
2. 거래 상태 변화 1회, 완료 이벤트 1회, 추가 보상 1회 이하 확인

### G. 오류 환불
1. 퀴즈마스터 오류 상황에서 refund 호출
2. 황금열쇠 1개 환불, 거래 상태 `refunded`
3. 환불 사유와 attempt ID 기록 확인

### H. 환불 콜백 중복
1. 동일 refund 콜백 반복 전송
2. 황금열쇠가 정확히 1개만 환불되는지 확인

### I. 상충 콜백 방어
1. completion 처리 후 refund 호출 → 환불되지 않는지 확인
2. refund 처리 후 completion 호출 → 완료 확정 및 추가 보상이 발생하지 않는지 확인

### J. 인증 오류
1. Authorization 헤더 없음 / 잘못된 API 키
2. `Idempotency-Key` 없음
3. 헤더와 body의 거래 ID 불일치
4. 각각 안전하게 거부되는지 확인

### K. 기존 기능 회귀
- MBTI 시작·이어하기·완료
- 기존 황금열쇠 차감
- 기존 놀이 카드 화면
- 자녀 로그인
- 부모 화면의 놀이 사용 내역
- 기존 Supabase RLS 및 RPC

---

## 구현 순서

1. `docs/reward-ownership-flow.md` 확인
2. 메인 앱 기존 황금열쇠 및 놀이 구조 조사
3. 영향 범위 및 재사용 계획 작성
4. 필요한 최소 DB 마이그레이션 또는 RPC 작성
5. 퀴즈 시작 handoff 구현
6. refund callback 구현
7. completion callback 구현
8. 멱등성 및 상태 경합 테스트
9. 기존 MBTI 회귀 테스트
10. Dev 환경 E2E 검증
11. 독립 코드 리뷰 및 보안 리뷰
12. 수정 사항 반영 후 재검증
13. 커밋 및 결과 보고

---

## 완료 조건

- 메인 앱에서 퀴즈마스터 시작 시 황금열쇠 1개만 차감된다.
- handoff token에 `child_id`, `grade`, `reward_transaction_id`가 정확히 저장된다.
- 학년이 없으면 차감과 token 생성 없이 시작이 차단된다.
- grade 기반 문제 출제가 정상 확인된다.
- refund 콜백이 중복 호출돼도 황금열쇠는 1개만 환불된다.
- completion 콜백이 중복 호출돼도 완료 및 보상 처리는 1회만 발생한다.
- 환불과 완료 상태가 상호 배타적으로 유지된다.
- 서버 간 API 키와 Idempotency-Key 검증이 적용된다.
- 기존 MBTI 및 황금열쇠 기능에 회귀가 없다.
- 실제 브라우저와 Dev Supabase를 이용한 E2E 검증을 완료한다.
- 임시 테스트 파일과 프로세스를 정리한다.
- 독립 리뷰에서 BLOCKED/HIGH/MEDIUM 이슈가 모두 해소된다.
- 변경 사항을 하나의 의미 있는 커밋으로 생성한다.
- Production 적용은 대표님 승인 전 진행하지 않는다.

---

## 결과 보고 형식

완료 후 아래 항목을 보고한다: 변경 파일, DB 마이그레이션 및 RPC, handoff token 생성 흐름, 황금열쇠 차감 및 원복 방식, refund 콜백 처리 결과, completion 콜백 처리 결과, 멱등성 구현 방식, 환불·완료 경합 방어 방식, 환경변수 목록과 Dev 설정 상태, 정상·중복·오류 E2E 결과, 기존 MBTI 회귀 테스트 결과, 독립 리뷰 결과와 수정 내역, 커밋 해시, Production 반영 전 남은 작업.

---

주요 정리 내용은 다음과 같습니다. 두 문서의 목적·작업 정보·책임 분리를 하나로 통합했고, handoff token 필드 규칙과 원자성 처리를 작업 1로 병합했습니다. 환불/완료 API의 중복되던 헤더·인증·상태 전이 설명을 각 작업 섹션과 공통 인증 섹션으로 분리 정리했으며, 첫 번째 문서에만 있던 항목(`playSessionId`, `progress_state`, grade 기반 출제 확인, 향후 놀이 확장성)도 누락 없이 반영했습니다.