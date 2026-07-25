# 미션 반복·상태·레이아웃 QA 결과

## 테스트 대상
- Dev URL: https://k-bestie-v3-dev.vercel.app
- Commit SHA: a1a789a431032123b5d263f728292bec962fac42
- 테스트 계정: `QA테스트(5학년)` (child_id `cde1b847-b1d2-4378-b337-b8cf4d532b00`), 이번 QA를 위해 `tier`를 3(live)→1(stt_tts)로 일시 변경 후 검증 완료 시 3으로 원복
- 기기·브라우저: 헤드리스 Chromium(Playwright), 뷰포트 390x844 — **실기기(iPhone Safari/PWA, Android Chrome)는 검증하지 못함**
- 테스트 시간: 2026-07-25 (KST 오전, 정확한 타임스탬프는 아래 이벤트 타임라인 참고)

## 결론 요약 (먼저 명시)
**필수 시나리오 중 B/D 일부/G/H가 NOT TESTED이므로, 011의 규칙("필수 시나리오 중 하나라도 FAIL/BLOCKED/NOT TESTED면 전체를 PASS/완료로 보고하지 않는다")에 따라 이 작업 전체를 완료로 보고하지 않는다.** 코드 수정과 근본 원인 분석은 끝났고, A/C(부분)/E(부분)/F는 실제 라이브 증거로 확인했으나, 나머지는 이번 세션에서 확인하지 못한 채 남아 있다. (2026-07-25 추가: 아래 "17번 추가 이슈 — 마스코트 잘림" 절 참고, 대표님 실기기 확인으로 발견된 후속 버그 수정·검증 완료.)

---

## 17. 대표님 실기기 추가 이슈 — 마스코트 잘림 (2026-07-25, 1차 배포 후)

### 증상 및 원인
1차 배포(커밋 a1a789a/7addd2b) 후 대표님이 iPhone Safari/PWA에서 실기기 확인한 결과,
하단 고정 레이아웃 적용 후 케이 마스코트가 반쯤 잘려 보이는 문제 발견. 코드 대조로
확정한 원인 2가지:
1. 중앙 히스토리 영역(`flex:1`)에 `minHeight:0`이 없어서, flex 자식의 기본값
   `min-height:auto` 때문에 실기기의 실제 `100dvh`(Safari 툴바 상태에 따라 시뮬레이터
   가정보다 작을 수 있음)에서 전체 flex 컬럼이 넘쳐 바깥 `overflow:hidden`이 하단
   고정 영역 일부(마스코트)를 잘라냄.
2. 하단 고정 영역의 기존 여백(16px+safe-area)이 그 위에 겹쳐 그려지는 실제 마이크/
   텍스트/종료 버튼 행(약 104px+safe-area)보다 훨씬 작아 마스코트 아랫부분이 그
   버튼 행에 가려질 수 있었음.

### 수정 내용
- 히스토리 영역에 `minHeight:0` 추가.
- 하단 고정 영역 여백을 `120px+safe-area`로 확대.
- 실제 버튼 행에 항상 가려지도록 설계돼 있던 죽은 장식 UI(자체 "듣고 있어요/파형"
  영역, 실사용자에게 보인 적 없음)를 제거해 마스코트가 쓸 세로 공간 확보.
- 하단 고정 레이아웃 자체(상단/하단 분리, 히스토리 3개 제한)는 그대로 유지.

### 검증 결과 (라이브, 커밋 d26f318 배포 후)
- **뷰포트 2종**(iPhone SE 375×667 — 가장 좁은 실제 iPhone 화면, iPhone 표준 390×844)
  헤드리스 Chromium으로 실제 배포본(`https://k-bestie-v3-dev.vercel.app`)에 QA테스트
  (5학년) 계정(tier 1로 일시 전환, 검증 후 3으로 원복)으로 로그인해 확인:
  - 마스코트 canvas 실제 렌더링 크기 `72×72`(의도한 크기와 정확히 일치, 잘렸다면
    실제 보이는 높이가 이보다 작아야 함).
  - `fullyVisibleInViewport: true` — 두 뷰포트 모두 마스코트가 화면 안에 완전히 들어옴.
  - `clippingAncestor: null` — 조상 요소 중 마스코트 경계를 실제로 자르는 `overflow:hidden`
    요소 없음(자동 스크립트로 DOM 경계 직접 검사).
  - 스크린샷으로 시각 확인: 마스코트 전신(다리/신발까지) 완전히 노출, 케이 말풍선
    바로 아래 정상 배치, 하단 메뉴(💬/✕)와 겹치지 않음.
