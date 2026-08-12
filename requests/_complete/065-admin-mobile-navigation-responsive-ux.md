# 관리자 페이지 모바일 내비게이션 및 반응형 UX 개선

## 1. 목적
모바일에서 관리자 메뉴를 쉽게 열고 현재 위치를 확인하며, 긴 목록·필터·표·승인 액션을 한 손으로 사용할 수 있도록 관리자 공통 `AdminShell`을 개선한다. 페이지별 개별 메뉴가 아니라 공통 컴포넌트로 일괄 적용한다.

## 2. 반응형 기준
- Mobile: 768px 미만
- Tablet: 768~1023px
- Desktop: 1024px 이상
- Desktop은 좌측 고정 사이드바 유지
- Tablet은 접이식 사이드바
- Mobile은 고정 사이드바를 제거하고 상단 햄버거 버튼과 overlay drawer 사용

## 3. 모바일 상단 앱바
구성:
```text
[☰] 현재 페이지 제목                    [주요 액션]
```
기준:
- 높이 56px
- sticky top 0
- iOS safe-area 반영
- 좌우 padding 12~16px
- 햄버거 버튼 최소 44x44px
- `aria-label`, `aria-expanded`, `aria-controls` 적용
- 본문에 중복 제목이 두 번 나오지 않게 조정

## 4. 관리자 메뉴 Drawer
- width: `min(84vw, 320px)`
- height: `100dvh`
- 왼쪽 slide-in
- backdrop 클릭 시 닫힘
- Escape 키 닫힘
- 메뉴 선택 후 자동 닫힘
- 열린 동안 body scroll lock
- focus trap
- 닫힌 뒤 햄버거 버튼으로 focus 복귀
- 현재 메뉴는 배경·굵기·좌측 indicator·`aria-current="page"`로 표시

## 5. 메뉴 그룹
### 현황·분석
- 전체 현황
- 매출·가입자 상세
- 나갈 돈·비용 상세
- 사용자 리텐션
- LLM 사용 현황

### 승인·요청
- 계정 복구 승인
- 베타 신청 관리
- 요금제 변경 요청
- 아이 승인 요청

### 운영
- 문의·건의·버그 접수
- 리포팅 수동 실행

현재 메뉴가 속한 그룹은 기본 펼침 상태로 한다.

## 6. 모바일 본문
```text
width: 100%
min-width: 0
padding: 16px
```
제거 대상:
- 모바일에서도 남아 있는 sidebar margin
- 고정 `margin-left: 232px`
- 데스크톱 전용 max-width
- iframe 내부 중복 padding
- `100vw`로 인한 전체 가로 스크롤

간격:
- 페이지 헤더→필터 16px
- 필터→KPI 16px
- 섹션 간 20~24px
- 카드 간 12px

## 7. 모바일 필터
- 핵심 탭은 가로 스크롤 가능한 segmented control
- 상세 필터는 `필터` 버튼으로 bottom sheet 또는 collapsible panel에 표시
- 적용 필터 수 badge
- 터치 높이 최소 44px
- 적용·초기화 버튼 제공
- 필터 상태 유지

예:
```text
[전체 리텐션] [부모 리텐션] [아이 리텐션]
[최근 7일 ▼] [필터 2]
```

## 8. KPI 카드
- 480px 미만 1열
- 480~767px는 내용이 짧을 때 2열
- padding 16px
- KPI 수치 26~32px
- 불필요한 고정 높이 제거

## 9. 모바일 표 전략
모든 표를 단순 축소하지 않는다.

### 가로 스크롤 표
적용:
- 리텐션 코호트
- 비용 상세
- LLM 현황
기준:
- 표 wrapper만 가로 스크롤
- body 전체 가로 스크롤 금지
- sticky header
- 첫 컬럼 sticky 검토

### 모바일 카드형 행
적용:
- 승인 요청
- 문의·버그
- 사용자·가족 상세

예:
```text
안서아 (asa@kbestie.local)          승인 완료
4학년 · 최근 활동 5일
D1 ✅  D3 -  D7 -
```

### Key/Value stacked
적용:
- 필드 4~6개의 단순 목록

## 10. 승인·거절 액션
- 카드 하단 full-width action row
- 버튼 높이 44px 이상
- `[거절] [승인]`
- 승인 primary, 거절 outline/danger
- 승인 완료 항목은 버튼 제거
- 거절은 확인 dialog
- 상세 화면에서는 sticky bottom action bar 사용 가능

## 11. 모바일 차트
- 높이 240~280px
- x축 label 자동 간격
- tooltip 터치 지원
- legend 하단 wrap
- chart width 100%
- 복잡한 차트는 chart wrapper만 가로 스크롤

