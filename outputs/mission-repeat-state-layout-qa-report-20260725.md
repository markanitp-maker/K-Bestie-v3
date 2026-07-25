# 미션 반복·상태·레이아웃 QA 결과

## 테스트 대상
- Dev URL: https://k-bestie-v3-dev.vercel.app
- Commit SHA: 작업 중(이 QA 시점 기준 아직 미커밋 — 커밋 후 `_log.md`/최종 보고에 실제 SHA 기록)
- 테스트 계정: `QA테스트(5학년)` (child_id `cde1b847-b1d2-4378-b337-b8cf4d532b00`), 이번 QA를 위해 `tier`를 3(live)→1(stt_tts)로 일시 변경 후 검증 완료 시 3으로 원복
- 기기·브라우저: 헤드리스 Chromium(Playwright), 뷰포트 390x844 — **실기기(iPhone Safari/PWA, Android Chrome)는 검증하지 못함**
- 테스트 시간: 2026-07-25 (KST 오전, 정확한 타임스탬프는 아래 이벤트 타임라인 참고)

## 결론 요약 (먼저 명시)
**필수 시나리오 중 B/D 일부/G/H가 NOT TESTED이므로, 011의 규칙("필수 시나리오 중 하나라도 FAIL/BLOCKED/NOT TESTED면 전체를 PASS/완료로 보고하지 않는다")에 따라 이 작업 전체를 완료로 보고하지 않는다.** 코드 수정과 근본 원인 분석은 끝났고, A/C(부분)/E(부분)/F는 실제 라이브 증거로 확인했으나, 나머지는 이번 세션에서 확인하지 못한 채 남아 있다.

## 사용자 행동 기반 E2E

| 시나리오 | 기대 결과 | 실제 결과 | 판정 | 증거 |
|---|---|---|---|---|
| A. 완료 후 반복 실행 | 완료 세션 존재해도 새 세션(0%)으로 시작 | 오늘자 round1_day/round2_night 모두 COMPLETED(10/10) 상태로 세팅한 뒤 로그인→`/child/missions` 진입 시 `mission/start` 응답이 `resumed:false, sessionId:480f5956(신규), progressPercent:0, completed:false, roundType:round1_day`로 확인됨. 완료 배너도 노출되지 않음 | **PASS** | mission/start 응답 로그, 화면 텍스트 캡처(완료 배너 없음 확인) |
| B. 진행 중 이어하기 | 진행 중 세션은 정상 이어하기 | 이번 세션에서 별도로 재현·확인하지 않음(이 경로의 쿼리 조건 자체는 011 작업으로 변경하지 않았음 — `mission_progress.status !== 'COMPLETED'`면 기존과 동일하게 이어하기 대상으로 남도록만 확인) | **NOT TESTED** | 코드 대조만, 라이브 확인 없음 |
| C. 상태 전환 | 듣는 중→생각하는 중→말하는 중→듣는 중 | 수동모드 마이크 탭 시 "듣는 중"/"듣고 있어요" 실측 노출 확인(수정 전엔 비Live 모드에서 이 배지 자체가 뜬 적이 없었음 — 코드상 도달 불가). 이후 "생각하는 중"/"말하는 중"은 가짜(무음) 오디오 입력이라 답변 파이프라인이 시작되지 않아 화면 노출을 확인하지 못함 | **PARTIAL(듣는 중만 PASS, 나머지 NOT TESTED)** | 콘솔 이벤트(`setTurnPhase idle→child_listening`), 화면 텍스트 매치 `['듣는 중','듣고 있어요']` |
| D. 상태 고정 오류 방지 | 각 상태가 잘못된 시점에 안 뜸 | 관찰 범위(듣는 중) 내에서는 오표시 없음. 생각/말하는 중/오류/연결중 조건은 실제로 그 상태에 도달시키지 못해 확인 불가 | **NOT TESTED(부분)** | 위와 동일 |
| E. 고정형 레이아웃 | 상단/하단 고정, 최근 3개, safe-area, 스크롤 없음 | `document.body.scrollHeight === window.innerHeight`(844=844, scrollTop 0) 확인 — 전체 페이지 스크롤 없음. 구조상 최근 3개 제한(`history.slice(-3)`)과 하단 고정 영역 재배치는 코드로 적용·tsc 통과. 실제 iPhone Safari/Android Chrome 화면에서의 시각적 확인(마스코트 잘림, safe-area 등)은 하지 못함 | **PARTIAL(스크롤 없음만 PASS, 나머지 NOT TESTED)** | scrollHeight 측정값, 화면 캡처(Chromium 헤드리스) |
| F. 끊김 경고 제거 | 정상 대화 중 끊김 문구 없음 | 로그인~미션 진입~녹음~정지 전 과정의 화면 텍스트 전수 검색 결과 "서버 연결이 끊겼어요/연결이 끊겼어요/지금 대화가 잠시 끊겼나봐/연결 불안정/통신이 고르지 않아요" 전부 미검출 | **PASS** | 화면 텍스트 검색 결과(각 캡처 시점) |
| G. 실제 실패 | 내부 재시도 우선, 복구 실패시만 재시도 UI | 실제 실패 상황을 의도적으로 유도하지 않음(네트워크 차단/타임아웃 강제 주입 등 미실시) | **NOT TESTED** | 없음 |
| H. 질문 순환 | 기본10+예비10+순환+실패 | 재현하려면 다수 문항을 실제로 소진해야 해 이번 세션 시간 내 미실시(011 이전 004 작업에서 이미 검증된 로직이며 011에서 이 로직 자체는 변경하지 않음) | **NOT TESTED** | 코드 변경 없음 확인만 |
| I. 진행률 | 유효답변마다 10%, 무효 시 미증가 | 신규 세션 시작 시 0% 확인. 실제 유효 답변 제출 후 10%로 오르는 것은 이번 세션에서 별도 재확인하지 않음(로직 자체는 011에서 변경하지 않음 — `record_v2_mission_answer` RPC 미변경) | **NOT TESTED(부분, 0%만 PASS)** | mission/start 응답의 progressPercent:0 |

