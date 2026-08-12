# 부모 플랜 자율 변경 및 Care Premium 환경별 노출 정책 구현

## 목적

현재 관리자 승인제를 유지하면서, 승인된 부모가 직접 `Care Start`와 `Care Insight` 사이에서 플랜을 자유롭게 변경할 수 있도록 한다.

Production에서는 `Care Insight`를 기본 플랜으로 사용하고, `Care Premium`은 선택할 수 없는 `준비 중` 상태로 표시한다. Development 환경에서는 기능 개발과 검증을 위해 `Care Premium` 선택을 허용한다.

---

## 핵심 정책

### 1. 관리자 승인 정책 유지

현재 Production의 베타 신청 및 관리자 승인 흐름은 유지한다.

- 신규 사용자는 가입 후 `승인 대기` 상태가 된다.
- 관리자가 베타 신청을 승인해야 서비스를 사용할 수 있다.
- 별도의 플랜 변경 승인 절차는 추가하지 않는다.
- 부모의 `Care Start ↔ Care Insight` 변경은 관리자 승인 없이 즉시 반영한다.

### 2. 기본 플랜 변경

신규 승인 사용자의 기본 플랜은 `Care Insight`로 설정한다.

```text
신규 가입
→ 관리자 베타 승인
→ 기본 플랜 Care Insight 적용
→ 서비스 이용 시작
```

기존 Production 사용자의 현재 플랜은 일괄 변경하지 않는다.

- 기존 `Care Start` 사용자는 그대로 유지한다.
- 기존 `Care Insight` 사용자는 그대로 유지한다.
- 플랜 값이 없거나 비정상인 신규 승인 사용자만 `Care Insight`를 기본 적용한다.
- 운영 데이터 전체를 강제로 `Care Insight`로 변경하는 Migration은 수행하지 않는다.

---

## 부모 플랜 변경 기능

승인된 부모가 부모 화면에서 직접 플랜을 변경할 수 있도록 한다.

허용되는 변경:

```text
Care Start → Care Insight 업그레이드
Care Insight → Care Start 다운그레이드
```

변경 정책:

- 관리자 승인 없이 즉시 적용한다.
- 별도의 결제 페이지로 이동하지 않는다.
- 자동결제를 실행하지 않는다.
- 변경 완료 후 현재 플랜과 이용 가능 기능을 즉시 갱신한다.
- 새로고침하거나 다시 로그인해도 변경 결과가 유지되어야 한다.
- 동일 플랜을 다시 선택하면 중복 변경 요청을 생성하지 않는다.
- 변경 처리 중 버튼 중복 클릭을 방지한다.
- 변경 실패 시 원인을 사용자에게 표시한다.

성공 안내 예시:

```text
Care Insight로 변경되었습니다.
새로운 플랜 기능을 지금부터 이용할 수 있습니다.
```

```text
Care Start로 변경되었습니다.
일부 리포트 및 장기 인사이트 기능 이용이 제한될 수 있습니다.
```

---

## 플랜 선택 UI

부모 설정 또는 플랜 관리 화면에 다음 3개 플랜을 표시한다.

### Care Start

- 선택 가능
- 현재 플랜이면 `현재 이용 중` 표시
- Care Insight 이용자가 선택하면 다운그레이드 확인창 표시

확인 문구 예시:

```text
Care Start로 변경하시겠습니까?

변경하면 Care Insight 전용 기능의 이용이 제한될 수 있습니다.
기존에 생성된 데이터는 현재 데이터 보존 정책에 따라 처리됩니다.
```

### Care Insight

- 선택 가능
- Production 신규 사용자의 기본 플랜
- 현재 플랜이면 `현재 이용 중` 표시
- Care Start 이용자가 선택하면 업그레이드 확인창 표시

확인 문구 예시:

```text
Care Insight로 변경하시겠습니까?

변경 즉시 Care Insight 기능을 이용할 수 있습니다.
```

### Care Premium

Production과 Development의 동작을 분리한다.

#### Production

- 플랜 카드는 표시한다.
- 선택 버튼은 비활성화한다.
- `준비 중` 배지를 표시한다.
- 클릭해도 플랜 변경 API를 호출하지 않는다.
- URL이나 API를 직접 호출해도 Premium으로 변경되지 않아야 한다.

표시 예시:

```text
Care Premium
준비 중
더 세심한 사람 지원 기능을 준비하고 있습니다.
```

#### Development·Preview

- `Care Premium` 선택을 허용한다.
- 기능 개발과 QA 목적으로 실제 플랜 변경이 가능해야 한다.
- Dev Supabase에만 반영한다.
- Production 사용자와 Production DB에는 영향을 주지 않는다.

