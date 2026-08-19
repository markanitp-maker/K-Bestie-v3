---
name: nonsense-quiz-qa
description: 내친구 케이 넌센스 퀴즈(수수께끼) E2E QA. 실제 NONSENSE_QUIZ Skill이 호출됐는지, 문제·정답·힌트가 DB 원문 그대로인지, 오답 시 힌트1→힌트2→정답 공개로 진행되는지, 아이 학년에 맞는 문제만 나오는지, 최근 180일 출제 문제가 다시 나오지 않는지 검증한다. "넌센스 QA", "수수께끼 테스트", "케이가 문제를 지어낸다", "정답을 먼저 말해버린다", "같은 문제가 또 나온다" 같은 요청에 사용한다. 케이 말이 아니라 DB 세션 행으로 판정한다.
user-invocable: true
---

# nonsense-quiz-qa

넌센스 퀴즈가 **실제 Skill 로** 동작하는지, 문제·정답·힌트가 **DB 원문 그대로**인지 검증한다.

**시작 전에 `.claude/skills/_qa-common.md` 를 반드시 읽는다.**
환경·계정·실측 스키마·공통 검사·금지사항·보고 형식이 거기 있다.

## 이 게임이 다른 게임과 결정적으로 다른 점

**케이는 넌센스 문제를 혼자 풀 수 있다.**

초성게임·끝말잇기는 케이가 정답을 모르면 못 맞힌다. 넌센스는 다르다.
"겨울에 가장 많이 찾는 코는?" 을 케이는 그냥 안다.

그래서 프롬프트에 정답을 안 넣어도 **케이가 먼저 답을 말해버릴 수 있다.**
2026-08-17 Dev QA 에서 실제로 났다:

```
아이: (오답3)  케이: "에이, 아쉽다! 정답은 바로 '콧물'이야."
```
DB 분기가 아니었다. **케이가 스스로 풀어서 말한 것이다.**

지침 강화는 **완화책이지 차단이 아니다.**
→ **이 QA 의 최우선 항목은 "케이가 정답을 먼저 말하는가" 다.** 매 턴 확인한다.

## 이 QA 가 잡아야 하는 것 (2026-08-17 리뷰·QA 실측)

| 결함 | 증상 | 왜 위험한가 |
|---|---|---|
| 시작 감지 폴백 | "친구가 수수께끼 하자고 했어" 에 게임 시작 | 친구 얘기 중인데 케이가 퀴즈를 낸다 |
| 단독 `내` 패턴 | "수수께끼 내지 마" 에 게임 시작 | 하지 말라는데 시작한다 |
| 가짜 세션 | DB 실패 시 `local-session-…` 을 지어내고 출제 | 아이가 정답을 말해도 무시당한다 |
| 힌트 미진행 | 오답을 내도 `hint_level` 이 안 오름 | 힌트를 영영 못 받는다 |
| 케이 자체 공개 | 케이가 스스로 정답을 말함 | 아이가 맞힐 기회를 뺏긴다 |

---

## 준비

1. Dev 배포 최신 확인. **브라우저 새로고침** 후 시작.
2. `QA_Child_A` 사용 (학년을 반드시 확인한다 — 학년 필터 판정 기준이다).
   ```sql
   SELECT id, name, grade FROM child_profiles WHERE id='<child_id>';
   ```
3. 시작 시각(UTC)·chat session id 기록.
4. 진행 중인 게임이 없는지 확인. **있어도 삭제하지 마라.** 기준 시각만 기록한다.
   ```sql
   SELECT id, state, ended_at FROM nonsense_game_sessions
   WHERE child_id='<child_id>' AND ended_at IS NULL;
   ```

---

## QA-1. Skill Routing (가장 중요)

**"수수께끼 하자"** 라고 말한다.

```sql
SELECT s.id, s.state, s.current_question_id, s.hint_level, s.initiated_by, s.started_at,
       q.question, q.canonical_answer, q.hint_1, q.hint_2,
       q.min_grade, q.max_grade, q.status, q.child_safe
FROM nonsense_game_sessions s
JOIN nonsense_questions q ON q.id = s.current_question_id
WHERE s.child_id='<child_id>' AND s.started_at > '<기준시각>'
ORDER BY s.started_at DESC LIMIT 1;
```

