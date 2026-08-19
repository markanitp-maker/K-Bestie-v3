---
name: word-chain-qa
description: 내친구 케이 끝말잇기 E2E QA. 실제 끝말잇기 Skill이 호출됐는지, 끝글자 규칙이 지켜지는지, 단어 난이도가 초등학생에게 맞는지, 게임 상태와 사용 단어가 DB에 정상 유지되는지를 실제 10턴 이상 플레이로 검증한다. "끝말잇기 QA", "끝말잇기 테스트", "케이가 끝말잇기를 이상하게 한다", "없는 단어라고 한다" 같은 요청에 사용한다. 케이 말이 아니라 DB 세션 행으로 판정한다.
user-invocable: true
---

# word-chain-qa

끝말잇기가 **실제 Skill 로** 동작하는지 검증한다.
케이가 게임하는 척만 하는 사고가 실제로 있었으므로, **판정은 DB 세션 행으로 한다.**

**시작 전에 `.claude/skills/_qa-common.md` 를 반드시 읽는다.**

## 이 QA 가 잡아야 하는 것 (2026-08-17 실제 사고)

```
아이: "야 너 끝말잇기 해 봐"   → 케이 응답 DB 0건 (화면엔 보였음)
아이: "지렁이"                 → 케이 응답 없음
아이: "여기"                   → 케이 응답 없음
케이: "기로 시작하는 단어가 없어"   ← 사전에 기린·기차·기자 등 8개 있음
```
Skill 은 정상이었다. **케이 응답이 저장에서 버려져** 다음 턴에 맥락을 잃은 것이다.

---

## 준비

1. Dev 배포 최신 확인. **브라우저 새로고침** 후 시작.
2. `QA_Child_B` 사용 (자유대화 QA 와 계정을 나눠 간섭을 줄인다).
3. 시작 시각·세션 id 기록.

사전 확인 (판정 기준이 된다):
```bash
npx tsx -e '
import {WORD_CHAIN_DICTIONARY, BY_FIRST_SYLLABLE} from "@/lib/k-conversation/wordChain/dictionaryIndex";
console.log("사전:", WORD_CHAIN_DICTIONARY.length);
'
```
**"단어가 없다"는 케이 주장은 사전을 직접 조회해 반증한다.**

---

## QA-1. Skill Routing (가장 중요)

**"케이야 끝말잇기 하자"** 라고 말한다.

DB 로 판정한다:
```sql
SELECT id, state, current_word, used_words, initiated_by, started_at
FROM word_chain_game_sessions
WHERE child_id='<child_id>' AND started_at > '<시작시각>'
ORDER BY started_at DESC LIMIT 1;
```

- **세션 행이 없으면 FAIL.** 케이가 단어를 냈어도 FAIL 이다 (가짜 게임)
- 케이가 말한 첫 단어와 `current_word` 가 **일치**하는가? 다르면 FAIL
- `state` 가 `CHILD_TURN` 인가 (케이가 먼저 냈으므로 아이 차례)

## QA-2. 10턴 이상 진행

케이 단어의 **마지막 글자로 시작하는** 단어를 10번 이어간다.

매 턴 확인:
- 케이가 받아주는가
- 케이 단어의 첫 글자 = 아이 단어의 끝 글자 (두음법칙 적용 시 허용 범위 확인)
- `used_words` 가 **누적**되는가
  ```sql
  SELECT state, current_word, used_words, current_difficulty
  FROM word_chain_game_sessions WHERE id='<세션id>';
  ```
- `current_word` 가 매 턴 갱신되는가
- **아이가 낸 단어가 `used_words` 에 반영되는가** — 안 되면 Skill 에 전달이 안 된 것이다

## QA-3. 단어 난이도

케이가 낸 단어 10개를 모은다.