---

## 서버 API 요구사항

기존 부모 플랜·승인 관련 API와 DB 구조를 먼저 감사하고 재사용한다.

중복 테이블이나 중복 플랜 변경 API를 새로 만들지 않는다.

필수 서버 검증:

1. 로그인한 부모만 요청할 수 있어야 한다.
2. 부모 자신의 플랜만 변경할 수 있어야 한다.
3. 승인 완료된 부모만 플랜을 변경할 수 있어야 한다.
4. 허용 플랜 값을 서버에서 검증한다.
5. Production에서는 `Care Premium` 요청을 반드시 거부한다.
6. 클라이언트 UI 비활성화만으로 보안을 처리하지 않는다.
7. Dev·Preview 환경에서만 `Care Premium` 변경을 허용한다.
8. 변경 결과는 실제 Production 또는 Dev 환경에 해당하는 Supabase에만 저장한다.
9. Service Role Key나 관리자 전용 API를 브라우저에 노출하지 않는다.

Production Premium 요청 차단 응답 예시:

```json
{
  "error": "Care Premium은 현재 준비 중입니다."
}
```

권장 HTTP 상태:

```text
403 Forbidden 또는 409 Conflict
```

프로젝트의 기존 API 오류 규칙이 있다면 그 규칙을 우선 적용한다.

---

## 환경 판별 원칙

환경 분기는 클라이언트 화면뿐 아니라 서버에서도 수행한다.

Production 판별 시 기존 환경변수를 우선 재사용한다.

예시 후보:

```text
VERCEL_ENV
NEXT_PUBLIC_SUPABASE_TARGET
NODE_ENV
```

Production 판정 예시:

```text
VERCEL_ENV=production
NEXT_PUBLIC_SUPABASE_TARGET=prod
```

Development·Preview 판정 예시:

```text
VERCEL_ENV=development 또는 preview
NEXT_PUBLIC_SUPABASE_TARGET=dev
```

한 환경변수만 신뢰하지 말고 현재 프로젝트의 기존 환경 분기 유틸리티가 있으면 반드시 재사용한다.

---

## 관리자 베타 신청 관리 화면

현재 관리자 베타 신청 승인·거절 기능은 유지한다.

신규 승인 시:

- 기본 플랜은 `Care Insight`로 설정한다.
- 현재처럼 승인 과정에서 플랜을 선택하게 하더라도 기본 선택값은 `Care Insight`여야 한다.
- Production에서는 `Care Premium`을 선택지로 제공하지 않거나 `준비 중` 비활성 상태로 표시한다.
- 관리자도 Production에서 사용자를 `Care Premium`으로 변경할 수 없어야 한다.
- Development에서는 관리자와 부모 모두 `Care Premium` 선택이 가능하다.

기존 승인 데이터와 승인 이력은 보존한다.

---

## 데이터 처리

기존 플랜 컬럼과 플랜 Enum 또는 Check Constraint를 우선 재사용한다.

확인 대상:

- 부모 또는 구독 테이블의 현재 플랜 컬럼
- 가입 승인 시 플랜 지정 로직
- 관리자 플랜 변경 API
- 부모 설정 페이지
- 플랜별 기능 접근 제어
- 리포트 보존 기간 및 기능 노출 로직
- 비용 집계 및 관리자 대시보드
- Middleware 및 서버 API의 플랜 검사
- Care Premium 전용 기능 검사

플랜 변경 이력 테이블이 이미 존재하면 변경 내역을 기록한다.

기존 이력 구조가 없다면 이번 요청만을 위해 불필요한 대형 구독 시스템을 새로 만들지 않는다. 감사 또는 장애 추적에 필요한 최소한의 이력이 필요할 때만 기존 패턴에 맞춰 추가한다.

---

## 플랜별 기능 정책

이번 요청에서는 기존 `Care Start`, `Care Insight`, `Care Premium`의 기능 차이와 데이터 보존 정책 자체를 변경하지 않는다.

변경 범위는 다음으로 제한한다.

- 기본 플랜을 `Care Insight`로 변경
- 부모의 `Care Start ↔ Care Insight` 직접 변경
- Production의 `Care Premium` 선택 차단
- Development의 `Care Premium` 선택 허용
- 관리자 승인 화면의 기본값과 Premium 선택 정책 반영

기존 플랜별 기능 제한이 실제 API에서도 동일하게 적용되는지 확인한다.

---

## UI·UX 요구사항

