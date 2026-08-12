# Production QA 부모·아이 테스트 계정 생성 및 연결

## 1. 작업 목적

Production 환경에서 QA 테스트에 사용할 전용 부모 계정을 생성하고, 아래 두 아이 테스트 계정을 해당 부모 계정에 연결한다.

- 부모 QA 계정: `qa-parent@kbestie.local`
- 아이 TestA: `testa@kbestie.local`
- 아이 TestB: `testb@kbestie.local`

본 작업은 기존 실제 사용자와 가족 관계 데이터에 영향을 주지 않는 범위에서 수행한다.

---

## 2. 작업 범위

### 2.1 부모 QA 계정 생성

Production 인증 환경에 다음 부모 계정을 생성한다.

- 이메일: `qa-parent@kbestie.local`
- 역할: 부모 또는 보호자
- 상태: 활성
- 관리자 승인 상태: 승인 완료
- 용도: Production QA 테스트 전용

이미 동일한 이메일 계정이 존재하면 중복 생성하지 말고 기존 계정의 역할, 프로필, 승인 상태를 점검한 뒤 누락된 값만 보완한다.

### 2.2 아이 테스트 계정 확인 및 생성

다음 아이 계정을 조회한다.

| 표시 이름 | 로그인 이메일 |
|---|---|
| TestA | `testa@kbestie.local` |
| TestB | `testb@kbestie.local` |

계정이 없으면 생성하고, 이미 존재하면 중복 생성하지 않는다.

각 아이 계정은 다음 조건을 충족해야 한다.

- 역할: 아이
- 상태: 활성
- 로그인 가능
- 표시 이름: 각각 `TestA`, `TestB`
- QA 부모 계정 이외의 다른 가족 관계가 존재하는 경우 임의로 변경하지 말고 작업을 중단한 뒤 충돌 내용을 보고

### 2.3 부모-아이 연결

`qa-parent@kbestie.local` 부모 계정에 아래 두 아이만 연결한다.

- `testa@kbestie.local`
- `testb@kbestie.local`

기존 guardian-child 또는 family 관계가 이미 정상적으로 연결되어 있으면 중복 레코드를 생성하지 않는다.

Production QA 부모 계정으로 로그인했을 때 TestA와 TestB 두 명만 조회되어야 한다.

---

## 3. 구현 원칙

### 3.1 멱등성

동일 작업을 여러 번 실행해도 계정, 프로필, 가족 관계가 중복 생성되지 않도록 구현한다.

처리 순서는 다음과 같다.

1. 인증 계정 조회
2. 사용자 프로필 조회
3. 역할 및 승인 상태 조회
4. 가족 또는 보호자-아이 연결 조회
5. 누락된 항목만 생성 또는 수정
6. 생성 후 재조회하여 최종 상태 검증

### 3.2 Production 데이터 보호

다음 데이터는 절대 변경하거나 삭제하지 않는다.

- 실제 부모 및 아이 계정
- 기존 실제 가족 관계
- 실제 대화 데이터
- 미션 데이터
- 리포트 데이터
- 구독 및 결제 데이터
- 다른 QA 계정의 데이터

작업 대상은 아래 세 계정과 직접 연결된 필수 프로필 및 관계 레코드로 한정한다.

- `qa-parent@kbestie.local`
- `testa@kbestie.local`
- `testb@kbestie.local`

### 3.3 충돌 처리

다음 상황에서는 임의 수정하지 말고 작업을 중단한 뒤 보고한다.

- TestA 또는 TestB가 실제 사용자 부모 계정에 연결되어 있는 경우
- TestA 또는 TestB 이메일이 아이 역할이 아닌 계정으로 사용 중인 경우
- QA 부모 이메일이 부모 역할이 아닌 계정으로 사용 중인 경우
- 하나의 아이가 복수 가족에 연결되는 것을 현재 스키마가 허용하지 않는 경우
- 기존 데이터와 연결 관계가 불명확한 경우

---

## 4. 보안 요구사항

다음 비밀정보를 코드, SQL 파일, 로그, 임시파일, Markdown 결과 문서에 평문으로 기록하지 않는다.

