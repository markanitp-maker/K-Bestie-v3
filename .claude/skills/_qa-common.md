# 자유대화 계열 QA 공통 기준 (free-chat-qa / word-chain-qa / chosung-game-qa / nonsense-quiz-qa 공용)

> 네 QA 스킬이 공유하는 원칙과 실측 정보. 각 SKILL.md 가 이 파일을 참조한다.
> **여기 적힌 테이블·컬럼·상태값은 2026-08-17 Production 실측이다. 추측이 아니다.**

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

## 6. 금지 사항

- **QA 중 코드를 고치지 마라.** 재현 → 검증 → 증거 → PASS/FAIL → 원인 후보까지가 책임이다.
- Production DB 쓰기 금지. 배포 금지. git commit/push 금지.
- 계정 생성·비밀번호 변경·초기화 금지.
- API key·token·service role key 를 출력·저장·하드코딩하지 마라.
- 존재하지 않는 테이블·컬럼·API 를 추측해 쓰지 마라. 위 실측 스키마를 쓴다.
- **증거 없는 "정상 확인" 금지.** 추측으로 PASS 쓰지 마라.
- 자동화가 막히면 **막혔다고 보고하라.** 우회하지 마라.

## 7. 보고 형식 (공통)

```text
[QA RESULT]
Skill: <스킬명>
Environment: Dev
Child: QA_Child_A (e2e00001-...)
Session: <세션id>

Routing:      PASS/FAIL
Conversation: PASS/FAIL
State:        PASS/FAIL
Persistence:  PASS/FAIL

Overall: PASS/FAIL
```

항목별:
```text
QA-01 PASS — <무엇을 확인했나>
  근거: <DB 행 / 응답 원문 / 로그>

QA-03 FAIL — <증상>
  재현: <절차>
  기대: <기대 결과>
  실제: <실제 결과>
  근거: <쿼리 결과·응답 원문>
  원인 후보: <파일:줄 또는 가설>
```

**FAIL 을 숨기지 마라.** 애매하면 FAIL 로 적고 근거를 남긴다.
