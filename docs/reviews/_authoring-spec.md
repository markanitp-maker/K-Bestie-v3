# 질문은행 v2 초안 작성 규격 (공유)

> 이 문서는 작성 세션들이 공유하는 규격이다. 각 세션은 자기 담당 구간만 작성한다.
> **이번 단계는 대표 검수용 초안 산출이다. DB 반영이 아니다.**

## 절대 금지

- `mission_questions` 에 대한 INSERT / UPDATE / DELETE **금지**
- migration 적용 **금지**, seed 실행 **금지**, Production 배포 **금지**
- 코드 변경 **금지** (`lib/`, `app/`, `components/` 등 손대지 마라)
- git commit / push **금지**, `npm install` **금지**
- **민감 영역(친구 갈등·안전·지원망) 질문을 주말 재미 질문처럼 가볍게 새로 만들지 마라.**
  기존 clinical-approved 자산을 그대로 유지한다. 해당 영역은 신규 작성 대상이 아니다.

## Ground Truth (실측)

기존 승인 질문 846건(`is_active=true AND clinical_status='APPROVED'`)은 **유지**한다.

학년군 × 요일 현재 후보 수:

```
        월   화   수   목   금   토   일
초1~2   47   40    9    2   16   18   85
초3~4   39   46   24    0   18   13   85
초5~6   42   49   20    0   18   10   94
```

핵심 문제는 **개수 부족이 아니라 맥락 부재**다.

- 일요일 후보가 85~94개로 많지만 대부분 **주간 회고**형이다.
  주말을 실제로 어떻게 보냈는지 묻는 생활맥락 질문이 사실상 없다.
- "주말"·"토요일"·"일요일"·"나들이"·"외출"·"놀러" 를 포함한 질문은 **0건**이다.
- 목요일은 초3~4 / 초5~6 이 **0건**이다.
  Goal 10개 자체는 일반 fallback 으로 채워진다. 문제는 채우지 못하는 게 아니라
  **목요일다운 질문이 없어 맥락이 비고 아이가 반복으로 느끼는 것**이다.

목표: **학년군 × 요일마다 실제 usable 후보 15개 이상.**
단, 매일 실제 Mission 은 10 Goal 만 선택한다는 기존 정책은 그대로다.

## 기존 자산 위치

`docs/reviews/_existing-questions-approved.json` (846건)
필드: `id, question_text, applicable_grades, semantic_group, weekday_affinity,
periodicity, cooldown_days, conversation_style, answer_mode, topic, sensitivity, memory_usable`

**새 질문을 쓰기 전에 반드시 이 파일에서 유사 질문을 검색하라.**

## 기존 semantic_group 21종 — 최대한 재사용하라

```
EMOTIONAL_EXPERIENCE 142  PEER_CONNECTION 109  SCHOOL_EXPERIENCE 108
DAILY_LIFE 104  ACHIEVEMENT 76  MOOD_CHECK 56  INTEREST_AND_PREFERENCE 43
FRIEND_CONFLICT 42  DAILY_HIGHLIGHT 42  DIGITAL_CONTENT 38
FAMILY_RELATIONSHIP 31  PHYSICAL_STATE 30  LEARNING_AND_STUDY 25
MEAL_AND_TASTE 16  TEACHER_RELATIONSHIP 16  FUTURE_HOPE 15
RAPPORT_IDENTITY 11  HOBBY_AND_CREATION 11  SUPPORT_NETWORK 4
DIGITAL_WELLBEING 3  SAFETY_EXPERIENCE 3
```

**새 semantic_group 을 임의로 추가하지 마라.**
예를 들어 `WEEKEND_EXPECTATION` 이 필요해 보여도, 먼저
`DAILY_LIFE` / `DAILY_HIGHLIGHT` / `INTEREST_AND_PREFERENCE` /
`HOBBY_AND_CREATION` / `PEER_CONNECTION` 로 표현 가능한지 검토하라.
정말 불가능한 경우에만 **제안**하고 이유를 적어라. 확정하지 마라.

## question_family — 반복 차단용 SSOT 후보

같은 뜻을 문장만 바꿔 반복하는 것을 막기 위한 키다. 아래를 우선 재사용하라.