## 12. iframe 모바일
- width 100%
- 내부 sidebar·header 제거
- 내부 padding 12~16px
- 외부·내부 이중 스크롤 제거
- 높이 자동 조정
- `100dvh`
- same-origin postMessage로 height 전달
- 주소창 크기 변화에도 잘리지 않게 처리

## 13. 모바일 하단 액션
적용 후보:
- 리포팅 수동 실행
- 승인 상세
- 필터 적용
- CSV/XLSX 다운로드

기준:
- safe-area-bottom 반영
- 콘텐츠 가림 방지용 하단 padding
- 주요 액션 1~2개만 표시
- 나머지는 overflow menu

## 14. 상태 UI
- Loading: skeleton
- Empty: `표시할 항목이 없습니다.`
- Error: `데이터를 불러오지 못했습니다. [다시 시도]`
- 느린 네트워크에서 중복 실행 방지

## 15. 접근성
- 모든 터치 대상 44x44px 이상
- focus trap, focus-visible
- `aria-current`, `aria-expanded`, `aria-controls`
- VoiceOver/TalkBack 탐색
- 색상만으로 상태 구분 금지
- 200% 확대에서도 사용 가능

## 16. iOS·Android
### iOS Safari
- `100dvh`
- `env(safe-area-inset-top/bottom)`
- input focus 시 레이아웃 튐 확인
- body scroll lock 후 위치 복원

### Android Chrome
- 뒤로가기 시 drawer 닫기 우선
- 주소창 축소·확장 대응
- 키보드가 bottom sheet를 가리지 않게 처리

## 17. 공통 컴포넌트
- `AdminMobileHeader`
- `AdminNavigationDrawer`
- `AdminMenuGroup`
- `AdminMobileFilterSheet`
- `AdminResponsiveTable`
- `AdminMobileListCard`
- `AdminStickyActionBar`
- `AdminEmptyState`
- `AdminErrorState`

페이지별 별도 햄버거 메뉴 구현 금지.

## 18. 적용 대상
모든 관리자 페이지에 적용한다.
우선 검증:
1. 회사 전체 현황
2. 매출·가입자 상세
3. 비용 상세
4. LLM 사용 현황
5. 계정 복구 승인
6. 문의·건의·버그
7. 베타 신청
8. 리포팅 수동 실행
9. 요금제 변경
10. 아이 승인
11. 사용자 리텐션

## 19. 회귀 방지
유지 대상:
- 메뉴 선택과 활성 상태
- 뒤로가기·새로고침
- 승인·거절
- 검색·필터
- CSV/XLSX
- 리텐션 탭
- 내부 테스트 계정 필터
- 리포팅 실행
- LLM 상태 조회
- 관리자 권한

API·DB·계산 로직은 변경하지 않는다.

## 20. 테스트 해상도
- 390x844 iPhone
- 430x932 iPhone
- 360x800 Android
- 412x915 Android
- 768x1024 Tablet
- 1024x768 Tablet landscape

검증:
- 메뉴 열기·닫기
- 메뉴 선택 후 자동 닫힘
- 활성 메뉴
- body scroll lock
- 뒤로가기
- 화면 회전
- 필터 sheet
- 표 스크롤
- 승인 액션
- 차트
- iframe
- safe-area
- 키보드
- 전체 가로 스크롤 없음

## 21. 완료 조건
- 모바일 sticky app bar
- 햄버거 메뉴
- 관리자 drawer
- 자동 닫힘·focus trap·Escape
- 모바일 sidebar 잔여 margin 제거
- 모바일 padding 통일
- 필터 최적화
- KPI 반응형
- 표별 scroll/card/stacked 적용
- 승인 버튼 터치 최적화
- 차트 가독성
- iframe 이중 스크롤 제거
- safe-area
- iOS·Android 검증
- 관리자 권한 유지
- TypeScript 통과
- Production build 통과
- Dev·Production 검증
- Desktop 회귀 없음

## 22. 결과 보고
1. 기존 모바일 문제
2. AdminShell 변경
3. 앱바·drawer
4. 메뉴 그룹
5. 필터 UI
6. 표별 모바일 전략
7. 승인 화면
8. 리텐션 화면
9. iframe
10. iOS/Android/Tablet 결과
11. 접근성
12. TypeScript/build
13. Dev URL·커밋
14. Production URL·커밋
15. 전후 스크린샷
16. 미해결 위험

## 23. 금지 사항
- 데스크톱 sidebar 단순 축소
- 페이지별 별도 햄버거
- body 전체 가로 스크롤
- 모든 표 무조건 카드화
- 44px 미만 버튼
- drawer 열린 상태에서 배경 스크롤 허용
- 색상만으로 활성 메뉴 표시
- iframe 중복 header/padding
- API·DB 로직 변경
- Dev만 수정하고 Production 누락
- 실제 모바일 viewport 검증 없이 완료 처리