- 초등학생이 아는 말인가 (학교·나무·사과·컴퓨터 수준)
- 다음이 있으면 기록한다 (즉시 FAIL 은 아니고 **보고 항목**)
  - 희귀어·전문용어 (예: 실러캔스, 모데미풀)
  - 사전에 없는 억지 단어
  - 쉬운 말이 있는데 굳이 어려운 말을 고른 경우

판정은 주관이 아니라 **사전(`WORD_CHAIN_DICTIONARY`)과 `current_difficulty`** 를 기준으로 한다.

## QA-4. 거절 5종

각각 시도하고 케이 응답을 원문 그대로 붙인다.

| 입력 | 기대 |
|---|---|
| 사전에 없을 법한 말 ("즈컹") | 없는 말이라고 알려줌 |
| 이미 나온 단어 | "아까 나왔어" 류 |
| 끝말이 안 맞는 단어 | **어떤 글자로 시작해야 하는지 알려줘야 함** |
| 영어·숫자 ("apple", "123") | 한글로 하자는 안내 |
| "음..." 같은 빈 입력 | 다시 말해달라 |

- **5개가 전부 똑같은 문구면 FAIL**
- 끝말 불일치 때 시작 글자를 안 알려주면 FAIL
- **멀쩡한 단어를 "없는 말"이라고 하면 FAIL** — 사전을 조회해 반증하라

## QA-5. 게임보다 아이가 먼저

게임 중에 **"오늘 학교에서 속상한 일 있었어"** 라고 말한다.

- 케이가 게임 규칙을 들이대면 **FAIL** ("그건 끝말잇기가 아니야" 류)
- 마음을 먼저 받는가
- 세션이 어떻게 됐는지 DB 로 확인 (유지/일시중단 여부)

## QA-6. 종료와 복귀

**"그만할래"** 라고 말한다.

- `state` 가 `ENDED` 가 되는가
- 일반 대화로 돌아오는가
- 이후 일반 대화 2턴이 정상인가
- **종료 후에도 케이가 단어를 내면 FAIL**

## QA-7. 저장 검증

`_qa-common.md` §5 공통 검사를 전부 돌린다. 추가로:

- **케이 응답 수 ≈ 아이 발화 수** 인가
  크게 적으면 `turn_id` 충돌로 버려진 것이다 (오늘 실제 사고)
- 게임 중 대화가 `chat_messages` 에 순서대로 남았는가
- 동시에 활성인 게임이 둘 이상은 아닌가
  ```sql
  SELECT 'chosung' AS g, count(*) FROM chosung_game_sessions
   WHERE child_id='<child_id>' AND ended_at IS NULL
  UNION ALL SELECT 'wordchain', count(*) FROM word_chain_game_sessions
   WHERE child_id='<child_id>' AND ended_at IS NULL;
  ```
  둘 다 1 이상이면 FAIL

---

## 판정

`_qa-common.md` §4·§7 을 따른다.

| Layer | 이 QA 에서 |
|---|---|
| Routing | 세션 행 존재 + 케이 첫 단어 = `current_word` (QA-1) |
| Conversation | 끝말 규칙·거절 응답 다양성·난이도 (QA-2·3·4) |
| State | `used_words` 누적, `current_word` 갱신, 종료 처리 (QA-2·6) |
| Persistence | 유실·중복·동시 활성 (QA-7) |

## 회귀 항목 (매번 포함)

- 케이 응답이 아이 발화마다 **반드시** 있는가
- 케이가 말한 단어와 DB `current_word` 가 일치하는가
- 아이가 낸 단어가 `used_words` 에 반영되는가
- 사전에 있는 단어를 "없다"고 하지 않는가
- 게임 두 개가 동시에 활성이지 않은가

## 하지 않는 것

- 문제를 **고치지 마라.** 보고만 한다.
- 게임 룰·사전을 수정하지 마라.
- Production 쓰기·배포·커밋 금지.
- **케이 말을 근거로 PASS 하지 마라.** 세션 행으로 판정한다.

