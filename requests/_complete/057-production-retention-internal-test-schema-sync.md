# Production 리텐션 내부 테스트 계정 필터 스키마 동기화 및 검증

## 1. 작업 목적

Production 관리자 페이지 `/admin/retention`의 `내부 테스트 계정 포함` 체크박스가 정상 동작하지 않는 원인을 해결한다.

읽기 전용 감사 결과, Production DB에는 리텐션 API가 조회하는 `is_internal_test` 컬럼이 존재하지 않는다. 반면 현재 코드베이스는 해당 컬럼을 조회하도록 구현되어 있어 Production DB와 애플리케이션 코드 사이에 스키마 불일치가 발생하고 있다.

이번 작업의 목적은 다음과 같다.

1. 누락된 내부 테스트 계정 플래그 스키마를 Production에 안전하게 적용
2. 지정된 Production 테스트 가족에 내부 테스트 플래그 설정
3. 최신 리텐션 API와 Production DB 스키마 동기화
4. 체크박스 OFF/ON에 따른 모든 리텐션 지표의 포함·제외 동작 검증
5. 일반 사용자 데이터와 기존 서비스 기능의 회귀 방지

---

## 2. 확정된 원인

### Production DB 상태

다음 테이블에 코드가 기대하는 `is_internal_test` 컬럼이 존재하지 않는다.

- `child_profiles`
- `family_members`
- 실제 migration 내용에 따라 관련 부모 프로필 테이블

### 코드 상태

현재 리텐션 API는 체크박스 ON/OFF 여부와 관계없이 내부 테스트 계정 판정을 위해 `is_internal_test` 컬럼을 조회한다.

확인 대상 예시:

```text
app/api/admin/retention/overview/route.ts
lib 또는 서버 영역의 retentionFilter.ts
관련 코호트·드릴다운·내보내기 API
```

### 발생 가능한 오류

Production DB에 컬럼이 없는 상태에서 신규 API 코드가 실행되면 Supabase/PostgreSQL이 다음 오류를 반환할 수 있다.

```text
42703 undefined_column
```

따라서 현재 화면에 표시된 테스트 계정 포함·제외 수치는 정상 필터 결과로 신뢰하지 않는다.

---

## 3. 최우선 안전 원칙

1. 다른 pending migration 전체를 실행하지 않는다.
2. `20260802092252_add_internal_test_flag.sql` 또는 동일 목적 migration만 대상으로 한다.
3. SQL 적용 전에 migration 내용을 반드시 검토한다.
4. 기존 사용자, 아이, 가족, 대화, 미션, 리포트 데이터를 삭제하거나 초기화하지 않는다.
5. 기존 컬럼의 타입이나 의미를 변경하지 않는다.
6. 신규 컬럼은 안전한 기본값 `FALSE`를 사용한다.
7. Production 적용 전 Dev 또는 동등한 안전한 환경에서 동일 SQL을 검증한다.
8. Production DB 백업 또는 복구 가능성을 확인한 후 적용한다.
9. Service Role Key, DB 비밀번호, API Key, Token을 평문 출력하지 않는다.
10. Production 배포 및 DB 변경 결과는 실제 API·화면 E2E 검증 후 완료로 판정한다.

---

## 4. 대상 Production 테스트 계정

### 가족 1: QA 부모-TestA-TestB 전용 가족

#### 부모

```text
qa-parent@kbestie.local
```

#### 아이

```text
testa@kbestie.local
testb@kbestie.local
```

### 가족 2: 테스트 가족

#### 부모

```text
markanitp@gmail.com
```

#### 아이

```text
psa160202@kbestie.local
psh160202@kbestie.local
psd160202@kbestie.local
```

---

## 5. Phase 1 — Migration 사전 검토

다음 migration 파일을 우선 검토한다.

```text
supabase/migrations/20260802092252_add_internal_test_flag.sql
```

프로젝트의 실제 경로가 다르면 동일 파일명을 검색한다.

### 검토 항목

- 어떤 테이블에 `is_internal_test`를 추가하는지
- 컬럼 타입이 `BOOLEAN`인지
- 기본값이 `FALSE`인지
- `NOT NULL` 적용 여부
- 기존 레코드가 안전하게 `FALSE`로 채워지는지
- 인덱스가 필요한지
- RLS 정책에 영향을 주는지
- trigger 또는 function 변경이 포함되는지
- 기존 데이터 UPDATE 또는 DELETE가 포함되는지
- 다른 migration에 의존하는지
- 반복 적용 시 안전한지
- Production 현재 스키마와 충돌하는지

