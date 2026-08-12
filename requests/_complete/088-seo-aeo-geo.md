# Request — app.k-bestie.com SEO / GEO / AEO 통합 최적화

## 1. 목적

`https://app.k-bestie.com/`을 내친구 케이의 검색 및 AI 검색 노출 기준 대표 사이트로 설정하고, Google / Naver / Bing 계열 검색엔진과 Google AI Overviews·AI Mode / ChatGPT Search / Claude Search / Perplexity에서 사이트와 서비스의 의미를 정확하게 발견·수집·색인·이해할 수 있도록 SEO·GEO·AEO 기술 기반을 구축한다.

이번 작업은 검색 순위를 조작하기 위한 키워드 삽입 작업이 아니다.

다음 흐름을 안정적으로 만드는 것이 목적이다.

검색·AI crawler 발견
→ public page crawl
→ 정확한 canonical/index 판정
→ 서비스 및 사이트 entity 이해
→ 검색/AI answer source 후보
→ `app.k-bestie.com`
→ 시작하기/회원가입 전환

---

# 2. 2026 최신 공식 가이드 기준

본 구현은 2026-08 기준 공식 문서를 기준으로 한다.

## Google

2026-05 Google Search Central의 Generative AI 최적화 가이드 기준:

- GEO/AEO를 Google Search와 별개의 기술 체계로 구현하지 않는다.
- AI Overviews / AI Mode 역시 기존 Google Search의 색인, 검색 품질 및 ranking 시스템을 기반으로 한다.
- AI 검색 노출을 위한 별도 기술 요구사항은 없다.
- 페이지가 Google Search에 index 가능하고 snippet 표시가 가능해야 AI 기능의 supporting link 후보가 될 수 있다.
- unique / useful / non-commodity / people-first content를 우선한다.
- 사용자의 실제 의도를 충족하지 못하는 대량 생성 콘텐츠를 만들지 않는다.
- query variation마다 유사 페이지를 대량 생성하지 않는다.
- `llms.txt`는 Google Search 및 Google AI 검색 순위에 긍정적·부정적 영향을 주지 않는다.
- AI용이라는 이유만으로 콘텐츠를 작은 chunk로 인위적으로 분리하지 않는다.
- AI만을 위한 별도 문체로 전체 콘텐츠를 재작성할 필요가 없다.
- AI 검색용 특수 Schema는 존재하지 않는다.
- Structured Data는 기존 SEO 및 entity 이해 목적으로만 정확하게 사용한다.
- JavaScript 사이트도 색인할 수 있으나 crawl/render/index 상태를 실제 검증해야 한다.
- Search Console을 기준 관측 도구로 사용한다.

## Google 2026 변경사항

- FAQ Rich Result는 2026-05-07부터 폐지됨.
- 2026-06 공식 FAQ Rich Result 개발 문서도 제거됨.
- 따라서 `FAQPage` Schema를 Google Rich Result 확보 목적으로 구현하지 않는다.
- FAQ 콘텐츠 자체는 일반 HTML 기반 AEO 콘텐츠로 사용할 수 있다.
- Search Console Generative AI Performance Report가 2026-06부터 일부 사이트에 순차 제공되고 있으므로 해당 Property에 기능이 제공될 경우 관측 대상으로 사용한다.
- Google sitemap ping endpoint는 사용하지 않는다.

## Naver

Naver Search Advisor 최신 가이드 기준:

- 각 페이지에 정확하고 고유한 `<title>` 필요
- 각 페이지에 고유한 meta description 필요
- 명확한 heading hierarchy 필요
- 대표 URL / canonical 정리 필요
- robots.txt 필요
- sitemap.xml 제공 필요
- 반응형 페이지 권장
- IndexNow 지원
- IndexNow는 URL 변경 통지 기능이며 index를 보장하지 않음
- Search Advisor URL 검사 및 사이트 진단을 활용

## AI Search Crawlers