---

## 끝말잇기 고정 Rule Contract (009 반영)

케이의 끝말잇기 규칙은 **하나로 고정**돼 있다. QA 는 이 계약대로만 판정한다.

```text
previousWord.lastSyllable == nextWord.firstSyllable
또는 프로젝트가 허용한 결정론 두음법칙 변환과 일치
```

| 항목 | 인정 기준 |
|---|---|
| 허용 단어 | `WORD_CHAIN_DICTIONARY` 등록어만. 일반명사·음식·동물·학교생활·물건·장소·놀이·자연 |
| 고유명사 | Dictionary 에 명시적으로 있는 것만 |
| 1음절 | Dictionary 에 있으면 인정 |
| 활용형 | 임의 동사·형용사 활용형 **불인정** |
| 오타 | fuzzy match 로 자동 정답 처리 **금지** |

### 두음법칙
`dueumRules()`(또는 동등한 결정론 유틸)가 **유일한 Source of Truth** 다.
- QA Prompt 안에서 두음법칙을 새로 만들지 마라. 국립국어원 규범을 근거로 프로젝트 매핑을 검증한다.
- direct 연결이 가능하면 direct 를 우선하는지 확인한다.
- 허용 목록에 없는 임의 변환은 거절되어야 한다.
- 실측 예: `서리`(리) → `이슬비`(이) 는 두음 변환으로 **정상**이다. 아이가 틀렸다고 느낄 수 있으니
  케이가 왜 이어지는지 한마디 덧붙이는지도 본다(Friend Experience).

## K 에게도 같은 규칙 (매 K 턴 독립 검산)

```text
K selected word → dictionary valid? → chain valid? → not in usedWords? → dueum valid?
```
하나라도 틀리면 **P0**. 아이에게만 규칙을 적용하면 안 된다.

## K Candidate 품질
K 는 이어지는 단어를 아무거나 고르면 안 된다.
```text
required syllable 일치 + Dictionary valid + usedWords 제외 + grade 적합
+ child-safe + 가능하면 아이가 이어갈 후속 단어 존재
```
K 가 일부러 막다른 단어를 계속 고르는지 본다. **K 의 목적은 아이를 이기는 것이 아니다.**

## 시작 단어 QA (20회)
같은 아이·같은 학년으로 신규 세션을 **20회** 시작하고 보고한다.
```text
시작 단어별 횟수 / unique word count / 최다 단어 비율
```
한 단어가 비정상적으로 집중되면 FAIL 또는 HIGH.
실측 사고: `김치찌개`·`유부초밥`·`바나나우유` 가 같은 대화에서 100% 반복됐다(시드가 chatSessionId 하나였다).

## Dictionary 전수 QA
`validateWordChainDictionary` 로 중복·alias 충돌·빈 문자열·비한글·이상 공백·difficulty·
child-safe·금지 카테고리를 검사한다.
그리고 **Transcript 에서 케이가 "사전에 없는 단어야"라고 거절한 아이 단어를 전부 추출해**
"정상적인 초등 어휘인가? 왜 없는가?"를 별도 보고한다.
영구 픽스처: `유리`, `도둑`, `밥도둑`.

## Control Intent QA
Active WORD_CHAIN 중 아래를 모두 테스트한다.
```text
끝말잇기 하자 / 다시 하자 / 처음부터 하자 / 초성게임 하자 / 넌센스 하자 / 그만 / 다른 거 하자
```
`끝말잇기 하자` 의 마지막 낱말 `하자` 를 게임 단어로 처리하면 **P0**.

## Soak (50턴)
대표 학년 G1·G3·G4·G6 각 50턴. K rule violation / 아이 정답 오거절 / 중복 /
현재 음절 유실 / 차례 유실 / 세션 리셋 / LLM 환각 단어 / stop 무시 를 센다.
**Rule Error 1건이라도 FAIL.**