- **주의**: 이 QA테스트 계정은 기본값이 `tier=3`(Live 모드)이며, Live 모드는
  `MissionConversationLayout`을 전혀 쓰지 않는 완전히 별도의 레이아웃 코드(같은 파일
  1995행부터 시작하는 별도 `return` 블록)를 쓴다는 것을 이번에 재확인했다 — 처음
  검증 시도에서 tier 전환을 깜빡해 엉뚱한(고쳐지지 않은, 관련 없는) 화면을 테스트할
  뻔했다가 바로잡았다. 011 전체가 명시한 "현재 개발서버는 STT→LLM→TTS 구조"라는
  전제와 일치하도록, 이 마스코트 수정 검증도 반드시 비Live(tier 1/2) 계정 기준으로만
  유효하다.
- **여전히 헤드리스 Chromium이며 실제 iPhone Safari/PWA standalone 모드 그 자체는
  아니다** — 뷰포트 크기(375×667)로 iPhone SE 조건을 근사했을 뿐, Safari 고유의
  동적 툴바 동작·PWA standalone 모드는 시뮬레이션이 불가능하다. 대표님 실기기
  재확인이 이 항목의 최종 확인이다.

### 배포 경위 (참고)
로컬 Vercel CLI로 배포 시도 중 `services/vertex-live-relay`를 Vercel이 마이크로
서비스로 오인식해 "entrypoint 필요" 오류로 4회 연속 실패(코드와 무관, 원인 미확정) —
대표님 승인 하에 `git push`로 GitHub 자동배포를 이용해 우회, 커밋
`d26f318`(및 병렬 세션이 그 위에 커밋한 `7b992d0`)이 정상 배포됨을 확인.
실수로 생성된 임시 Vercel 프로젝트("verify-011")는 삭제 완료.

### 최종 완료조건 확인
- 마스코트 전체 노출(잘림 0건) — iPhone SE/표준 iPhone 뷰포트 시뮬레이션 기준 **PASS**
- 말풍선이 상태배지를 가리지 않음 — 스크린샷 확인 **PASS**
- 마스코트/말풍선/상태배지가 하단 실제 조작 버튼과 겹치지 않음 — 자동 모드 확인
  **PASS**(수동 모드에서 마이크 버튼과의 실측 겹침 여부는 버튼 선택자 문제로 이번
  스크립트에서 확인 못함 — NOT TESTED, 스크린샷상으로는 겹침 정황 없음)
- 실기기(iPhone Safari/PWA) 최종 확인 — **대표님 확인 필요(여전히 남음)**

---

## 19. 대표님 실기기 추가 이슈 — "케이가 잘 못 들었어" 문구 제거 (2026-07-25, 3차)

### 증상 및 검색 결과
2차 배포 후 대표님이 실기기에서 "케이가 잘 못 들었어. 다시 한번 말해줄래?" 노출을
추가로 발견. `app/child/missions/page.tsx` 전체에서 STT 실패/무음/timeout/fallback
경로를 전수 검색한 결과 **27곳의 `resetToIdle("...")` 호출 + `onKTurnTimeout`(케이
말풍선 저장) + `onTranscriptRejected`(Live, 케이 말풍선 저장) + `onRecoveryNeeded`(배너)**
에서 유사 문구가 사용자 화면(상단 배너 2곳 또는 케이 대화 말풍선)에 노출되고
있었음을 확인. `lib/freechat/reactionEngine.ts`와 `components/TestMode{AB,CD,E}Runner.tsx`
에도 유사 문구가 있으나, 011의 범위(미션 화면)와 CLAUDE.md의 "A·B·C·E 중단 트랙
수정 금지"에 따라 **의도적으로 건드리지 않았다**(발견만 기록).