## 미션 반복 정책
- `app/api/mission/start/route.ts`의 활성 세션 판정을 `chat_sessions.ended_at IS NULL`(항상 참이었던 깨진 조건 — ended_at은 미션 완료 시 이 저장소 어디서도 갱신되지 않음, grep으로 전체 확인)에서 `mission_progress.status !== 'COMPLETED'`로 교체.
- 라이브 확인: 오늘자 COMPLETED 세션 2건(round1_day/round2_night)이 있는 상태에서 앱 진입 시 신규 세션이 생성됨을 실제 API 응답으로 확인(위 시나리오 A).

## 보상 중복 방지
- `record_v2_mission_answer` SQL RPC(코드 미변경, 기존 로직 그대로)가 `child_id` 단위 하루 지급 횟수(reason='mission')를 세션과 무관하게 카운트해 일일 한도(2회)를 넘으면 `daily_limit_reached`로 보상만 스킵하고 완료 처리는 정상 진행하는 구조임을 코드로 재확인. 011의 "같은 날 반복 완료해도 보상 중복 지급 없음" 요구사항을 이 기존 RPC가 이미 충족하므로 별도 수정 없음. 실제 반복 완료→보상 스킵까지 라이브로 재현하지는 못함(위 H/시간 제약과 동일 사유).

## 질문 순환
- 코드 변경 없음. 004에서 이미 검증된 로직 그대로 유지.

## 진행률
- 신규 세션 0% 라이브 확인. 유효 답변 시 10% 증가는 로직 미변경(코드 재확인만).

## 상태 머신
- `voiceState`/`isThinkingTurn`을 `isLiveMode` 기준으로 분기해, 비Live(STT/TTS) 모드는 `isRecording`/`isProcessingAnswer`/`sttTts.isSpeaking`로 파생하도록 수정. `isRecording`(듣는 중)만 라이브로 확인, 나머지는 코드 검토 수준.

## 레이아웃
- `MissionConversationLayout.tsx`: 현재 케이 말풍선/마스코트/상태배지를 하단 고정 영역으로 이동, 히스토리 `slice(-3)`로 제한, 중앙 영역 `overflow:hidden`. 페이지 전체 스크롤 없음만 라이브 확인.

