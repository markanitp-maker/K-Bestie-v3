# 미션 연결 불안정 원인 분석

## 테스트 환경
- Dev URL: https://k-bestie-v3-dev.vercel.app
- 커밋 SHA: a1a789a431032123b5d263f728292bec962fac42
- 기기: 헤드리스 Chromium(Playwright), 뷰포트 390x844(iPhone 세로 시뮬레이션), `--use-fake-device-for-media-stream`
- 브라우저/PWA: 일반 브라우저 탭(PWA standalone 아님) — 실기기 Safari/PWA 검증은 이 세션에서 수행하지 못함(아래 "확인되지 않은 사항" 참고)
- 음성 경로: QA테스트(5학년) 계정은 `child_profiles.tier=3` → `plans.voice_mode='live'`(Gemini Live)로 확인됨. 011이 명시한 "현재 Dev 테스트 유저는 STT→LLM→TTS"와 달리 이 계정 자체는 Live 모드였다 — 이번 세션에서 `tier`를 일시적으로 1(`voice_mode='stt_tts'`)로 바꿔 STT/TTS 경로를 직접 검증했고, 검증 후 3으로 원복했다(테스트 계정 정책상 QA테스트는 자동화 조작 허용 대상).
- 테스트 계정 종류: 부모/자녀 자동화 전용 `QA테스트`/`QA테스트(5학년)`(child_id `cde1b847-b1d2-4378-b337-b8cf4d532b00`)

## 관찰된 증상
011이 보고한 두 증상:
1. 화면이 계속 "듣는 중"으로만 표시됨(또는 상태가 갱신되지 않는 것처럼 보임)
2. 정상적으로 대화 중인데도 끊김/연결 불안정 안내가 노출됨

## 재현 조건
코드를 직접 대조 확인한 결과, 두 증상 모두 **특정 네트워크 조건에서만 재현되는 것이 아니라 코드 로직상 상시 발생하는 구조적 버그**였다(즉 "가끔" 재현되는 게 아니라, 해당 코드 경로를 타면 매번 발생). 아래 "확정 원인" 참고.

## 실제 파이프라인
STT/TTS(비Live) 모드 실측 이벤트 순서(이번 세션에서 실제 라이브 캡처):
```
mission/start (200) → 첫 질문 TTS 발화
→ (수동 모드) 마이크 탭 → setTurnPhase(idle→child_listening) → mission/stt 반복 호출(스트리밍)
→ 마이크 재탭(녹음 종료) → mission/timing → (STT 결과에 따라 answer 처리 또는 무효 처리)
```

## 이벤트 타임라인 (실측, 2026-07-25)
Live 모드(QA테스트 tier=3 원래 설정) 최초 진입 시:
```
T+0.00s  로그인 완료, /child/missions 진입
T+3.06s  mission/start 200 (resumed:false, 신규 세션 480f5956...)
T+3.19s  [K] 🔑 token received, mode: relay, model: gemini-live-2.5-flash-native-audio
T+3.24s  responseStart / firstTextDelta (turnId t1)
T+3.38s  첫 오디오 청크 수신 시작(총 10청크, ~3.53s까지)
T+3.53s  turnComplete (t1) — 첫 질문 발화 완료
T+5.5s   audioQueueDrained
```
STT/TTS(비Live, tier 일시 변경 후) 모드:
```
T+0.00s  /child/missions 진입, mission/start 200
T+~2.4s  mission/stt 호출 시작(첫 질문 TTS 재생과 별개로 이미 STT 워밍업/폴링 호출이 도는 것으로 보임 — 아래 "확인되지 않은 사항" 참고)
T+~5.7s  수동 모드 전환
T+~6.6s  마이크 탭 → setTurnPhase(idle→child_listening) 콘솔 이벤트 확인, 화면에 "듣는 중"/"듣고 있어요" 정상 노출(수정 후 최초 확인)
T+~7.3s  마이크 재탭(녹음 종료) → mission/timing 200
T+7.3~11.5s  화면에 생각하는 중/말하는 중 배지 미노출(가짜 오디오 무음 입력 → STT가 유효 발화를 못 받아 answer 파이프라인까지 못 간 것으로 추정, "확인되지 않은 사항" 참고)
```

