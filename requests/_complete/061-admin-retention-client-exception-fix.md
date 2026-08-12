# Production 관리자 리텐션 client-side exception 진단 및 복구

## 1. 작업 목적

Production 관리자 페이지 `/admin/retention` 진입 시 다음 오류로 전체 화면이 중단되는 문제를 해결한다.

```text
Application error: a client-side exception has occurred while loading app.k-bestie.com
```

이번 작업은 단순 새로고침이나 임시 예외 무시가 아니라, 브라우저 클라이언트 오류의 최초 원인을 확정하고 Production DB·API·프런트 타입·응답 스키마를 일치시켜 페이지를 정상 복구하는 작업이다.

---

## 2. 현재 의심 원인

최근 리텐션 작업 이력을 기준으로 다음 가능성을 우선 점검한다.

1. Production DB에 `is_internal_test` 컬럼이 없거나 일부 테이블에만 존재함
2. `/api/admin/retention/*` 응답이 오류 객체 또는 누락 필드를 반환함
3. 프런트가 `undefined`, `null`, 누락 배열에 대해 `.map()`, `.length`, `.reduce()` 등을 실행함
4. API 응답 타입과 실제 JSON 구조가 불일치함
5. 카드·DAU·코호트·드릴다운·CSV 중 일부 API만 구버전 구조를 사용함
6. 체크박스 `includeInternal` 값이 문자열 `"false"`로 전달되어 잘못 처리됨
7. Production 배포 코드와 Production DB migration 상태가 불일치함
8. Next.js fetch cache 또는 CDN cache가 오래된 API 응답을 반환함
9. 관리자 권한 실패 응답을 정상 데이터로 렌더링함
10. 최근 컴포넌트 정리 과정에서 필수 props 또는 상태 초기값이 누락됨

원인을 추측으로 고치지 말고 실제 Console·Network·서버 로그로 확정한다.

---

## 3. 최우선 원칙

1. 브라우저 Console의 첫 번째 실제 예외를 먼저 확인한다.
2. Network에서 실패한 리텐션 API의 HTTP 상태와 응답 원문을 확인한다.
3. Production DB 스키마와 현재 배포 코드를 대조한다.
4. API 오류를 프런트에서 정상 데이터처럼 처리하지 않는다.
5. 전체 페이지가 흰 화면으로 죽지 않도록 오류 경계를 추가한다.
6. 카드 일부만 복구하고 나머지 차트·코호트·드릴다운을 방치하지 않는다.
7. Dev에서 재현·수정·검증 후 Production에 반영한다.
8. 비밀정보는 로그·스크린샷·보고서에 노출하지 않는다.

---

## 4. Phase 1 — Production 증거 수집

Production에서 다음을 수집한다.

### 브라우저 Console

- 첫 번째 빨간 오류
- 오류 메시지
- stack trace
- 파일명
- line/column
- 발생 컴포넌트
- hydration 관련 여부
- `undefined.map`, `cannot read properties`, `JSON parse`, `ChunkLoadError` 여부

### Network

다음 요청을 모두 확인한다.

```text
/api/admin/retention/overview
/api/admin/retention/dau
/api/admin/retention/cohort
/api/admin/retention/users
/api/admin/retention/export
```

실제 프로젝트 경로가 다르면 해당 리텐션 관련 API 전체를 추적한다.

각 요청별 확인:

- URL
- query parameter
- `includeInternal`
- 기간 필터
- HTTP status
- response body
- response content-type
- cache header
- 권한 오류 여부
- 500/401/403/404 여부
- JSON 구조

### 서버 로그

- Vercel Function 로그
- Supabase/Postgres 오류
- SQLSTATE
- undefined column
- RLS 오류
- timeout
- serialization 오류
- API 내부 stack trace

---

## 5. Phase 2 — Production DB 스키마 확인

다음 테이블에 `is_internal_test` 컬럼 존재 여부를 확인한다.

- `family_members`
- `child_profiles`
- `parent_profiles`
- 실제 retention filter가 참조하는 테이블

확인 SQL 예시:

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'is_internal_test'
  AND table_name IN ('family_members', 'child_profiles', 'parent_profiles');
