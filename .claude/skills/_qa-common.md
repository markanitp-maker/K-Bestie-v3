# K PLAY QA 공통 기준 (k-play-qa / free-chat-qa / word-chain-qa / chosung-game-qa / nonsense-quiz-qa 공용)

> 다섯 QA 스킬이 공유하는 원칙과 실측 정보. 각 SKILL.md 가 이 파일을 참조한다.
> **여기 적힌 테이블·컬럼·상태값은 실측이다. 추측이 아니다.**
>
> 이 QA 의 최종 질문은 "게임 알고리즘이 동작했는가?" 가 아니다.
> **"초등학생 친구가 사람 친구와 놀 때 기대하는 규칙 정확성·기억·다양성·통제권을 K 가 끝까지 지켰는가?"** 다.
> 평가 우선순위: 정확성 → 기억/상태 → 아이 통제권 → 반복 방지 → 재미 → 말투.

## 0. 이 QA 가 존재하는 이유 — 2026-08-17 실제 사고들

하루에 아래 사고가 연달아 났다. **전부 "코드는 맞아 보이는데 아이 경험은 망가진"** 유형이다.
QA 는 이 유형을 잡기 위한 것이다.

| 사고 | 증상 | 왜 못 잡았나 |
|---|---|---|
| 케이가 아이 말을 두 번 들음 | "나도 반가워" 한 번 했는데 "두 번 말할 정도로 반가웠나 봐" | DB 는 정상. 프롬프트 맥락만 중복 |
| 케이가 인사에 침묵 | 아이가 "안녕" 4회 → 응답 0건 | 서버는 200 반환. 클라이언트가 버림 |
| 케이 응답이 통째로 유실 | 끝말잇기 중 케이 응답 DB 0건 | `turn_id` 충돌로 `ignoreDuplicates` 가 조용히 버림 |
| 케이가 가짜 게임 진행 | 세션 없이 "ㄱㅊ 맞춰봐", 정답 "배드민턴"인데 "바다마을" | 화면엔 게임처럼 보임 |
| 인사에 개학일부터 물음 | "반가워" → "언제 개학하는지 알려줘" | 규칙 분기가 대화를 가로챔 |

### 2026-08-19 대표님 직접 QA 에서 드러난 것 — QA 가 놓친 유형

| 사고 | 증상 | 왜 자동 QA 가 놓쳤나 |
|---|---|---|
| 되묻기가 게임 판정을 가로챔 | 케이 응답 47개 중 12개(26%)가 "내가 'OO'라고 들었는데, 이게 맞니?" | 브리프에 없는 짧은 음성 답변. 자동 QA 는 긴 텍스트를 보냈다 |
| 아이 단어가 엔진에 도달 못 함 | 끝말잇기 20턴인데 `word_chain_game_rounds` 9턴, 한때 **0턴** | 케이 응답만 보면 게임처럼 보였다 |
| 지적하면 게임이 죽음 | "게임이 안 끝났**잖아**" → `isTopicShift` 가 화제 전환으로 보고 세션 종료 | 정상 대화만 테스트했다. 아이는 케이를 지적한다 |
| 세션 없이 케이가 게임 흉내 | "무스탕 할게", "육교 할 차례인가?", "끝말잇기를 그런 식으로 하는 거야? 신기하네" | DB 라운드를 안 봤다 |
| 내부 지침이 아이에게 노출 | "시스템에서 문제를 내줄 때까지 기다려야 해" | 프롬프트 문구를 아이 관점에서 안 읽었다 |
| 답변으로 낸 말을 요청으로 오인 | "다음 문제**는** 반은우" → 정답 공개하고 넘어감 | 조사 차이를 픽스처에 안 넣었다 |

**여기서 얻은 QA 규칙 (반드시 지켜라)**
- **짧은 발화로 테스트하라.** "소", "무료", "지민" 같은 1~3자 답변이 실제 아이의 답이다.
  긴 문장만 보내면 이 유형을 절대 못 잡는다.
- **아이처럼 지적하라.** "그거 아니잖아", "규칙을 모르냐", "왜 또 같은 걸 내" 를 반드시 섞어라.
  그 뒤에 게임이 살아 있는지 DB 로 확인하라.