검색/답변 노출용 crawler와 foundation model 학습 crawler를 구분한다.

검색 노출 허용 대상:

- Googlebot
- Naver Yeti
- Bingbot
- OAI-SearchBot
- Claude-SearchBot
- Claude-User
- PerplexityBot
- Perplexity-User

학습 목적 crawler:

- GPTBot
- ClaudeBot

이번 정책은 검색 노출용 crawler는 허용하고, foundation model 학습용 crawler는 기본 차단한다.

단 사용자가 직접 요청하여 URL을 가져오는 user-triggered fetcher는 robots.txt 적용 방식이 crawler마다 다를 수 있으므로 robots.txt를 보안 장치로 간주하지 않는다.

---

# 3. 핵심 원칙

## 3.1 Canonical Host

SEO/GEO/AEO 대표 host는 다음으로 고정한다.

`https://app.k-bestie.com/`

모든 public page는 해당 host의 자기 자신 URL을 canonical로 사용한다.

동일 콘텐츠가 query string, trailing slash 차이, legacy URL 또는 다른 host에서 중복 노출되고 있다면 현황을 먼저 파악한다.

같은 콘텐츠가 실제 중복 존재하는 경우에만:

1. 가능하면 HTTP 301
2. 불가능하면 `rel="canonical"`

순서로 처리한다.

외부 도메인의 redirect 또는 DNS/Vercel 변경은 이번 Request에서 임의 수행하지 않는다.

---

# 4. P0 — 현재 상태 진단

수정 전 아래를 먼저 점검하고 결과를 작업 로그에 남긴다.

## 4.1 Framework / Rendering

확인:

- Next.js 버전
- App Router / Pages Router
- root layout
- landing page rendering 방식
- SSR / SSG / CSR 여부
- hydration 이전 initial HTML 내용
- Metadata API 사용 여부
- dynamic metadata 여부

특히 `https://app.k-bestie.com/`의 최초 HTTP HTML을 확인한다.

JavaScript 실행 전 HTML에 최소한 다음이 존재하는지 검증한다.

- `<title>`
- meta description
- canonical
- H1
- 핵심 서비스 설명 텍스트
- 주요 내부 링크
- JSON-LD

현재 외부 텍스트 추출 환경에서 title 외 본문 추출이 거의 확인되지 않는 상황이 있으므로 반드시 실제 raw HTML을 기준으로 검증한다.

CSR이라고 추측하여 바로 구조를 변경하지 말고 실제 response HTML부터 확인한다.

---

## 4.2 기존 SEO 파일

확인:

- robots.txt 또는 `robots.ts`
- sitemap.xml 또는 `sitemap.ts`
- manifest
- metadata
- canonical
- JSON-LD
- Open Graph
- Twitter Card
- favicon / icons
- Search Console verification
- Naver verification
- 기존 IndexNow 구현
- analytics / GA4

기존 정상 구현은 중복 생성하지 않는다.

---

# 5. Public / Private Search Boundary

내친구 케이는 공개 마케팅 사이트와 로그인 후 개인 서비스가 동일 host에 존재하므로 검색 경계를 명확히 한다.

## Public

로그인 없이 누구나 볼 수 있고 개인정보가 없는 서비스 소개 콘텐츠만 index 가능하다.

현재 route를 조사하여 실제 public route allowlist를 만든다.

대표 예:

- `/`
- 공개 서비스 소개 페이지
- 공개 이용안내
- 공개 개인정보/안전 정책
- 공개 FAQ/도움말
- 기타 명시적으로 공개된 서비스 설명 페이지

## Private

다음 유형은 검색 대상에서 제외한다.

- 로그인
- 회원가입 과정 중 개인정보 입력 화면
- OAuth callback
- 부모 dashboard
- 아이 dashboard
- 부모/아이 설정
- 리포트
- 대화 화면
- LLM Wiki
- Mission
- Free Chat
- Play session
- 관리자
- 테스트/debug route
- API
- 개인별 ID가 포함된 route
- invitation/token route
- 기타 인증 후 접근하는 화면

