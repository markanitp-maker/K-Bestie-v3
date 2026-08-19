---
name: k-play-qa
description: 내친구 케이 K놀이(초성게임·끝말잇기·넌센스퀴즈) 통합 QA. 세 놀이를 한 번에 검증하고 공통 결함(놀이 세션 유실, 되묻기가 판정 가로채기, 케이가 세션 없이 게임 흉내, 지적하면 게임 종료, 내부 지침 노출, 놀이 간 전환)을 잡는다. "K놀이 QA", "케이 놀이 전체 테스트", "놀이 프로덕션 배포 가능한지 봐줘" 같은 요청에 사용한다. 케이 말이 아니라 DB 세션·라운드 행으로 판정한다. 개별 놀이만 볼 때는 chosung-game-qa / word-chain-qa / nonsense-quiz-qa 를 쓴다.
user-invocable: true
---

# k-play-qa — K놀이 통합 QA

> 공통 기준·실측 스키마·금지사항·보고 형식은 `.claude/skills/_qa-common.md` 를 **먼저 읽어라.**
> 이 파일은 그 위에서 "세 놀이를 함께 볼 때 무엇을 어떤 순서로 하는가" 만 다룬다.

## 이 스킬이 잡아야 하는 것

개별 놀이 QA 를 각각 통과해도 아이 경험이 망가지는 유형이 있다.
2026-08-19 대표님 QA 에서 실제로 그랬다 — 세 놀이가 각자 "동작"했지만 아이는 못 놀았다.

이 스킬은 **놀이를 가로지르는 결함**을 본다.

1. 아이 발화가 게임 엔진에 **도달하는가** (DB 라운드 기록 수 = 게임 턴 수)
2. 아이가 지적·불만을 말했을 때 **세션이 살아 있는가**
3. 세션이 없을 때 케이가 게임을 **흉내내지 않는가**
4. 놀이 간 전환에서 **하나만 Active 인가**
5. 케이 발화에 **내부 어휘가 새지 않는가**
6. 같은 문구가 **반복되지 않는가**

## 실행 순서

### STEP 0 — 준비
`_qa-common.md` §1(환경·계정), §3(실측 스키마) 확인. 시작 시각(KST)과 배포 시각을 적어 둔다.
**배포 시각보다 이전 기록으로 판정하면 QA 를 안 한 것이다.**

### STEP 1 — Static / Rule (LLM 없이)
`_qa-common.md` §11 레벨 1~2. 여기서 FAIL 이면 대화 QA 로 넘어가지 마라 — 원인이 데이터다.

```bash
npx tsc --noEmit
npx tsx --test lib/k-conversation/wordChain/*.test.ts \
  lib/k-conversation/chosungGame/*.test.ts \
  lib/k-conversation/nonsenseQuiz/*.test.ts \
  lib/k-conversation/play/*.test.ts
```

### STEP 2 — 세 놀이 대화 QA
각 놀이를 아래 형태로 돌린다. **짧은 발화와 지적을 반드시 섞어라.**

```text
1. <놀이> 하자
2. (짧은 정답 1~3자로 답한다. 예: "소", "해")
3. (군말을 붙여 답한다. 예: "그러니까 OO 이라고")
4. (아이처럼 지적한다. 예: "그거 아니잖아 OO 이잖아")
5. (놀이와 무관한 말을 한다. 예: "오늘 급식 맛있었어")
6. 다음 문제 줘
7. 그만할래
```

턴마다 기록: 아이 발화 / 케이 응답 **원문** / 세션 state / 라운드 기록 여부.

### STEP 3 — 판정 (DB 로만)
```sql
-- 게임 턴 수와 라운드 수가 맞는가
SELECT 'wordchain' g, count(*) FROM word_chain_game_rounds
  WHERE child_id='<id>' AND created_at > '<시작시각>'
UNION ALL SELECT 'chosung', count(*) FROM chosung_game_rounds
  WHERE child_id='<id>' AND created_at > '<시작시각>';

-- 지적한 턴 뒤에 세션이 살아 있는가
SELECT state, current_word, used_words FROM word_chain_game_sessions
  WHERE child_id='<id>' ORDER BY started_at DESC LIMIT 3;

-- 동시 Active 가 없는가 (_qa-common §5-5)
```

### STEP 4 — 문구 검사 (케이 응답 전체 대상)
아래가 **한 번이라도** 나오면 해당 항목 FAIL. 몇 턴에서 나왔는지 적어라.

```text
"라고 들었는데"            → 놀이 중 되묻기가 판정을 가로챘다 (P1)
"응, 듣고 있어" / "더 얘기해줄래"  → 자유대화 폴백이 놀이를 깼다 (P1)
"잠깐만 준비할게"          → 같은 문구 반복 (P2), 2회 이상이면 P1
"시스템" / "준비 중" / "세션"  → 내부 어휘 노출 (P1)
"네가 문제 내주면"          → 아이에게 역할 전가 (P1)
```

### STEP 5 — Cross-Skill
`초성 → 끝말잇기 → 넌센스 → 초성` 순으로 전환. 전환마다 이전 Skill END + 새 Skill START 확인.
두 Skill 이 동시에 Active 면 P0.

### STEP 6 — 실제 장애 Replay
`_qa-common.md` §12 픽스처 전부. 하나라도 재발하면 Production 후보 FAIL.

## 보고
`_qa-common.md` §15 형식을 그대로 쓴다. Production Ready 는 §14 게이트를 모두 만족할 때만 YES.

## 하지 않는 것
`_qa-common.md` §13. 특히 **코드·Dictionary·DB·문제·Prompt 를 고치지 마라.**
문제를 찾으면 재현 정보만 남긴다.