## 확인된 사실 (코드 직접 대조로 확정)

1. **"항상 듣는 중"류 증상의 실제 원인**: `app/child/missions/page.tsx`의 `voiceState`(화면 배지) 및 `isThinkingTurn`(중앙 버튼 생각중 표시) 계산이 예전엔 `turnPhaseUi`(Live 전용 상태값, `handleTurnComplete` 내부에서 `isLive`일 때만 갱신)에만 의존했다. `isThinkingTurn = isLiveMode && !isAuto && turnPhaseUi !== "idle"`처럼 **비Live 조건에서 항상 false로 게이팅**돼 있어서, STT→LLM→TTS 경로에서는 "생각하는 중" 표시가 코드상 도달 자체가 불가능했다. 이는 네트워크 문제가 아니라 상태 파생 로직이 Live 전용으로만 작성된 채 비Live 경로에 연결되지 않은 순수 로직 버그다.
2. **"연결 불안정/끊김" 문구 오노출의 실제 원인**: `resetToIdle("서버 연결이 끊겼어요...")` 호출 7곳이 전부 `if (liveRef.current?.status === "live") {...} else { resetToIdle(...) }` 구조였다. 이 `liveRef.current?.status`는 Live 파이프라인 자체의 연결 상태이고, 비Live(STT/TTS) 세션에서는 애초에 "live"가 될 수 없으므로 **이 else 분기(연결 끊김 안내)가 실제 연결 장애 여부와 무관하게 매번 실행**된다. 즉 단순 타임아웃(8초)만 발생해도 "서버가 끊겼다"는 문구가 나왔다 — 실제 네트워크 단절 여부를 판정한 게 아니었다.
3. **`onKTurnTimeout`의 "통신이 고르지 않아요"**: 이 문구는 케이 대화 말풍선(`appendTurn`)으로 영구 저장됐다 — 011이 명시적으로 금지한 "오류 메시지가 케이 대화 말풍선으로 저장" 사례였다.
4. **연결 품질 지표(`ConnectionQualityIndicator`/`usePipelineConnectionQuality`) 자체의 "정상 대화 중 자동 강등" 버그는 이전 세션(2026-07-24)에 이미 발견·수정 완료된 상태였다** — `recordNormalTurn()`이 `handleTurnComplete`에서 Live/비Live 공통으로 호출되도록 고쳐져 있어, 90초 무갱신 자동강등 로직이 정상 대화 중에는 발동하지 않는 것을 코드로 재확인했다. 이번 011 작업에서 이 부분은 추가로 손대지 않았다(이미 해결됨).
5. **미션 반복 실행 시 "이전 완료 세션 재사용" 버그의 실제 원인**은 상태 표시와는 별개 이슈이나 같은 파일에서 함께 발견·수정했다: `chat_sessions.ended_at`이 미션 완료 시 이 저장소 어디에서도 갱신되지 않아(완료는 `mission_progress.status='COMPLETED'`만 찍음), "활성 세션" 조회가 `ended_at IS NULL`만 보고 완료 세션도 항상 활성으로 오인했다.