### 승인 가능한 SQL 원칙

권장 형태:

```sql
ALTER TABLE public.family_members
ADD COLUMN IF NOT EXISTS is_internal_test BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.child_profiles
ADD COLUMN IF NOT EXISTS is_internal_test BOOLEAN NOT NULL DEFAULT FALSE;
```

실제 스키마에 부모 프로필 테이블이 따로 있고 리텐션 API가 해당 테이블을 기준으로 조회한다면 그 테이블에도 동일 원칙으로 추가한다.

### 금지

- 기존 테이블 DROP
- 기존 컬럼 DROP
- 기존 사용자 데이터 DELETE
- 전체 테스트 데이터 초기화
- 다른 기능용 migration 동시 적용
- 모든 pending migration 일괄 push

---

## 6. Phase 2 — Dev 사전 검증

Production 적용 전에 Dev 또는 안전한 검증 환경에서 migration을 실행한다.

검증 항목:

1. migration 성공
2. 기존 레코드의 `is_internal_test` 기본값이 `FALSE`
3. 기존 회원가입·로그인·아이 조회 정상
4. 관리자 리텐션 API 정상 응답
5. 체크박스 OFF/ON 정상 전달
6. TypeScript 검사 통과
7. Production build 통과
8. migration 재실행 시 치명적 오류 없음
9. 기존 RLS 및 관리자 권한 정상

검증 실패 시 Production에 적용하지 않는다.

---

## 7. Phase 3 — Production에 해당 Migration만 적용

Dev 검증을 통과한 후 Production DB에 해당 migration만 적용한다.

### 적용 전 확인

- 대상 Supabase Project Ref가 Production인지 확인
- Dev, Preview 프로젝트가 아닌지 확인
- 현재 DB 스키마에서 컬럼이 실제로 없는지 재확인
- migration 파일 checksum 또는 SQL 내용 확인
- 실행 계정 권한 확인
- 복구 방안 확인

### 적용 후 확인

다음 쿼리 또는 동등한 안전한 조회로 컬럼 존재를 확인한다.

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('family_members', 'child_profiles')
  AND column_name = 'is_internal_test';