### 수정 내용
- 새 공용 정책 도입: `recoveryAttemptedRef`(턴마다 리셋) + `attemptSilentRecoveryOrShowRetry()`
  — 처음 실패는 문구·배너 없이 조용히 재시도(마이크 재오픈 등), 같은 턴에서 반복되면
  그때만 재시도 버튼을 띄운다.
- `resetToIdle`의 시그니처를 `fallbackMessage?: string` → `showRetryButtonNow?: boolean`로
  변경 — 문자열 메시지를 완전히 제거하고 배너 표시 로직(`setInputErrorNotice`)과 Live
  말풍선 폴백(`askQuestionRef` 경유 speakAsK) 둘 다 삭제.
- 기존 `recoveryNotice`/`inputErrorNotice` state와 그 배너 렌더링 2곳(비Live 대화 영역,
  Live 헤더 영역)을 전부 제거.
- 새 `showRetryButton` state + 화면 중앙 카드 오버레이(`retryOverlay`) 추가 — 오류
  문구 없이 "다시 시도"/"미션 나가기" 버튼만 표시, 상단 배너도 케이 말풍선도 아니다.
- `onEmptyAudio`/`onSttFailed`(기존에 이미 1회 조용한 재시도 로직 보유)의 2번째 실패
  시점은 바로 `resetToIdle(true)`로 연결(중복 재시도 방지 — 이미 한 번 시도했으므로).
- `onKTurnTimeout`: 케이 말풍선(appendTurn) 저장을 완전히 제거, `attemptSilentRecoveryOrShowRetry()`로 대체.
- `onTranscriptRejected`(Live, GCP STT 외국문자 오판): `speakAsK` 말풍선 저장 제거,
  동일한 조용한 재시도→버튼 패턴으로 대체.
- `onRecoveryNeeded`(Live 재연결 시도): 텍스트 자체를 없애 "재연결 성공 시 사용자
  메시지 없이 대화 계속"을 그대로 만족.
- Live 전용 "시간이 좀 걸리네. 다시 말해줄래?" 필러(7곳)도 "다시 말해줄래" 패턴이라
  아이에게 반복을 요구하지 않는 "음... 잠깐만 기다려줄래?"로 교체.

### 검증 결과 (라이브, 커밋 0b2d257 배포 후)
QA테스트(5학년) 계정(tier 1로 일시 전환, 검증 후 3으로 원복) + 실제 배포본
(`https://k-bestie-v3-dev.vercel.app`)에서 확인:

| 시나리오 | 기대 결과 | 실제 결과 | 판정 |
|---|---|---|---|
| 정상 대화 진입 | 금지 문구 0건 | 전수 검색 결과 0건 | **PASS** |
| 무음 1회차(가짜 무음 오디오로 마이크 녹음) | 문구·버튼 없이 조용히 재시도 | 금지 문구 0건, 재시도 버튼 미노출 확인 | **PASS** |
| 무음 2회 연속 | 그제서야 재시도 버튼만 노출(문구 없음) | 금지 문구 0건, 재시도 버튼 노출 확인 | **PASS** |
| 재시도 버튼 클릭 | 버튼이 사라지고 정상 재개 | 클릭 후 버튼 사라짐 확인 | **PASS** |
| 최종 화면 상태 | 금지 문구 0건 | 0건 확인 | **PASS** |

검색한 금지 문구(모두 0건 확인): "케이가 잘 못 들었어", "다시 한번 말해줄래",
"다시 말해줄래", "서버 연결이 끊겼어요", "연결이 불안정해요", "통신이 고르지
않아요", "마이크 상태가 이상해요", "서버 응답이 늦어지고 있어요".

**참고(문제 아님)**: 최종 화면 텍스트에 "연결 불안정"이라는 문구가 있었는데, 이는
이번에 손댄 배너/말풍선이 아니라 기존 `ConnectionQualityIndicator`(연결 품질 막대
+ 라벨, 011 이전부터 있던 별개 기능)가 2회 연속 실제 STT 실패를 정확히 반영해
표시한 것이다 — 항상 떠 있는 작은 상태 아이콘이지 모달/배너/말풍선이 아니고, 이번
경우엔 실제로 파이프라인이 2번 실패한 게 맞아 오탐도 아니다. 대표님이 지목한
"문구 노출" 범주와는 다른 기능이라 판단해 손대지 않았다.