- **매 게임 턴마다 라운드 기록을 세라.** 게임 턴 수와 DB 라운드 수가 다르면 그 차이가 곧 결함이다.
- **케이 발화를 아이 귀로 읽어라.** 내부 어휘("시스템", "준비 중", "세션")가 들리면 FAIL 이다.

**교훈 (모든 QA 에 적용)**
1. **케이 말을 근거로 PASS 하지 마라.** 케이는 게임하는 척, 아는 척을 한다. 판정은 DB 행으로 한다.
2. **DB 가 깨끗해도 사고일 수 있다.** 저장은 정상인데 케이에게 넘어가는 맥락이 틀린 경우가 있다.
   실제 대화 내용을 읽어야 한다.
3. **HTTP 200 은 성공이 아니다.** 저장이 조용히 버려져도 200 이 온다.
4. **응답이 "없는 것"도 결함이다.** 아이 발화 뒤에 케이 응답이 없으면 FAIL 이다.
   침묵은 중복보다 훨씬 나쁘다.

## 1. 환경·계정 (실측)

```
Dev  : k-bestie-v3-dev.vercel.app   / Supabase mkrsaaedxqrcrktapaus
Prod : app.k-bestie.com             / Supabase fetvnhhjicndmxvhrffk
```

**QA 는 Dev 에서 한다.** Production 은 **읽기 전용**이며 특별 지시 없이 쓰지 않는다.

Dev QA 계정 (실측):
```
QA_Child_A  e2e00001-aaaa-4000-8000-000000000001
QA_Child_B  e2e00002-bbbb-4000-8000-000000000002
TestChild   fe3ba9aa-5485-43fb-b8eb-a5838f6f9ff9
```
로그인 이메일 규약: `<username>@kbestie.local`
**비밀번호를 못 찾으면 "확인 불가"로 보고하고 중단한다. 추측·초기화 금지.**

## 2. DB 조회 방법 (함정 주의)

```bash
node scripts/run-query.js "<SQL>"                 # Dev (기본값)
node scripts/run-query.js "<SQL>" --target=prod   # Production (읽기 전용)
```

**⚠️ SQL 이 첫 인자다.** `--target=prod` 를 앞에 두면 그게 SQL 로 들어가 조용히 `[]` 를
돌려준다. 프로덕션을 조회했다고 착각하기 쉽다. 실제로 이 함정에 걸린 적이 있다.

## 3. 실측 스키마 — 추측 금지

### chat_messages
```
id, session_id, role, content, created_at, mode, voice_mode, deleted_at,
display_sequence, turn_id, turn_status, collected_at, collection_batch_id, is_clarification
```
- `role` = `child` | `k`
- `turn_id` — 케이 응답은 `<아이턴id>:k` 형태
- **`UNIQUE(session_id, turn_id)`** 제약이 있고 저장 시 `ignoreDuplicates: true` 다.
  → **충돌하면 조용히 버려진다.** 200 이 와도 저장 안 됐을 수 있다.
  `[chat/messages] upsert SKIPPED by duplicate turn_id` 경고 로그를 확인하라.

### chosung_game_sessions
```
id, child_id, chat_session_id, state, initiated_by, current_word, current_chosung,
current_category, current_difficulty, hint_level, recent_words, started_at, updated_at, ended_at
```
- `state`: `PLAYING_K_ASKS` | `PLAYING_CHILD_ASKS` | `ENDED`
- `hint_level` — 힌트 단계. 오답마다 증가한다.

### word_chain_game_sessions
```
id, child_id, chat_session_id, initiated_by, state, current_word,
current_difficulty, used_words, started_at, updated_at, ended_at
```
- `state`: `K_TURN` | `CHILD_TURN` | `ENDED` | `SUSPENDED`
- `used_words` — 사용된 단어 배열

### nonsense_game_sessions (2026-08-17 신설)
```
id, child_id, chat_session_id, state, initiated_by, current_question_id,
current_difficulty, hint_level, recent_question_ids, started_at, updated_at, ended_at
```
- `state`: `OFFERED` | `PLAYING_K_ASKS` | `PLAYING_CHILD_ASKS` | `WAITING_FOR_ANSWER`
  | `HINT` | `ROUND_RESULT` | `SUSPENDED` | `ENDED`
