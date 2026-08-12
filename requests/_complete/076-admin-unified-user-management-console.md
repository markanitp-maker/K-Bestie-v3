# Request: 관리자 `사용자 관리` 통합 콘솔 구축 — 가족 / 부모 / 아이 3탭 + 공통 검색 + 우측 상세 패널

## 0. 배경

현재 관리자 사이드바에는 `사용자 관리` 그룹이 있지만 실제 가족/부모/아이 전체 목록을 한눈에 볼 수 있는 통합 관리 화면이 없다.

현재는 다음 기능이 파편화되어 있다.

- 계정 복구 승인
- 요금제 변경 요청
- 아이 승인 요청
- 리텐션 사용자 드릴다운
- 매출·가입자 상세 일부 사용자 정보
- 개별 사용자 관련 API

Antigravity 읽기 전용 감사 결과, Production DB에는 가족/부모/아이 관계가 정상적으로 존재하며 통합 조회가 가능하다.

이번 작업의 목표는 **가족 / 부모 / 아이를 하나의 사용자 관리 콘솔에서 조회·검색·필터·상세 확인할 수 있게 하는 것**이다.

이번 Request는 관리자 정보 구조와 조회 UX를 만드는 작업이다.

기존 사용자 계정·가족 관계·대화·미션·리포트 데이터를 임의 수정하거나 삭제하지 않는다.

---

# 1. 실제 Production DB 관계 기준

실제 관계는 아래를 source of truth로 사용한다.

```text
families
  └─ family_members
       ├─ role = owner_parent / parent
       │    └─ user_id → auth.users.id
       │                    └─ parents.id
       │
       └─ role = child
            └─ family_members.id
                 └─ child_profiles.member_id
                      └─ child_profiles.family_id → families.id
```

실제 조인 경로:

## 부모

```text
parents.id
= auth.users.id
= family_members.user_id

family_members.role IN ('owner_parent', 'parent')

family_members.family_id
→ families.id
```

## 아이

```text
child_profiles.member_id
→ family_members.id

family_members.user_id
→ auth.users.id

family_members.role = 'child'

child_profiles.family_id
→ families.id
```

반드시:

```text
family_members.deleted_at IS NULL
families.deleted_at IS NULL
```

조건을 기본 조회에 적용한다.

---

# 2. Production 기준 QA 베이스라인

Antigravity 감사 시점 Production 실측:

```text
활성 가족: 7개
부모: 10명
아이: 14명
전체 Auth Users: 24명
```

내부 테스트:

```text
테스트 가족: 1개
테스트 부모: 1명
테스트 아이: 5명
```

이 수치는 테스트 기준값일 뿐 코드에 하드코딩하지 않는다.

Production 데이터는 계속 변할 수 있으므로 E2E에서는 DB 실시간 집계값과 UI 값을 비교한다.

---

# 3. 최종 관리자 메뉴 구조

사이드바 `사용자 관리` 그룹은 최종적으로 아래처럼 단순화한다.

```text
사용자 관리
└─ 사용자 관리
```

또는 상위 그룹 자체가 `/admin/users`로 이동할 수 있는 현재 메뉴 시스템이라면 별도 하위 메뉴를 두지 않아도 된다.

핵심은 `/admin/users` 한 화면에서 가족/부모/아이를 전환하는 것이다.

기존 파편화 메뉴:

```text
계정 복구 승인
요금제 변경 요청
아이 승인 요청
```

은 사용자 관리 화면의 각 탭 내부로 흡수한 뒤 사이드바에서는 제거한다.

---

# 4. 메인 라우트

통합 사용자 관리 메인:

```text
/admin/users
```

탭 query:

```text
/admin/users?tab=families
/admin/users?tab=parents
/admin/users?tab=children
```

기본 탭:

```text
families
```

잘못된 tab 값은 families로 fallback한다.

---

# 5. 화면 전체 구조

권장 UX:

```text
사용자 관리
가족·부모·아이 계정과 서비스 이용 상태를 관리합니다.

[ 전체 가족 ] [ 전체 부모 ] [ 전체 아이 ] [ 처리 대기 ]

[ 🔍 가족명 / 이름 / 로그인 아이디 / 이메일 검색... ]

[ 가족 ] [ 부모 ] [ 아이 ]

[상태] [내부 테스트 제외] [가입일/생성일] [기타 탭별 필터]   [CSV]

──────────────────────────────────────────────────────────
목록 테이블
──────────────────────────────────────────────────────────

행 클릭
→ 우측 Slide-over Detail Drawer
```

디자인 원칙:

- 목록 = 빠른 탐색
- 상세 = 우측 패널
- 승인/복구/요금제 요청 = 해당 사용자 탭의 sub-tab
- 리텐션 분석은 별도 리텐션 메뉴 역할 유지
- 사용자 관리 목록에 리텐션 지표를 과도하게 넣지 않음

---

# 6. 상단 KPI 카드

상단에는 핵심 수치만 표시한다.

```text
전체 가족
전체 부모
전체 아이
처리 대기
```

추가 가능:

```text
내부 테스트 가족/부모/아이
```

단, 카드가 과도하게 늘어나지 않게 한다.

## 처리 대기 정의

다음 합계:

```text
계정 복구 요청 대기
요금제 변경 요청 대기
아이 승인 대기
```

기존 실제 상태값과 테이블을 확인하여 계산한다.

추측 enum 금지.

---

# 7. 공통 검색

상단 검색창 하나로 다음 필드를 검색할 수 있게 한다.

```text
가족명
부모 이름
부모 로그인 이메일/아이디
아이 이름
아이 로그인 아이디
```

검색 placeholder:

```text
가족명, 부모/아이 이름, 로그인 아이디 또는 이메일 검색
```

검색은 현재 선택 탭 범위에서 결과를 좁힌다.

가능하면 서버-side 검색을 사용한다.

사용자 수가 증가해도 전체 데이터를 클라이언트로 가져와 필터링하는 구조로 만들지 않는다.

---

# 8. 공통 필터

모든 탭 공통:

```text
내부 테스트: 제외 / 포함 / 테스트만
상태
기간
```

기본:

```text
내부 테스트 제외
```

내부 테스트 판단은 기존 실제 필드를 재사용한다.

예:

```text
family_members.is_internal_test
child_profiles.is_test_account
```

이메일 suffix만을 유일한 source of truth로 사용하지 않는다.

---

# 9. 가족 탭

탭:

```text
[가족]
```

상단 count:

```text
가족 7
```

실시간 DB 값 사용.

## 9.1 가족 목록 컬럼

권장:

| 가족 | 부모 | 아이 | 요금제 | 생성일 | 최근 활동 | 테스트 | 상태 |
|---|---|---|---|---|---|---|---|

### 가족

원천:

```text
families.name
```

families.name이 비어 있을 때만 기존 실제 fallback 규칙을 재사용한다.

임의로 새 규칙을 만들지 않는다.

### 부모

해당 가족의:

```text
family_members.role IN ('owner_parent', 'parent')
```

부모 이름 + 로그인 이메일/아이디를 표시한다.

여러 명이면:

```text
안형진
hjan***@...

정미경
...
```

처럼 최대 2명 정도 표시 후 필요하면 `+N` 처리.

### 아이

아이 이름을 표시.

아이 수가 많으면:

```text
안서아, 안서현
```

또는 `2명` + hover/detail.

### 요금제

대표 요금제의 authoritative source를 코드에서 다시 확인한다.

Antigravity 보고에 `parents.tier 또는 child_profiles.tier` 후보가 있었으나, **실제 서비스 과금의 source of truth를 확인한 뒤 하나로 확정**한다.

추측하거나 부모/아이 tier를 임의 혼합하지 않는다.

### 생성일