```

기대 결과:

- 컬럼 존재
- 타입 BOOLEAN
- 기본값 FALSE
- 신규 일반 사용자 기본값 FALSE

---

## 8. Phase 4 — Production 테스트 계정 플래그 설정

### 8.1 불변 ID 확인

이메일이나 로그인 아이디로 계정을 검색하되, 실제 UPDATE는 확인된 불변 ID를 기준으로 수행한다.

확인 항목:

- Auth User ID
- parent/profile ID
- child_id
- family_id 또는 가족 연결 ID
- 부모와 아이의 실제 연결 관계
- 중복 계정 여부
- soft-delete 또는 비활성 여부

### 8.2 부모 플래그

다음 부모 계정에 `is_internal_test = TRUE`를 설정한다.

```text
qa-parent@kbestie.local
markanitp@gmail.com
```

### 8.3 아이 플래그

다음 아이 계정에 `is_internal_test = TRUE`를 설정한다.

```text
testa@kbestie.local
testb@kbestie.local
psa160202@kbestie.local
psh160202@kbestie.local
psd160202@kbestie.local
```

### 8.4 데이터 안전 조건

- 동일 이름이 아니라 로그인 아이디와 불변 ID로 식별
- 일반 사용자에게 플래그를 설정하지 않음
- 대상 계정이 없으면 임의 생성하지 않음
- 중복 계정이 있으면 임의 선택하지 않고 BLOCKED 보고
- 이메일 대소문자와 공백 정규화
- 가족 연결 관계가 요청 내용과 다르면 적용 전 보고

---

## 9. Phase 5 — 리텐션 API 및 공통 필터 확인

다음 코드를 확인한다.

- `/api/admin/retention/overview`
- KPI 카드 API
- DAU API
- 코호트 API
- 사용자 상세 드릴다운 API
- CSV 또는 내보내기 API
- 공통 `retentionFilter`
- 관련 SQL, RPC, View

### 필터 원칙

체크박스 OFF:

```text
includeInternal = false
```

- 내부 테스트 부모 제외
- 내부 테스트 아이 제외
- 해당 부모·아이의 모든 활동 이벤트 제외
- 가족 동시 활성 집계에서도 가족 전체 제외

체크박스 ON:

```text
includeInternal = true
```

- 지정 테스트 부모와 아이 포함
- 관련 활동 이벤트 포함

### Boolean 처리

다음 오류가 없어야 한다.

```text
"false" 문자열을 true로 오인
undefined를 true로 처리
파라미터 누락 시 테스트 계정 포함
```

기본값은 반드시 OFF다.

---

## 10. 적용 대상 리텐션 지표

체크박스는 다음 모든 지표에 동일하게 적용되어야 한다.

### 사용자 규모

- 승인 부모 수
- 기간 내 활성 부모 수
- 활성 아이 수
- 가족 동시 활성 수

### 리텐션

- D1
- D3
- D7
- D14가 존재하는 경우 D14
- W2 또는 2주차 지속률
- 가입 코호트 표

### 행동 지표

- 미션 시작 수
- 미션 완료 수
- 미션 완료율
- 자유대화 사용 지표
- 리포트 조회 지표
- 놀이 시작·완료 지표
- DAU
- 신규 사용자
- 재방문 사용자

### 상세 기능

- 부모 상세 드릴다운
- 아이 상세 드릴다운
- 사용자 목록
- 차트
- 표
- CSV 또는 내보내기

카드와 상세 목록이 서로 다른 내부계정 필터를 사용하지 않도록 한다.

---

## 11. Production 검증 조건

조회 조건:

```text
환경: Production
기간: 최근 7일
타임존: Asia/Seoul
```

### 11.1 체크박스 OFF

기본 진입 시 체크박스가 OFF인지 확인한다.

OFF 상태에서 다음 계정이 모든 집계에서 제외되어야 한다.

부모:

```text
qa-parent@kbestie.local
markanitp@gmail.com
```

아이:

```text
testa@kbestie.local
testb@kbestie.local
psa160202@kbestie.local
psh160202@kbestie.local
psd160202@kbestie.local
```

관련 활동 데이터도 모두 제외되어야 한다.

### 11.2 체크박스 ON

체크박스를 ON으로 변경하면 위 테스트 가족과 관련 활동이 모두 다시 포함되어야 한다.

### 11.3 지표별 대조

각 지표마다 다음을 비교한다.

```text
OFF 화면값
OFF API값
OFF DB 재계산값
ON 화면값
ON API값
ON DB 재계산값
ON-OFF 차이
포함·제외된 부모 ID
포함·제외된 아이 ID
추가·제외된 이벤트 수
```

### 11.4 화면 수치 참고

문제가 보고된 화면의 ON 값:

```text
승인 부모 수: 5명
활성 아이 수: 6명
가족 동시 활성: 3가족
D1: 42.9% / 대상 7명 중 3명
D3: 40.0% / 대상 5명 중 2명
D7: 대상 없음
W2: 대상 없음
미션 완료율: 95.2% / 시작 21회 중 완료 20회
```

이 값은 정상값으로 가정하지 말고 Production DB에서 다시 계산한다.

---

## 12. 네트워크 및 캐시 검증

체크박스 토글 시 브라우저 네트워크 요청을 확인한다.

검증 항목:

- OFF 요청에 `includeInternal=false`
- ON 요청에 `includeInternal=true`
- API 응답이 실제로 달라짐
- 카드·차트·표가 같은 요청 조건을 사용
- 이전 응답 캐시가 남지 않음
- Next.js fetch cache 또는 CDN cache로 잘못된 값이 재사용되지 않음
- 새로고침 시 기본 OFF
- URL 파라미터가 없는 경우 OFF
- 사용자 상세 및 CSV도 같은 파라미터 사용

---

## 13. 일반 사용자 회귀 검증

내부 테스트 플래그 적용 후 일반 사용자 데이터가 누락되지 않는지 확인한다.

- 일반 승인 부모 수
- 일반 활성 아이 수
- 일반 가족 동시 활성
- 일반 사용자 D1/D3/D7
- 일반 사용자 미션 완료율
- 일반 사용자 DAU
- 일반 사용자 코호트
- 일반 사용자 상세 조회

체크박스 OFF와 ON의 차이는 지정 테스트 계정 및 관련 활동에서만 발생해야 한다.

---

## 14. 권한 및 보안 검증

- 관리자만 `/admin/retention` 접근 가능
- 일반 부모는 리텐션 API 접근 불가
- 아이 계정은 리텐션 API 접근 불가
- 관리자 API 서버 측 권한 검증 유지
- Service Role Key 브라우저 노출 없음
- DB 비밀번호·API Key·Token 로그 출력 없음
- 실행 보고서의 이메일과 ID는 필요한 수준으로 마스킹
- 임시 감사 스크립트에 Secret 하드코딩 금지
- 감사 완료 후 민감한 임시파일 정리

---

## 15. 배포 정책

### 코드가 이미 Production에 배포된 경우

- DB migration 적용 후 Production API가 정상화되는지 확인
- 필요하지 않은 재배포는 하지 않는다
- 단, 필터 코드 수정이 발생하면 최신 검증 커밋으로 Production 재배포

### 코드가 아직 Production에 배포되지 않은 경우

1. migration 적용
2. 테스트 계정 플래그 설정
3. 최신 리텐션 코드 Production 배포
4. API 및 화면 검증

DB 스키마와 코드 중 한쪽만 반영된 상태로 완료 처리하지 않는다.

---

## 16. 롤백 계획

### Migration 적용 직후 장애 발생 시

기존 일반 사용자 기능에 영향이 없고 신규 컬럼만 추가된 경우 우선 애플리케이션 코드를 이전 안정 버전으로 롤백한다.

컬럼 삭제는 즉시 수행하지 않는다.

### 플래그 오설정 시

잘못 설정된 특정 계정만 `is_internal_test = FALSE`로 되돌린다.

전체 플래그 초기화는 금지한다.

---

## 17. 완료 조건

다음 조건을 모두 충족해야 완료로 판정한다.

- 대상 migration 내용 검토 완료
- 다른 pending migration 미실행
- Dev 사전 검증 PASS
- Production에 필요한 컬럼 존재
- 부모 2명 내부 테스트 플래그 TRUE
- 아이 5명 내부 테스트 플래그 TRUE
- 일반 계정 기본값 FALSE
- Production 리텐션 API 500 오류 없음
- 체크박스 기본값 OFF
- OFF에서 두 테스트 가족과 관련 활동 완전 제외
- ON에서 두 테스트 가족과 관련 활동 완전 포함
- 승인 부모·활성 아이·가족 동시 활성 지표 일치
- D1·D3·D7·W2 지표 일치
- 미션 완료율·DAU 지표 일치
- 코호트·드릴다운·CSV 동일 필터 적용
- 화면값·API값·DB 재계산값 일치
- 일반 사용자 데이터 회귀 없음
- 관리자 권한 정상
- TypeScript 검사 통과
- Production build 통과
- Production 스모크 테스트 통과
- 비밀정보 노출 없음

---

## 18. 결과 보고 형식

작업 완료 후 다음 내용을 짧고 명확하게 보고한다.

1. 확정 원인
2. 적용한 migration 파일
3. 실제 변경된 테이블과 컬럼
4. 다른 pending migration 미실행 확인
5. 플래그 설정 부모 수
6. 플래그 설정 아이 수
7. 대상 계정 연결 관계 확인 결과
8. Production API 500 해소 여부
9. OFF 지표
10. ON 지표
11. ON-OFF 차이
12. 화면·API·DB 일치 여부
13. 코호트·드릴다운·CSV 검증 결과
14. 일반 사용자 회귀 결과
15. TypeScript 결과
16. build 결과
17. Production deployment ID 및 커밋
18. Production URL
19. 미해결 위험

---

## 19. 작업 금지 사항

- `supabase db push` 등으로 모든 pending migration을 일괄 적용하지 않는다.
- 대상 migration 검토 없이 Production에 적용하지 않는다.
- 기존 사용자·아이·가족·대화·리포트 데이터를 삭제하지 않는다.
- 일반 사용자를 내부 테스트 계정으로 지정하지 않는다.
- 이름만으로 테스트 계정을 식별하지 않는다.
- 체크박스 UI만 수정하고 서버 필터를 누락하지 않는다.
- 카드 일부에만 필터를 적용하지 않는다.
- 이메일 목록을 브라우저 코드에 하드코딩하지 않는다.
- Production 스키마와 코드가 불일치한 상태로 완료 처리하지 않는다.
- API 200만 확인하고 실제 수치 검증을 생략하지 않는다.
- 화면 수치만 보고 DB 대조를 생략하지 않는다.
- 비밀정보를 코드·로그·보고서·임시파일에 남기지 않는다.
