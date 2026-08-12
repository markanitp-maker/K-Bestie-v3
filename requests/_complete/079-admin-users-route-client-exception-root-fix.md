# Request: Production `/admin/users` 통합 사용자 관리 콘솔 실제 구현 및 client-side exception 근본 수정

> 완료: 2026-08-08 · main `1151da1` · Dev/Production 배포 및 검증 완료

## 0. 배경

Production에서 아래 URL 진입 시:

```text
/admin/users?tab=families
/admin/users?tab=parents
/admin/users?tab=children
```

브라우저에 다음 오류가 발생한다.

```text
Application error: a client-side exception has occurred
```

Chrome Console:

```text
Uncaught TypeError: Cannot read properties of undefined (reading 'map')
```

Antigravity 읽기 전용 감사 결과, 원인은 DB 문제가 아니라 **076 Request 문서는 완료 처리됐지만 실제 `/admin/users` 페이지와 `/api/admin/users` 구현 코드가 생성·커밋·배포되지 않은 상태**이며, 동시에 기존 관리자 대시보드와 공통 테이블 컴포넌트 일부에서 `undefined.map()` 방어가 빠져 있어 fallback 렌더링 과정에서 client crash가 발생하는 것이다.

이번 작업은 임시 `?.map` 처리만 하는 것이 아니라, **076에서 확정한 가족/부모/아이 통합 사용자 관리 콘솔을 실제로 구현하고 Production에 정상 배포**하는 작업이다.

---

## 1. 확정 원인

### 1.1 `/admin/users` 라우트 미구현

현재 실제 코드베이스에 아래 파일/디렉토리가 없다.

```text
app/admin/users/page.tsx
app/api/admin/users/*
```

076 Request 문서는 존재하지만 실제 구현이 누락됐다.

따라서 `/admin/users?tab=families` 진입 시 기대한 사용자 관리 페이지가 렌더링되지 않고 기존 상위 대시보드 렌더링 경로로 떨어져 crash가 발생한다.

### 1.2 `.map()` 방어 누락

현재 확인된 위험 지점:

```text
app/admin/(dashboard)/page.tsx
- data.subSummary.byTier.map(...)
- data.dailyTrend.map(...)

components/admin/shell/AdminResponsiveTable.tsx
- tableProps.data.map(...)

components/admin/shell/AdminDataTable.tsx
- data.map(...)

app/admin/retention/page.tsx
- cohort.cohorts.slice().map(...)
```

API 응답 일부 key가 undefined이거나 초기 상태/에러 응답 shape가 다를 경우 client-side exception이 발생한다.

---

## 2. 작업 목표

이번 작업 완료 후 아래 URL이 모두 정상 동작해야 한다.

```text
/admin/users?tab=families
/admin/users?tab=parents
/admin/users?tab=children
```

그리고:

- 가족 목록 표시
- 부모 목록 표시
- 아이 목록 표시
- 상단 KPI count 표시
- 검색
- 내부 테스트 필터
- 서버 pagination
- 행 클릭 → 우측 상세 Drawer
- UUID 기본 노출 없음
- client-side `.map()` crash 0건

---

## 3. `/admin/users` 실제 구현

신규 생성:

```text
app/admin/users/page.tsx
```

또는 현재 App Router 구조에 맞는 실제 경로.

페이지 구조:

```text
사용자 관리

[가족] [부모] [아이]

공통 검색
공통 필터
목록
우측 상세 Drawer
```

탭 query:

```text
?tab=families
?tab=parents
?tab=children
```

기본값:

```text
families
```

잘못된 tab 값은 `families`로 fallback.

---

## 4. 사용자 관리 API 실제 구현

신규 API는 현재 프로젝트 구조와 재사용 가능한 기존 API를 확인한 후 최소 구조로 구현한다.

권장:

```text
GET /api/admin/users/overview
```

query:

```text
tab=families|parents|children
search=
internalTest=exclude|include|only
page=
pageSize=
sort=
status=
```

필요 시 상세:

```text
GET /api/admin/users/families/[id]
GET /api/admin/users/parents/[id]
GET /api/admin/users/children/[id]
```

단, 기존 관리자 API를 재사용할 수 있으면 중복 API를 만들지 않는다.

---

## 5. 실제 DB 관계

반드시 Production 실제 관계를 그대로 사용한다.

### 가족

```text
families.id
→ family_members.family_id
```

### 부모

```text
parents.id
= auth.users.id
= family_members.user_id

family_members.role IN ('owner_parent', 'parent')
```

### 아이

```text
child_profiles.member_id
→ family_members.id
→ family_members.user_id
→ auth.users.id
```

필수:

```text
families.deleted_at IS NULL
family_members.deleted_at IS NULL
```

soft-deleted 데이터가 목록에 섞이면 실패.

---

## 6. Production 기준 baseline

Antigravity 감사 시점:

```text
활성 가족: 7
부모: 10
아이: 14
전체 Auth Users: 24
```

이 숫자를 코드에 하드코딩하지 않는다.

UI count는 조회 시점 DB 실시간 값과 비교한다.

---

## 7. 가족 탭

컬럼:

```text
가족명
부모
아이
요금제
생성일
최근 활동
내부 테스트
상태
```

행 클릭:

```text
→ 가족 상세 Drawer
```

상세:

```text
가족명
생성일
부모 목록
아이 목록
요금제
최근 활동
내부 테스트 여부
```

---

## 8. 부모 탭

컬럼:

```text
부모
소속 가족
연결 아이 수
요금제
가입 채널
가입일
최근 접속
계정 상태
내부 테스트
```

실제 계정 상태값:

```text
ACTIVE
ONBOARDING
SUSPENDED
```

다른 상태 enum을 새로 만들지 않는다.

가입 채널:

```text
parents.id
→ parent_attributions.parent_user_id
→ signup_link_id
→ acquisition_links.id
```

유입 정보가 없으면 임의 추정하지 않는다.

---

## 9. 아이 탭

컬럼:

```text
아이
학년
성별
가족
부모
승인 상태
생성일
최근 활동
내부 테스트
```

아이 최근 활동 1순위:

```text
chat_sessions.started_at
```

아이 계정에 존재하지 않는 `ACTIVE/SUSPENDED` 같은 별도 상태를 임의 생성하지 않는다.

---

## 10. 검색

공통 검색:

```text
가족명
부모 이름
부모 이메일
아이 이름
아이 로그인 아이디
```

서버-side 검색.

전체 데이터를 클라이언트로 가져와 필터링하지 않는다.

---

## 11. 내부 테스트 필터

기본:

```text
내부 테스트 제외
```

선택:

```text
제외
포함
테스트만
```

실제 source of truth:

```text
family_members.is_internal_test
child_profiles.is_test_account
```

이메일 suffix만으로 판단하지 않는다.

---

## 12. 페이지네이션

서버 pagination:

```text
25
50
100
```

기본:

```text
25개
```

N+1 query 금지.

---

## 13. 우측 상세 Drawer

기존 `AdminDrawer` / Slide-over Drawer 재사용.

### 가족

```text
부모
아이
최근 활동
요금제
```

### 부모

```text
로그인 이메일
가족
연결 아이
요금제
가입 채널
가입일
최근 접속
계정 상태
```

### 아이

```text
로그인 아이디
학년
성별
가족
부모
승인 상태
최근 미션/자유대화
usage_events 요약
```

목록 위치와 필터 상태를 유지한 채 Drawer 열기/닫기.

---

## 14. UUID 노출 제거

기본 UI에서:

```text
UUID 노출 0건
```

사용자 식별:

```text
이름
로그인 아이디
이메일
가족명
```

기술 ID가 꼭 필요하면 별도 접힘 영역 또는 복사 버튼으로 숨긴다.

