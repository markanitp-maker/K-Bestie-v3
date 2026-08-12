# 관리자 페이지 공통 UI/UX 전면 개선

## 1. 목적

현재 관리자 페이지는 페이지별로 본문 폭, 사이드바 간격, 카드 크기, 표 밀도, 섹션 여백이 달라 운영 효율이 낮다. 개별 페이지에 임시 CSS를 추가하지 말고 관리자 전체에 공통으로 적용되는 레이아웃·간격·카드·표·승인 목록·반응형 규칙을 하나의 디자인 시스템으로 통일한다.

핵심 목표:
- 넓은 화면의 가용 폭을 효율적으로 사용
- 과도한 빈 공간 제거
- 반복 데이터의 정보 밀도 향상
- 관리자 업무 유형별 최적 컴포넌트 적용
- PC·태블릿·모바일 반응형 통일
- 기존 기능·권한·데이터 흐름 회귀 방지

## 2. 리서치 반영 원칙

- Material의 responsive/adaptive layout 원칙을 적용하여 화면 크기에 따라 compact·medium·expanded 구조로 전환한다.
- IBM Carbon의 2·4·8 배수 spacing과 고밀도 data table 원칙을 적용한다.
- USWDS의 접근 가능한 table, keyboard focus, responsive stacked/scroll table 원칙을 적용한다.
- 관리자·B2B 화면은 장식적 여백보다 정렬·비교·처리 속도를 우선한다.

## 3. 관리자 화면 유형

### 운영 대시보드
대상: 회사 전체 현황, 매출·비용, 사용자 리텐션, LLM 사용 현황

구조:
```text
페이지 헤더 → 필터 → KPI → 차트/요약 → 상세 표
```

### 승인·처리 업무
대상: 베타 신청, 아이 승인, 계정 복구, 요금제 요청, 문의·버그

구조:
```text
페이지 헤더 → 상태 탭 → 검색/필터 → 작업 목록 → 상세/액션
```

### 운영 도구
대상: 리포팅 수동 실행, 관리자 진단

구조:
```text
페이지 헤더 → 실행 조건 → 대상 목록 → 액션 → 단계별 결과
```

## 4. 공통 AdminShell

```text
AdminShell
├─ Header
└─ Main
   ├─ Sidebar
   └─ Content
```

권장 기준:
```text
상단 헤더: 56~64px
사이드바: 232px
본문 max-width: 1600px
Desktop padding: 32px
Tablet padding: 24px
Mobile padding: 16px
```

권장 구조:
```css
.admin-main {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  min-width: 0;
}

.admin-content {
  width: 100%;
  max-width: 1600px;
  margin: 0 auto;
  padding: 24px 32px 48px;
}
```

제거 대상:
- 페이지별 `max-w-4xl`, `max-w-5xl`, `max-w-6xl`
- 900~1200px 고정 width
- 과도한 `mx-auto`
- 페이지별 임의 margin-left
- iframe 내부 중복 max-width
- 본문을 중앙의 좁은 폭으로 고정하는 wrapper

## 5. Spacing Token

```text
4, 8, 12, 16, 20, 24, 32, 40, 48px
```

적용:
- 제목→설명 8px
- 페이지 헤더→본문 24px
- 섹션 간 24~32px
- 카드 간 12~16px
- 카드 padding 16~20px
- 표 셀 padding 12~16px
- 버튼 간 8px

임의 spacing 값 사용 금지.

## 6. Typography

```text
페이지 제목: 24/32, 700
섹션 제목: 18/26, 700
카드 제목: 14/20, 600
KPI 수치: 28~36px, 700
본문: 14/20
보조 정보: 12~13/18
```

## 7. Sidebar

- width 232px
- 메뉴 높이 40~44px
- 메뉴 gap 4px
- 좌우 padding 14~16px
- 활성 메뉴: 배경+굵기+좌측 indicator
- 1024px 미만에서는 collapse/drawer
- 사이드바와 본문 사이 과도한 공백 제거

## 8. 페이지 헤더

모든 페이지:
```text
제목
설명/상태
우측 주요 액션
```

중복 제목, 불필요한 상단 빈 공간, iframe 내부 중복 헤더 제거.

## 9. 승인 업무 화면

반복 데이터 5건 이상은 테이블 우선:
```text
이름 | 요청일 | 요청자 | 연락처 | 상태 | 액션
```

행 높이:
```text
기본 52~60px
2줄 정보 64~72px
```

상세 정보가 많을 때만 2열 compact card:
```css
grid-template-columns: repeat(2, minmax(0, 1fr));
gap: 16px;
```

승인 완료는 별도 탭으로 분리하고 액션 버튼을 제거한다.

## 10. 베타 신청 관리

권장 테이블:
```text
이름 | 신청일 | 연락처 | 연령대 | 유입 경로 | 상태 | 액션
```

수정:
- 대형 1열 카드 제거
- `1970-01-01`, null, invalid date는 `신청일 미확인`
- `미상` 반복 대신 `정보 미입력` 요약
- 실제 입력된 정보 우선 표시

## 11. 아이 승인 요청

권장 테이블:
```text
아이 | 학년 | 요청일 | 요청자 | 가족 생성자 | 관심사 | 상태
```

관심사:
```text
[게임] [요리] [과학] +2
```

승인 대기/승인 완료 탭 분리.