## 확인되지 않은 사항
- STT/TTS 모드에서 가짜(무음) 오디오 입력을 마이크로 보낸 뒤 실제로 "생각하는 중 → 말하는 중" 배지가 화면에 뜨는지는 **이번 세션에서 직접 확인하지 못했다.** 무음 입력 탓에 STT가 유효 발화를 못 받아 답변 파이프라인 자체가 시작되지 않은 것으로 보이며(서버가 별도 오류를 반환한 흔적은 없음), 텍스트 입력 경로로 우회 검증을 시도했으나 텍스트 입력창 선택자를 찾지 못해 완료하지 못했다. 코드상 `isProcessingAnswer`/`sttTts.isSpeaking`이 정확한 시점에 true/false로 전환되는 것은 소스 코드 대조로 확인했지만(각각 답변 제출 시작~다음 질문 TTS 요청 시작 직전, TTS 요청~오디오 재생 종료), 실제 화면에서의 시각적 확인은 남아 있다 — 실기기 확인 항목에 포함.
- iPhone Safari/PWA standalone 모드에서의 실제 안전영역(safe-area-inset)·주소창 변화 대응은 헤드리스 Chromium 테스트로는 확인할 수 없었다.
- STT 스트리밍 호출(`mission/stt`)이 마이크 탭 전부터 이미 여러 차례 도는 것을 관찰했는데, 이게 의도된 웜업 폴링인지 별도 조사가 필요한 패턴인지는 이번 분석 범위에서 확정하지 못했다(정상 동작을 방해하는 정황은 없었음 — 응답은 전부 200).
- 백그라운드 전환/화면 잠금/네트워크 전환(Wi-Fi↔LTE) 조건에서의 재현 여부는 헤드리스 자동화로 재현할 수 없어 미확인.

## 원인 후보별 검증
| 후보 | 검증 방법 | 결과 |
|---|---|---|
| 실제 네트워크/서버 연결 장애 | 라이브 캡처 전체에서 API 응답 상태코드 확인 | 전부 200, 실패 흔적 없음 — 기각 |
| 상태 파생 로직이 Live 전용으로만 작성됨 | 코드 대조(`isThinkingTurn`, `voiceState`) | **확정** |
| "연결 끊김" 판정 조건이 비Live 세션에 안 맞음 | 코드 대조(`liveRef.current?.status==='live'` 체크) | **확정** |
| 연결 품질 지표의 시간경과 자동강등 | 코드 대조 | 이미 이전 세션에 수정됨(재확인만) |
| 실기기 특유 문제(Safari 오디오 세션 등) | 헤드리스로 재현 불가 | 원인 미확정 — 실기기 확인 필요 |

## 확정 원인
**두 증상 모두 네트워크/연결 불안정이 아니라, 상태 파생 로직이 Live 파이프라인 전용으로만 작성된 채 비Live(STT→LLM→TTS) 경로에 연결되지 않았던 순수 로직 버그였다.** "화면이 계속 듣는 중"은 실제로는 "듣는 중 이후의 상태(생각/말하는 중)가 표시되지 않아 상대적으로 그렇게 보인" 것이고, "끊김 경고"는 Live 전용 연결상태 체크가 비Live 세션에서 항상 else(끊김) 분기를 타서 발생했다.

## 수정 내용
- `app/child/missions/page.tsx`: `voiceState`/`isThinkingTurn`을 `isLiveMode` 분기로 나눠, 비Live 모드는 `isRecording`/`isProcessingAnswer`/`sttTts.isSpeaking`(전부 이미 실시간으로 갱신되던 값)으로 상태를 파생하도록 수정.
- 끊김/통신불안 문구 9곳 전체 검색·제거(네트워크를 단정하지 않는 중립 문구로 교체), `onKTurnTimeout`의 말풍선 영구저장(`appendTurn`)을 일시 배너(`inputErrorNotice`)로 변경.
- `app/api/mission/start/route.ts`: `ended_at` 기반 활성세션 판정을 `mission_progress.status !== 'COMPLETED'` 기준으로 교체(미션 반복 실행 정책 수정, 별개 버그였지만 같은 파일에서 함께 발견).
- `components/MissionConversationLayout.tsx`: 현재 케이 말풍선/마스코트/상태배지를 스크롤 가능한 중앙 영역에서 하단 고정 영역으로 이동, 히스토리를 최근 3개로 제한, 중앙 영역 `overflow: hidden`으로 전환.

## 수정 후 재검증 결과
- tsc/build/npm test(95/95) 클린.
- 실제 Dev 배포본에서 QA테스트(5학년) 계정으로 `resumed:false`(신규 세션) 라이브 확인, "듣는 중" 배지 라이브 확인, 금지 문구 전수 미노출 확인, 페이지 스크롤 없음(scrollHeight===windowHeight) 확인.
- "생각하는 중"/"말하는 중" 배지의 라이브 시각 확인은 위 "확인되지 않은 사항" 참고 — 코드 경로는 확인했으나 화면 캡처로는 완료하지 못함.