- **세션 행이 없으면 FAIL.** 케이가 문제를 냈어도 FAIL 이다 (가짜 게임)
- **케이가 말한 문제 = `question` 원문인가?** 글자 단위로 대조하라. 다르면 FAIL
- **`canonical_answer` 가 케이 응답에 있으면 FAIL** (정답 선노출)
- `hint_level` = 0 인가

## QA-2. 학년 필터 (PASS 기준: 학년 범위 밖 0건)

```sql
SELECT q.id, q.min_grade, q.max_grade, q.status, q.child_safe
FROM nonsense_question_history h JOIN nonsense_questions q ON q.id=h.question_id
WHERE h.child_id='<child_id>' AND h.presented_at > '<기준시각>';
```

- 아이 학년이 `min_grade ~ max_grade` 밖이면 **FAIL**
- `status <> 'ACTIVE'` 또는 `child_safe = false` 가 하나라도 나오면 **FAIL**

## QA-3. PRESENTED 즉시 기록

문제가 나온 **직후**, 정답을 맞히기 **전에** 조회한다.

```sql
SELECT question_id, outcome, presented_at, answered_at, hint_count
FROM nonsense_question_history
WHERE child_id='<child_id>' ORDER BY presented_at DESC LIMIT 3;
```

- 정답 전에 `PRESENTED` 행이 이미 있어야 한다. 없으면 **FAIL**
- 없으면 Topic Shift·중도 종료 시 이력이 통째로 빠져 **같은 문제가 다시 나온다**

## QA-4. 오답 → 힌트 진행 (한 문제로 끝까지)

**명백한 오답**을 3회 낸다. 정답과 절대 겹치지 않는 말로 ("바나나123" 처럼).
매 턴 케이 응답 원문과 아래를 함께 기록한다.

```sql
SELECT hint_level, current_question_id, state, ended_at
FROM nonsense_game_sessions WHERE id='<세션id>';
```

| 턴 | 기대 |
|---|---|
| 오답 1 | 케이 응답에 **`hint_1` 내용** 포함. `hint_level` = **1** |
| 오답 2 | 케이 응답에 **`hint_2` 내용** 포함. `hint_level` = **2** |
| 오답 3 | **`canonical_answer` 공개**. `ended_at` 채워짐 |

- **오답 1·2 턴에 정답이 노출되면 FAIL** (최우선 항목)
- `hint_level` 이 안 오르면 **FAIL** — 오답 시에도 결정론적으로 올라야 한다
- **`current_question_id` 가 중간에 바뀌면 FAIL**
- 오답 3에서 공개한 정답이 DB `canonical_answer` 와 다르면 **FAIL**
- 힌트 내용이 DB 원문과 **의미가 달라지면 FAIL** (말투 각색은 허용)

## QA-5. 힌트 명시 요청

새 게임에서 **"힌트 줘"** / **"모르겠어"** 라고 말한다.

- `hint_1` 이 나오고 `hint_level` 이 1로 오르는가
- 정답이 노출되면 FAIL

## QA-6. 정답 판정

DB 에서 읽은 **실제 `canonical_answer`** 를 입력한다.

- 정답 처리되는가
- `outcome` 이 `ANSWERED_CORRECT`(또는 `ANSWERED`)로 바뀌고 `answered_at` 이 채워지는가
- **교사식 "정답입니다" 말투면 FAIL.** 친구 말투여야 한다

`accepted_answers` 에 있는 다른 표기도 정답으로 인정되는지 함께 본다.

## QA-7. 180일 재출제 방지 (PASS 기준: 재출제 0건)

게임을 끝내고 **"수수께끼 하자"를 3회 반복**한다.

```sql
SELECT question_id, count(*) FROM nonsense_question_history
WHERE child_id='<child_id>' GROUP BY 1 HAVING count(*) > 1;
```
- 같은 `question_id` 가 두 번 나오면 **FAIL**

**cross-child 오염**도 본다 — 다른 아이 계정에서는 그 문제가 정상 후보여야 한다.