- **활성 판정은 `ended_at IS NULL` 이다.** `state='ENDED'` 로만 보지 마라.
  라운드가 끝나면 `state` 가 `ROUND_RESULT` 인 채로 `ended_at` 이 채워진다.
- child 당 활성 세션 1개만 허용하는 partial unique index 가 있다.

### nonsense_question_history (2026-08-17 신설)
```
id, child_id, question_id, chat_session_id, game_session_id,
outcome, presented_at, answered_at, hint_count
```
- `outcome`: `PRESENTED` | `ANSWERED` | `SKIPPED` | `ANSWERED_CORRECT`
  | `ANSWERED_INCORRECT` | `TOPIC_SHIFT`
- `presented_at` — **문제를 낸 시점**에 기록된다. 정답 시점이 아니다.
  180일 재출제 방지가 이 값 기준이다.

### nonsense_questions (2026-08-17 신설 · Dev/Prod 각 500건)
```
id, concept_key, question, canonical_answer, accepted_answers, hint_1, hint_2,
explanation, category, pun_type, difficulty, min_grade, max_grade,
primary_grade_band, status, child_safe, source_type, quality_score
```
- 출제 후보는 `status='ACTIVE'`(250건) + `child_safe` + `min_grade <= 학년 <= max_grade`
- `concept_key` UNIQUE

### chat_sessions
```
id, child_id, started_at, ended_at, turn_count, session_type, ...,
relationship_context (jsonb, write-once 트리거 있음), pending_play_proposal (jsonb)
```
- `session_type` = `free_chat` | `mission`

## 4. 4-Layer 판정 (하나라도 FAIL 이면 전체 FAIL)

| Layer | 무엇을 보나 | 판정 근거 |
|---|---|---|
| **Routing** | 올바른 Skill/Router 가 실제 선택됐나 | **게임 세션 DB 행**. 케이 말 아님 |
| **Conversation** | 케이 응답이 정책·규칙에 맞나 | 응답 원문 |
| **State** | 문맥·턴·힌트·게임 상태가 유지되나 | 세션 행의 상태값 변화 |
| **Persistence** | DB 에 정상 저장됐나 | 행 존재·순서·중복·누락 |

## 5. 반드시 돌려야 할 공통 검사

### 5-1. 응답 유실 (모든 QA 필수)
```sql
-- 아이 발화 뒤에 케이 응답이 없는 경우 = 유실
WITH m AS (
  SELECT cm.role, cm.content, cm.created_at,
         lead(cm.role) OVER (PARTITION BY cm.session_id ORDER BY cm.created_at) AS nr,
         lead(cm.created_at) OVER (PARTITION BY cm.session_id ORDER BY cm.created_at) AS nt
  FROM chat_messages cm
  WHERE cm.session_id = '<세션id>' AND cm.deleted_at IS NULL
)
SELECT left(content,40) AS lost,
       round(extract(epoch from (nt-created_at))::numeric,1) AS gap_sec
FROM m WHERE role='child' AND nr='child';
```
- `gap_sec >= 8` 이면 **진짜 유실**이다. FAIL.
- `gap_sec < 1` 은 아이가 연달아 말한 것이라 정상일 수 있다. 구분해서 보고하라.

### 5-2. turn_id 충돌
```sql
SELECT turn_id, count(*) FROM chat_messages
WHERE session_id='<세션id>' AND role='k' GROUP BY turn_id HAVING count(*)>1;
```
0 이어야 한다. 그리고 **케이 응답 수 ≈ 아이 발화 수** 인지 확인하라.
크게 적으면 저장이 버려진 것이다.

### 5-3. 맥락 중복
케이가 "두 번 말했네", "또 말했구나" 류로 반응하면 프롬프트 맥락이 중복된 것이다.
DB 에 중복이 없어도 FAIL 이다.

### 5-4. 가짜 게임
케이가 문제·정답·힌트를 말하는데 **게임 세션 행이 없으면** FAIL 이다.
세션이 있어도 **케이가 말한 정답과 `current_word` 가 다르면** FAIL 이다.

