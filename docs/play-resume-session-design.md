# 게임 참여 공통 재접속(Resume Session) 설계안

> ⚠️ **부분 폐기 (2026-07-27) — 퀴즈마스터 부분만 무효, 나머지는 유효**
>
> 퀴즈마스터가 독립 앱 + 리버스 프록시 구조로 확정되면서, 이 문서에서 퀴즈마스터를
> 다루는 대목(`/api/quiz-play/*` 엔드포인트, `QuizPlayScreen`, K-Bestie가 `claim`을
> 직접 호출하는 시퀀스)은 더 이상 현실과 맞지 않는다. 해당 코드는 2026-07-27에
> 삭제됐다(커밋 `c7a76e2`).
>
> **퀴즈마스터의 현재 이어하기 방식:** K-Bestie는 `/api/play/session`으로 이어하기
> *가능 여부만* 판단하고(`quiz_attempts` 읽기 전용 조회), `/play/quiz?resume=<attemptId>`로
> 하드 네비게이션한다. 실제 재개와 `claim` 호출은 Quiz 앱이 자기 세션으로 처리한다.
>
> **여전히 유효한 부분:** MBTI·만화책 등 다른 놀이에 대한 공통 재접속 정책, 그리고
> "놀이 타입별로 진행 상태 저장 위치가 달라 생기는 구조적 문제"라는 문제 정의 자체.
> 현재 정본은 `PROJECT_STATUS.md`의 "놀이 앱 아키텍처 최종 확정" 항목.

작성일: 2026-07-26
배경: 퀴즈마스터 실사용 테스트에서 "이탈 후 재진입 시 이어하기가 뜨지 않고 항상 새로 시작하기만
표시되는" 버그가 보고됨. 원인 분석 결과 개별 버그가 아니라 놀이 타입별로 진행 상태 저장 위치가
서로 달라 생기는 구조적 문제로 판단, 대표 지시에 따라 퀴즈마스터/MBTI/만화책 등 모든 놀이에
적용되는 공통 재접속 정책으로 범위를 넓혀 설계한다. **이 문서는 설계/구현범위 정리까지만
다루며, 실제 코드 변경은 포함하지 않는다.**

## 1. 목표

앱 종료, 화면 잠금, 백그라운드 이동, 네트워크 단절 후 다시 진입하면:

- 진행 중 세션이 있으면 **이어하기**가 표시된다 (모든 놀이 타입 공통).
- 이어하기를 선택하면 **새 세션 생성도, 황금열쇠 재차감도 없이** 기존 진행 상태를 그대로
  복원한다. 예: 퀴즈 10문제 중 7번 진행 중이면 7번부터, MBTI 20문항 중 14번 진행 중이면
  14번부터, 만화책이면 마지막 읽은 페이지부터.
- handoff token은 **최초 진입 인증 전용**이며, 재접속 여부 판단에는 절대 사용하지 않는다.
- 기존 황금열쇠 reward transaction 구조와 완료 callback 구조는 그대로 유지한다.

## 2. 현재 구조 분석

### 2-A. 놀이 타입은 소유권 모델이 서로 다른 두 그룹으로 나뉜다

**그룹 1 — 네이티브 세션 소유 (main app이 생명주기 전체를 own)**