## 끊김 경고
- 저장소 전체에서 "끊겼", "연결 불안정", "통신이 고르지 않아요" 등 011이 지목한 문구 및 유사 문구 9곳 확인·전부 교체(1곳은 대화 말풍선 영구저장 방식 자체도 배너로 변경). 라이브 미노출 확인.

## 연결 불안정 분석
- 별도 문서 `outputs/mission-connection-instability-analysis-20260725.md` 참고. 확정 원인: 네트워크 문제가 아니라 상태 파생 로직이 Live 전용으로만 작성된 구조적 버그.

## 이벤트 타임라인
- 분석 보고서(`outputs/mission-connection-instability-analysis-20260725.md`)의 "이벤트 타임라인" 절 참고.

## 자동 테스트 결과
- `npm test`: 95/95 PASS

## 타입검사·빌드 결과
- `npx tsc --noEmit`: 클린(에러 0건)
- `npm run build`: 성공, `/api/quiz/*`/`/api/rewards/*` 등 기존 라우트 포함 정상 빌드

## 독립 리뷰 결과
- claude-review 인스턴스 1회 실행. 6개 검토 중점 전부 [통과], [단순] 1건 발견: 케이 마스코트 애니메이션(`KBestieMascotAnimation`)이 여전히 `turnPhaseUi === "k_speaking"`(Live 전용)로만 "말하는 중" 판정하고 있어, 비Live 모드에서는 상태 배지("말하는 중")와 마스코트 동작(정지 상태)이 서로 불일치하는 문제 — voiceState는 고쳤지만 바로 옆 마스코트 코드는 같은 수정이 누락됐던 것. 지적받은 그대로(`isLiveMode ? turnPhaseUi==="k_speaking" : sttTts.isSpeaking`) 즉시 수정, tsc/build/test(95/95) 재확인 후 재배포 완료. 이 1줄 수정은 리뷰가 제시한 정확한 해법을 그대로 적용한 기계적 수정이라 2회 루프 상한에 따라 3차 리뷰는 돌리지 않고 자체 재검증으로 대체했다.

## 데이터 원상복구 결과
- QA테스트(5학년) `child_profiles.tier`: 1(테스트용 임시 변경) → 3(원래 값)으로 원복 확인
- 테스트로 생성한 오늘자 미션 세션 3건(합성 COMPLETED 2건 + 라이브 테스트로 생성된 신규 세션 1건)의 `mission_question_history`/`chat_messages`/`mission_progress`/`chat_sessions` 전부 삭제 확인(remaining count: 0)
- 임시 비밀번호를 설정했던 QA테스트(5학년) 계정은 자동화 전용 계정 정책상 비밀번호 재설정 자체가 허용 범위이며, 하드코딩된 값은 어떤 파일에도 커밋하지 않음(스크립트 자체도 테스트 종료 후 삭제)
- 이번 QA에 사용한 임시 스크립트(`qa-011-*.mjs`) 전부 삭제, 스크린샷(`/tmp/qa-011-*.png`) 전부 삭제 확인

## FAIL/BLOCKED/NOT TESTED 항목
- B(진행 중 이어하기), G(실제 실패 유도), H(질문 순환) — 전부 NOT TESTED
- C/D/E/I — 부분 NOT TESTED(위 표 참고)
- FAIL 항목은 없음(발견된 버그는 전부 이번 세션에서 수정 완료)

## 대표님 확인 필요
1. 접속 위치: 실기기(iPhone/Android), 정상 Wi-Fi
2. 사용할 계정: QA테스트(5학년) 또는 대표님 확인용 계정
3. 말할 내용: 3~4턴 정상 음성 대화(자동 모드) + 짧은 답변 1회
4. 정상적으로 보여야 할 결과: 듣는 중→생각하는 중→말하는 중 전환이 실제로 보이는지, 정상 대화 중 끊김/연결 불안정 문구가 안 뜨는지, 마스코트/말풍선/메뉴가 화면 하단에 항상 고정돼 있는지
5. 문제가 생기면 캡처할 화면: 상태가 멈춘 순간, 끊김 문구가 뜬 순간, 레이아웃이 깨진 순간
