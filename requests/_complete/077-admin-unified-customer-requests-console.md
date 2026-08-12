# Request: 관리자 `고객 접수` 통합 운영 콘솔 구축 — 문의 / 건의 / 버그 3종 분리 + 기존 VOC 안전 보존

## 0. 배경

현재 관리자 고객 접수 영역은 문의/건의/버그가 사이드바에서 분리되어 있거나 기존 통합 화면 안에서 필터로 관리되고 있으나, 실제 DB 구조는 `public.support_requests` 단일 테이블을 사용한다.

Antigravity 읽기 전용 감사 결과 현재 실제 구조는 다음과 같다.

```text
category = voc
→ 문의 + 일반 건의가 함께 저장됨

category = bug
→ 버그 신고
```

Production 실측:

```text
총 14건
voc 12건
bug 2건
```

상태값:

```text
open
in_progress
resolved
closed
```

이번 개편에서는 **앞으로 신규 접수부터 문의 / 건의 / 버그를 정확히 3종으로 분리**하고, 기존 `voc` 데이터는 임의 자동분류하지 않고 **`기존 문의·건의`로 안전하게 보존**한다.

---

## 1. 최종 정책

### 신규 접수

앞으로 신규 접수 category:

```text
inquiry
suggestion
bug
```

의미:

```text
inquiry     → 문의
suggestion  → 건의
bug         → 버그
```

### 기존 데이터

기존 Production `voc` 12건:

```text
voc → 기존 문의·건의
```

로 그대로 보존한다.

금지:

- 기존 `voc` 12건 AI/키워드 자동 재분류 금지
- 기존 데이터 일괄 UPDATE 금지
- 기존 request_number 변경 금지
- 기존 status 변경 금지

필요하면 관리자 상세 Drawer에서 관리자가 수동으로 `문의` 또는 `건의`로 재분류할 수 있게 한다.

---

## 2. 최종 관리자 IA

사이드바:

```text
고객 접수
```

하위에 `문의 접수`, `건의 접수`, `버그 접수`를 각각 별도 메뉴로 두지 않는다.

통합 라우트:

```text
/admin/customer-requests
```

페이지 내부 유형 필터:

```text
[전체] [문의] [건의] [버그] [기존 문의·건의]
```

상태 필터:

```text
[전체 상태] [신규] [처리 중] [처리 완료] [종료]
```

---

## 3. 기존 DB 구조 재사용

기존 단일 테이블:

```text
public.support_requests
```

주요 컬럼:

```text
id
request_number
category
status
submitter_role
user_id
child_id
guardian_id
subject
body
admin_note
device_info
app_surface
current_route
app_version
play_session_id
created_at
updated_at
deleted_at
deleted_by
delete_reason
```

기존 `type` 컬럼을 새로 만들지 않는다.

반드시 실제 컬럼명:

```text
category
```

를 사용한다.

---

## 4. category 확장

현재:

```text
voc
bug
```

변경 후 허용:

```text
inquiry
suggestion
bug
voc
```

`voc`는 legacy category로 유지한다.

신규 생성에서는 `voc`를 사용하지 않는다.

표시명:

```text
inquiry     → 문의
suggestion  → 건의
bug         → 버그
voc         → 기존 문의·건의
```

---

## 5. 상태값 유지

기존 상태값:

```text
open
in_progress
resolved
closed
```

표시:

```text
open        → 신규
in_progress → 처리 중
resolved    → 처리 완료
closed      → 종료
```

기존 상태 전이:

```text
open → in_progress → resolved → closed
```

이 흐름을 유지한다.

기존 `PATCH /api/admin/support-requests/[id]`와 `admin_audit_log` 기록 구조를 재사용한다.

---

## 6. 상단 KPI / 유형 카운터

상단에 작은 카운터 또는 탭 badge:

```text
전체 14
문의 0
건의 0
버그 2
기존 문의·건의 12
```

실시간 DB 값을 사용한다.

상태별 카운터:

```text
신규
처리 중
처리 완료
종료
```

유형 필터와 상태 필터를 조합 가능하게 한다.