### 확인되지 않은 사항
- **timeout/API 실패 경로**(15초/8초/10초 워치독, `/api/mission/answer` 등)는 코드
  수정은 했지만 실제로 네트워크를 인위적으로 지연시켜 재현하지는 못했다(Playwright
  route 가로채기를 준비했으나 이번 세션에서 시간 관계상 무음 경로 검증에 집중했다).
  로직은 무음 경로와 완전히 같은 공용 함수(`attemptSilentRecoveryOrShowRetry`)를
  쓰므로 동작은 같을 것으로 판단하나, 실측 확인은 남아 있다 — NOT TESTED.
- `lib/freechat/reactionEngine.ts`/`components/TestMode{AB,CD,E}Runner.tsx`의 유사
  문구는 011 범위 밖(자유대화, A/B/C/E 트랙)이라 확인만 하고 손대지 않았다.
- 실기기(iPhone Safari/PWA) 최종 확인은 여전히 대표님 몫으로 남아 있다.

### 최종 완료조건 확인 (19번)
- "케이가 잘 못 들었어" 및 유사 표현 사용자 화면 노출 0건 — **PASS**(라이브 확인)
- 1회 내부 재시도 후 복구되면 무음(안내 없음) — **PASS**(무음 1회차로 확인)
- 복구 불가능 시에만 짧은 재시도 버튼(케이 말풍선/상단 배너 아님) — **PASS**(무음 2회차로 확인)
- timeout/API 실패 경로의 동일 동작 실측 — **NOT TESTED**(코드는 동일 함수 재사용, 별도 라이브 확인 남음)

## 21. 대표님 실기기 추가 이슈 — PC PWA 마스코트 미노출 (2026-07-25, 4차)

### 원인
`components/MissionConversationLayout.tsx`의 최상위 컨테이너가 `height:"100dvh"`를
사용해, PC(`pointer:fine && width>=900px`)에서 `DemoFrame`(태블릿/스마트폰 기기
목업 프레임)이 실제 뷰포트보다 훨씬 작은 고정 픽셀 높이(1920x1080에서 약 700px,
실제 뷰포트의 약 65%)를 부모로 제공해도 `100dvh`는 그 부모 크기와 무관하게 항상
"실제 전체 뷰포트" 높이(1080px)로 계산돼, 하단 고정 마스코트 영역이 목업 프레임
밖으로 밀려 보이지 않았다. 상세 원인 분석은 requests/011 §20 참고.

### 수정
`height:"100dvh"` → `height:"100%"` (1줄, `components/MissionConversationLayout.tsx`).
커밋 `bb530f4`. GitHub 자동배포가 `CANCELED`로 실패(이전 라운드와 동일 증상,
원인 미확정)해 격리 워크트리 `vercel deploy --prod`로 재배포
(`dpl_J9VDNUqYBXvNEti22dJW5t4V4PSV`, `k-bestie-v3-dev.vercel.app` 정상 alias 확인).

### 검증 결과 (실배포 URL, QA테스트(5학년) 계정, Playwright 헤드리스)

| 환경 | 뷰포트/설정 | 마스코트 노출 | 상태배지·하단메뉴 겹침 | 비고 |
|---|---|---|---|---|
| PC PWA(데스크톱, 마우스) | 1920x1080 | **PASS** — `top:659,bottom:731`, `windowInnerHeight:1080` 내 완전 포함 | 겹침 없음 | 최초 재현 뷰포트, 수정 전 `top:1119`(뷰포트 밖)였던 것과 대조 확인 |
| PC PWA(데스크톱, 마우스) | 1280x720 | **PASS** — 완전 노출 | 겹침 없음 | |
| PC PWA(데스크톱, 마우스) | 1024x600(가장 작은 PC) | **PASS** — DOM 위치·크기·`canvas.toDataURL()` 실제 픽셀 내용까지 확인(마스코트 실루엣 46.6% 비투명 픽셀) | 겹침 없음 | `page.screenshot()`/`locator.screenshot()` 캡처 자체가 이 케이스에서만 빈 화면을 반환하는 Playwright 자체 아티팩트를 발견해, DOM rect + computed style + 실제 canvas 픽셀 데이터(toDataURL)까지 교차 확인 후 실제로는 정상 렌더 중임을 확정(스크린샷 도구 결함이지 앱 버그 아님) |
| 태블릿(iPad 크기, PC 취급 임계값 미만) | 768x1024 | **PASS** — 완전 노출(DemoFrame 프레임 미적용, `!isPc` 경로) | 겹침 없음 | |
| Android Chrome(터치, `pointer:coarse`) | Pixel 7 에뮬레이션 | **PASS** — 회귀 없음, 프레임 미적용 확인 | 겹침 없음 | 기존(1~3차) 수정 대비 회귀 없음 재확인 |
| 스마트폰 Safari/PWA(터치) | iPhone SE(375x667) | **PASS** — 회귀 없음 | 겹침 없음 | |
| 스마트폰 Safari/PWA(터치) | iPhone 13(390x844) | **PASS** — 회귀 없음 | 겹침 없음 | |