## 남은 위험
- 실기기(iPhone Safari/PWA) 미검증 — 011이 지목한 "iPhone Safari 오디오 세션 중단", "PWA suspend/resume" 등 기기 특유 원인은 이번 분석으로 배제되지도 확정되지도 않았다.
- "생각하는 중"/"말하는 중" 배지의 실제 화면 노출은 코드 검토로는 타당하나 스크린샷 증거가 없다 — QA 보고서에 NOT TESTED로 기록.

## 대표님 실기기 확인 항목
1. 접속 위치: 실제 iPhone/Android 기기, Wi-Fi 환경
2. 사용할 계정: QA테스트(5학년) 또는 대표님 확인용 계정(자동 접근 금지 계정은 대표님만)
3. 말할 내용: 짧은 답변("응", "좋아") 포함 3~4턴 정상 대화
4. 정상적으로 보여야 할 결과: 듣는 중 → 생각하는 중 → 말하는 중 → 듣는 중 순서로 상태가 바뀌고, 정상 대화 중 끊김/연결 불안정 문구가 전혀 뜨지 않아야 함
5. 문제가 생기면 캡처할 화면: 상태 배지가 멈춘 순간, 끊김 문구가 뜬 순간의 화면 전체

---

## 추가 라운드 — "생각하는 중" 상태가 너무 오래 유지됨 (2026-07-27, 대표님 실기기 재확인)

### 배경
`requests/011-test-result.md`(대표님 iPhone 실기기 테스트 결과): Live API 상태 표시(듣는 중/생각하는 중/말하는 중) 자체는 정상 전환되나, "생각하는 중" 상태가 너무 오래 유지돼 케이가 멈춘 것처럼 느껴진다는 보고. 지시 조건: Live API 연결 구조·STT/TTS 로직 변경 금지, "상태 표시 UX 문제인지 실제 응답 지연 문제인지 먼저 구분."

### 조사 방법
코드 대조 + **Dev Supabase `turn_timing_events` 테이블 직접 조회로 실측** (추측이 아닌 실제 운영 이벤트 타임스탬프 기준).

### 코드 대조로 확인한 상태 전이 구조
`app/child/missions/page.tsx`의 정상 턴 흐름(요약):
```
아이 발화 종료 → POST /api/mission/answer(채점, AI 호출 없음 — 순수 DB/규칙 기반, 빠름)
             → POST /api/mission/respond(케이 리액션 문구 생성 — Gemini 호출)
             → setTurnPhase("k_speaking")  ← respond 완료 직후, live.speakAsK() 호출 이전에 선반영
             → live.speakAsK(reactionText) (실제 TTS 오디오 생성 시작)
```
`/api/mission/answer/route.ts`에는 AI 호출이 전혀 없다(grep으로 `generateContent` 0건 확인) — 채점 단계는 지연의 원인이 아니다.
"생각하는 중"(`waiting_k`) 상태는 아이 발화 종료 시점부터 `/api/mission/respond`가 끝날 때까지 유지되고, `k_speaking`으로의 전환은 `live.speakAsK()` 호출보다도 **먼저** 일어난다(858행) — 즉 배지 전환 자체는 실제보다 일찍 "말하는 중"으로 바뀌는 쪽이라, 이 로직이 "생각하는 중을 더 길게 보이게" 만들지는 않는다(오히려 반대 방향의 사소한 부정확성).

### 실측 결과 (Dev, `turn_timing_events`, 최근 64개 턴)
`/api/mission/respond`가 `vertex_request` 기록 후 `ai.models.generateContent()`(**non-streaming**, 응답 전체를 기다려야 반환)를 호출하고 `vertex_first_chunk`/`vertex_complete`를 같은 시점에 함께 기록한다(스트리밍이 아니므로 "첫 청크"와 "완료"가 사실상 동일 이벤트) — 이 두 타임스탬프 사이 구간이 곧 "생각하는 중"의 실제 소요 시간이다.