## 12. 문의·건의·버그

- 본문 가용 폭 100%
- 검색 최소 240px
- 필터 toolbar 한 줄, 좁으면 wrap
- 표:
```text
접수번호 | 유형 | 접수자 | 제목/내용 요약 | 접수일 | 상태
```
- 행 전체 클릭, 키보드 Enter 지원
- 요약 1~2줄 clamp
- 상태 badge

## 13. 공통 DataTable

기능:
- loading, empty, error, retry
- sorting, pagination
- sticky header
- row action
- keyboard focus
- horizontal scroll
- mobile stacked 또는 scroll 전략

밀도:
```text
comfortable 56px
compact 44~48px
```

관리자 반복 목록 기본값은 compact.

## 14. KPI 카드

```text
>=1440px 4열
1024~1439px 3열
768~1023px 2열
<768px 1열
```

카드:
- padding 20px
- 최소 높이 132px
- 강한 shadow 대신 border
- 불필요한 고정 높이 금지

## 15. 반응형

```text
Mobile <768
Tablet 768~1023
Desktop 1024~1439
Wide >=1440
```

- Mobile: sidebar drawer, padding 16, 카드 1열
- Tablet: sidebar collapsible, padding 24, 카드 2열
- Desktop: 3열
- Wide: 4열, max-width 1600

## 16. 사용자 리텐션 iframe

- width 100%
- border 0
- 내부 추가 max-width 제거
- 외부/내부 padding 중복 제거
- 중복 제목 제거
- 높이 자동 조정
- 이중 세로 스크롤 제거
- 가로 잘림 제거
- 동일 도메인 관리자 인증 유지

## 17. 상태 UI

Loading:
- spinner 대신 skeleton
- layout shift 최소화

Empty:
```text
현재 표시할 항목이 없습니다.
```

Error:
```text
데이터를 불러오지 못했습니다.
[다시 시도]
```

위젯 오류가 전체 페이지를 죽이지 않도록 error boundary 적용.

## 18. 접근성

- 버튼 최소 44px
- focus-visible
- 색상만으로 상태 구분 금지
- table `th`, `scope`, `caption`
- 아이콘 버튼 aria-label
- 키보드 탐색
- 200% 확대에서도 기능 유지

## 19. Design Token

```text
--admin-bg
--admin-surface
--admin-border
--admin-text-primary
--admin-text-secondary
--admin-primary
--admin-danger
--admin-success
--admin-warning
--admin-focus
```

radius:
```text
button/input 8~10px
card 12~16px
```

페이지별 색상 하드코딩 금지.

## 20. 구현 순서

1. 관리자 layout·wrapper·max-width 감사
2. spacing/typography/color token 확정
3. AdminShell 구현
4. 공통 컴포넌트 구현
   - AdminPageHeader
   - AdminFilterBar
   - AdminDataTable
   - AdminKpiCard
   - AdminStatusBadge
   - AdminEmptyState
   - AdminErrorState
5. 페이지 적용 순서
   - 베타 신청
   - 아이 승인
   - 문의·버그
   - 사용자 리텐션
   - 리포팅 수동 실행
   - LLM 사용 현황
   - 매출·비용
   - 나머지 페이지

## 21. 기능 회귀 방지

변경 금지:
- 승인/거절
- 검색/필터
- CSV/XLSX
- 리텐션 계산
- 리포팅 실행
- LLM 상태 조회
- 계정 복구
- 요금제 요청
- 관리자 권한
- Production 데이터

UI 계층만 개선한다.

## 22. 테스트 해상도

```text
1920x1080
1600x900
1440x900
1280x800
1024x768
768x1024
390x844
```

확인:
- 본문이 좁게 몰리지 않음
- 사이드바/본문 과도한 공백 없음
- 전체 가로 스크롤 없음
- 표 잘림 없음
- 카드 빈 공간 최소화
- 모바일 sidebar 정상
- iframe 이중 스크롤 없음
- loading/empty/error 정상
- focus state 정상

## 23. 완료 조건

- 공통 AdminShell 적용
- 본문 max-width 1600px
- sidebar 232px
- spacing token 통일
- 임의 max-width 제거
- 베타 신청 고밀도 구조
- 아이 승인 고밀도 구조
- 문의·버그 표 폭 개선
- 리텐션 iframe 개선
- KPI 반응형 Grid
- 공통 DataTable
- 상태 UI 통일
- PC·태블릿·모바일 검증
- TypeScript 통과
- Production build 통과
- Dev·Production 화면 검증
- 기존 관리자 기능 회귀 없음

## 24. 결과 보고

1. 기존 레이아웃 감사
2. AdminShell 변경
3. token 목록
4. 공통 컴포넌트
5. 페이지별 전후
6. 반응형 테스트
7. 접근성 테스트
8. TypeScript/build
9. Dev URL·커밋
10. Production URL·커밋
11. 미해결 위험

## 25. 작업 금지 사항

- 페이지별 임시 CSS 추가
- 모든 화면을 무조건 카드화
- 대형 1열 반복 카드 유지
- 본문 900~1000px 제한
- 모바일에서 데스크톱 표 단순 축소
- 색상만으로 상태 표시
- 데이터/API 로직 변경
- iframe padding 중복
- Dev만 수정하고 Production 누락
- 화면 검증 없이 완료 처리