### 최종 완료조건 확인 (20번)
- 스마트폰(Safari/PWA), Android Chrome, PC PWA 각각에서 마스코트 전체 노출 — **PASS**(7개 환경/뷰포트 전부)
- 하단 고정 레이아웃·최근 3개 말풍선 구조 유지(회귀 없음) — **PASS**(코드 변경이 height 값 1곳뿐, 구조 변경 없음)
- 상태 배지·하단 메뉴와 마스코트 비겹침(3개 환경 전부) — **PASS**
- `/k-bestie-voice-mission-qa` 스킬에 PC PWA 시나리오 추가 재검증 — **PASS**(이번 라운드에서 PC PWA 3개 뷰포트 + Android Chrome 시나리오로 실행)

### 참고 — 실기기(진짜 iPhone/Android 기기, 진짜 PC 브라우저) 최종 확인은 대표님 몫으로 남아 있음(헤드리스 에뮬레이션 기반 검증만 완료).

## 23. 대표님 추가 요구 — 하단 메인 음성 버튼 상태 기반 3종 전환 (2026-07-26, 5차)

### 적용 범위
AskUserQuestion으로 대표님께 직접 확인 — "자동/수동 공통 적용" vs "수동 모드에만
적용" 중 **"수동 모드에만 적용"** 으로 확정. 자동 모드의 기존 hands-free 버튼숨김
동작은 변경하지 않았다.

### 수정 내용
- STT/TTS(Tier1) 트리: `isThinkingTurn`에 `sttTts.isSpeaking`을 추가(기존엔
  `isProcessingAnswer`만 봐서 TTS 재생 중엔 버튼이 다시 "대기"로 되돌아가는 버그가
  있었음) + 회색+스피너 비주얼 신설(기존엔 이 상태 자체가 없었음).
- Live(Tier3) 트리: 기존에 이미 3단계에 가까운 비주얼이 있었으나 `disabled` 속성이
  없어 내부 가드(`canStartRecording`)가 탭을 조용히 무시하는 방식이었던 것을 실제
  HTML `disabled`로 교체.
- 새 `isKSpeakingNow`로 같은 회색 비활성 모양 안에서 "케이가 말하고 있어요"/"생각
  하고 있어요" 문구만 구분.

### QA 중 발견·수정한 회귀
Live 트리에 `disabled={isThinkingTurn}`을 그대로 적용하자, 녹음을 시작하는 즉시
`turnPhaseUi`가 `"child_listening"`(≠idle)으로 바뀌어 `isThinkingTurn`이 true가 되며
버튼이 잠겨 "녹음중 눌러서 종료" 자체가 불가능해지는 회귀를 실제 클릭으로 재현·발견했다.
`isButtonBlocked = isThinkingTurn && !isRecording`로 교체해 수정(커밋 20cf045).

### 검증 결과 (실배포 URL, QA테스트(5학년) 계정, Playwright, `/api/mission/stt` 가로채기로
가짜 유효 답변을 반환시켜 판정→다음질문생성→TTS 전체 파이프라인을 강제로 태워 검증)