```

확인 항목:

- 컬럼 존재
- BOOLEAN 타입
- DEFAULT FALSE
- NOT NULL 여부
- 기존 레코드 null 여부
- migration 적용 여부
- Dev와 Production 차이

컬럼 누락이 확정되면 다른 pending migration 전체를 적용하지 말고 해당 목적 migration만 검토 후 적용한다.

---

## 6. Phase 3 — API 응답 스키마 감사

각 리텐션 API의 실제 응답을 타입 정의와 대조한다.

### 필수 필드 예시

```text
summary
approvedParents
activeChildren
activeFamilies
d1
d3
d7
w2
missionCompletion
dau
cohorts
users
filters
```

실제 프로젝트의 타입을 기준으로 확인한다.

### 규칙

- 배열 필드는 항상 배열 반환
- 숫자 필드는 항상 숫자 또는 명시적 null
- 객체 필드는 항상 기본 객체 또는 명시적 null
- 오류 응답은 정상 데이터 구조와 섞지 않는다
- 500 오류를 200 + `{ error: ... }`로 위장하지 않는다
- 빈 데이터는 정상 빈 배열·0·`대상 없음`으로 반환
- 필수 필드 누락 금지

---

## 7. Phase 4 — 프런트 안전 렌더링

리텐션 페이지에서 다음을 보완한다.

### 초기값

```text
arrays → []
numbers → 0
objects → 안전한 기본 객체
```

### 안전 처리

- `data?.items ?? []`
- `cohorts ?? []`
- `dau ?? []`
- `users ?? []`
- `summary ?? defaultSummary`

### 금지

- `undefined.map()`
- `null.length`
- 오류 객체를 정상 데이터로 간주
- API 실패 후 기존 state 구조 유지 가정
- 로딩 완료 전에 데이터 렌더링

---

## 8. 오류 UI 및 Error Boundary

전체 페이지가 흰 화면으로 죽지 않도록 한다.

### 필수 상태

- 로딩
- 정상
- 데이터 없음
- 권한 없음
- API 오류
- 스키마 오류
- 재시도 가능

### 오류 표시 예시

```text
리텐션 데이터를 불러오지 못했습니다.
오류 코드: RETENTION_OVERVIEW_FETCH_FAILED
다시 시도
```

내부 SQL, Secret, stack trace는 사용자 화면에 노출하지 않는다.

### Error Boundary

리텐션 페이지 또는 주요 위젯 단위로 error boundary를 적용한다.

한 차트 오류가 전체 페이지를 중단하지 않게 한다.

---

## 9. includeInternal 필터 재검증

체크박스 OFF/ON 동작을 함께 검증한다.

### OFF

```text
includeInternal=false
```

- 테스트 부모 제외
- 테스트 아이 제외
- 관련 이벤트 제외
- 모든 카드·차트·코호트·드릴다운·CSV 동일 적용

### ON

```text
includeInternal=true
```

- 테스트 가족 포함
- 관련 이벤트 포함

### 주의

- `"false"` 문자열을 true로 처리하지 않음
- 파라미터 누락 시 기본 OFF
- 토글 시 모든 API 재조회
- 캐시로 이전 값 재사용 금지

---

## 10. 캐시 정책

관리자 리텐션 API는 최신 운영 데이터를 표시해야 한다.

검토 항목:

- `fetch(..., { cache: 'no-store' })`
- `revalidate = 0`
- 적절한 `Cache-Control`
- CDN cache
- stale response
- 브라우저 cache

필요한 범위에서만 no-store를 적용한다.

---

## 11. 권한 처리

- 관리자만 접근
- 일반 부모 403
- 아이 403
- 세션 만료 시 로그인 유도
- 401/403 응답을 정상 데이터로 렌더링하지 않음
- 서버에서 관리자 권한 검증
- 클라이언트 메뉴 숨김만으로 처리하지 않음

---

## 12. Dev 수정 및 검증

Dev에서 다음을 재현한다.

1. Production과 동일한 응답 구조
2. `is_internal_test` 컬럼 존재/부재 상황
3. 빈 데이터
4. 일부 API 실패
5. 권한 실패
6. includeInternal OFF/ON
7. 차트 데이터 없음
8. 코호트 데이터 없음
9. 사용자 목록 없음

수정 후 확인:

- 페이지 정상 진입
- Console 오류 없음
- API 200
- 오류 시 오류 UI
- 재시도 동작
- 일부 위젯 실패 시 전체 페이지 유지

---

## 13. Production 배포 및 E2E

Dev PASS 후 Production에 반영한다.

### Production 확인

- `/admin/retention` 정상 진입
- client-side exception 없음
- Console 오류 없음
- overview API 정상
- DAU 정상
- cohort 정상
- users 정상
- export 정상
- includeInternal OFF/ON 정상
- 새로고침 정상
- PC·모바일 정상
- 관리자 권한 정상

---

## 14. 회귀 테스트

다음 관리자 기능에 영향이 없어야 한다.

- 관리자 홈
- 리포팅 수동 실행
- LLM 사용 현황
- 사용자 관리
- 베타 신청 관리
- 문의·버그 접수
- 요금제 변경 요청
- 아이 승인 요청

다음 사용자 기능도 회귀 없어야 한다.

- 부모 로그인
- 아이 로그인
- 미션
- 자유대화
- 리포트 조회
- 놀이
- 황금열쇠

---

## 15. 완료 조건

- Production client-side exception 해소
- 브라우저 Console 첫 오류 원인 확정
- 실패 API 확정
- DB 스키마와 코드 일치
- `is_internal_test` 관련 migration 상태 정상
- API 응답 타입과 실제 JSON 일치
- null/undefined 안전 처리
- 오류 UI 제공
- 재시도 제공
- error boundary 적용
- 카드·DAU·코호트·드릴다운·CSV 정상
- includeInternal OFF/ON 정상
- 관리자 권한 정상
- TypeScript 통과
- Production build 통과
- Dev E2E PASS
- Production E2E PASS
- 기존 관리자·사용자 기능 회귀 없음
- 비밀정보 노출 없음

---

## 16. 결과 보고 형식

1. 확정 원인
2. 브라우저 Console 오류
3. 실패 API
4. DB 스키마 문제 여부
5. 적용 migration
6. 수정 파일
7. API 응답 변경
8. 프런트 안전 처리
9. error boundary 적용 위치
10. OFF/ON 검증 결과
11. TypeScript 결과
12. build 결과
13. Dev URL·커밋
14. Production URL·커밋
15. Production E2E 결과
16. 미해결 위험

---

## 17. 작업 금지 사항

- 원인 확인 없이 임의 try/catch만 추가하지 않는다.
- 오류를 숨기고 빈 화면으로 대체하지 않는다.
- 500 응답을 200으로 위장하지 않는다.
- DB 스키마 불일치를 무시하지 않는다.
- 모든 pending migration을 일괄 적용하지 않는다.
- 카드만 고치고 차트·코호트·드릴다운을 방치하지 않는다.
- Production 검증 없이 완료 처리하지 않는다.
- Secret·Token·Service Role Key를 로그에 출력하지 않는다.