---

## 15. ONBOARDING 사용자 보호

Production에 실제:

```text
account_status = ONBOARDING
```

사용자가 존재한다.

가족 미소속 또는 온보딩 미완료라는 이유로:

```text
테스트 계정
삭제 대상
오류 계정
```

으로 분류하지 않는다.

정상 표시:

```text
가입 진행 중
```

---

## 16. 기존 AdminShell 메뉴 연결

`components/admin/shell/AdminShell.tsx`에서 사용자 관리 메뉴가 실제:

```text
/admin/users
```

로 이동하도록 연결한다.

현재 임시/placeholder 구조가 있으면 제거한다.

사이드바에서 사용자 관리 클릭 시 실제 통합 콘솔이 열려야 한다.

---

## 17. 기존 관련 URL redirect

실제 존재하는 라우트를 확인 후:

```text
/admin/parents
→ /admin/users?tab=parents

/admin/children
→ /admin/users?tab=children

/admin/restorations
→ /admin/users?tab=parents&sub=restorations
```

등으로 redirect.

존재하지 않는 라우트를 임의 생성하지 않는다.

---

## 18. `.map()` client crash 공통 방어

이번 작업에서는 `/admin/users` 근본 구현과 별개로 공통 관리자 렌더링 안정성도 수정한다.

### `app/admin/(dashboard)/page.tsx`

변경 예:

```tsx
(data.subSummary?.byTier ?? []).map(...)
```

```tsx
(data.dailyTrend ?? []).map(...)
```

### `AdminResponsiveTable`

```tsx
(tableProps.data ?? []).map(...)
```

### `AdminDataTable`

```tsx
(data ?? []).map(...)
```

### retention cohort

```tsx
(cohort?.cohorts ?? []).slice(...).map(...)
```

단, 단순 빈 배열 fallback으로 API 오류를 숨기지 않는다.

API 자체가 실패한 경우:

```text
오류 상태 UI
재시도 버튼
```

을 표시한다.

---

## 19. API response contract 강화

API 응답에서 배열 필드는 항상 배열로 반환한다.

예:

```json
{
  "items": [],
  "families": [],
  "parents": [],
  "children": []
}
```

`undefined` 반환 금지.

count:

```json
{
  "counts": {
    "families": 0,
    "parents": 0,
    "children": 0
  }
}
```

필드가 없어서 UI가 crash하지 않도록 서버 contract를 고정한다.

---

## 20. Loading / Empty / Error 상태

각 탭:

### Loading

```text
불러오는 중...
```

### Empty

```text
조건에 맞는 가족이 없습니다.
조건에 맞는 부모가 없습니다.
조건에 맞는 아이가 없습니다.
```

### Error

```text
사용자 정보를 불러오지 못했습니다.
[다시 시도]
```

Error 응답을 정상 data로 setState하지 않는다.

---

## 21. TypeScript 타입 강화

API response type을 명확히 정의한다.

예:

```ts
type AdminUsersOverviewResponse = {
  counts: {
    families: number;
    parents: number;
    children: number;
  };
  items: FamilyRow[] | ParentRow[] | ChildRow[];
  page: number;
  pageSize: number;
  total: number;
};
```

optional array를 남발하지 않는다.

---

## 22. Dev / Production 구현 일치 확인

Antigravity 감사 결과 현재 `/admin/users`는 Dev/Production 모두 구현 코드 자체가 없다.

이번 작업 완료 후:

- Dev 구현
- Dev E2E
- Production 배포
- Production 직접 URL 검증

까지 모두 완료해야 한다.

문서만 `_done` 이동하고 실제 코드가 없는 상태를 다시 만들지 않는다.

---

## 23. 반드시 검증할 client crash 지점

아래를 직접 브라우저 Console 기준으로 검증한다.

```text
Cannot read properties of undefined (reading 'map')
```

0건.