```text
families.created_at
```

KST 표시.

### 최근 활동

권장:

해당 가족 소속 사용자들의 실제 활동 중 최신 시각.

우선 후보:

```text
chat_sessions.started_at
behavior_events.created_at
```

N+1 없이 서버 집계.

### 테스트

가족 내 internal-test 멤버가 있을 때 정책을 명확히 한다.

권장:

- 가족 자체 테스트 여부는 family_members.is_internal_test를 기준으로 집계
- 가족 내 모든 핵심 계정이 테스트면 `[테스트]`
- 혼합 가족이 존재하면 `[혼합]`

실제 Production 데이터에 혼합 가족이 없다면 해당 상태는 future-safe 처리만 한다.

### 상태

```text
families.deleted_at IS NULL → 활성
deleted_at IS NOT NULL → 일반 목록 제외 / 휴지통
```

일반 목록에는 삭제된 가족을 표시하지 않는다.

---

# 10. 가족 상세 우측 패널

가족 행 클릭 시 오른쪽 Slide-over Drawer를 연다.

권장 너비:

```text
Desktop: 420~520px
Tablet: 50~65vw
Mobile: full screen
```

표시:

```text
가족명
가족 생성일
가족 상태
내부 테스트 여부

부모
- 이름
- 로그인 이메일/아이디
- role (owner_parent / parent)
- 계정 상태

아이
- 이름
- 로그인 아이디
- 학년
- 성별
- 승인 상태

요금제
최근 가족 활동
최근 대화 세션 요약
```

버튼:

```text
[부모 상세]
[아이 상세]
```

같은 Drawer 안에서 context 전환하거나 해당 탭으로 이동 가능.

---

# 11. 부모 탭

탭:

```text
[부모]
```

Sub-tabs:

```text
전체 부모
계정 복구 요청
요금제 변경 요청
```

기존 기능을 여기로 흡수한다.

## 11.1 전체 부모 목록 컬럼

권장:

| 부모 | 가족 | 연결 아이 | 요금제 | 가입 채널 | 가입일 | 최근 접속 | 상태 | 테스트 |
|---|---|---:|---|---|---|---|---|---|

### 부모

```text
parents.name
auth.users.email
```

표시 예:

```text
안형진
hjan***@outlook.com
```

UUID 표시 금지.

### 가족

```text
family_members.family_id
→ families.name
```

### 연결 아이

같은 family_id 내 실제 child_profiles 수.

soft-deleted member 제외.

### 요금제

```text
parents.tier
```

실제 tier → 사용자-facing 플랜명 변환 로직을 기존 pricing/plan mapping에서 재사용한다.

새 명칭 하드코딩 금지.

### 가입 채널

실제 연결:

```text
parents.id
→ parent_attributions.parent_user_id
→ parent_attributions.signup_link_id
→ acquisition_links.id
```

표시 우선순위:

```text
channel_name
link_name
utm_source
```

예:

```text
카카오톡
kakao / referral
```

유입 정보가 없으면:

```text
기존 가입자
```

또는:

```text
미확인
```

기존 attribution 생성 시점과 가입 시점 기준을 확인해 구분한다.

임의 추정 금지.

### 가입일

우선:

```text
auth.users.created_at
```

KST.

### 최근 접속

부모 1순위:

```text
auth.users.last_sign_in_at
```

툴팁:

```text
Supabase Auth 기준 최근 로그인/토큰 갱신 시각
```

실제 앱 활동과 완전히 동일하지 않을 수 있음을 관리자 문구로 명확히 한다.

### 상태

실제 Production enum:

```text
ACTIVE
ONBOARDING
SUSPENDED
```

이 값만 사용한다.

### 테스트

```text
family_members.is_internal_test
```

기준.

---

# 12. 부모 상세 패널

표시:

```text
부모 이름
로그인 이메일
계정 상태
가입일
최근 접속
온보딩 완료일
소속 가족
연결 아이
현재 요금제
회원가입 유입 채널
첫 유입/가입 유입 정보
계정 복구 요청 이력
요금제 변경 요청 이력
```

가능하면:

```text
[가족 보기]
[아이 보기]
```

버튼 제공.

이번 Request에서 신규 `SUSPENDED` 변경 API를 임의로 만들지 않는다.

기존 검증된 액션 API가 있으면 재사용하고, 없으면 상세 조회까지만 구현 후 `신규 액션 API 필요`로 보고한다.

---

# 13. 부모 계정 복구 요청 Sub-tab

기존 독립 `계정 복구 승인` 화면을 부모 탭 안으로 흡수한다.

URL:

```text
/admin/users?tab=parents&sub=restorations
```

기존 복구 서비스:

```text
app/api/admin/trash/restore
parents.restore_requested_at
```

실제 기존 승인/복구 흐름을 재사용한다.

표시:

```text
부모
가족
요청일
상태
액션
```

기존 데이터 변경 없이 UI 위치만 통합.

---

# 14. 부모 요금제 변경 요청 Sub-tab

URL:

```text
/admin/users?tab=parents&sub=plan-change
```

표시:

```text
부모
현재 요금제
요청 요금제
요청일
상태
액션
```

중요:

Antigravity 보고에는 `parents.tier 직접 변경 API로 통합 가능`이라고 되어 있지만, **현재 기존 요금제 변경 승인 로직/API가 실제로 있는지 다시 코드에서 확인하여 반드시 재사용**한다.

단순 `parents.tier` 직접 UPDATE를 새로 작성하지 않는다.

결제/상품 상태와 정합성을 깨뜨릴 수 있으므로 기존 비즈니스 로직을 우선한다.

---

# 15. 아이 탭

탭:

```text
[아이]
```

Sub-tabs:

```text
전체 아이
승인 대기
```

## 15.1 아이 목록 컬럼

권장:

| 아이 | 학년 | 성별 | 가족 | 부모 | 승인 | 생성일 | 최근 활동 | 테스트 |
|---|---|---|---|---|---|---|---|---|

### 아이

```text
child_profiles.name
family_members.user_id → auth.users.email
```

화면에는 아이 이름 + 로그인 아이디만 표시.

예:

```text
안서아
asa160202
```

`@kbestie.local` 이메일을 로그인 아이디로 변환하는 기존 helper가 있다면 재사용한다.

### 학년

```text
child_profiles.grade
```

실제 서비스 표시 규칙 재사용.

### 성별

실제 DB 값:

```text
M / F
male / female
```

표시:

```text
남
여
```

기존 normalize helper가 있으면 재사용.

### 가족

```text
families.name
```

### 부모

같은 가족의:

```text
owner_parent / parent
```

이름 표시.

### 승인

```text
child_profiles.approval_status
```

실제 값:

```text
APPROVED
PENDING
```

실제 enum을 코드에서 재확인.

### 생성일

```text
child_profiles.created_at
```

KST.

### 최근 활동

아이 1순위:

```text
chat_sessions.started_at
```

최근 미션/자유대화 시작 시각.

auth.last_sign_in_at은 보조 정보로 상세에서만 표시 가능.

### 테스트

```text
child_profiles.is_test_account
family_members.is_internal_test
```

기존 테스트 판정 정책 재사용.

---

# 16. 아이 상세 패널

표시:

```text
아이 이름
로그인 아이디
학년
성별
가족
연결 부모
승인 상태
생성일
최근 활동
내부 테스트 여부

최근 미션 세션
최근 자유대화 세션
usage_events 요약
안전 이벤트 요약
```

재사용:

```text
app/api/admin/usage/route.ts
app/api/admin/safety-events/route.ts
safety_events_admin_view
```

주의:

사용자 관리 상세는 운영 요약 목적이다.

리텐션 화면 수준의 긴 차트/코호트를 여기 중복 구현하지 않는다.