- Production service role key
- Supabase API key
- 데이터베이스 비밀번호
- 사용자 비밀번호
- 액세스 토큰
- 세션 토큰
- 기타 Production Secret

비밀정보는 기존 보안 환경변수, Secret Manager, Vercel 또는 Supabase Secrets에서 런타임에만 불러온다.

로그에는 Secret 원문을 출력하지 않으며 필요한 경우 마스킹한다.

부모 및 아이 계정의 초기 비밀번호는 안전하게 생성하거나 런타임 보안 입력으로 설정한다. 비밀번호를 저장소, 커밋, 작업 로그, 검증 문서에 남기지 않는다.

---

## 5. 검증 항목

Production 환경에서 아래 항목을 실제로 검증한다.

### 5.1 인증 및 역할

- [ ] `qa-parent@kbestie.local` 로그인 성공
- [ ] 부모 역할 정상
- [ ] 부모 프로필 정상
- [ ] 관리자 승인 완료 상태
- [ ] `testa@kbestie.local` 로그인 성공
- [ ] TestA 아이 역할 정상
- [ ] `testb@kbestie.local` 로그인 성공
- [ ] TestB 아이 역할 정상

### 5.2 가족 연결

- [ ] QA 부모 계정에 TestA 연결
- [ ] QA 부모 계정에 TestB 연결
- [ ] 중복 guardian-child 또는 family 관계 없음
- [ ] QA 부모 화면에서 TestA와 TestB 두 명만 조회
- [ ] 다른 실제 아이 또는 가족 데이터가 조회되지 않음

### 5.3 RLS 및 접근 제어

- [ ] QA 부모가 연결된 TestA와 TestB 데이터만 조회 가능
- [ ] 다른 가족의 프로필 조회 차단
- [ ] 다른 가족의 대화 조회 차단
- [ ] 다른 가족의 리포트 조회 차단
- [ ] 아이 계정에서 다른 아이 또는 부모 데이터 접근 차단

### 5.4 회귀 영향

- [ ] 기존 실제 사용자 로그인 영향 없음
- [ ] 기존 가족 관계 변경 없음
- [ ] 기존 Production 대화 및 리포트 변경 없음
- [ ] 계정 생성 작업 재실행 시 중복 데이터 없음

---

## 6. 완료 보고 형식

작업 완료 후 아래 형식으로 보고한다.

```md
# Production QA 테스트 계정 생성 결과

## 처리 결과

- 부모 QA 계정: PASS / FAIL
- TestA 계정: PASS / FAIL
- TestB 계정: PASS / FAIL
- 부모-아이 연결: PASS / FAIL
- 로그인 검증: PASS / FAIL
- RLS 검증: PASS / FAIL
- 기존 사용자 영향 없음: PASS / FAIL
- 멱등성 재실행 검증: PASS / FAIL

## 생성 또는 수정된 레코드

- 부모 auth user ID:
- 부모 profile ID:
- TestA auth user ID:
- TestA profile ID:
- TestB auth user ID:
- TestB profile ID:
- 생성 또는 확인된 family/guardian-child relation ID:

## 검증 결과

- QA 부모 화면에서 조회된 아이:
- 다른 가족 데이터 접근 결과:
- 중복 레코드 확인 결과:
- 충돌 또는 특이사항:

## 최종 판정

PASS / FAIL / BLOCKED
```

비밀번호, API key, service role key, 토큰 등 민감정보는 완료 보고서에 포함하지 않는다.

---

## 7. 완료 조건

다음 조건을 모두 충족해야 완료로 판정한다.

1. Production에 QA 부모 계정이 존재하고 로그인 가능하다.
2. 부모 계정의 역할과 승인 상태가 정상이다.
3. TestA와 TestB 계정이 존재하고 각각 로그인 가능하다.
4. TestA와 TestB가 QA 부모 계정에 정상 연결되어 있다.
5. QA 부모 화면에는 TestA와 TestB만 표시된다.
6. 다른 실제 가족 데이터에 접근할 수 없다.
7. 기존 실제 사용자 및 데이터에 변경이 없다.
8. 재실행해도 중복 계정이나 관계 레코드가 생성되지 않는다.
9. 민감정보가 코드, 로그, 파일, 커밋에 노출되지 않는다.
