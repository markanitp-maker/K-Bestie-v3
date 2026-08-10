# 088 SEO / AEO / GEO 구현 계획 및 P0 진단 로그

## 범위

- Canonical host: `https://app.k-bestie.com/`
- Indexable public allowlist: `/`, `/privacy`
- 변경 대상: `app/layout.tsx`, `app/page.tsx`, `components/landing/HomeHubClient.tsx`,
  `components/landing/BetaLandingPage.tsx`, `app/privacy/page.tsx`, `public/robots.txt`,
  `public/sitemap.xml`
- 인증·회원가입·OAuth·자동 로그인·DB/RLS·대화·Mission·Free Chat·리포트·관리자
  비즈니스 로직은 변경하지 않는다. 기존 root client router는 파일만 이동하고 로직은
  그대로 보존한다.

## P0 현재 상태 진단 (변경 전)

- Framework: `package.json`은 Next.js `^15.3.3`, 실제 설치 및 build 출력은 Next.js
  `15.5.19`; App Router이며 root layout은 `app/layout.tsx`이다.
- Rendering: `/`는 `"use client"` page이고 최초 상태가 `loading=true`라 hydration 전
  서버 HTML에는 `사용자 정보를 확인하는 중...` 로딩 UI만 렌더된다. 공개 랜딩의 H1,
  서비스 설명, CTA 링크는 인증 확인 후에만 렌더되는 조건부 branch에 있다. CSR이라고
  추측한 것이 아니라 initial render branch를 직접 확인한 결과다.
- Metadata: root Metadata API는 title/description/Open Graph/Twitter/Naver verification/
  icons/robots를 제공하지만 canonical과 JSON-LD가 없다. route별 dynamic metadata는 없다.
- Existing SEO files: `public/robots.txt`는 모든 경로를 허용하고 sitemap만 선언한다.
  `public/sitemap.xml`에는 `/`와 private `/login`이 포함된다. manifest는
  `app/manifest.json/route.ts`, favicon/icons와 social image는 기존 PWA 이미지를 사용한다.
- Public route 조사: 개인정보 없는 공개 설명 route는 `/`, `/privacy`뿐이다. 나머지
  account/admin/auth/beta/chat/child/demo/family/invite/login/onboarding/offline/parent/play/
  signup/test 및 모든 API route는 검색 제외 대상으로 분류한다.
- Structured data/analytics: JSON-LD, IndexNow, Google Search Console verification, GA4는
  발견되지 않았다. Naver verification만 있다. 공개 운영주체 정보가 `사업자 정보 준비
  중`으로 표시되어 Organization schema는 만들지 않는다.
- Production raw HTML: `curl`은 실행환경의 DNS 차단(`Could not resolve host`), 직접 IP
  요청은 socket 정책(`Operation not permitted`)으로 실패했다. Web fetch도 안전성 정책으로
  원본 URL을 열지 못했다. 변경 전 local production build는 env 분리 검사를 통과했으나
  최적화 단계에서 5분 이상 출력 없이 정체되어 중단했다. 원격 응답을 확인했다고 허위로
  기록하지 않으며, 구현 후 local production-build HTTP raw HTML을 필수 검증한다.

## 구현

1. root layout은 private-safe 기본값(`noindex, nofollow`)과 공통 icon/manifest/verification만
   제공한다.
2. `/`를 server page로 두고 고유 metadata, canonical, WebSite JSON-LD를 출력한다. 기존
   client router는 `HomeHubClient`로 그대로 이동하며 최초 로딩 화면만 공개 랜딩으로 바꿔
   핵심 콘텐츠가 initial HTML에 포함되게 한다.
3. `/privacy`에 고유 metadata/canonical/index 정책과 semantic main 구조를 적용한다.
4. 랜딩에 visible FAQ와 명확한 section hierarchy를 추가하고 이미지 `sizes`를 명시한다.
5. robots에서 public crawl과 search crawler를 허용하고 private path 및 GPTBot/ClaudeBot을
   차단한다. sitemap은 `/`, `/privacy`만 포함한다.

## 의도적으로 하지 않는 것

- 검증된 운영 조직 정보가 없으므로 Organization schema 미적용.
- genuine offer/rating/review 요건이 없으므로 SoftwareApplication rich-result schema 미적용.
- 폐지된 FAQPage rich-result schema, `llms.txt`, Google sitemap ping 미구현.
- IndexNow는 공개 URL이 정적 2개뿐이고 게시 CMS/URL 변경 파이프라인이 없어 임의 key와
  외부 제출 side effect를 추가할 실익이 작다. sitemap과 Search Console/Search Advisor
  제출을 우선하고, 실제 public publishing pipeline 도입 시 별도 적용한다.

## 위험 및 검증

- root의 기존 자동 라우팅을 바꾸지 않도록 client 로직 diff가 이동 외에는 없는지 확인한다.
- private route는 root 기본 noindex를 상속하고 sitemap/robots allowlist 밖인지 검사한다.
- `tsc --noEmit`, lint, 전체 test, production build 후 실제 HTTP raw HTML/robots/sitemap/
  대표 private route를 자동 검증한다.

## 검증 결과

- `npx tsc --noEmit`: PASS (오류 0건)
- 변경 TSX 5개 Next core-web-vitals/TypeScript lint: PASS. 저장소의 `npm run lint`는
  ESLint config가 없어 대화형 초기 설정으로 진입하므로, 설치된 동일
  `eslint@9.39.4`/`eslint-config-next@15.5.19`를 임시 config로 실행했다.
- 전체 test: PASS 42/42. 샌드박스가 `tsx` CLI IPC socket을 거부해 1차 실행은 시작 전
  EPERM이었고, 동일 파일 목록을 `node --import tsx --test`로 실행해 전부 통과했다.
- 정적 SEO validator: PASS. sitemap URL은 `/`, `/privacy` 2개, private URL 0개;
  search crawler allow와 GPTBot/ClaudeBot block; public canonical/index/OG/Twitter;
  root private-safe noindex; WebSite JSON-LD; visible FAQ/semantic HTML을 확인했다.
- production build: FAIL. 캐시 분리 전·후 2회 모두 환경 분리 검사는 통과했으나
  `Creating an optimized production build ...`에서 5분 이상 추가 출력 없이 정체되어
  중단했다. 동일 문제 2회 반복 금지 규칙에 따라 더 시도하지 않았다.
- HTTP raw/robots/sitemap/private route 및 Production smoke: 미검증. production build가
  없어 local production server를 시작할 수 없고, 실행환경은 외부 DNS와 socket을
  차단한다. 배포 또한 별도 지시가 없어 수행하지 않았다.
- Core Web Vitals field regression: 미검증. Search Console CrUX 권한과 배포된 build가
  필요하다. 코드상 hero/logo image의 dimensions container와 responsive `sizes`를
  명시했고 새 third-party script/font는 추가하지 않았다.