---

# 17. 아이 승인 대기 Sub-tab

URL:

```text
/admin/users?tab=children&sub=approval
```

기존 `아이 승인 요청` 기능을 흡수한다.

표시:

```text
아이
로그인 아이디
가족
부모
학년
요청일
상태
액션
```

기존 승인 API와 상태 변경 로직을 재사용한다.

새로운 직접 DB UPDATE 로직을 만들지 않는다.

---

# 18. 서버 API 구조

신규 통합 조회 API 권장:

```text
GET /api/admin/users/overview
```

파라미터:

```text
tab=families|parents|children
search=
status=
internalTest=exclude|include|only
page=
pageSize=
sort=
sub=
```

필요 시 탭별 상세 API:

```text
GET /api/admin/users/families/:id
GET /api/admin/users/parents/:id
GET /api/admin/users/children/:id
```

단, 기존 상세 API를 재사용할 수 있으면 중복 생성하지 않는다.

---

# 19. N+1 방지

현재 일부 관리자 코드는 테이블별 여러 query 후 메모리 조인 구조가 존재한다.

사용자가 늘어나면 느려질 수 있으므로 목록은 N+1 없이 구성한다.

권장:

```text
RPC
또는
Supabase Embedded Resource Select
또는
서버 단일/소수 쿼리
```

예:

```text
get_admin_family_tree_v1()
```

RPC 이름은 예시다.

실제 필요성을 확인하고, 단순 Embedded Select로 충분하면 불필요한 RPC를 만들지 않는다.

목표:

```text
목록 1페이지 조회 시 사용자 수만큼 반복 query 금지
```

---

# 20. 페이지네이션

가족/부모/아이 모두 서버 pagination 적용.

기본:

```text
25개/페이지
```

선택:

```text
25
50
100
```

Production 현재 데이터가 작더라도 향후 사용자 증가를 고려한다.

---

# 21. 정렬

탭별 최소 정렬:

## 가족

```text
가족명
생성일
최근 활동
```

## 부모

```text
이름
가입일
최근 접속
상태
```

## 아이

```text
이름
학년
생성일
최근 활동
승인 상태
```

---

# 22. CSV Export

사용자 관리 탭별 CSV 다운로드를 제공한다.

```text
가족 CSV
부모 CSV
아이 CSV
```

현재 필터/검색 조건을 그대로 적용.

민감정보 최소화:

- UUID 제외
- 비밀번호/토큰 제외
- 원문 대화 제외
- 전체 Auth metadata 제외

다운로드 감사 로그가 기존에 있으면 재사용.

XLSX는 기존 공통 export 인프라가 있으면 추가 가능.

없으면 이번 Request에서 CSV만 우선 구현해도 된다.

---

# 23. UUID 노출 제거

현재 관리자 일부 drilldown에서 truncated UUID가 보이는 위치가 있다.

이번 개편 화면에서는:

```text
사용자-facing UUID 표시 0건
```

을 목표로 한다.

기본 화면:

```text
이름
로그인 아이디/이메일
가족명
```

으로 식별.

개발상 내부 ID가 꼭 필요하면 상세 패널의 별도 `기술 정보` 접힘 영역 또는 복사 버튼으로 숨긴다.

기본 텍스트로 노출하지 않는다.

---

# 24. 기존 라우트 정리

통합 완료 후 기존 관련 URL은 새 화면으로 redirect한다.

Antigravity 감사 기준 후보:

```text
/admin/parents
→ /admin/users?tab=parents

/admin/children
→ /admin/users?tab=children

/admin/restorations
→ /admin/users?tab=parents&sub=restorations
```

실제 저장소 라우트를 다시 전수 확인한 뒤 적용한다.

존재하지 않는 URL을 임의로 만들지 않는다.

요금제 변경/아이 승인 기존 라우트도 실제 path 확인 후 각각 해당 sub-tab으로 redirect.