```
SCHOOL_HIGHLIGHT  FRIEND_PLAY  GAME_TODAY  VIDEO_TODAY
ACADEMY_TODAY  ACADEMY_LEARNING  FOOD_TODAY  OUTING_TODAY
WEEKEND_EXPECTATION  WEEKEND_HIGHLIGHT  MOOD_TODAY  RAPPORT_INTEREST
```

`semantic_group` 과 별개 축이다. family 는 "사실상 같은 질문인가"를 판정한다.

## 요일별 성격

| 요일 | 중심 |
|---|---|
| 월 | 주말 → 학교 전환 |
| 화 | 수업 / 학원 / 놀이 |
| 수 | 친구 / 게임 / 주 중간 |
| 목 | 오늘 학교·쉬는시간·친구·선생님·학원·방과후·피로·금요일 기대 |
| 금 | 학교 끝난 뒤·친구 놀이·이번 주 웃긴 일·주말 기대·게임 계획·외출 계획 |
| 토 | 게임·영상 / 친구 / 학원 / 외출·나들이 / 가족 / 음식 / 휴식·늦잠 / 오늘 재미있던 일 |
| 일 | 주말 하이라이트 / 게임·외출 / 가족 / 친구 / 휴식 / 월요일 느낌 / 다음 주 기대 |

## Gate 형으로 써라 — 사실을 가정하지 마라

나쁜 예: `토요일이니까 게임했지?` / `학원 갔지?`
→ 안 한 아이는 답할 말이 없고 거짓말을 하게 된다.

좋은 예: `오늘 게임이나 재미있는 영상 본 거 있어?`
- YES → 게임명 → 누구와 → 재미있던 점 순으로 follow-up
- NO → 외출 / 휴식 / 다른 놀이로 자연스럽게 전환

## 학년별 표현 원칙

- **초1~2**: 짧고 구체적. **한 번에 하나만** 묻는다. 두 가지를 붙이지 마라.
- **초3~4**: 활동 + 경험 + 가벼운 이유.
- **초5~6**: 취향·의견·자율성 존중. **성인 면접식 질문이 되지 않게.**
  "어떤 점이 의미 있었나요" 같은 말투 금지.

## 각 후보에 반드시 채울 필드

```
grade_band                  초1~2 | 초3~4 | 초5~6
weekday_affinity            mon,tue,... (복수 가능)
semantic_group              기존 21종 중 하나 (신규 제안 시 별도 표시)
proposed_question_family
question_text
gate_type                   GATE | FOLLOW_UP | OPEN
yes_follow_up_intents       YES 일 때 이어갈 방향 (세미콜론 구분)
no_branch_direction         NO 일 때 전환 방향
recommended_cooldown_days
time_of_day                 morning | afternoon | evening | any
rapport_weight              0~3
existing_similar_question_ids   유사 기존 질문 id (없으면 빈칸)
duplicate_risk              LOW | MEDIUM | HIGH
why_needed                  왜 이 질문이 필요한가 (한 줄)
status                      NEW_QUESTION | REUSE_EXISTING
```

## NEW_QUESTION vs REUSE_EXISTING

- 기존 질문과 **의미가 거의 같으면** 새로 만들지 마라.
  `status = REUSE_EXISTING` 으로 표시하고, `existing_similar_question_ids` 를 채우고,
  `why_needed` 에 **어떤 metadata 를 고치면 되는지**(주로 `weekday_affinity`) 적어라.
- **완전히 새로운 생활맥락**일 때만 `NEW_QUESTION`.

주말 생활맥락은 기존에 0건이므로 대부분 NEW_QUESTION 이 될 것이다.
반대로 목요일은 "학교/친구" 질문 자체는 많고 요일 태그만 없는 경우가 많을 것이다 —
그런 건 REUSE_EXISTING 이다. **무턱대고 새로 만들지 마라.**

## 산출 형식

각 세션은 담당 구간만 **CSV 한 파일**로 낸다. 헤더는 위 필드 순서 그대로.
경로는 각 브리프가 지정한다. 통합 문서는 마지막 세션이 만든다.