| 환경 | ①대기 | ②녹음중(클릭가능) | ③생각중(회색·비활성·클릭불가) | ③말하는중(회색·비활성·클릭불가) | ④대기복귀 |
|---|---|---|---|---|---|
| STT/TTS 모바일(390x844) | PASS | PASS | PASS | PASS | PASS |
| STT/TTS PC PWA(1280x800) | PASS | PASS | PASS | PASS | PASS |
| Live 모바일(390x844) | PASS | PASS(회귀 수정 확인) | PASS | PASS | NOT TESTED(20초 내 미복귀, 대화 콘텐츠 자체는 진행 확인됨) |
| Live PC PWA(1280x800) | NOT TESTED | NOT TESTED | - | - | - |

비활성 상태에서 클릭 시도 시 아무 상태 변화 없음(진짜 `disabled`로 클릭 자체가 막힘)을
모든 PASS 항목에서 확인.

**Live PC PWA NOT TESTED 사유**: 새 세션에서 아이 조작 없이도 "케이가 생각하고 있어요"
회색 비활성 상태로 60초 넘게 멈추는 현상을 관측 — 코드 대조 결과 이번 버튼 수정과
무관하게 Live(Gemini 네이티브 오디오)가 Playwright의 완전 무음 fake-media에서 초기
응답을 못 받는 것으로 보인다(STT/TTS는 단순 REST라 무음에도 정상, Live는 실제 양방향
오디오 스트리밍 필요). 버튼 JSX/상태 로직 자체엔 뷰포트·DemoFrame 조건부 분기가 없음을
코드로 확인했으므로 모바일에서 확인된 동작이 PC PWA에도 동일 적용될 것으로 판단하나,
실기기 확인 필요.

### 최종 완료조건 확인 (22번)
- 하나의 메인 버튼이 3가지 모습으로 전환 — **PASS**
- 하단 고정 레이아웃·마스코트 노출 구조 유지 — **PASS**(버튼 내부 스타일만 변경)
- 스마트폰/PC PWA 자연스러운 전환 — **PASS**(STT/TTS 양쪽), Live PC PWA **NOT TESTED**

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
- (4차/PC PWA 마스코트 미노출) 별도 claude-review 인스턴스 미실행 — `height:"100dvh"→"100%"` CSS 값 1곳 변경으로, 2차(마스코트 잘림) 라운드에 적용한 동일 기준("1줄 수준 CSS 수정은 tsc/build/실배포 라이브 검증으로 대체")을 그대로 따름. 대신 근본원인을 추측으로 넘기지 않고 DOM ancestor-chain 실측(각 단계 높이·overflow·class), 수정 전/후 mascot `getBoundingClientRect()` 좌표 대조(수정 전 `top:1119`(뷰포트 밖) → 수정 후 `top:659`(뷰포트 안)), `canvas.toDataURL()` 실제 픽셀 데이터까지 3중으로 실측 검증했다. tsc(`npx tsc --noEmit`) 클린 재확인.

## 데이터 원상복구 결과
- (5차) QA테스트(5학년) `child_profiles.tier`: 1(테스트용) → 3(원래 값)으로 재원복 확인(Live 검증 후 최종 3 확인)
- (5차) 5차 테스트로 생성된 미션 세션 2건(`f979c9aa-...`, `4801d4a2-...`)의 `chat_messages`/`mission_question_history`/`mission_progress`/`chat_sessions` 전부 삭제 확인
- (5차) 이번 라운드에 사용한 임시 스크립트(`qa-011-button-states.mjs`, `qa-011-netlog.mjs`, `qa-011-set-temp-pw.mjs`, `qa-011-pc-live-quick.mjs`, `qa-011-pc-live-wait.mjs`) 및 스크린샷(`/tmp/qa-011-btn-*.png`, `/tmp/qa-011-pc-live-*.png`) 전부 삭제 확인
- (4차) QA테스트(5학년) `child_profiles.tier`: 1(3차부터 이어진 테스트용 임시 값) → 3(원래 값)으로 재원복 확인
- (4차) 4차 테스트로 생성된 오늘자 미션 세션 2건(`ad8c685f-...`, `818f608b-...`)의 `chat_messages`/`mission_question_history`/`mission_progress`/`chat_sessions` 전부 삭제 확인
- (4차) 이번 라운드에 사용한 임시 스크립트(`qa-011-pc*.mjs`, `qa-011-set-temp-pw.mjs`, `qa-011-mobile-regress.mjs`) 및 스크린샷(`/tmp/qa-011-*.png`) 전부 삭제 확인
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