내부 관리자 앱에서는 307/308 등 현재 Next.js routing 정책에 맞는 redirect를 사용한다.

SEO 목적의 301은 관리자 내부 페이지에서 필수 요구사항이 아니다.

---

# 25. 계정 상태 정책

부모 계정 실제 enum:

```text
ACTIVE
ONBOARDING
SUSPENDED
```

새 상태 enum 생성 금지.

아이의 경우 Antigravity 감사상 별도 일반 `account_status`가 확정되지 않았다.

따라서 아이 목록에서는:

```text
승인 상태
테스트 여부
```

를 별도로 표시한다.

아이에게 `ACTIVE/SUSPENDED` 같은 상태를 임의로 만들어 보여주지 않는다.

---

# 26. 중요한 Production 보호 조건

현재 Production에 실제 `ONBOARDING` 사용자가 존재한다.

가족 미소속 또는 가입 미완료라는 이유로:

```text
테스트
오류
삭제 대상
```

으로 분류하면 안 된다.

정상 표시:

```text
ONBOARDING
가입 진행 중
```

또한:

```text
family_members.deleted_at IS NULL
```

필터 누락으로 삭제 멤버가 다시 목록에 나타나지 않게 한다.

---

# 27. UI 디자인 세부

## 탭

```text
[가족 7] [부모 10] [아이 14]
```

현재 탭은 명확한 active style.

## 검색/필터 툴바

Carbon/Data Table 계열 UX처럼 목록 바로 위에 배치.

왼쪽:

```text
검색
상태
내부 테스트
```

오른쪽:

```text
CSV
```

## 테이블

- sticky header 가능
- 행 전체 clickable
- hover 표시
- checkbox는 실제 bulk action이 없으면 넣지 않음
- bulk action이 없는 상태에서 선택 checkbox를 단순 장식으로 만들지 않음

## 우측 Drawer

목록 context를 잃지 않고 상세 확인 가능.

닫기 후 목록의 필터/페이지/스크롤 위치 유지.

---

# 28. 모바일

모바일에서는 테이블을 무리하게 압축하지 않는다.

권장:

- 탭 유지
- 검색/필터 2줄
- 목록은 카드형 또는 가로 스크롤
- 상세 Drawer는 full-screen modal
- 긴 이메일 말줄임
- action은 overflow menu 사용 가능

---

# 29. 기존 리텐션과 역할 분리

사용자 관리:

```text
누가 가입되어 있는가
어느 가족인가
현재 상태는 무엇인가
최근 접속은 언제인가
가입 채널은 무엇인가
```

리텐션:

```text
얼마나 자주 사용했는가
D1/D3/D7
활성일
미션/자유대화/놀이
코호트
```

리텐션 상세 데이터를 사용자 관리 목록에 과도하게 복제하지 않는다.

아이 상세에는 최근 이용 요약만 제공하고, 필요하면:

```text
[리텐션에서 보기]
```

링크를 제공한다.

---

# 30. 기존 API 재사용

가능한 기존 리소스:

```text
app/api/admin/usage/route.ts
app/api/admin/safety-events/route.ts
app/api/admin/retention/parents/route.ts
app/api/admin/trash/route.ts
safety_events_admin_view
get_retention_overview
```

재사용 여부를 먼저 확인한다.

중복 API를 무조건 만들지 않는다.

---

# 31. 테스트 요구사항

## 31.1 Production count 정합성

화면 count는 DB 실시간 집계와 일치.

```text
가족
부모
아이
```

내부 테스트 제외/포함 시 각각 재검증.

## 31.2 가족

- 가족명 검색
- 부모 표시
- 아이 표시
- 최근 활동
- 테스트 태그
- Drawer

## 31.3 부모

- 이름 검색
- 이메일 검색
- 가족 필터
- 요금제
- 가입 채널
- ACTIVE/ONBOARDING/SUSPENDED
- 최근 접속
- Drawer
- 계정 복구 sub-tab
- 요금제 변경 sub-tab