또한:

```text
Application error: a client-side exception has occurred
```

0건.

---

## 24. E2E 시나리오

### Case 1 가족 탭

```text
/admin/users?tab=families
```

- 페이지 로딩
- 가족 count
- 가족 목록
- 검색
- Drawer
- Console error 0

### Case 2 부모

```text
/admin/users?tab=parents
```

- 부모 count
- ACTIVE / ONBOARDING / SUSPENDED 표시
- 가입 채널
- 내부 테스트 필터
- Console error 0

### Case 3 아이

```text
/admin/users?tab=children
```

- 아이 count
- 학년
- 가족
- 부모
- 승인 상태
- 최근 활동
- Console error 0

### Case 4 API empty

필터 결과 0건일 때:

```text
빈 화면 정상
crash 없음
```

### Case 5 API error

QA fixture/mocked response:

```text
500
```

UI:

```text
오류 안내
재시도
crash 없음
```

### Case 6 Dashboard regression

```text
/admin
```

`byTier`, `dailyTrend` undefined 상황에서도 crash 없음.

### Case 7 Retention regression

cohort array 누락 fixture에서도 crash 없음.

---

## 25. Production 데이터 보호

이번 오류는 client rendering 문제이므로 사용자 DB 변경이 필요하지 않다.

금지:

- 가족 데이터 수정
- 부모 상태 수정
- 아이 상태 수정
- auth.users 수정
- 임의 migration
- 테스트 계정 정리
- ONBOARDING 사용자 수정

Production 검증은 read-only 중심으로 수행한다.

---

## 26. 완료 조건

아래를 모두 만족해야 완료다.

- `app/admin/users/page.tsx` 실제 존재
- 실제 `/admin/users` route 정상
- 가족 탭 정상
- 부모 탭 정상
- 아이 탭 정상
- 사용자 관리 API 실제 구현
- AdminShell 메뉴 `/admin/users` 연결
- 서버 pagination
- 검색
- 내부 테스트 필터
- 상세 Drawer
- 부모 가입 채널 표시
- UUID 기본 노출 0건
- ONBOARDING 사용자 보호
- soft-deleted family/member 제외
- API 배열 field undefined 0건
- `.map()` client crash 0건
- Dashboard `.map()` 방어
- AdminResponsiveTable 방어
- AdminDataTable 방어
- Retention cohort 방어
- TypeScript 오류 0건
- Build 성공
- Dev E2E PASS
- Production 배포 완료
- Production `/admin/users?tab=families` PASS
- Production `/admin/users?tab=parents` PASS
- Production `/admin/users?tab=children` PASS
- Chrome Console error 0건

---

## 27. 완료 보고 형식

1. 실제 미구현 원인
2. 생성한 `/admin/users` 파일
3. 생성/재사용한 사용자 관리 API
4. 가족/부모/아이 데이터 조인 방식
5. AdminShell 메뉴 연결 결과
6. 검색/필터/pagination
7. Drawer 구조
8. ONBOARDING 사용자 보호
9. UUID 제거 결과
10. `.map()` 방어 수정 파일
11. API response contract
12. Dev 가족/부모/아이 E2E
13. Dashboard regression
14. Retention regression
15. TypeScript/Build
16. Production 배포 커밋
17. Deployment ID / READY
18. Production 3개 탭 직접 URL 검증
19. Browser Console 오류 0건 확인
20. 남은 위험

---

## 28. 작업 제한

- 단순 `?.map`만 추가하고 `/admin/users` 구현을 생략하면 완료 처리 금지
- Request MD를 `_done` 이동한 것만으로 구현 완료 간주 금지
- Production DB 수정 금지
- ONBOARDING 실제 사용자 변경 금지
- API Key/Token/Service Role Key 출력 금지
- 사용자-facing UUID 노출 금지
- 존재하지 않는 API/route를 완료 보고서에 구현됐다고 허위 보고 금지