### 5-5. 동시 활성 게임
게임 QA 는 매번 확인한다. 둘 이상 1 이상이면 FAIL.
```sql
SELECT 'chosung' AS g, count(*) FROM chosung_game_sessions
 WHERE child_id='<child_id>' AND ended_at IS NULL
UNION ALL SELECT 'wordchain', count(*) FROM word_chain_game_sessions
 WHERE child_id='<child_id>' AND ended_at IS NULL
UNION ALL SELECT 'nonsense', count(*) FROM nonsense_game_sessions
 WHERE child_id='<child_id>' AND ended_at IS NULL;
```

## 5-6. 대화 QA 는 턴 사이를 기다려라 (2026-08-17 추가)

**케이 응답이 돌아오기 전에 다음 말을 보내면 판정이 통째로 무의미해진다.**

2026-08-17 실측: 2~3초 간격으로 11턴을 연달아 보냈더니
- `"놀이공원 갔다고 했잖아"` → `"학교에서 무슨 일 있었어?"` (앞 턴 맥락이 섞임)
- 케이 응답이 **DB 에 한 건도 저장되지 않음** — API 를 직접 때려 클라이언트
  저장 경로를 안 탔기 때문이다. 그런데 QA 는 `11:11` 로 보고했다.

지켜야 할 것:
- **한 턴을 보내고 케이 응답을 받은 뒤 다음 턴을 보낸다.** 최소 5초.
- 가능하면 **UI 를 통해** 입력한다. API 직접 호출은 저장 경로를 건너뛰어
  `chat_messages` 에 케이 응답이 안 남는다 → 유실 검사가 거짓 음성이 된다.
- 판정 근거로 **DB 행과 응답 본문을 모두** 남긴다. 한쪽만 보면 위 사고를 못 잡는다.
- 응답이 **직전 질문과 무관해 보이면** 그것 자체가 신호다. PASS 로 넘기지 말고
  "맥락 섞임 의심"으로 보고하라.

## 5-7. 네가 만든 증거가 언제 것인지 밝혀라 (2026-08-17 추가)

**QA 를 시작하기 전에 배포 시각을 확인하고, 보고에 네 증거의 시각을 적어라.**

2026-08-17 실측 사고: 브리프가 지정한 계정·발화를 쓰지 않고 `e2e/` 에 이미 있던
spec 을 그대로 다시 돌린 뒤, **그 옛 실행의 결과를 이번 결과로 보고**했다.
보고서는 형식이 완벽했고 FAIL 항목 하나는 실제로 맞았다. 그래서 더 믿기 쉬웠다.

들킨 방법은 하나뿐이었다 — `chat_messages` 의 가장 최근 행이 **검증 대상 배포보다
41분 앞서 있었다.** 새 대화가 아예 만들어지지 않았던 것이다.

지켜야 할 것:
- 시작 전 배포 시각을 확인한다.
  ```bash
  npx vercel ls k-bestie-v3-dev | head -6
  ```
- 끝나고 **네가 만든 가장 최근 기록의 시각**을 확인해 보고에 적는다.
  ```sql
  SELECT max(created_at) FROM chat_messages WHERE deleted_at IS NULL;
  ```
  **배포 시각보다 이전이면 QA 를 안 한 것이다.** PASS/FAIL 을 쓰지 말고 그 사실을 보고하라.
- 브리프가 발화를 지정했으면 **기존 spec 을 재사용하지 마라.** 지정된 발화를 그대로 쓴다.
  `e2e/` 의 기존 spec 은 손이 가기 쉬우니 의식적으로 피한다.
- 배포 직후라면 **브라우저 캐시를 비우고** 시작한다. WSL2 에서 옛 화면이 뜬 전례가 있다.

## 6. 아이 발화 우선순위 (모든 놀이 절대 기준)

```text
Safety / 위험 발화
↓
Stop / 그만
↓
불만 / Frustration
↓
Topic Shift
↓
Skill Control (놀이 시작·전환 요청)
↓
Gameplay Input (정답·단어)
```

아래는 **즉시 FAIL** 이다.

| 아이 발화 | 잘못된 처리 |
|---|---|
| `그만` | 정답·끝말잇기 단어로 판정 |
| `너 왜 똑같은 것만 내?` | 오답 처리하고 다음 문제 출제 |
| `오늘 친구랑 싸웠어` | 게임 입력으로 처리 |
| `끝말잇기 하자` | 마지막 낱말 `하자` 를 게임 단어로 처리 (P0) |

