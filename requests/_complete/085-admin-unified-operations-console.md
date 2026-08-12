# Request: 관리자 `운영 도구` 통합 콘솔 구축 — 푸시 테스트 / 회원가입 유입 / 휴지통 통합

## 0. 작업 목적
현재 운영 도구의 `푸시 발송 테스트 / 회원가입 유입 링크 관리 / 회원가입 유입 현황 / 휴지통` 4개 독립 메뉴를 하나의 `/admin/operations` 통합 콘솔로 재구성한다.

최종 IA:
```text
운영 도구
[푸시 테스트] [회원가입 유입] [휴지통]

회원가입 유입 내부:
[유입 현황] [유입 링크 관리]
```

## 1. 구현 전 현재 HEAD 재확인
Antigravity 감사 시점 기준 084 푸시 테스트 수정은 미반영 상태다.
현재 `PushTestTab.tsx`가 `/api/cron/mission-start`를 직접 호출해 Production 401이 발생한다.

작업 시작 시 아래를 재확인한다.
```text
app/admin/(dashboard)/PushTestTab.tsx
app/api/admin/push-test/send/route.ts
lib/mission/missionPushService.ts
app/api/cron/mission-start/route.ts
```

- 084가 이미 반영됐으면 재사용
- 미반영이면 이번 작업에서 함께 구현
- Cron endpoint direct fetch를 그대로 옮기지 말 것

## 2. 사이드바
기존 4개 메뉴를 제거하고 `운영 도구` 하나만 남긴다.

```text
운영 도구 → /admin/operations
```

## 3. 라우트
```text
/admin/operations?tab=push
/admin/operations?tab=acquisition&sub=dashboard
/admin/operations?tab=acquisition&sub=links
/admin/operations?tab=trash
```

기본: `tab=push`

## 4. Legacy Redirect
실제 존재하는 기존 라우트만 아래로 redirect한다.

```text
/admin/push-test
→ /admin/operations?tab=push

/admin/acquisition/dashboard
→ /admin/operations?tab=acquisition&sub=dashboard

/admin/acquisition/links
→ /admin/operations?tab=acquisition&sub=links

/admin/trash
→ /admin/operations?tab=trash
```

## 5. 통합 페이지
신규:
```text
app/admin/operations/page.tsx
```

메인 탭:
```text
[푸시 테스트] [회원가입 유입] [휴지통]
```

회원가입 유입 sub-tab:
```text
[유입 현황] [유입 링크 관리]
```

URL query와 탭 상태를 항상 동기화하고 새로고침/뒤로가기에도 유지한다.

## 6. 푸시 테스트 탭
기존 UX 유지:
```text
아이 검색
→ 테스트 아이 선택
→ 미션 1 즉시 발송
→ 미션 2 즉시 발송
```

UUID 직접 입력 금지.

## 7. 푸시 테스트 401 근본 수정
현재:
```text
PushTestTab
→ GET /api/cron/mission-start
→ CRON_SECRET 요구
→ 401
```

최종:
```text
PushTestTab
→ POST /api/admin/push-test/send
→ requireAdmin()
→ QA/Internal Test 계정 검증
→ 공통 missionPushService
→ sendPushNotificationWithRetry()
```

Cron은 별도 유지:
```text
Vercel Cron
→ /api/cron/mission-start
→ CRON_SECRET/BATCH_SECRET 검증
→ 공통 missionPushService
```

절대 금지:
- Cron 인증 완화
- CRON_SECRET 클라이언트 노출
- 실사용자 테스트 발송

## 8. 회원가입 유입 탭
공통 데이터:
```text
acquisition_links
acquisition_visits
acquisition_events
parent_attributions
```

두 sub-tab은 같은 데이터 소스를 재사용한다.

## 9. Acquisition 공통 State
```ts
interface AcquisitionSharedState {
  period: "today" | "7d" | "14d" | "30d" | "month" | "last_month" | "all" | "custom";
  attribution: "signup" | "first";
  includeTestAccounts: boolean;
  channelFilter: string;
  startDate: string;
  endDate: string;
}
```

sub-tab 전환 후에도 최소 `includeTestAccounts`, `channelFilter`는 유지하고, 가능하면 기간/Attribution도 유지한다.

## 10. 유입 현황
기존 `AcquisitionDashboardTab.tsx` 재사용.

KPI:
```text
총 클릭 수
고유 방문자 수
가입 시작 수
부모 가입 완료 수
가입 전환율
아이 등록 수
부모당 평균 아이 수
미확인 유입 가입 수
```

필터:
```text
오늘 / 최근7일 / 최근14일 / 최근30일 / 이번달 / 지난달 / 전체 / 사용자 지정
Signup Touch / First Touch
내부 테스트 포함
채널
```

차트/표:
```text
채널별 부모 가입 수
채널별 전환율
기간별 가입 추이
채널별 성과표
```

현재 화면의 `가입 전환율 200%` 같은 비정상 수치가 있다면 기존 API 산식을 검증해 잘못된 경우 함께 수정하고 완료 보고에 원인을 명시한다.

## 11. 유입 링크 관리
기존 `AcquisitionLinksTab.tsx` 재사용.

기능:
```text
신규 링크 생성
복사
활성/비활성 전환
소프트 삭제
```

링크 목록:
```text
채널명
link_id
Source / Medium / Campaign
용도
상태
클릭 / 가입 / 전환율
액션
```