예:

```text
버그 + 처리 중
문의 + 신규
전체 + 신규
```

---

## 7. 검색 / 필터 툴바

검색:

```text
접수번호
제목
내용
접수자 이름
로그인 이메일/아이디
```

필터:

```text
유형
상태
접수자 역할: 전체 / 부모 / 아이
기간
```

기간 권장:

```text
오늘
최근 7일
최근 30일
전체
직접 기간
```

직접 기간:

```text
시작일 ~ 종료일
```

KST 기준.

현재 API의 서버-side pagination 유지.

기본:

```text
pageSize = 25
```

---

## 8. 통합 목록 테이블

권장 컬럼:

| 유형 | 접수번호 | 접수자 | 제목/내용 요약 | 접수일 | 상태 |
|---|---|---|---|---|---|

삭제 버튼을 각 행에 항상 노출하지 않는다.

행 전체 클릭:

```text
→ 우측 상세 Drawer
```

선택 checkbox는 실제 bulk action을 제공할 때만 표시한다.

---

## 9. 우측 상세 Drawer

공통 표시:

```text
유형
접수번호
접수일시
상태

접수자
이름
부모/아이 역할
로그인 이메일/아이디
가족명

제목
내용

첨부파일
관리자 메모
처리 이력
```

버그 추가 정보:

```text
app_surface
current_route
app_version
device_info
OS
Platform
Browser/UserAgent 요약
```

문의 / 건의 추가 정보:

```text
play_session_id
guardian_id
관련 세션/기능 정보
```

---

## 10. 상세 Drawer 액션

Drawer 안에서:

```text
[상태 변경]
[관리자 메모 저장]
[접수자 상세 보기]
[가족 상세 보기]
```

우측 `⋯` 메뉴:

```text
유형 재분류
삭제
```

삭제는 기존 소프트 삭제 정책을 그대로 사용한다.

---

## 11. 기존 VOC 수동 재분류

`category = voc`인 기존 데이터에서만:

```text
[문의로 분류]
[건의로 분류]
```

제공.

실행 전 확인 모달:

```text
이 접수 건을 '문의'로 분류하시겠습니까?
기존 접수번호와 상태는 유지됩니다.
```

변경:

```text
voc → inquiry
```

또는:

```text
voc → suggestion
```

유지:

```text
request_number
status
submitter
created_at
attachments
admin_note
```

감사 로그:

```text
CATEGORY_RECLASSIFIED
before_category
after_category
admin_id
timestamp
request_id
```

재분류는 수동 관리자 액션으로만 수행한다.

---

## 12. 신규 접수 UI / API 변경

부모/아이의 문의·건의·버그 접수 UI에서 앞으로 3개 유형을 정확히 생성해야 한다.

신규 생성 시:

```text
문의 → inquiry
건의 → suggestion
버그 → bug
```

`voc` 신규 생성 금지.

부모 앱 / 아이 앱의 접수 폼에서 이미 유형 선택 UI가 있다면 실제 API payload가 새 category와 일치하도록 수정한다.

기존 사용자 화면의 조회는 legacy `voc`도 정상 표시해야 한다.

표시:

```text
voc → 문의·건의
```

---

## 13. 사용자 진행상태 연동 유지

현재:

```text
/parent/support
/child/support
```

에서 사용자가 자신의 접수 건 상태를 조회한다.

관리자 상태 변경:

```text
open
in_progress
resolved
closed
```

은 기존처럼 사용자 화면에 즉시 반영되어야 한다.

이번 category 개편으로 사용자 진행 상태 기능이 깨지면 안 된다.

---

## 14. 접수자 → 사용자 관리 연동

실제 조인:

아이:

```text
support_requests.child_id
→ child_profiles.id
→ child_profiles.family_id
→ families.id
```

부모:

```text
support_requests.user_id
→ auth.users.id
→ parents.id
```

또는:

```text
support_requests.guardian_id
→ parents.id
```

Drawer에서:

```text
[부모 상세]
[아이 상세]
[가족 상세]
```