| 지표 | 값 |
|---|---|
| 평균 | **4.78초** |
| 중앙값(p50) | 4.57초 |
| p90 | **7.37초** |
| 최댓값(관측) | 7.64초 |
| 최솟값(관측) | 0.92초 |

추가로 코드 대조로 확인한 잠재적 가중 요인(이번 64개 표본에는 낮은 빈도로만 존재해 평균에 크게 반영 안 됐을 가능성):
- `parent_questions`가 `mission_confirming` 상태일 때는 본 리액션 생성 **이전에** 별도의 판정용 `generateContent` 호출(`evalAi`, 201행)이 한 번 더 순차 실행된다 — 이 조건에 해당하는 턴은 위 표보다 한 번의 Gemini 왕복만큼 더 걸린다.
- 리액션이 검증 실패(15자 초과/물음표 포함/프롬프트 유출)하면 동일 호출을 1회 재시도한다(305행) — 이 경우도 순차 추가 지연.

### 원인 구분 결론
**실제 응답 지연 문제다, UX/상태 표시 로직 문제가 아니다.** "생각하는 중" 배지 자체는 정확한 실제 상태를 반영하고 있고(코드 경로상 조기 전환 여지도 없음), 그 상태가 길게 유지되는 이유는 `/api/mission/respond`의 비스트리밍 Gemini 호출이 평균 4.8초·p90 7.4초라는 실측된 실제 지연 때문이다. 이는 Live API 연결 구조도 STT/TTS 로직도 아닌, 케이 리액션 문구를 만드는 별도의 텍스트 생성 API(`/api/mission/respond`) 계층의 문제다 — 지시된 변경 금지 범위(Live 연결, STT/TTS) 밖에서 개선 여지가 있다.

### 확정 원인
`/api/mission/respond`의 `ai.models.generateContent()` 호출이 스트리밍이 아닌 완전 대기(non-streaming) 방식이라 평균 4.8초·최대 7.6초가 통째로 "생각하는 중"에 반영된다. `mission_confirming` 조건에서는 판정용 호출이 하나 더 순차로 붙고, 리액션 검증 실패 시 재시도 호출이 한 번 더 순차로 붙어 최악의 경우 최대 3회의 순차 Gemini 왕복이 쌓일 수 있다(이번 표본에는 이 두 가중 요인이 흔치 않아 관측 평균에 크게 반영되지 않았을 뿐, 구조적으로는 존재).

### 수정 내용
**없음 — 이번 라운드는 진단만 수행, 코드 변경 없음** (사용자 지시: "원인 분석 진행"까지만).

### 남은 위험 / 후속 개선 후보 (구현 전 대표님 확인 필요, 이번 라운드에서 임의 적용하지 않음)
- 스트리밍 응답으로 전환(`generateContentStream`)하면 "생각하는 중"을 텍스트 첫 토큰 도착 시점까지로 단축 가능 — 단 Live 파이프라인과의 연동 방식 재설계 필요.
- `maxOutputTokens`(현재 1024)를 리액션의 실제 필요 길이(15자 이내 지시)에 맞춰 대폭 축소하면 생성 지연이 줄어들 가능성.
- `mission_confirming` 판정 호출과 메인 리액션 호출을 병렬화(`Promise.all`)하거나, 판정 호출 자체를 별도 경량 모델/규칙으로 대체.
- 리액션 검증 실패 재시도를 없애고 실패 시 즉시 안전한 고정 문구로 폴백(현재도 `isInvalid` 재검증 실패 시 안전 문구로 폴백하는 코드가 있음 — 재시도 자체를 건너뛰는 옵션 검토).

### 대표님 확인 필요
- 위 개선 후보 중 어떤 방향으로 진행할지(스트리밍 전환은 구조 변경 규모가 있고, 나머지 3개는 상대적으로 국소적) — 실제 코드 변경은 다음 확인 후 진행.