실제 route tree를 확인한 후 정확한 목록을 작성한다.

---

# 6. Private Page 보호 원칙

robots.txt는 개인정보 보호 수단이 아니다.

Private page는 반드시 기존 인증/권한 검사를 그대로 유지한다.

추가로 검색 노출 방지를 위해 가능한 route에는:

`noindex, nofollow`

를 적용한다.

Private URL은 sitemap에서 완전히 제외한다.

robots.txt에도 crawler 효율을 위한 Disallow를 적용할 수 있지만:

- robots.txt만으로 개인정보 보호 금지
- robots.txt만으로 noindex 효과를 기대하지 않음
- 인증/authorization이 실제 보안 경계

라는 원칙을 유지한다.

기존 인증·RLS·회원가입·자동로그인 동작은 이번 작업으로 변경하지 않는다.

---

# 7. robots.txt 정책

실제 route 확인 후 private path를 반영한다.

기본 방향:

```txt
User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Disallow: /auth/
Disallow: <실제 private route patterns>

User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

Sitemap: https://app.k-bestie.com/sitemap.xml
```

`OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`, Googlebot, Bingbot, Yeti 등 검색용 crawler는 wildcard public policy를 따라 공개 콘텐츠에 접근할 수 있어야 한다.

특정 crawler group을 별도로 생성한다면 wildcard의 private Disallow 정책이 상실되지 않도록 동일 private restriction을 적용한다.

WAF / middleware / rate limit이 존재하는 경우 robots.txt가 Allow여도 실제 crawler request가 401/403/429로 막히지 않는지 확인한다.

IP allowlist가 실제 필요한 인프라가 존재하는 경우에만 각 업체가 공개하는 공식 crawler IP 정보를 기준으로 설정하며 IP를 코드에 임의 하드코딩하지 않는다.

---

# 8. sitemap.xml

`https://app.k-bestie.com/sitemap.xml`

을 제공한다.

요구사항:

- HTTP 200
- valid XML
- production canonical URL만 포함
- public indexable page만 포함
- login/private/admin/API/test URL 제외
- canonical과 sitemap URL 일치
- 실제 변경 시점에만 정확한 `lastmod` 사용
- 존재하지 않는 route 금지
- redirect URL 금지
- noindex URL 금지
- 4xx/5xx URL 금지

Next.js App Router라면 현재 프로젝트 구조에 맞춰 Metadata Route 방식 사용을 우선 검토한다.

Google의 deprecated sitemap ping endpoint는 구현하지 않는다.

---

# 9. Page Metadata

모든 indexable public page는 고유 metadata를 가진다.

필수:

- title
- description
- canonical
- robots
- Open Graph title
- Open Graph description
- Open Graph URL
- Open Graph image
- Open Graph locale
- site name
- Twitter/X card metadata
- favicon/icons

홈페이지 기준 사이트 이름:

`내친구 케이`

alternate site name은 실제 브랜드에서 사용 중인 경우에만:

`K-Bestie`

사용한다.

SEO용 과도한 keyword stuffing 금지.

페이지 제목은 사용자에게 보이는 H1/주요 제목과 의미가 일치해야 한다.

meta description은 실제 페이지 내용과 일치해야 한다.

---

# 10. WebSite Structured Data

Google은 서브도메인도 독립 Site Name 대상으로 지원하므로 `app.k-bestie.com` root homepage에 `WebSite` JSON-LD를 구현한다.

필수 개념:

```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "내친구 케이",
  "url": "https://app.k-bestie.com/"
}
```

실제 브랜드에서 사용하고 있을 경우에만 `alternateName`을 추가한다.

Structured Data의 URL과 canonical host는 반드시 동일하게 유지한다.

JSON-LD 내용은 페이지에서 사용자에게 제공되는 사실과 일치해야 한다.

