# Dev 환경 외부 AI·음성 자격증명 임시 공유 — 마이그레이션 체크리스트

## 현재 상태 (2026-07-20)

`k-bestie-v3-dev` Vercel 프로젝트는 알파 내부 테스트 목적으로 Production의 외부 AI·음성 API 자격증명을 **임시로 공동 사용**한다. Dev Supabase(DB)는 계속 별도 프로젝트를 사용하며, 아래 값들만 Production과 공유된다:

- `GCP_STT_API_KEY`
- `GCP_TTS_API_KEY`
- `GEMINI_API_KEY`
- `GEMMA_API_KEY`
- `GCP_VERTEX_SA_KEY_JSON`
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`

모두 Vercel의 서버 전용 **Sensitive** 환경변수로 등록되어 있으며, `NEXT_PUBLIC_` 접두사가 없어 클라이언트 번들에 노출되지 않는다. Dev Supabase URL/anon key/service role key, Dev OAuth 설정은 이 공유와 무관하게 그대로 Dev 전용을 유지한다.

이 임시 상태는 `k-bestie-v3-dev` Vercel 프로젝트에 등록된 표식 환경변수 `DEV_USES_SHARED_PROD_AI=true`로 식별한다(비밀값 아님, 평문 확인 가능).

## 왜 임시인가

- 이 API 키들은 Production GCP 프로젝트(`k-bestie3`)의 청구·사용량에 함께 집계된다.
- Dev에서의 테스트 트래픽이 Production 키의 쿼터/레이트리밋에 영향을 줄 수 있다.
- Vertex Live relay(Cloud Run, `services/vertex-live-relay`)는 무상태 음성 중계라 Dev가 함께 써도 Supabase/사용자 데이터가 섞이지는 않지만, `ALLOWED_ORIGINS`가 `https://app.k-bestie.com,http://localhost:3000`로 고정되어 있어 `k-bestie-v3-dev.vercel.app`에서의 연결은 현재 거부된다(별도 조치 없이는 Dev에서 Vertex Live 경로 테스트 불가 — Dev의 `provider_switch_settings` Group C가 기본 `ai_studio`라 현재는 영향 없음).

## 베타/외부 공개 전 필수 교체 체크리스트

- [ ] Dev 전용 GCP 프로젝트 또는 최소한 Dev 전용 API 키 발급(STT/TTS/Gemini/Gemma) — Production 청구·쿼터와 분리
- [ ] Dev 전용 Vertex 서비스 계정(`GCP_VERTEX_SA_KEY_JSON`) 발급 및 최소 권한 부여
- [ ] Vertex Live를 Dev에서도 실사용 검증해야 한다면 별도 `vertex-live-relay-dev` Cloud Run 서비스 신규 배포(예상 구성/비용은 별도 보고 필요) 또는 기존 relay의 `ALLOWED_ORIGINS`에 Dev 도메인 추가 여부를 별도로 결정
- [ ] 위 신규 값들로 `k-bestie-v3-dev` Vercel 프로젝트의 해당 Sensitive 변수들을 교체
- [ ] `DEV_USES_SHARED_PROD_AI` 환경변수를 완전히 삭제(또는 `false`로 설정)
- [ ] 베타/Production 릴리스 체크리스트에서 `DEV_USES_SHARED_PROD_AI=true`가 남아있으면 **BLOCKED**로 판정하고 배포를 진행하지 않는다

## 검증 방법

`vercel env ls production` (k-bestie-v3-dev 프로젝트 대상)에서 `DEV_USES_SHARED_PROD_AI` 값이 조회되면 아직 공유 상태다. 이 값이 삭제되어 있어야 위 체크리스트가 완료된 것으로 간주한다.