## 31.4 아이

- 이름 검색
- 로그인 아이디 검색
- 학년
- 성별
- 가족
- 부모
- 승인 상태
- 최근 활동
- 테스트 여부
- Drawer
- 승인 대기 sub-tab

## 31.5 Soft delete

삭제된:

```text
families
family_members
```

가 기본 목록에 나타나지 않아야 한다.

## 31.6 UUID

기본 사용자 관리 화면에서 UUID 텍스트 0건.

---

# 32. E2E 시나리오

1. `/admin/users` 진입
2. 가족 탭 기본 표시
3. 가족 count와 DB count 비교
4. 특정 가족 검색
5. 행 클릭 → Drawer
6. 부모 클릭 → 부모 tab/detail
7. 부모 가입 채널 확인
8. ONBOARDING 부모가 정상 표시되는지 확인
9. 아이 탭 이동
10. 아이 이름 검색
11. 승인 대기 sub-tab
12. 내부 테스트 제외/포함
13. CSV 다운로드
14. 기존 계정 복구 URL redirect
15. 기존 요금제 변경 URL redirect
16. 기존 아이 승인 URL redirect

---

# 33. 완료 조건

- `/admin/users` 통합 콘솔 구현
- 가족/부모/아이 3탭 구현
- 상단 실시간 count
- 공통 검색
- 내부 테스트 필터
- 서버 pagination
- 가족 목록 구현
- 부모 목록 구현
- 아이 목록 구현
- 가족 상세 Drawer
- 부모 상세 Drawer
- 아이 상세 Drawer
- 부모 가입 채널 표시
- 계정 복구 요청 부모 sub-tab 통합
- 요금제 변경 요청 부모 sub-tab 통합
- 아이 승인 대기 sub-tab 통합
- 기존 파편화 사이드바 메뉴 제거
- 기존 관련 URL redirect
- UUID 기본 노출 0건
- soft-deleted 멤버 조회 제외
- ONBOARDING 실제 사용자 보호
- N+1 query 구조 없음
- TypeScript 오류 0건
- Build 성공
- Dev E2E PASS
- Production 배포 완료
- Production 읽기 중심 스모크 테스트 PASS
- 실제 사용자 데이터 임의 수정 0건

---

# 34. 완료 보고 형식

1. 최종 사용자 관리 IA
2. 최종 라우트/탭/sub-tab
3. 가족 목록 데이터 원천
4. 부모 목록 데이터 원천
5. 아이 목록 데이터 원천
6. 요금제 authoritative source
7. 최근 활동 계산식
8. 가입 채널 조인 방식
9. 내부 테스트 판정 방식
10. N+1 방지 방식
11. 기존 API 재사용 목록
12. 신규 API/RPC 목록
13. Drawer 구현 구조
14. 기존 파편화 메뉴 제거 결과
15. 기존 URL redirect 목록
16. UUID 노출 제거 결과
17. Production 가족/부모/아이 count UI vs DB 비교
18. ONBOARDING 사용자 보호 검증
19. TypeScript/Build 결과
20. Dev E2E
21. Production 배포 커밋
22. Production Deployment ID / READY
23. Production 스모크 테스트
24. 남은 위험 또는 미완료

---

# 35. 보안 및 작업 제한

- auth UUID 전체값 UI 노출 금지
- Service Role Key 출력 금지
- API Key/Token/비밀번호 출력 금지
- 실제 사용자 계정 임의 삭제 금지
- 실제 ONBOARDING 사용자 상태 변경 금지
- 가족 관계 임의 변경 금지
- 대화/미션/리포트 데이터 삭제 금지
- 아이에게 존재하지 않는 계정 상태 enum 생성 금지
- 요금제 변경을 단순 DB UPDATE로 새로 구현하지 말고 기존 비즈니스 로직 확인 후 재사용
- 기존 pending migration 전체 일괄 적용 금지