---

# 11. Organization Structured Data

홈페이지에 운영 조직 정보가 현재 공개적으로 명확하게 표시되고 있다면 `Organization` JSON-LD를 추가한다.

포함 가능한 항목:

- name
- url
- logo
- contactPoint
- sameAs

단 다음은 금지:

- 확인되지 않은 법인명
- 확인되지 않은 주소
- 확인되지 않은 SNS
- 임의 사업자 정보
- 공개되지 않은 개인정보

현재 사이트의 운영주체 표시와 실제 정책 문서를 먼저 확인한 후 동일 사실만 사용한다.

---

# 12. Software / WebApplication Structured Data

내친구 케이는 웹 애플리케이션이므로 `WebApplication` / `SoftwareApplication` Schema 적용 가능성을 검토한다.

단 Google Software Application Rich Result는 `name`, offer 가격 및 genuine rating/review 등 별도 요건이 있으므로 허위 데이터로 요건을 맞추지 않는다.

절대 금지:

- 가짜 별점
- 가짜 리뷰
- 임의 ratingCount
- 임의 가격
- 존재하지 않는 App Store / Play Store URL

실제 required property가 준비되어 있지 않다면 Google Rich Result 획득을 위해 데이터를 조작하지 말고 `WebSite` / `Organization` entity 최적화를 우선한다.

Naver Software structured data와 Google structured data 요구 차이도 검토한다.

---

# 13. FAQ / AEO 구조

Google FAQ Rich Result는 폐지되었으므로 `FAQPage` Schema를 Rich Result 목적으로 구현하지 않는다.

하지만 사람이 실제로 자주 질문하는 내용을 일반 HTML 콘텐츠로 제공하는 것은 유지한다.

예:

```html
<section>
  <h2>내친구 케이는 어떤 서비스인가요?</h2>
  <p>질문에 대한 직접적이고 짧은 답변...</p>
</section>
```

AEO 콘텐츠 원칙:

질문
→ 첫 1~3문장 직접 답변
→ 필요한 설명
→ 관련 서비스 기능
→ 필요 시 신뢰할 수 있는 근거

검색엔진만을 위한 숨김 FAQ 금지.

`display:none`, 투명 텍스트, crawler-only text, DOM 외부 keyword stuffing 금지.

모든 AEO 콘텐츠는 실제 사용자에게도 보여야 한다.

---

# 14. Semantic HTML

현재 UI 디자인을 변경하지 않는 범위에서 의미 구조를 개선한다.

기본 기준:

- page primary heading 명확화
- H1은 핵심 page title 역할
- 하위 주제는 H2/H3 계층
- navigation은 `<nav>`
- 주요 콘텐츠는 `<main>`
- section 구분
- footer는 `<footer>`
- 실제 이동 CTA는 `<a>`
- UI action은 `<button>`
- 이미지에 적절한 alt
- 장식 이미지는 불필요한 keyword alt 금지

시각적 디자인을 SEO 때문에 임의 변경하지 않는다.

---

# 15. GEO Content 원칙

내친구 케이 사이트의 목표는 AI에게 키워드를 반복시키는 것이 아니라 다음 entity를 명확하게 이해시키는 것이다.

- 서비스명: 내친구 케이
- 서비스 대상
- 해결하려는 부모의 문제
- 아이에게 제공하는 경험
- 부모에게 제공하는 가치
- 서비스 작동 방식
- 아이 데이터/프라이버시 정책
- 서비스 운영 주체
- 실제 이용 방법

한 문단에 모든 키워드를 넣지 않는다.

서비스에 대한 핵심 설명은 서로 다른 페이지에서 모순되지 않도록 single source of truth를 둔다.

---

# 16. 아동 관련 콘텐츠 품질 기준

아이 감정, 심리, 정서, 건강, 안전 등에 영향을 줄 수 있는 내용은 일반 마케팅 글보다 높은 신뢰 기준을 적용한다.