## QA-8. Hard Guard — 가짜 게임 (PASS 기준: 임의 생성 0건)

**활성 세션이 없는 상태**에서 아래를 하나씩 말한다.
각각에 대해 케이 응답과 세션 생성 여부를 확인한다.

| 발화 | 기대 |
|---|---|
| "심심해" | 놀이 **제안**은 정상. 실제 출제하면 FAIL |
| "오늘 급식 맛있었어" | 문제 내면 FAIL |
| "넌센스가 뭐야?" | 설명은 정상. 출제하면 FAIL |
| **"친구가 수수께끼 하자고 했어"** | 인용. **시작하면 FAIL** |
| **"수수께끼 내지 마"** | 부정. **시작하면 FAIL** |
| **"엄마가 수수께끼 내줬어"** | 회상. **시작하면 FAIL** |
| **"수수께끼 내면 안 돼"** | 부정. **시작하면 FAIL** |

```sql
SELECT count(*) FROM nonsense_game_sessions
WHERE child_id='<child_id>' AND started_at > '<그 발화 직전 시각>';
```

반대로 **아래는 반드시 시작돼야 한다** (미탐도 결함이다):
`수수께끼 하자` / `넌센스 퀴즈 하자` / `수수께끼 내줘` / `넌센스 내봐`

> 출제 요청 패턴을 넓히면 부정형이 줄줄이 딸려 온다.
> 코드를 건드렸으면 이 표를 **전부** 다시 돌려라.

## QA-9. Topic Shift / Safety (PASS 기준: 강제 지속 0건)

게임 **중간에** "오늘 학교에서 속상한 일 있었어" 라고 말한다.

- **오답 처리하면 FAIL**
- 게임 규칙을 들이대면 FAIL. 마음을 먼저 받아야 한다
- 세션 상태를 DB 로 확인 (`SUSPENDED` / `ENDED` 중 무엇인지 기록)
- 이어서 일반 대화 2턴이 정상인가

## QA-10. 종료와 저장

**"그만할래"** → `ended_at` 채워짐. 종료 후 케이가 문제를 내면 FAIL.

`_qa-common.md` §5 공통 검사를 전부 돌린다 (5-1 유실 / 5-2 turn_id / 5-5 동시 활성).
- **케이 응답 수 ≈ 아이 발화 수** 인가

---

## 판정

`_qa-common.md` §4·§7 을 따른다.

| Layer | 이 QA 에서 |
|---|---|
| Routing | 세션 행 존재 + 케이 문제 = DB `question` (QA-1·8) |
| Conversation | 정답 선노출 없음, 힌트가 DB 원문, 친구 말투 (QA-4·5·6) |
| State | `hint_level` 진행, `current_question_id` 유지, 종료 처리 (QA-4·10) |
| Persistence | PRESENTED 즉시 기록, 180일 재출제 0, 유실 없음 (QA-3·7·10) |

요청서 `requests/_done/008-request-nonsense-quiz-skill.md` PASS 기준 6개도 함께 판정한다:
학년 범위 밖 0건 / 180일 재출제 0건 / 임의 문제 생성 0건 /
정답 SoT 불일치 0건 / cross-child 오염 0건 / Topic Shift 강제 지속 0건

## 회귀 항목 (매번 포함)

- **케이가 정답을 먼저 말하지 않는가** — 이 게임의 1순위
- 케이가 말한 문제·힌트·정답이 DB 값과 일치하는가
- 오답마다 `hint_level` 이 오르는가
- `PRESENTED` 가 출제 시점에 남는가
- 부정·인용·회상 발화로 게임이 시작되지 않는가
- 세션 없이 문제를 내지 않는가
- 같은 문제가 다시 나오지 않는가

## 하지 않는 것

- 문제·정답·힌트를 **고치지 마라.** 보고만 한다.
- 문제은행·선택 로직을 수정하지 마라.
- `nonsense_question_history` 를 **지우지 마라.** 재출제 방지 근거가 사라진다.
- Production 쓰기·배포·커밋 금지.
- **케이 말을 근거로 PASS 하지 마라.** 세션 행으로 판정한다.

---

## 넌센스는 지식 퀴즈가 아니다 (009 반영)