MBTI가 유일한 실제 구현체다 (`docs/play-lifecycle.md`가 이미 이 패턴을 "반드시 재사용할 참조
구현"으로 문서화해 둔 상태). comic_book/hairstyle은 `app/child/play/page.tsx`에 게임 화면 자체가
아직 없고(placeholder "준비 중"), `GAMES` 목록에만 존재한다.

```
/api/play/consume (POST)  — 세션 생성 or 이어하기, consume_play_access RPC
                              (child_id+play_type당 in_progress 1개 unique 제약 →
                              이미 진행 중이면 재화 재차감 없이 access_type="resume" 반환)
/api/play/session (GET)   — k_play_sessions만 조회해 canResume 판정
/api/play/restart (POST)  — 기존 세션 폐기 후 재시작
k_play_sessions           — 진행 상태(progress_state.<playType> 네임스페이스) 저장, 6시간
                              resume_expires_at 창
lib/play/sessionAuth.ts   — playSessionId 자체를 capability token으로 검증(쿠키 재확인 안 함)
lib/play/progressState.ts — 네임스페이스 CAS 저장
lib/play/completion.ts    — in_progress→completed CAS 전이
```

이 그룹은 **이미 재접속 요구사항을 정확히 만족한다** — `/api/play/consume`이 idempotency와
"이미 진행 중" 조건을 원자적 RPC 안에서 판정하므로 이어하기 시 재화가 다시 빠지지 않고,
`/api/play/session`이 `k_play_sessions` 하나만 보면 되므로 canResume 판정도 정확하다.

(별도로 발견한 기존 wrinkle: comic_book/hairstyle 용으로 `/api/play/reserve`+`/api/play/start`
2단계 RPC(`reserve_gold_keys_for_play`/`start_new_play_session`)가 이미 존재하는데, 이는
`/api/play/consume`(`consume_play_access` RPC)와 별개의 소비 메커니즘이다. 두 놀이가 아직
미구현이라 지금 당장 회귀는 없지만, 실제 게임을 만들 때 이 두 메커니즘 중 어느 쪽을 표준으로
할지 정리가 필요하다 — 이번 설계 범위 밖의 별도 과제로 남긴다.)

**그룹 2 — 외부 위임 소유 (main app은 진입 인증+과금만 중개, 실제 생명주기는 별도 테이블)**

퀴즈마스터가 유일한 예로, 독립 퀴즈마스터 앱과 이 저장소에 포팅된 `quiz-play` 모듈이 **같은**
`quiz_attempts`/`quiz_handoff_tokens` 테이블과 RPC(`quiz_draw_questions`,
`quiz_claim_handoff_entry`, `quiz_apply_signal`, `quiz_enter_background` 등)를 공유한다.

```
/api/quiz/start-handoff (main app)  — grade 조회 + consumeKeys() [주의: 그룹1과 다른 소비
                                        경로, k_play_sessions를 아예 거치지 않음] +
                                        quiz_handoff_tokens insert(60초 TTL)
/api/quiz-play/redeem                — handoff token 1회 소비, K-Bestie 세션과 연결
/api/quiz-play/start                 — quiz_attempts row 생성(문항 고정, device 세션쿠키 발급)
/api/quiz-play/{progress,heartbeat,background,submit} — quiz_attempts 진행/제출
quiz_attempts.status                 — in_progress ↔ background ↔ submitted
```

이 그룹은 `k_play_sessions`을 전혀 쓰지 않도록 **의도적으로 설계**돼 있다
(`lib/quiz/handoffToken.ts` 주석: 황금열쇠 소비는 KY 놀이 세션 인프라를 쓰지 않고 기존 범용
`consumeKeys()` 경로를 그대로 재사용). 독립 퀴즈마스터 앱 자체는 이미 완전한 재접속 메커니즘을
갖고 있다 — `GET /api/quiz/attempt/active`(인증만으로 재개 가능한 attempt를 attemptId 없이
찾음, 6시간 창) + `POST /api/quiz/attempt/[id]/claim`(기기 전환, 황금열쇠/handoff token과 무관한
순수 재인증 — session_token만 원자적으로 교체). **다만 이 두 엔드포인트는 이 저장소의
`quiz-play` 포팅 대상에서 빠져 있다** — `start`/`redeem`만 포팅됐고 `active`/`claim`은 없다.

### 2-B. 버그의 정확한 위치

`app/child/play/page.tsx`의 `handleGameClick`이 놀이 타입과 무관하게 항상
`GET /api/play/session?...&play_type=X`만 호출해 `canResume`을 판정하는데, 이 라우트는
`k_play_sessions`만 본다. 퀴즈마스터는 그룹 2라 이 테이블에 아무 것도 남기지 않으므로
`canResume`이 항상 `false`다. 설사 `true`가 되도록 고치더라도 `handleResume`의 퀴즈마스터
분기가 `handleStart`와 완전히 동일(`/api/quiz/start-handoff` 무조건 호출 → 재차감 + 새 token)해
"재차감 없는 재접속" 액션 자체가 없다.

## 3. 설계 원칙

1. **두 그룹을 하나의 메커니즘으로 억지로 통합하지 않는다.** 그룹 1(k_play_sessions)은 이미
   정답이므로 손대지 않는다. 그룹 2(quizmaster, 그리고 향후 등장할 수 있는 유사한 "외부 위임"
   놀이)는 자신의 진짜 진행 상태 테이블(`quiz_attempts`)을 그대로 신뢰 원본(source of truth)으로
   쓴다 — `k_play_sessions`에 이중 기록하지 않는다(정합성 리스크, YAGNI 위반).
2. **공통 계약은 유지하되 구현은 놀이 타입별로 위임(adapter)한다.** `/api/play/session`의
   응답 shape(`canResume`/`progressState`/`sessionId`)과 `ChildPlayPage`가 그 결과를 쓰는 방식은
   모든 놀이 타입에서 동일해야 한다 — 화면 쪽 코드가 놀이 타입별 데이터 소스를 알 필요는 없다.
   내부적으로만 play_type에 따라 그룹 1(k_play_sessions 조회)과 그룹 2(quiz_attempts 조회, 그룹
   2 놀이가 늘어나면 그 놀이 전용 조회 함수)로 분기한다.
3. **handoff token은 절대 재접속 판단에 관여하지 않는다.** 이미 그렇게 설계돼 있고(1회용, 최초
   진입 인증 전용), 이번 변경도 이 불변식을 유지한다 — token 대신 quiz_attempts 자체를 본다.
4. **재접속은 황금열쇠 소비/환불/완료 콜백 경로를 건드리지 않는다.** 그룹 2의 재접속은 기존
   attempt에 대한 순수 재인증(device_id/session_token 교체)일 뿐, `reward_transaction_id`나
   완료/환불 콜백 흐름과는 무관하다 — 이미 검증된 독립 퀴즈마스터 앱의 `claim` 엔드포인트가
   증거다(황금열쇠 테이블을 전혀 건드리지 않음).
5. **이미 만들어져 검증된 것을 재사용한다.** 독립 퀴즈마스터 앱의
   `GET /api/quiz/attempt/active` + `POST /api/quiz/attempt/[id]/claim`을 그대로 `quiz-play`
   포팅 패턴(K-Bestie 세션 인증으로 교체, RPC/테이블 로직은 원본 유지)으로 이식한다 — 새로
   설계하지 않는다.

## 4. 제안 아키텍처

### 4-A. `/api/play/session` — play_type-aware 어댑터

```
GET /api/play/session?child_id=X&play_type=Y

  if Y in {comic_book, mbti, hairstyle} (그룹 1):
    기존 그대로 k_play_sessions 조회

  if Y === "quizmaster" (그룹 2):
    quiz_attempts에서 이 사용자의 최근 attempt 중
    status in (in_progress, background) AND started_at > now-6h
    를 조회 (독립 앱의 /api/quiz/attempt/active와 동일 조건)
    → canResume = 존재 여부, sessionId = attemptId
```

응답 필드 이름(`canResume`/`progressState`/`sessionId`)은 그대로 유지한다.
`progressState`는 퀴즈마스터의 경우 화면이 실제로 쓰지 않으므로(3단계 참고) `null`로 둬도 된다.

### 4-B. 퀴즈마스터 전용 "재차감 없는 재접속" 엔드포인트 포팅

`app/api/quiz-play/`에 독립 앱의 두 엔드포인트를 이식한다(신규 파일, 기존 `start`/`redeem`과
같은 포팅 패턴 — K-Bestie 세션 인증(`requireChildAccess`)으로 감싸고 RPC/테이블 로직은 원본
그대로):

- `GET /api/quiz-play/attempt/active` — (내부적으로 4-A가 이미 이 조회를 하므로, 이 엔드포인트는
  선택사항이다. 4-A의 조회 결과를 그대로 재사용하면 중복 쿼리를 피할 수 있다 — 구현 시 판단.)
- `POST /api/quiz-play/attempt/[attemptId]/claim` — 독립 앱의 `claim`과 동일: 인증만 확인,
  소유권/만료 확인, `session_token`/`device_id` 원자적 교체, 하이드레이션 페이로드 반환. 황금열쇠/
  handoff token과 무관.

### 4-C. `ChildPlayPage`(화면) 변경

```
handleResume():
  if selectedGame.id === "quizmaster":
    canResume이 true일 때 이미 알고 있는 attemptId(4-A 응답의 sessionId)로
    POST /api/quiz-play/attempt/[attemptId]/claim 호출
    (start-handoff 호출 안 함 → 재차감 없음, 새 token 발급 없음)
    성공 시 writeQuizSessionHandoff({ token: "", childId, attemptId })로
    attemptId를 처음부터 채워서 저장 → router.push("/play/quiz")
    (QuizPlayScreen은 이미 initialAttemptId가 있으면 redeem을 건너뛰고 바로
    하이드레이션하는 내부 로직을 갖고 있음 — 화면 컴포넌트 자체는 수정 불필요)
```

`handleStart`(새로 시작하기)는 변경하지 않는다 — 항상 `start-handoff`(과금)로 새 attempt를
만드는 게 맞다.

### 4-D. QuizPlayScreen 쪽 확인 필요 사항

`QuizPlayScreen`은 현재 `initialAttemptId`가 있으면 `token`을 아예 쓰지 않고 바로 하이드레이션
하는지, 아니면 `token`이 빈 문자열/placeholder일 때 문제가 생기는지 확인이 필요하다(설계 단계
에서는 코드를 읽지 않았음 — 구현 착수 시 먼저 확인). 필요하면 `token`을 옵셔널로 바꾸거나,
claim 성공 응답에 (재사용 목적의) 더미 값을 넣는 대신 컴포넌트가 `initialAttemptId` 존재 시
`token` 필드를 아예 참조하지 않도록 소폭 조정한다.

## 5. 영향받지 않는 것 (명시적으로 유지)

- `reward_transaction_id` 기반 황금열쇠 소유권/환불/완료 콜백 계약 — 변경 없음.
- `quiz_handoff_tokens`의 1회용·60초 TTL·최초 진입 인증 역할 — 변경 없음.
- MBTI/comic_book/hairstyle의 `k_play_sessions` 기반 흐름 — 변경 없음.
- 퀴즈마스터의 진행 저장(`/api/quiz-play/progress`), heartbeat/background 신호 처리 — 변경 없음.

## 6. 구현 범위 (제안, 승인 대기)

1. `app/api/quiz-play/attempt/[attemptId]/claim/route.ts` 신규 — 독립 앱 `claim` 이식.
2. `app/api/play/session/route.ts` — play_type==="quizmaster" 분기 추가(quiz_attempts 조회).
3. `app/child/play/page.tsx` — quizmaster `handleResume` 분기를 claim 호출로 교체.
4. `components/quiz/QuizPlayScreen.tsx` — initialAttemptId 재접속 경로에서 token 미사용 확인/보강
   (필요 시에만).
5. 회귀 검증: (a) 퀴즈마스터 새로 시작 흐름(황금열쇠 정상 차감) (b) 진행 중 이탈 후 재진입 시
   이어하기 표시+재차감 없이 정확한 문제 번호부터 재개 (c) 6시간 만료 후에는 이어하기 미표시
   (d) MBTI/기존 그룹1 흐름 무회귀 (e) 완료/환불 콜백 무회귀.

이 중 1~4는 퀴즈마스터 소유권 흐름(황금열쇠 관련)에 인접한 변경이므로, 착수 전 대표 승인을
받는다 — 특히 2번(`/api/play/session`, 4종 놀이 공용 라우트)은 공유 파일 수정에 해당한다.

## 7. 미결정/후속 과제 (이번 설계 범위 밖)

- comic_book/hairstyle이 실제 구현될 때 `/api/play/consume`과 `/api/play/reserve`+`/api/play/start`
  두 소비 메커니즘 중 어느 쪽을 표준으로 할지 정리 필요(§2-A 참고).
- 그룹 2(외부 위임) 놀이가 퀴즈마스터 외에 추가로 생기면, 4-A의 어댑터를 놀이 타입별 조회
  함수 레지스트리로 일반화할지 검토(현재는 소비자가 하나뿐이라 하드코딩 분기로 충분 — YAGNI).
