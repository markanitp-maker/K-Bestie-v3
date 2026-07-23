# vertex-live-relay

그룹C(라이브 음성)가 Vertex AI로 전환됐을 때만 쓰이는 WebSocket 릴레이. AI Studio 경로는 이 서비스를
전혀 거치지 않는다 — `app/api/voice/token/route.ts`가 `provider_switch_settings`의 그룹C 값을 보고
`vertex`일 때만 이 릴레이 접속 정보(URL + 1회성 티켓)를 브라우저에 내려준다.

브라우저 ⇄ 이 릴레이(`/live` WebSocket, JSON 프레임) ⇄ Vertex AI Live(`gemini-live-2.5-flash-native-audio`)

## 왜 별도 서비스인가

Next.js 앱은 Vercel Hobby 플랜이라 WebSocket 연결이 5분으로 강제 상한된다(Vercel Functions
WebSocket 공식 문서, 2026-06 퍼블릭 베타 — Pro/Enterprise만 30분 베타 상한 적용, Hobby는 5분 고정).
Vertex Live 세션은 이보다 길게 유지돼야 하므로, 이 릴레이만 Vercel 밖(Cloud Run)에 별도로 둔다.

## 로컬 테스트

```bash
cd services/vertex-live-relay
npm install
cp .env.example .env   # 값을 채워 넣을 것(비밀값은 로컬 .env에만, git에 커밋 금지)
npm run dev            # tsx로 src/server.ts 바로 실행, 기본 포트 8080
```

헬스체크: `curl http://localhost:8080/` → `ok`

WS 연결 테스트는 Next.js 앱의 `.env.local`에 다음을 추가하고 `provider_switch_settings`의 그룹C를
`vertex`/`gemini-live-2.5-flash-native-audio`로 바꾼 뒤(관리자 화면, 기존 스위치 그대로 사용)
`/child/missions`에서 실제 마이크로 확인한다.

```bash
# Next.js 앱 쪽 .env.local에 추가
VERTEX_LIVE_RELAY_URL=ws://localhost:8080/live
VERTEX_LIVE_RELAY_SECRET=<이 서비스의 .env와 동일한 값>
```

`ALLOWED_ORIGINS`는 로컬 테스트 중엔 Next.js 개발 서버 오리진(예: `http://localhost:3000`)을 넣어야
업그레이드 요청이 거부되지 않는다.

## 확인이 필요한 항목 (완료 기준, Plan7 참고)

- [ ] 실제 Vertex 연결 성공 (`vertex_open` 로그)
- [ ] 아이 음성 입력 → 케이 음성 응답
- [ ] input/output transcription 수신 여부 (안 오면 Plan B 없이 그 사실만 보고)
- [ ] barge-in 동작
- [ ] transcript 저장 → 리포트 입력 연결
- [ ] 세션 정상 종료 시 릴레이·Vertex 양쪽 자원 정리
- [ ] 10분 연속 대화 테스트 (MAX_SESSION_MS 기본 30분 안에서 재연결 없이 유지되는지)
- [ ] Vertex 연결 실패 시 자동 폴백 없이 종료 + 아이 화면에 안내 문구만 표시되는지
- [ ] iOS Safari / Android Chrome

## 배포 (2026-07-16 확정본 — 프로젝트 k-bestie3, 리전 us-west1)

GCP API 활성화(Cloud Run/Cloud Build/Artifact Registry/Vertex AI/Secret Manager/IAM), 런타임
서비스계정(`vertex-live-relay-runtime@k-bestie3.iam.gserviceaccount.com`, `roles/aiplatform.user`),
`vertex-live-relay-secret`(Secret Manager, 이 서비스계정에만 `secretAccessor`)까지 이미 완료된 상태를
전제로 한다.

```bash
# 1) Artifact Registry Docker 리포지토리 생성 (최초 1회)
gcloud artifacts repositories create vertex-live-relay \
  --project=k-bestie3 \
  --repository-format=docker \
  --location=us-west1 \
  --description="Vertex Live relay container images"

# 2) 이미지 빌드 + 푸시 (~/vertex-live-relay 소스 디렉터리에서)
cd ~/vertex-live-relay
gcloud builds submit --project=k-bestie3 \
  --tag us-west1-docker.pkg.dev/k-bestie3/vertex-live-relay/vertex-live-relay:latest

# 3) Cloud Run 배포
gcloud run deploy vertex-live-relay \
  --project=k-bestie3 \
  --region=us-west1 \
  --image=us-west1-docker.pkg.dev/k-bestie3/vertex-live-relay/vertex-live-relay:latest \
  --service-account=vertex-live-relay-runtime@k-bestie3.iam.gserviceaccount.com \
  --set-secrets=VERTEX_LIVE_RELAY_SECRET=vertex-live-relay-secret:latest \
  --set-env-vars="^;^GOOGLE_CLOUD_PROJECT=k-bestie3;GOOGLE_CLOUD_LOCATION=us-west1;ALLOWED_ORIGINS=https://app.k-bestie.com,http://localhost:3000;RELAY_ENVIRONMENT=production" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=1 \
  --concurrency=20 \
  --timeout=900
```

> **참고**: `RELAY_ENVIRONMENT` 변수(예: `production`, `development`)를 `--set-env-vars`에 추가하면, 로깅 시 어떤 환경의 트래픽인지 구분하는 데 사용됩니다.

### `--max-instances=1`을 초과 확대하기 전에 반드시 해야 하는 것

지금 `ticket.ts`의 1회성 사용 처리(`usedNonces`)와 `server.ts`의 아이별 중복연결 관리(`activeSessions`)는
**인스턴스 로컬 메모리**로 되어 있다. Cloud Run이 인스턴스를 2개 이상 띄우면:
- 같은 티켓이 서로 다른 인스턴스에서 각각 "아직 안 씀"으로 보여 1회성 보장이 깨질 수 있고,
- 같은 아이의 중복 연결이 인스턴스가 다르면 서로 존재를 몰라 동시에 두 세션이 열릴 수 있다.

따라서 **`--max-instances`를 2 이상으로 올리는 것은, 티켓 jti(1회성 사용 여부)와
`active_connection_id`(아이별 활성 연결)를 Supabase 같은 공유 저장소에서 원자적으로
(예: `INSERT ... ON CONFLICT DO NOTHING` / 조건부 UPDATE) 관리하도록 바꾼 뒤에만 진행할 것.**
그 전까지는 `max-instances=1`을 유지한다(동시 접속자가 몰려 처리량이 부족해지는 것은 이번
소수 테스트 계정 검증 단계에서는 허용 가능한 트레이드오프로 간주).