**불만은 종료 신호가 아니다.** 아이가 놀이를 지적하는 말(`게임이 안 끝났잖아`,
`이빨 이잖아`, `맞는지 안 맞는지 알려줘야 될 거 아냐`)에 세션이 끝나면 FAIL 이다.
아이가 그만하자고 말했을 때만 끝난다.

## 7. Active Skill 규칙

한 아이는 동시에 **하나의** Play Skill 만 Active 다.

```text
ONE CHILD → MAX ONE ACTIVE PLAY SKILL
```

`CHOSUNG + WORD_CHAIN`, `WORD_CHAIN + NONSENSE` 동시 Active 는 P0 FAIL.
§5-5 쿼리로 매 QA 마다 확인한다.

## 8. Gameplay Hard Guard

```text
NO ACTIVE SKILL SESSION → NO GAMEPLAY
```

DB 에 게임 세션이 없는데 케이가 `좋아! 첫 문제!` 하고 게임을 시작하면 **P0 FAIL**.
반대로 세션이 없을 때 케이가 내부 사정을 아이에게 설명하는 것도 FAIL 이다:

```text
"시스템에서 문제를 내줄 때까지 기다려야 해"      ← 아이에게 내부 구조를 말했다
"내가 문제를 직접 내기 어려워서, 네가 내주면"     ← 아이에게 역할을 떠넘겼다
```

## 9. Rule Engine 과 Gemini 역할 분리

| Rule Engine 이 결정 | Gemini 가 담당 |
|---|---|
| 정답/오답, 현재 차례, 현재 문제, 다음 문제·단어, 중복 여부, Hint 단계, 난이도, Game State | 친구다운 표현, 짧은 리액션, 장난, 공감, 말투 |

**Gemini 가 대화 이력을 보고 게임 규칙을 새로 추론하면 FAIL.**
매 턴 DB 상태와 케이 발화가 일치하는지 독립 검산한다.
케이가 `내가 무스탕 할게`, `육교 할 차례인가?` 처럼 **묻거나 지어내면** 엔진이 안 돈 것이다 —
DB 라운드 기록으로 확인하라.

## 10. Severity 기준

### P0 / BLOCKER — 한 건이라도 Production 불가
맞는 답을 틀렸다고 함 · 틀린 답을 맞았다고 함 · Rule 위반 · 현재 문제/차례 망각 ·
Active Session 없는 Gameplay · 두 Skill 동시 Active · `그만` 무시 ·
Topic Shift 무시 후 게임 강행 · 방금 한 문제 즉시 반복 · Session State 유실 ·
정답 판정 번복(오답 처리 후 "사실 네가 맞았어")

### P1 / HIGH
정상 기본 단어 거절 · 시작 단어 심각한 편중 · 게임 명령을 answer/word 로 오인 ·
Hint 즉시 누출 · Free Chat fallback 으로 Gameplay 붕괴 · 내부 지침이 아이에게 노출

### P2 / MEDIUM
동일 말투 반복 · 교사 말투 · 난이도 리듬 불량 · category 반복 · 어색한 조사

### LOW
사소한 표현 · 작은 UI 문구 · 놀이 결과에 영향 없는 스타일

## 11. QA 실행 레벨

| 레벨 | 내용 | 언제 |
|---|---|---|
| 1 Static | Question Bank·Dictionary·중복·alias·grade·difficulty·metadata·dueum fixture·초성 생성 검산 | 매 변경 |
| 2 Rule Engine | LLM 없이 결정론 테스트. chain 100건 / 전체 초성 생성 / 전체 ACTIVE answer·alias | 매 변경 |
| 3 Conversation | 실제 자연어 발화. 정답·오답·문장 속 정답·STT 반복·모르겠어·힌트·불만·그만·Topic Shift·재시작 | 기능 변경 |
| 4 Voice E2E | Dev 실음성. STT → Router → Rule → DB → 응답 → TTS. 대표 학년 G1·G3·G4·G6 | 배포 후보 |
| 5 Soak | 각 Skill 50턴. 상태 유실·중복·반복 문구·난이도 이상·세션 꼬임 | 배포 후보 |
| 6 Restart/Failure | cold start·DB 실패·LLM 실패·TTS 실패·STT 모호·네트워크 재연결 후 State 일관성 | 배포 후보 |