Google People-first / E-E-A-T 원칙을 따른다.

가능한 경우:

- 출처
- 작성/검토 주체
- 작성일
- 업데이트일
- 근거
- 서비스가 할 수 있는 것
- 서비스가 할 수 없는 것

을 명확히 한다.

서비스를 다음과 같이 과장하지 않는다.

- 아이의 마음을 정확히 판독한다
- 심리 상태를 진단한다
- 정신건강 문제를 판별한다
- 부모가 모르는 모든 사실을 알아낸다

실제 서비스 기능과 정책 범위를 넘어서는 의료·심리·진단 표현을 SEO 목적으로 추가하지 않는다.

---

# 17. Original / Non-commodity Content

GEO를 위해 대량의 AI 생성 SEO 페이지를 만들지 않는다.

금지:

- 검색어 하나당 자동 생성 페이지
- 지역명만 바꾼 duplicate page
- 질문 표현만 바꾼 동일 답변 페이지
- 다른 육아 사이트 요약만 한 콘텐츠
- AI가 만든 일반적인 육아 팁 대량 게시
- keyword stuffing
- 검색 순위 목적 doorway page

향후 콘텐츠를 추가한다면 내친구 케이만 제공할 수 있는 다음 정보를 우선한다.

- 실제 서비스 방법론
- 부모/아이 경험 설계 원칙
- 대화 설계 원칙
- 프라이버시 설계 원칙
- 부모가 아이를 이해하는 방식에 대한 고유 관점
- 실제 익명화된 서비스 인사이트
- 검증 과정에서 얻은 고유 데이터

개인정보 또는 아이의 raw conversation은 공개 콘텐츠에 사용하지 않는다.

---

# 18. Initial HTML / Rendering

Google은 JavaScript를 렌더링할 수 있지만 Google 이외의 검색·AI crawler까지 고려한다.

따라서 public landing의 핵심 정보는 가능하면 initial HTML에서 확인 가능하도록 한다.

최소 포함:

- title
- description
- H1
- 핵심 설명
- 주요 public navigation
- CTA label
- JSON-LD

단 기존 애플리케이션 전체를 SEO 이유만으로 SSR로 재작성하지 않는다.

public search landing layer만 필요한 범위에서 server rendering / static generation을 적용한다.

로그인 후 interactive app은 기존 architecture를 유지한다.

---

# 19. Image SEO

검색과 generative AI 검색 모두 image를 사용할 수 있으므로 public marketing image를 정리한다.

요구사항:

- 의미 있는 이미지 filename
- contextual alt
- width / height 명시
- layout shift 방지
- 적절한 compression
- responsive image
- 주요 social preview image 제공
- `og:image` 설정
- 구조화 데이터에서 image 사용 시 crawl 가능한 절대 URL

아이 개인정보가 포함된 이미지나 실제 사용자 screenshot은 공개 검색 자산으로 자동 노출하지 않는다.

---

# 20. Core Web Vitals

public landing page는 모바일을 우선한다.

목표:

- LCP ≤ 2.5s
- INP < 200ms
- CLS ≤ 0.1

해당 값은 실제 사용자 field data의 75th percentile 기준을 목표로 한다.

특히 점검:

- hero image
- custom font
- hydration
- unnecessary JS
- third-party scripts
- layout shift
- image dimensions
- above-the-fold rendering
- analytics script

SEO 때문에 기존 정상 UX 성능을 악화시키지 않는다.

---

# 21. Agent-friendly Web

2026년 browser agent 대응을 위해 public page의 기본 웹 접근성을 유지한다.

요구사항:

- 명확한 accessible name
- CTA에 안정적인 label
- 표준 anchor/button 사용
- 버튼 위치 및 DOM 의미 불필요하게 변경하지 않음
- navigation 구조 명확화
- form label 연결
- modal/focus 처리 정상
- 불필요한 browser history 조작 금지
- back-button hijacking 금지

