# 내친구 케이 컴포넌트 레시피 (React + Tailwind v3)

`tailwind.config.js` 토큰이 병합돼 있다는 전제. 복붙 후 바로 쓰거나 참고용으로 사용.

## 버튼

```tsx
// Primary — 화면당 주요 액션. 코랄은 '가장 중요한 CTA 1개'에만.
<button className="bg-primary hover:bg-secondary text-white font-semibold
                   px-5 py-3 rounded-md shadow-soft transition-colors">
  시작하기
</button>

// CTA (코랄, 아껴 쓰기)
<button className="bg-coral hover:bg-coral-600 text-white font-semibold
                   px-6 py-3 rounded-full shadow-soft transition-colors">
  베타 신청하기
</button>

// Secondary
<button className="bg-white text-primary font-semibold border border-hairline
                   hover:bg-tint px-5 py-3 rounded-md transition-colors">
  자세히 보기
</button>
```

## 카드

```tsx
<div className="bg-surface rounded-lg shadow-soft p-6">
  <h3 className="text-charcoal text-xl font-bold mb-2">카드 제목</h3>
  <p className="text-body leading-relaxed">본문 내용을 여기에.</p>
</div>

// 강조 카드(그린 틴트, 테두리 대신 배경으로 구분)
<div className="bg-tint rounded-lg p-6">
  <span className="text-primary font-bold text-sm">기대 산출물</span>
  <p className="text-body mt-1">처리방침 · 보호자 동의 체계 · 처리방침 URL</p>
</div>
```

## 입력창

```tsx
<label className="block text-sm font-medium text-body mb-1.5">이메일</label>
<input
  type="email"
  placeholder="parent@example.com"
  className="w-full bg-surface border border-hairline rounded-md px-4 py-2.5
             text-body placeholder:text-muted
             focus:outline-none focus:ring-2 focus:ring-secondary focus:border-secondary"
/>
```

## 배지 / 칩

```tsx
<span className="inline-flex items-center rounded-full bg-coral-tint text-coral-600
                 text-xs font-semibold px-3 py-1">신규</span>
<span className="inline-flex items-center rounded-full bg-tint text-primary
                 text-xs font-semibold px-3 py-1">베타</span>
```

## 아이콘 원형 (라이트그린 배경 + 흰 아이콘)

```tsx
<div className="flex items-center gap-3">
  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-white">
    {/* <Icon size={20} /> */}
  </div>
  <span className="font-semibold text-charcoal">항목명</span>
</div>
```

## 대시보드 통계 카드 (KPI)

```tsx
<div className="bg-surface rounded-lg shadow-soft p-6">
  <p className="text-sm text-muted">활성 베타 사용자</p>
  <p className="mt-1 text-4xl font-bold text-primary">1,284</p>
  <p className="mt-1 text-sm text-success">▲ 12% 이번 주</p>
</div>
```

## 상태 알림 (Alert)

```tsx
// success / info / warning / danger — 배경은 *-bg, 텍스트/아이콘은 기본색
<div className="rounded-md bg-warning-bg text-warning px-4 py-3 text-sm font-medium">
  개인정보 동의서 검토가 필요합니다.
</div>
<div className="rounded-md bg-danger-bg text-danger px-4 py-3 text-sm font-medium">
  결제에 실패했습니다.
</div>
```

## 앱 헤더 (딥그린 지배)

```tsx
<header className="bg-primary text-white">
  <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
    <div className="flex items-center gap-2">
      {/* 로고 이미지 */}
      <span className="font-brand text-2xl">내친구 케이</span>
    </div>
    <nav className="flex items-center gap-6 text-sm">
      <a className="hover:text-tint" href="#">리포트</a>
      <a className="hover:text-tint" href="#">설정</a>
    </nav>
  </div>
</header>
```

## 히어로 섹션 (브랜드 문구는 Gaegu)

```tsx
<section className="bg-warm-white">
  <div className="mx-auto max-w-5xl px-6 py-20 text-center">
    <p className="font-brand text-secondary text-2xl">아이의 하루를 대화로</p>
    <h1 className="mt-3 text-5xl font-bold text-charcoal">
      부모와 아이를 잇는 AI 소통 서비스
    </h1>
    <p className="mt-4 text-body text-lg max-w-2xl mx-auto">
      아이가 케이와 나눈 하루를 1분 리포트와 대화 가이드로 전해드려요.
    </p>
    <button className="mt-8 bg-coral hover:bg-coral-600 text-white font-semibold
                       px-7 py-3.5 rounded-full shadow-soft">
      베타 신청하기
    </button>
  </div>
</section>
```

## 차트 색상 팔레트 (대시보드)

권장 순서(범주형): `#1A6B5A → #2D9F8F → #E8845A → #7FC0B3 → #E8A54A → #B5C4BF`.
- 단일 시리즈 막대/라인: `#2D9F8F`(라이트그린).
- 강조 시리즈 1개: `#E8845A`(코랄).
- 그리드선은 최소화, 축 라벨은 `#8A8A97`.

## 톤 체크리스트 (제출 전)

- [ ] 딥그린이 지배색인가? 코랄을 1–2곳만 썼는가?
- [ ] 배경이 warm-white(#FAFAF8)인가? 순백/베이지 아님?
- [ ] 모서리가 둥근가? 그림자가 은은한가(검정 아님)?
- [ ] 카드 구분에 색 스트라이프·제목 밑줄을 안 썼는가?
- [ ] 제목 Pretendard, 브랜드 문구만 Gaegu인가?
- [ ] "부모가 안심하는 따뜻함"이 느껴지는가?