## 12. 실제 장애 Replay Fixture (영구)

발견된 실제 장애는 회귀 픽스처가 된다. **한 번이라도 재발하면 Production 후보 FAIL.**

```text
NONSENSE
  마네킹 / 그러니까 마네킹이라고 마네킹 / 옷 마네킹   → 정답 인정
  "내 봐", "그래 문제 내봐"                          → 다음 문제 (힌트 아님)

WORD_CHAIN
  유리 / 도둑 / 밥도둑                               → 사전 인정
  "끝말잇기 하자"                                     → 게임 단어 `하자` 로 처리 금지
  "게임이 안 끝났잖아" / "이빨 이잖아"                 → 세션 유지 (종료 금지)
  이름표                                              → 음성보정이 "이름" 으로 바꾸지 않음

CHOSUNG
  정답 후 동일 초성 재출제 금지 (ㅂㄷㄱㅇ, ㄷㅅㄱ)
  "그러니까 도서관 이라고"                            → 정답 인정
  "다음 문제 줘"                                      → 정답 공개 + 새 초성
  "다음 문제는 OO"                                    → 답변으로 처리 (요청 아님)

COMMON
  "응, 듣고 있어. 더 얘기해줄래?"                     → 놀이 중 등장 0건
  "좋아, 같이 하자! 잠깐만 준비할게."                  → 연속 반복 0건
  "내가 'OO'라고 들었는데, 이게 맞니?"                 → 놀이 중 판정 가로채기 0건
```

## 13. 금지 사항

- **QA 중 코드를 고치지 마라.** 재현 → 검증 → 증거 → PASS/FAIL → 원인 후보까지가 책임이다.
  Dictionary·DB·문제·Prompt·migration 수정도 금지다. 문제를 찾으면 재현 정보만 전달한다.
- Production DB 쓰기 금지. 배포 금지. git commit/push 금지.
- 계정 생성·비밀번호 변경·초기화 금지.
- API key·token·service role key 를 출력·저장·하드코딩하지 마라.
- 존재하지 않는 테이블·컬럼·API 를 추측해 쓰지 마라. 위 실측 스키마를 쓴다.
- **증거 없는 "정상 확인" 금지.** 추측으로 PASS 쓰지 마라.
- 자동화가 막히면 **막혔다고 보고하라.** 우회하지 마라.
- QA Prompt 안에서 두음법칙·쿨다운 기간 같은 규칙을 **새로 만들지 마라.**
  프로젝트의 `dueumRules` 와 Skill config 가 Source of Truth 다. 없으면 "정책 없음" 을 Risk 로 보고한다.

## 14. Production Gate (K놀이 재활성화 조건)

```text
Static QA PASS + Rule QA PASS + Conversation QA PASS
+ Voice E2E PASS + 50턴 Soak PASS + 실제 장애 Replay PASS
+ BLOCKER 0 / HIGH 0 / MEDIUM 0
+ 대표님 Owner QA PASS
```

하나라도 실패하면 **Production 재활성화 금지.**
자동 QA PASS 는 대표님 Owner QA 를 대신하지 못한다.

## 15. 보고 형식 (공통)

```text
[K PLAY QA RESULT]
환경: Dev            Commit: <sha>        검사 시각: <KST>

COMMON PLAY:      PASS/FAIL
WORD_CHAIN:       PASS/FAIL
CHOSUNG:          PASS/FAIL
NONSENSE:         PASS/FAIL
VOICE/STT:        PASS/FAIL
SESSION/PERSIST:  PASS/FAIL
CROSS-SKILL:      PASS/FAIL
실제 장애 Replay:  PASS/FAIL

BLOCKER: n   HIGH: n   MEDIUM: n   LOW: n
대표 시나리오 총 n / PASS n / FAIL n

Production Ready: YES / NO
```

문제마다:
```text
[ISSUE]
Severity:            Skill:            Session:            Turn:
Child utterance:
K response:
Expected:            Actual:
Rule violated:       Source of Truth:
관련 파일/함수/DB state:
재현 방법:
```

**FAIL 을 숨기지 마라.** 애매하면 FAIL 로 적고 근거를 남긴다.