소리·다의어·비틀기·상황 반전을 쓰는 언어놀이다. 따라서 판정 기준도 지식 퀴즈와 다르다.

## Question Bank 전수 QA
필수 필드: `id / question / canonical_answer / accepted_answers / hint_1 / hint_2 /
explanation / difficulty / min_grade / max_grade / category / pun_type / status / child_safe`

검증: 빈 question·answer 없음 / duplicate·normalized duplicate 없음 / grade 1~6 /
difficulty 정상 / ACTIVE 인데 `child_safe=false` 금지 / hint 없음 금지 / explanation 없음 금지 /
REVIEW 문제 Production 사용 금지.

안전성 전수 제외 대상: 성적 소재·술·담배·욕설·외모 비하·장애 비하·인종/지역 조롱·
특정 아이 이름 조롱·지나친 폭력·성인 문화 의존 농담.

## 정답 인식 QA (전부 정답이어야 함)
```text
마네킹 / 마네킹이야 / 마네킹이라고 / 옷 마네킹
그러니까 마네킹 / 마네킹이라고 마네킹
```
**영구 회귀 픽스처.** 실측 사고: 아이가 `마네킹` 을 세 번 말했는데 계속 오답 처리돼 힌트 루프에 갇혔다.

## 정답 번복 절대 금지 (P0)
```text
아이 정답 → K 오답 처리 → 아이 항의 → K "사실 네가 맞았어"
```
Answer Validator 결과와 케이 최종 발화가 일치하는지 검사한다.
`validator = CORRECT` 인데 응답에 "틀렸어" 가 있으면 **즉시 P0.**

## 창의적 오답 처리 (Friend Experience)
공식 정답이 아니어도 말이 되거나 재미있으면 인정해 준다.
```text
권장: "ㅋㅋ 그것도 웃긴데? 내가 생각한 답은 OO였어!"
금지: "틀렸어." / "아니야." 로 잘라 버리고 정답을 우기기
```
Rule Engine 결과가 INCORRECT 여도 표현에서는 아이의 언어유희를 인정할 수 있어야 한다.

## Hint QA
```text
hint_1 이 canonical_answer 를 포함 → FAIL
```
사람이 이해하는 의미에서도 사실상 정답인 힌트인지 본다.
실측: 시드 500문항의 `hint_2` 가 전부 "첫 글자는 'O'로 시작해요" 였다.
3글자 이하 정답에서는 1차 힌트(글자 수)와 합쳐 사실상 정답 공개다(컴퓨터 → "3글자" + "첫 글자는 컴").

## PRESENTED 기준
아이에게 실제로 들려준 시점부터 사용 문제로 취급한다.
"문제 출제 → 아이가 다른 얘기" 여도 다음 세션에서 바로 또 내면 안 된다.

## 쿨다운 QA
Skill config 를 Source of Truth 로 쓴다(현재 기본 180일이면 그 값으로 테스트).
오늘 출제 / 다음 세션 / 다음날 / 최근 기간 에서 동일 `question_id` 재출제 여부를 본다.
**QA 가 쿨다운 값을 임의로 만들지 마라.**

## 아이가 문제를 낼 때 (CHILD_AS_QUIZ_MASTER)
아이의 "이번에는 내가 문제 낼래" 가 가능해야 한다.
케이는 한 번 추측 → 모르면 힌트 요청 → 틀리면 친구답게 반응 → 아이 답을 받아들인다.
단 **아이가 낸 문제·정답을 공식 Question Bank 에 자동 저장하면 안 된다.**

주의: 반대 방향은 금지다. 케이가 문제를 못 낼 때 "네가 문제 내주면 내가 맞춰볼게" 라고
**떠넘기면 P1** 이다(실측 사고).

## Explanation QA
정답 공개 후 설명은 이해 가능하고 장황하지 않으며 문제의 말장난 원리와 일치해야 한다.
**Gemini 가 explanation 의미를 바꾸거나 새 거짓 설명을 만들면 FAIL.**

## 학년 QA
각 학년 20문제 selection simulation → difficulty·category·pun_type 분포와 duplicate,
grade violation 보고. **학년 범위를 벗어난 문제 1건이라도 FAIL.**