WebMCP / UCP 등 아직 emerging 단계의 protocol은 이번 Request에서 구현하지 않는다.

---

# 22. Naver Search Optimization

Naver 기준으로 다음을 구현/검증한다.

- root robots.txt
- sitemap
- unique title
- unique description
- H1 hierarchy
- alt
- canonical
- responsive page
- valid response status
- public URL crawlability

404 page는 실제 HTTP 404를 반환해야 한다.

없는 페이지를 200으로 반환하는 soft 404 패턴이 존재하는지 검사한다.

---

# 23. IndexNow

Naver / Bing 등 지원 검색엔진을 위해 IndexNow 적용을 검토하고, 구현 비용이 낮다면 적용한다.

대상:

- public page 신규 생성
- public page 내용 변경
- public page 삭제

Private/auth/API URL은 절대 제출하지 않는다.

IndexNow가 색인을 보장하는 것으로 UI나 로그에 표현하지 않는다.

IndexNow key 파일은 protocol에 맞는 위치에서 제공한다.

Google에는 IndexNow 또는 deprecated sitemap ping을 보내지 않는다.

---

# 24. Analytics / Measurement

기존 analytics architecture를 먼저 확인한다.

추가 관측 대상:

## Google

- Search Console impressions
- clicks
- CTR
- query
- landing page
- indexed pages
- Core Web Vitals

Search Console에 Generative AI Performance Report가 활성화된 경우:

- AI feature impressions
- pages
- country
- device
- date

를 관측한다.

해당 보고서는 2026-06부터 순차 제공 중이므로 계정에 아직 없다는 이유로 오류 처리하지 않는다.

## Naver

Search Advisor:

- exposure
- clicks
- crawling
- indexing
- URL Inspection

## ChatGPT

OpenAI는 ChatGPT Search referral에:

`utm_source=chatgpt.com`

을 포함하므로 analytics에서 해당 source가 식별되는지 확인한다.

추가적으로 가능한 범위에서 referral domain을 통해:

- ChatGPT
- Perplexity
- Claude
- Google organic
- Naver organic
- Bing organic

유입을 분리 관측할 수 있게 한다.

기존 UTM/GA4 체계를 깨지 않는다.

---

# 25. Search Console / Naver Verification

현재 verification 상태를 우선 확인한다.

미등록이라면 코드로 임의 계정을 생성하거나 외부 계정 접근을 시도하지 않는다.

필요한 verification token 위치만 구현 가능하게 준비하고 운영 체크리스트에 남긴다.

Secret/token은 코드에 하드코딩하지 않는다.

---

# 26. 보안

절대 공개 검색 대상에 포함하면 안 되는 정보:

- 아이 이름
- 아이 계정
- 부모 계정
- conversation
- raw conversation
- corrected conversation
- report
- memory
- LLM Wiki
- 초대 token
- OAuth 정보
- session
- JWT
- 내부 API
- admin data
- QA account
- service role key
- API key
- production secret

robots.txt, sitemap, JSON-LD, metadata 생성 과정에서 내부 route나 ID가 accidental disclosure 되지 않는지 검사한다.

---

# 27. 기존 서비스 보호

이번 작업은 SEO/GEO/AEO 최적화 범위에 한정한다.

변경 금지:

- 로그인 상태머신
- 회원가입
- Google/Kakao OAuth
- 자동 로그인
- 부모/아이 권한
- 대화 기능
- Mission
- Free Chat
- 리포트
- LLM Wiki
- 알림
- 황금열쇠
- 놀이 모듈
- 관리자 비즈니스 로직
- DB schema
- RLS
- 사용자 데이터

SEO 구현을 위해 인증 로직이나 비즈니스 로직을 재작성하지 않는다.

---

# 28. 테스트

최소 자동 검증:

## Build

- TypeScript compile
- lint
- tests
- production build

## Public Home

