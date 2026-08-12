# Plan: 058 아이 홈 화면 목표 UI 정밀 재배치

## 범위 (이 2개 파일만 수정)
- `app/child/home/page.tsx`
- `components/events/MissionOnboardingCard.tsx`

## 변경 금지 (요청서 §11)
데이터 조회/미션 상태 계산/30일 이벤트 집계/보상 계산/황금열쇠 계산/각 카드의 클릭 라우팅·기능 — 전부 그대로. **레이아웃(높이/padding/margin/gap)만** 바꾼다. 하드코딩 값 삽입 금지(기존 `data.*`/API 응답값 그대로 사용).

## 1. 상단 이벤트 버튼 (`app/child/home/page.tsx` 약 276~299행)
- 현재: `<Bell/>` + `<span>이벤트</span>` 텍스트가 함께 있는 `h-[44px] px-3` 버튼.
- 목표: 텍스트 `이벤트` 제거, 아이콘만 담는 정사각형 버튼(`w-[44px] h-[44px]`)으로 축소. 로그아웃 버튼(`w-[44px] h-[44px]`)과 완전히 동일한 크기/높이 축으로 맞춘다.

## 2. 마스코트 + 인사 영역 (약 303~323행)
- 마스코트 컨테이너 높이 `160px` → 더 작게(약 110~120px 권장, 실측 후 조정). `Image`의 `clamp(120px, 42%, 164px)`도 비율 유지하며 축소(예: `clamp(96px, 34%, 128px)`).
- 인사 영역 `mt-2 mb-2` → 상하 margin 축소(예: `mt-1 mb-1.5`), `leading-[1.35]`는 필요시 살짝 축소.
- 마스코트-인사 사이, 인사-다음 카드 사이 여백을 시각적으로 줄이는 것이 목표.

## 3. `MissionOnboardingCard.tsx` — 4줄 세로 텍스트 → 2열 그리드 (핵심 변경)
현재(72~88행)는 `<p>` 하나에 `<br/>`로 4줄이 세로로 쌓여 있다:
```
케이와 벌써 {count}번 이야기했어요!
현재 {won(...)} 구간을 달성했어요.
{nextTierRemaining && `${remaining}번 더 완료하면 ${won(nextTier)} 구간이에요.`}
{remaining !== null && `이벤트 종료까지 ${remaining}일 남았어요.`}
```
이걸 요청서 §6.3/6.5 그대로 2열 grid로 바꾼다:
- 왼쪽 컬럼: "케이와 벌써 N번 이야기했어요!" / "현재 N원 구간을 달성했어요."
- 오른쪽 컬럼: "N번 더 완료하면 N원 구간이에요."(nextTierRemaining 없으면 이 줄만 생략) / "이벤트 종료까지 N일 남았어요."(remaining null이면 이 줄만 생략)
```tsx
<div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
  <div className="text-xs leading-snug" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
    <p>케이와 벌써 {count}번 이야기했어요!</p>
    <p>현재 {won(data.current_reward_amount)} 구간을 달성했어요.</p>
  </div>
  <div className="text-xs leading-snug" style={{ color: "var(--color-k-navy, #1A2B4C)" }}>
    {data.nextTierRemaining && <p>{data.nextTierRemaining.remaining}번 더 완료하면 {won(data.nextTierRemaining.nextTier)} 구간이에요.</p>}
    {remaining !== null && <p>이벤트 종료까지 {remaining}일 남았어요.</p>}
  </div>
</div>
```
- 바깥 카드(`px-4 py-3 mb-2`)의 padding/margin도 축소(예: `px-3.5 py-2.5 mb-1.5`)해 카드 전체 높이를 25~35% 줄인다.
- `not_started`/`completed` 분기는 이번 작업 대상이 아니지만(요청서가 `active`/`max_completed` 2열화만 명시), 카드 padding 축소는 모든 분기에 공통 적용되므로 자연히 함께 줄어드는 것은 허용.

## 4. 상태 말풍선 (약 327~334행)
- `mb-3` → 축소(예: `mb-2`)해 이벤트 카드와의 gap을 줄인다.

## 5. 미션 진행 카드 (약 337~356행)
- `px-4 py-3` → 상하 padding만 축소(예: `py-2.5`), 아이콘 컨테이너 `w-[52px] h-[52px]`는 살짝 축소 가능(예: `w-[46px] h-[46px]`, 텍스트 크기는 유지).
- 카드 바깥 `flex flex-col gap-3` → `gap-2` 정도로 축소해 미션 카드-놀이 카드 간격도 줄인다.

## 6. 하단 대화하기/케이와 놀이 카드 (약 359~391행)
- `gap-2.5`(grid) 유지 가능, 내부 `px-3.5 py-3.5` → `py-3` 정도로 소폭 축소. `gap-2.5`(아이콘-텍스트 사이)도 `gap-2`로 축소 가능.
- 두 카드 크기 동일 유지, 클릭 라우팅(`/chat`, `/child/play`) 변경 금지.

## 구현 순서 (요청서 §15 그대로)
1. Dev 서버 켜고 `getBoundingClientRect()`로 현재 마스코트/인사/이벤트카드/말풍선/미션카드/놀이카드 top/bottom/height 실측 후 보고에 남길 것.
2. 위 1~6 레이아웃만 수정.
3. `tsc --noEmit` (0 errors 목표), 단위 테스트, `npm run build` PASS 확인.
4. 수정 후 동일 요소 재측정 — 이벤트 카드 높이가 25~35% 줄었는지, 미션/놀이 카드가 위로 이동했는지 수치로 비교.
5. iPhone 390×844 / Android 360×800 / Android 412×915 각각에서 가로 스크롤 없음, 카드 겹침 없음, FAQ 버튼이 콘텐츠 안 가림을 스크린샷으로 확인.

## 완료 조건 (요청서 §14 요약)
이벤트 카드 높이 명확히 감소 + 2열 정보 표시 / 말풍선-이벤트카드 간격 축소 / 미션·놀이 카드 상단 이동 / 마스코트·인사 높이 축소 / 기능·데이터 로직 무변경 / 3개 뷰포트 레이아웃 깨짐 없음.