- 모바일 우선으로 구현한다.
- 현재 플랜을 화면 상단에서 명확히 표시한다.
- 각 플랜의 주요 차이를 짧게 표시한다.
- 현재 이용 중인 플랜의 선택 버튼은 비활성화한다.
- 플랜 변경 중 로딩 상태를 표시한다.
- 성공·실패 결과를 명확히 안내한다.
- Production의 Care Premium은 회색 비활성 카드와 `준비 중` 배지로 표시한다.
- Care Premium 카드가 비활성 상태여도 화면 레이아웃이 깨지지 않아야 한다.
- 네이티브 `alert`, `confirm`, `prompt` 사용을 제거하고 프로젝트 공통 모달·다이얼로그를 사용한다.
- 숫자 `1`, `2`, `3`을 입력받아 플랜을 선택하는 UI를 사용하지 않는다.

---

## QA 시나리오

### QA 1. 신규 Production 사용자

1. 신규 부모 회원가입
2. 승인 대기 화면 확인
3. 관리자 베타 승인
4. 부모 재로그인
5. 현재 플랜 확인

PASS 기준:

```text
기본 플랜이 Care Insight로 표시됨
```

### QA 2. Care Insight에서 Care Start로 변경

1. Care Insight 사용자 로그인
2. 플랜 관리 화면 이동
3. Care Start 선택
4. 다운그레이드 확인
5. 새로고침 및 재로그인

PASS 기준:

- Care Start가 즉시 적용됨
- DB에도 Care Start로 저장됨
- Care Insight 전용 기능 제한이 정상 적용됨
- 관리자 추가 승인 요구 없음

### QA 3. Care Start에서 Care Insight로 변경

1. Care Start 사용자 로그인
2. Care Insight 선택
3. 업그레이드 확인
4. 새로고침 및 재로그인

PASS 기준:

- Care Insight가 즉시 적용됨
- DB에도 Care Insight로 저장됨
- Care Insight 기능이 정상 활성화됨
- 관리자 추가 승인 요구 없음

### QA 4. Production Care Premium 차단

1. Production 부모 플랜 화면 접속
2. Care Premium 카드 확인
3. 버튼 클릭 또는 직접 API 요청 시도

PASS 기준:

- 카드에 `준비 중` 표시
- 선택 버튼 비활성화
- 플랜 변경 요청 미발생
- 직접 API 호출도 서버에서 차단
- DB 플랜이 Premium으로 변경되지 않음

### QA 5. Development Care Premium 허용

1. Dev 부모 계정 로그인
2. Care Premium 선택
3. 변경 완료 후 새로고침

PASS 기준:

- Dev에서 Care Premium 선택 가능
- Dev DB에만 반영
- Production DB와 Production 계정에는 영향 없음

### QA 6. 기존 사용자 보존

1. 기존 Care Start 사용자 확인
2. 기존 Care Insight 사용자 확인
3. 배포 후 플랜 재확인

PASS 기준:

- 기존 사용자의 플랜이 강제로 변경되지 않음
- 신규 승인 사용자만 Care Insight 기본값 적용

---

## 회귀 테스트

다음 기존 기능이 영향을 받지 않아야 한다.

- 신규 회원가입
- 승인 대기 화면
- 관리자 승인·거절
- 부모·아이 연결
- 부모 홈
- 아이 홈
- 미션
- 자유대화
- STT·TTS·Gemini Live
- 일일·주간·월간 리포트
- MBTI
- 퀴즈마스터
- 황금열쇠 차감·환불
- 관리자 비용 대시보드
- Dev·Production Supabase 분리

---

## 완료 조건

다음 조건을 모두 충족해야 완료 처리한다.

- Production 신규 승인 사용자의 기본 플랜이 Care Insight다.
- 기존 사용자의 현재 플랜은 일괄 변경되지 않는다.
- 부모가 Care Start와 Care Insight 사이를 직접 변경할 수 있다.
- 변경에 관리자 승인이 필요하지 않다.
- 변경 결과가 DB에 저장되고 재로그인 후에도 유지된다.
- Production Care Premium은 `준비 중`으로 표시되고 선택할 수 없다.
- Production API 직접 호출로도 Care Premium 적용이 불가능하다.
- Development·Preview에서는 Care Premium 선택이 가능하다.
- 관리자 승인 화면에서 Care Insight가 기본값이다.
- 네이티브 `prompt`, `confirm`, `alert` 기반 플랜 선택 UI가 제거된다.
- 기존 플랜별 기능 제한과 데이터 정책이 유지된다.
- Dev·Production 데이터와 환경변수가 혼합되지 않는다.
- 관련 자동 테스트와 모바일·PC 수동 QA가 통과한다.