로 `/admin/users` 통합 사용자 관리 콘솔과 연결한다.

UUID는 사용자-facing 텍스트로 노출하지 않는다.

---

## 15. 관리자 메모

기존:

```text
support_requests.admin_note
```

를 그대로 사용한다.

기존 PATCH API 재사용.

새 테이블 생성 금지.

---

## 16. 첨부파일

기존 구조:

```text
feedback_request_attachments
Storage bucket: support-attachments
```

를 재사용한다.

Drawer에서:

- 이미지 썸네일
- 클릭 시 확대
- 파일명
- 업로드 시각

표시 가능.

비공개 파일은 Signed URL 사용.

Storage 공개 정책 임의 변경 금지.

---

## 17. 삭제 정책

기존 soft delete 유지:

```text
deleted_at
deleted_by
delete_reason
```

삭제:

```text
POST /api/admin/trash/delete
```

복구:

```text
POST /api/admin/trash/restore
```

30일 휴지통 정책 유지.

기본 목록:

```text
deleted_at IS NULL
```

필수.

각 행의 빨간 삭제 버튼은 제거하고:

- 상세 Drawer `⋯`
- bulk action bar

로 이동한다.

---

## 18. 일괄 액션

기존 일괄 소프트 삭제 재사용.

선택 시:

```text
3건 선택됨
[상태 변경] [삭제]
```

일괄 상태 변경은 신규 구현.

허용:

```text
open → in_progress
in_progress → resolved
resolved → closed
```

모든 변경은 `admin_audit_log`에 각 접수 건별 기록한다.

---

## 19. 기존 API 재사용

최대한 재사용:

```text
GET /api/admin/support-requests
PATCH /api/admin/support-requests/[id]
POST /api/admin/trash/delete
POST /api/admin/trash/restore
```

GET API 확장:

```text
category=inquiry|suggestion|bug|voc|all
status=open|in_progress|resolved|closed|all
submitter_role=parent|child|all
q=
page=
pageSize=
```

필요하면:

```text
startDate
endDate
```

추가.

---

## 20. 새 일괄 상태 변경 API

권장 예:

```text
POST /api/admin/support-requests/bulk-status
```

payload:

```json
{
  "ids": ["..."],
  "status": "in_progress"
}
```

서버에서:

- 관리자 인증
- 권한
- 현재 상태 전이 검증
- deleted_at IS NULL
- 각 행 audit log
- request id

보장.

---

## 21. 기존 라우트 Redirect

통합:

```text
/admin/customer-requests
```

실제 존재하는 기존 라우트를 확인하여 redirect.

Antigravity 감사 기준:

```text
/admin/support-requests
→ /admin/customer-requests

/admin/voc
→ /admin/customer-requests?category=voc

/admin/bugs
→ /admin/customer-requests?category=bug
```

문의/건의/버그 분리 라우트가 실제로 존재한다면:

```text
문의 → category=inquiry
건의 → category=suggestion
버그 → category=bug
```

로 redirect.

존재하지 않는 라우트 임의 생성 금지.

---

## 22. 사이드바 정리

기존:

```text
고객 접수
├─ 문의 접수
├─ 건의 접수
└─ 버그 접수
```

최종:

```text
고객 접수
```

한 항목만 표시.

클릭:

```text
/admin/customer-requests
```

---

## 23. Production 기존 데이터 보호

현재 Production 실측:

```text
voc 12건
bug 2건
총 14건
```

모든 기존 데이터 보존.

migration 적용 후에도:

```text
기존 voc 12건 유지
기존 bug 2건 유지
```

건수와 request_number가 변하면 실패.

---

## 24. DB Migration

category constraint/enum/check가 현재 `voc | bug`만 허용한다면 아래를 추가한다.

```text
inquiry
suggestion
```

최종 허용:

```text
voc
inquiry
suggestion
bug
```

기존 `voc` DROP 금지.

기존 pending migration 전체 일괄 적용 금지.

이번 작업 전용 migration만 작성.

기존 row 수정 금지.

---

## 25. UI 상태 Badge

유형:

```text
문의
건의
버그
기존 문의·건의
```

상태:

```text
신규
처리 중
처리 완료
종료
```

색상만으로 구분하지 않고 텍스트 함께 표시.

---

## 26. 모바일

기존 `AdminResponsiveTable` 재사용.

모바일:

- 목록은 카드형
- 유형/상태 badge
- 접수자
- 제목/내용
- 접수일
- 상태

카드 클릭:

```text
full-screen detail drawer/modal
```

---

## 27. 검색/성능

현재 API가 이미:

```text
request_number
subject
body
parents.name
child_profiles.name
auth.users.email
```

검색 지원.

서버-side pagination 유지.

클라이언트 전체 데이터를 가져와 필터링하는 구조로 만들지 않는다.

---

## 28. 테스트 요구사항

DB migration 전후:

```text
voc 12건 유지
bug 2건 유지
```

신규 QA:

```text
inquiry 1건
suggestion 1건
bug 1건
```

유형 필터:

```text
전체
문의
건의
버그
기존 문의·건의
```

상태 필터:

```text
open
in_progress
resolved
closed
```

Drawer 검증:

- 내용
- 접수자
- 가족
- 첨부
- 상태
- 관리자 메모
- 유형 재분류
- 삭제

Legacy VOC QA 재분류:

```text
voc → inquiry
```

후:

- request_number 유지
- status 유지
- attachment 유지
- admin_note 유지
- audit log 기록

사용자 상태 연동:

관리자 상태 변경 후:

```text
parent/support
child/support
```

상태 반영 확인.

소프트 삭제:

- 목록 제거
- 휴지통 표시
- 복구
- 원래 category/status 유지

---

## 29. 완료 조건

- `/admin/customer-requests` 통합 콘솔 구현
- 사이드바 고객 접수 1개 메뉴
- 신규 문의 `inquiry`
- 신규 건의 `suggestion`
- 신규 버그 `bug`
- legacy `voc` 보존
- 기존 voc 자동 재분류 0건
- legacy voc 수동 재분류 기능
- 유형/상태/접수자/기간/검색 필터
- 서버 pagination
- 우측 상세 Drawer
- 관리자 메모
- 첨부파일 표시
- 사용자/가족 상세 연결
- 상태 변경 기존 API 재사용
- 사용자 진행상태 연동 유지
- 행 빨간 삭제 버튼 제거
- soft delete / 휴지통 유지
- 일괄 상태 변경
- 기존 Production 14건 손실 0건
- TypeScript 오류 0건
- Build 성공
- Dev E2E PASS
- Production 배포 완료
- Production 스모크 테스트 PASS
- 비밀정보 노출 0건

---

## 30. 완료 보고 형식

1. 기존 DB/category 구조
2. migration 내용
3. 최종 category 값
4. 기존 voc/bug 데이터 보존 결과
5. 최종 고객 접수 IA
6. 사이드바 변경
7. 목록/필터 구조
8. Drawer 구조
9. 신규 inquiry/suggestion/bug 생성 경로
10. legacy voc 수동 재분류
11. 상태 변경 재사용 구조
12. admin_note 재사용
13. 첨부파일 재사용
14. 사용자/가족 drill-down
15. soft delete / trash
16. bulk status 구현
17. 기존 URL redirect
18. Production 유형별/상태별 count before → after
19. TypeScript/Build
20. Dev E2E
21. Production 배포 커밋
22. Production Deployment ID / READY
23. Production 스모크 테스트
24. 남은 위험

---

## 31. 보안 및 제한

- 기존 voc 자동분류 금지
- 기존 request_number 변경 금지
- 기존 첨부파일 삭제 금지
- 실제 사용자 접수 임의 삭제 금지
- Auth UUID 기본 UI 노출 금지
- Service Role Key/API Key/Token 출력 금지
- Signed URL 영구 저장 금지
- category 컬럼을 type으로 잘못 변경 금지
- deleted_at IS NULL 조건 누락 금지
- 기존 사용자 진행상태 API 삭제 금지
- 기존 pending migration 전체 일괄 적용 금지