072 link_id 규칙 유지:
```text
영문 소문자/숫자/언더스코어
채널명 한글 미포함
```

## 12. 유입 현황 ↔ 링크 관리 Drill-down
채널/성과 클릭 시 해당 채널로 필터된 다른 sub-tab으로 이동 가능하게 한다.

예:
```text
/admin/operations?tab=acquisition&sub=links&channel=kakao
```

## 13. 휴지통 탭
기존 `TrashTab.tsx`, `softDeleteService.ts` 재사용.

기능:
```text
유형 필터
삭제 사유 검색
삭제일
삭제자
선택 복구
개별 복구
남은 복구일
영구 삭제 예정일
```

## 14. 휴지통 Resource 화이트리스트 유지
현재 6종만 유지:
```text
beta_applications
support_requests
plan_change_requests
child_approval_requests
event_reward_fulfillments
acquisition_links
```

아래는 절대 추가 금지:
```text
부모
아이
가족
대화
미션
리포트
리텐션 원천
gold_key_ledger
```

## 15. 30일 정책 유지
```text
SOFT_DELETE_RETENTION_DAYS = 30
```
및 기존 bulk restore/복구 로직 그대로 재사용.

## 16. 공통 컴포넌트 재사용
```text
AdminShell
AdminPageHeader
AdminFilterBar
AdminKpiCard
AdminDataTable
AdminResponsiveTable
AdminStatusBadge
useAdminSoftDelete
SoftDeleteSelectionBar
```

중복 UI 컴포넌트 생성 최소화.

## 17. 독립 스크롤 유지
기존 관리자 레이아웃:
```text
헤더 고정
좌측 사이드바 독립 스크롤
우측 본문 독립 스크롤
```
유지.

## 18. 오류 격리
Push/Acquisition/Trash 중 하나의 API가 실패해도 전체 페이지 crash 금지.

각 탭에 Loading / Empty / Error / Retry 상태 제공.

## 19. 모바일
- 메인 탭 가로 스크롤 또는 segmented control
- Acquisition sub-tab 유지
- 테이블은 모바일 카드형
- 휴지통 필터 2줄
- 푸시 테스트 full width

## 20. Production 안전 원칙
- 푸시 테스트는 기존 QA/Internal Test 계정만
- 실제 유입 링크 임의 삭제 금지
- 실제 운영 요청 복구/삭제 테스트 금지
- 실제 부모/아이/가족 데이터 변경 금지

## 21. E2E — Push
1. `/admin/operations?tab=push`
2. QA 아이 검색/선택
3. 미션1/2 발송
4. 브라우저에서 `/api/cron/mission-start` 호출 0건
5. `/api/admin/push-test/send` 2xx
6. Console 401 0건
7. 실제 아이 강제 요청 서버 거부

## 22. E2E — Acquisition
1. dashboard sub-tab
2. 기간/Attribution/테스트/채널 필터
3. links sub-tab 이동
4. shared state 유지
5. 신규 링크 생성/복사/비활성화
6. 테스트 링크 soft delete
7. 휴지통 연동 확인

## 23. E2E — Trash
1. `/admin/operations?tab=trash`
2. 유형/사유/날짜 필터
3. 개별 복구
4. bulk restore
5. 30일 표시
6. whitelist 외 resource 노출 0건

## 24. 완료 조건
- `/admin/operations` 구현
- Push / Acquisition / Trash 3탭
- Acquisition Dashboard / Links 2 sub-tab
- URL query 상태 유지
- 기존 4개 화면 기능 손실 0건
- 기존 URL redirect
- 운영 도구 사이드바 1개 메뉴
- Push Cron direct fetch 제거
- 관리자 push API 구현
- Cron Secret 보호 유지
- 테스트 계정만 push 허용
- 유입 shared state 유지
- 링크 관리/유입 현황 API 재사용
- 휴지통 6종 whitelist 유지
- 30일 정책 유지
- Soft delete → Trash 연동
- 독립 스크롤 유지
- 모바일 정상
- TypeScript 오류 0건
- Build 성공
- Dev E2E PASS
- Production 배포 완료
- Production 스모크 테스트 PASS
- Browser Console 오류 0건

## 25. 완료 보고 형식
1. 기존 운영 도구 구조
2. 최종 통합 IA
3. 생성한 `/admin/operations`
4. tab/sub-tab route
5. 기존 URL redirect
6. 사이드바 변경
7. Push 401 수정 결과
8. 관리자 push API
9. Acquisition shared state
10. Dashboard/Links 통합 결과
11. 휴지통 whitelist/30일 정책
12. Soft delete 연동
13. 재사용 공통 컴포넌트
14. 독립 스크롤/모바일 검증
15. TypeScript/Build
16. Dev E2E
17. Production 배포 커밋
18. Deployment ID / READY
19. Production 스모크 테스트
20. 남은 위험

## 26. 보안 및 작업 제한
- CRON_SECRET 클라이언트 노출 금지
- Cron endpoint 인증 완화 금지
- Service Role Key/API Key/Token 출력 금지
- softDeleteService whitelist 임의 확대 금지
- 부모/아이/가족 휴지통 resource 추가 금지
- 실제 운영 acquisition link 임의 삭제 금지
- 실제 사용자 push 테스트 금지
- 기존 화면 제거 전 기능 parity/redirect 확인 필수