`https://app.k-bestie.com/`

또는 동일 production-build 환경의 root HTML에서 확인:

- HTTP 200
- title 존재
- description 존재
- canonical 존재
- canonical = `https://app.k-bestie.com/`
- robots index/follow
- H1 존재
- 실제 readable body content 존재
- WebSite JSON-LD 존재
- OG metadata 존재
- social image 존재

## robots.txt

확인:

- HTTP 200
- text/plain
- sitemap declaration
- public crawl 허용
- private paths 제한
- GPTBot 차단
- ClaudeBot 차단
- OAI-SearchBot 검색 접근 가능
- Claude-SearchBot 검색 접근 가능
- PerplexityBot 검색 접근 가능

## sitemap.xml

확인:

- HTTP 200
- valid XML
- production app domain만 존재
- private URL 0
- API URL 0
- admin URL 0
- auth URL 0
- noindex URL 0
- redirect URL 0

## Private Routes

대표 route를 선정하여 확인:

- sitemap 미포함
- search metadata noindex
- 인증 보호 유지
- 개인정보가 unauthenticated HTML에 노출되지 않음

---

# 29. Structured Data Validation

Google Rich Results Test / Schema validation 기준으로 확인한다.

필수:

- invalid JSON-LD 없음
- page visible content와 schema 불일치 없음
- fake rating/review 없음
- canonical URL mismatch 없음
- inaccessible image 없음

`SoftwareApplication`이 Google rich result required property를 충족하지 못한다면 fake data로 PASS시키지 않는다.

---

# 30. Production Smoke

Production 배포 후 직접 확인:

- `/`
- `/robots.txt`
- `/sitemap.xml`
- representative public page
- representative private page
- login
- signup
- parent authentication
- child authentication

기존 PWA 설치/로그인/회원가입 flow에 regression이 없어야 한다.

---

# 31. 완료 기준

다음을 모두 만족해야 완료로 판정한다.

- `app.k-bestie.com` canonical 기준 확정
- public/private index boundary 확정
- public landing crawler 접근 가능
- initial HTML 핵심 콘텐츠 확인
- unique metadata 적용
- WebSite JSON-LD 적용
- Organization JSON-LD는 검증된 정보만 적용
- SoftwareApplication fake data 없음
- robots.txt 정상
- sitemap.xml 정상
- GPTBot training crawl 차단
- ClaudeBot training crawl 차단
- ChatGPT Search crawler 허용
- Claude Search crawler 허용
- Perplexity crawler 허용
- Googlebot/Yeti/Bingbot public crawl 허용
- private URL sitemap 노출 0
- private 개인정보 anonymous HTML 노출 0
- FAQ Rich Result deprecated feature 미구현
- `llms.txt`를 Google SEO 필수 항목으로 구현하지 않음
- Google sitemap ping 미구현
- IndexNow 적용 또는 적용 불필요 근거 기록
- Core Web Vitals regression 없음
- build/test PASS
- Production smoke PASS

---

# 32. 작업 결과 보고 형식

완료 후 아래 형식으로 보고한다.

## 변경 파일
- 파일명
- 변경 목적

## Before / After
- metadata
- canonical
- robots
- sitemap
- structured data
- rendering
- crawl/index boundary

## Crawler Policy
- Googlebot
- Yeti
- Bingbot
- OAI-SearchBot
- GPTBot
- Claude-SearchBot
- ClaudeBot
- PerplexityBot

각각 ALLOW / BLOCK 및 범위 표시.

## Search Exposure
- indexable public URL 목록
- noindex/private URL 유형
- sitemap URL 수

## Validation
- tsc
- lint
- test
- build
- structured data validation
- robots validation
- sitemap validation
- Production smoke

## 미검증 항목
외부 Search Console/Naver Search Advisor 계정 권한 등 자동 검증하지 못한 항목은 이유와 대표님이 확인해야 할 정확한 메뉴만 기록한다.

