# 065 — 초등학교 4학년 공통 미션 질문지 140문항 등록

## 작업 목적

초등학교 4학년 수준으로 작성된 미션 질문지 140문항을 새 버전으로 등록하고, 초기 베타 기간에는 1~6학년 전체 아이에게 공통 적용한다. Development 검증 완료 후 별도 승인 요청 없이 Production까지 자동 배포한다.

## 확정 정책

- 질문지 버전: `grade4_common_v2`
- 기준 학년: 초등학교 4학년
- 초기 적용 학년: 1~6학년 공통
- 기존 질문과 `mission_question_history`는 삭제하거나 덮어쓰지 않는다.
- 새 질문지 선택 조건:
  - `questionnaire_version='grade4_common_v2'`
  - `is_active=true`
  - `clinical_status='APPROVED'`
- 전문가 검토 상태는 출제 승인 상태와 분리하여 `expert_review_status='PENDING_REVIEW'`로 관리한다.
- 미승인·비활성·구버전 질문은 어떤 fallback 경로에서도 출제하지 않는다.

## 미션 운영 시간

- 방학 기간 `MISSION_I`: 10:00~17:50
- 학기 중 `MISSION_I`: 13:00~17:50
- `MISSION_II`: 18:00~23:50
- 현재 운영 모드는 방학이다.
- 방학/학기 전환은 하드코딩하지 말고 설정값으로 관리한다.

## 문항 배분

| 주기 | MISSION_I | MISSION_II | 합계 |
|---|---:|---:|---:|
| DAILY | 56 | 56 | 112 |
| WEEKLY | 8 | 8 | 16 |
| MONTHLY | 4 | 4 | 8 |
| QUARTERLY | 2 | 2 | 4 |
| 합계 | 70 | 70 | 140 |

## 출제 규칙

- 각 미션은 유효 답변 10개를 받아야 완료된다.
- 세션마다 `PRIMARY 10개 + RESERVE 10개`를 생성한다.
- `FIXED` 문항과 해당 기간에 도래한 `WEEKLY/MONTHLY/QUARTERLY` 문항을 PRIMARY 앞부분에 배치한다.
- 기간 문항이 들어가도 총 질문 수는 늘리지 않고 DAILY 순환 문항을 대체한다.
- 나머지는 최근 출제 이력, 동일 영역 쏠림, `daily_once_key`를 반영해 채운다.
- 동일 영역은 한 세션 최대 2문항이다.
- `mood_format`은 MISSION_I·II 합산 하루 최대 1회다.
- `meal_daily`는 하루 최대 1회다.
- 꼬리 질문은 유효 답변 수에 포함하지 않는다.
- 아이가 `없어`, `모르겠어`, `넘어갈래`라고 답하면 추가 추궁하지 않는다.
- 실제 LLM Wiki 근거 없이 `그 콘텐츠`, `전에 말한 게임`, `그 친구` 같은 지시 표현을 만들지 않는다.
- 위기 신호가 감지되면 일반 질문과 꼬리 질문을 즉시 중단하고 기존 안전 전환 로직으로 넘긴다.
- AI 정체성 고지, 비밀 한계 고지, 위기 대응 고정 문구는 140문항에 포함하지 않고 별도 시스템 메시지로 유지한다.

## 주기 스케줄

- `DAILY`: 해당 미션이 열리는 날마다 후보
- `WEEKLY`: MISSION_I는 토요일, MISSION_II는 일요일에 각 1문항씩 순환
- `MONTHLY`: 매월 마지막 주에 각 미션별 1문항씩 순환
- `QUARTERLY`: 1·4·7·10월 첫 성공 미션에서 각 미션별 1문항씩 순환
- 예정일에 미션을 하지 않으면 같은 주·월·분기 안의 다음 성공 미션으로 1회 이월
- 같은 주기 문항이 이미 해당 기간에 출제됐다면 재출제 금지
- 모든 판정은 한국 시간대와 아이별 `business_date` 기준

## V2 fallback 결함 수정

최근 Production에서 V2 질문 부족 시 레거시 질문 풀로 fallback한 뒤 `isV2=true`로 다시 기록되는 결함을 수정한다.

1. `selectQuestionsV2`는 새 버전의 APPROVED 활성 문항만 사용한다.
2. 레거시 `selectFixedMissionQuestions` fallback을 사용하지 않는다.
3. 문항 부족 또는 조회 실패 시 미승인 질문으로 대체하지 말고 fail-closed 처리한다.
4. `engine_version='v2-grade4-common-v2'`로 실제 엔진과 질문지 버전을 정확히 기록한다.
5. fallback 뒤 V2 플래그를 다시 덮어쓰는 코드를 제거한다.
6. 실제 아이에게 전송된 질문에만 `asked_at`을 기록한다.

## 데이터 모델

기존 스키마를 우선 재사용하되 아래 의미를 보존한다.

- `question_id`
- `questionnaire_version`
- `source_grade=4`
- `applicable_grades=[1,2,3,4,5,6]`
- `frequency`
- `mission_slot`
- `selection_type`
- `question_area`
- `question_text`
- `daily_once_key`
- `is_active`
- `clinical_status`
- `expert_review_status`
- `sort_order`
- `metadata`

마이그레이션과 seed는 멱등적으로 작성한다. 동일 seed를 재실행해도 질문이 중복되지 않아야 하며 기존 history 참조가 깨지면 안 된다.

## 등록할 140문항

| 문항 ID | 주기 | 미션 | 유형 | 영역 | 질문 | daily_once_key |
|---|---|---|---|---|---|---|
| Q4-D-M1-001 | DAILY | MISSION_I | FIXED | 하루 열기 | 오늘 하루 중에 제일 기억에 남는 순간 하나만 얘기해줘. | daily_opening |
| Q4-D-M1-002 | DAILY | MISSION_I | ROTATION | 학교·수업 | 오늘 학교에서 제일 먼저 떠오르는 일은 뭐야? |  |
| Q4-D-M1-003 | DAILY | MISSION_I | ROTATION | 학교·수업 | 오늘 수업 중에 재미있었던 순간이 있었어? |  |
| Q4-D-M1-004 | DAILY | MISSION_I | ROTATION | 학교·수업 | 오늘 새롭게 알게 된 것 하나만 알려줄래? |  |
| Q4-D-M1-005 | DAILY | MISSION_I | ROTATION | 학교·수업 | 오늘 쉬는 시간에는 주로 뭐 했어? |  |
| Q4-D-M1-006 | DAILY | MISSION_I | ROTATION | 학교·수업 | 오늘 가장 집중이 잘됐던 시간은 언제였어? |  |
| Q4-D-M1-007 | DAILY | MISSION_I | ROTATION | 학교·수업 | 오늘 조금 어렵게 느껴진 수업이 있었어? 없으면 넘어가도 돼. |  |
| Q4-D-M1-008 | DAILY | MISSION_I | ROTATION | 학교·수업 | 오늘 준비물이나 과제 때문에 기억나는 일이 있었어? |  |
| Q4-D-M1-009 | DAILY | MISSION_I | ROTATION | 학교·수업 | 오늘 선생님이 한 말 중에 기억나는 게 있어? |  |
| Q4-D-M1-010 | DAILY | MISSION_I | ROTATION | 학교·수업 | 오늘 학교에서 웃었던 순간이 있었어? |  |
| Q4-D-M1-011 | DAILY | MISSION_I | ROTATION | 학교·수업 | 오늘 했던 학교 활동 중에 다시 해보고 싶은 게 있어? |  |
| Q4-D-M1-012 | DAILY | MISSION_I | ROTATION | 학원·방과후 | 오늘 학원이나 방과후 활동이 있었다면 어떤 시간이 제일 기억나? |  |
| Q4-D-M1-013 | DAILY | MISSION_I | ROTATION | 학원·방과후 | 오늘 학원이나 방과후에서 새로 배운 게 있었어? |  |
| Q4-D-M1-014 | DAILY | MISSION_I | ROTATION | 학원·방과후 | 오늘 학원이나 방과후에서 잘됐다고 느낀 일이 있었어? |  |
| Q4-D-M1-015 | DAILY | MISSION_I | ROTATION | 학원·방과후 | 오늘 학원이나 방과후에서 조금 어려웠던 게 있었어? 없으면 넘어가도 돼. |  |
| Q4-D-M1-016 | DAILY | MISSION_I | ROTATION | 학원·방과후 | 오늘 학원이나 방과후가 끝난 뒤 가장 하고 싶었던 건 뭐였어? |  |
| Q4-D-M1-017 | DAILY | MISSION_I | ROTATION | 친구·또래 | 오늘 누구랑 제일 많이 이야기했어? |  |
| Q4-D-M1-018 | DAILY | MISSION_I | ROTATION | 친구·또래 | 오늘 친구랑 같이 해서 재미있었던 일이 있었어? |  |
| Q4-D-M1-019 | DAILY | MISSION_I | ROTATION | 친구·또래 | 오늘 친구가 해준 말 중에 기억나는 말이 있어? |  |
| Q4-D-M1-020 | DAILY | MISSION_I | ROTATION | 친구·또래 | 오늘 네가 친구를 도와준 일이 있었어? |  |
| Q4-D-M1-021 | DAILY | MISSION_I | ROTATION | 친구·또래 | 오늘 친구가 너를 도와준 일이 있었어? |  |
| Q4-D-M1-022 | DAILY | MISSION_I | ROTATION | 친구·또래 | 요즘 친구들이랑 자주 하는 놀이나 이야기는 뭐야? |  |
| Q4-D-M1-023 | DAILY | MISSION_I | ROTATION | 친구·또래 | 오늘 같이 있고 싶었던 친구가 있었어? |  |
| Q4-D-M1-024 | DAILY | MISSION_I | ROTATION | 친구·또래 | 오늘 친구 때문에 조금 서운했던 일이 있었어? 없으면 넘어가도 돼. |  |
| Q4-D-M1-025 | DAILY | MISSION_I | ROTATION | 친구·또래 | 친구랑 생각이 달랐던 일이 있었어? 그다음엔 어떻게 됐어? |  |
| Q4-D-M1-026 | DAILY | MISSION_I | ROTATION | 친구·또래 | 내일 친구랑 같이 해보고 싶은 게 있어? |  |
| Q4-D-M1-027 | DAILY | MISSION_I | ROTATION | 개인취향 | 요즘 제일 좋아하는 건 뭐야? |  |
| Q4-D-M1-028 | DAILY | MISSION_I | ROTATION | 개인취향 | 요즘 시간 가는 줄 모르고 하는 게 있어? |  |
| Q4-D-M1-029 | DAILY | MISSION_I | ROTATION | 개인취향 | 최근에 자주 듣는 노래나 좋아하는 소리가 있어? |  |
| Q4-D-M1-030 | DAILY | MISSION_I | ROTATION | 개인취향 | 요즘 그리고 싶거나 만들고 싶은 게 있어? |  |
| Q4-D-M1-031 | DAILY | MISSION_I | ROTATION | 개인취향 | 지금 하나를 골라서 실컷 할 수 있다면 뭘 하고 싶어? |  |
| Q4-D-M1-032 | DAILY | MISSION_I | ROTATION | 개인취향 | 요즘 새로 관심이 생긴 게 있어? |  |
| Q4-D-M1-033 | DAILY | MISSION_I | ROTATION | 개인취향 | 친구에게 추천하고 싶은 재미있는 게 있어? |  |
| Q4-D-M1-034 | DAILY | MISSION_I | ROTATION | 개인취향 | 예전에는 좋아했는데 요즘은 덜 좋아하게 된 게 있어? |  |
| Q4-D-M1-035 | DAILY | MISSION_I | ROTATION | 디지털·콘텐츠 | 요즘 재미있게 보는 영상이나 자주 하는 게임이 있어? |  |
| Q4-D-M1-036 | DAILY | MISSION_I | ROTATION | 디지털·콘텐츠 | 최근에 본 영상이나 게임에서 제일 기억나는 장면은 뭐야? |  |
| Q4-D-M1-037 | DAILY | MISSION_I | ROTATION | 디지털·콘텐츠 | 게임이나 영상에서 직접 해보고 싶은 게 있었어? |  |
| Q4-D-M1-038 | DAILY | MISSION_I | ROTATION | 디지털·콘텐츠 | 요즘 친구들이 많이 이야기하는 게임이나 영상이 있어? |  |
| Q4-D-M1-039 | DAILY | MISSION_I | ROTATION | 디지털·콘텐츠 | 게임을 할 때 혼자 하는 게 좋아, 같이 하는 게 좋아? |  |
| Q4-D-M1-040 | DAILY | MISSION_I | ROTATION | 디지털·콘텐츠 | 영상이나 게임을 보고 나서 더 궁금해진 게 있었어? |  |
| Q4-D-M1-041 | DAILY | MISSION_I | ROTATION | 디지털·콘텐츠 | 오늘 디지털 기기를 쓰면서 가장 재미있었던 건 뭐였어? |  |
| Q4-D-M1-042 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | 오늘 몸은 가벼운 편이었어, 피곤한 편이었어? |  |
| Q4-D-M1-043 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | 오늘 많이 움직였던 순간이 있었어? |  |
| Q4-D-M1-044 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | 오늘 쉬고 싶다고 느낀 때가 있었어? |  |
| Q4-D-M1-045 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | 오늘 밥 뭐 먹었어? | meal_daily |
| Q4-D-M1-046 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | 오늘 먹은 것 중에 제일 맛있었던 건 뭐야? | meal_daily |
| Q4-D-M1-047 | DAILY | MISSION_I | ROTATION | 성취·뿌듯함 | 오늘 네가 잘했다고 느낀 일이 있었어? |  |
| Q4-D-M1-048 | DAILY | MISSION_I | ROTATION | 성취·뿌듯함 | 오늘 끝까지 해낸 일이 하나라도 있어? |  |
| Q4-D-M1-049 | DAILY | MISSION_I | ROTATION | 성취·뿌듯함 | 오늘 처음 해봤거나 새롭게 도전한 게 있어? |  |
| Q4-D-M1-050 | DAILY | MISSION_I | ROTATION | 성취·뿌듯함 | 오늘 누군가에게 칭찬받은 일이 있었어? |  |
| Q4-D-M1-051 | DAILY | MISSION_I | ROTATION | 성취·뿌듯함 | 오늘 스스로에게 잘했다고 말해주고 싶은 건 뭐야? |  |
| Q4-D-M1-052 | DAILY | MISSION_I | ROTATION | 공정함·억울함 | 오늘 공평하다고 느낀 일이 있었어? |  |
| Q4-D-M1-053 | DAILY | MISSION_I | ROTATION | 공정함·억울함 | 오늘 조금 억울하거나 답답했던 일이 있었어? 없으면 넘어가도 돼. |  |
| Q4-D-M1-054 | DAILY | MISSION_I | ROTATION | 공정함·억울함 | 오늘 네 생각과 다르게 일이 정해진 적이 있었어? |  |
| Q4-D-M1-055 | DAILY | MISSION_I | ROTATION | 공정함·억울함 | 오늘 차례나 규칙 때문에 기억나는 일이 있었어? |  |
| Q4-D-M1-056 | DAILY | MISSION_I | ROTATION | 공정함·억울함 | 오늘 다시 정할 수 있다면 다르게 하고 싶은 일이 있어? |  |
| Q4-W-M1-001 | WEEKLY | MISSION_I | ROTATION | 학교·수업 | 이번 주 학교에서 제일 기억에 남는 일은 뭐야? |  |
| Q4-W-M1-002 | WEEKLY | MISSION_I | ROTATION | 친구·또래 | 이번 주 친구와 함께해서 제일 즐거웠던 일은 뭐야? |  |
| Q4-W-M1-003 | WEEKLY | MISSION_I | ROTATION | 성취·뿌듯함 | 이번 주에 네가 가장 잘했다고 느낀 일은 뭐야? |  |
| Q4-W-M1-004 | WEEKLY | MISSION_I | ROTATION | 개인취향 | 이번 주에 새로 좋아하게 된 게 있어? |  |
| Q4-W-M1-005 | WEEKLY | MISSION_I | ROTATION | 학교·수업 | 이번 주에 가장 재미있었던 수업이나 활동은 뭐였어? |  |
| Q4-W-M1-006 | WEEKLY | MISSION_I | ROTATION | 공정함·억울함 | 이번 주에 조금 억울하거나 아쉬웠던 일이 있었어? 없으면 넘어가도 돼. |  |
| Q4-W-M1-007 | WEEKLY | MISSION_I | ROTATION | 몸·컨디션 | 이번 주에는 언제 가장 신나게 움직였어? |  |
| Q4-W-M1-008 | WEEKLY | MISSION_I | ROTATION | 개인취향 | 다음 주에 꼭 해보고 싶은 활동이 있어? |  |
| Q4-M-M1-001 | MONTHLY | MISSION_I | ROTATION | 학교·수업 | 이번 달 학교생활에서 제일 기억에 남는 일은 뭐야? |  |
| Q4-M-M1-002 | MONTHLY | MISSION_I | ROTATION | 성취·뿌듯함 | 이번 달에 새롭게 알게 됐거나 잘하게 된 게 있어? |  |
| Q4-M-M1-003 | MONTHLY | MISSION_I | ROTATION | 친구·또래 | 이번 달에 친구와 있었던 일 중 가장 기억나는 건 뭐야? |  |
| Q4-M-M1-004 | MONTHLY | MISSION_I | ROTATION | 개인취향 | 다음 달에는 새로 해보고 싶은 게 있어? |  |
| Q4-Q-M1-001 | QUARTERLY | MISSION_I | ROTATION | 자기효능감 | 세 달 전보다 더 잘하게 됐다고 느끼는 게 있어? |  |
| Q4-Q-M1-002 | QUARTERLY | MISSION_I | ROTATION | 관심사 | 요즘 네 관심사가 세 달 전과 달라진 게 있어? |  |
| Q4-D-M2-001 | DAILY | MISSION_II | FIXED | Rose-Thorn-Bud | 오늘 제일 좋았던 일은 뭐야? | rose |
| Q4-D-M2-002 | DAILY | MISSION_II | FIXED | Rose-Thorn-Bud | 오늘 조금 힘들거나 아쉬웠던 일이 있었어? 없으면 넘어가도 돼. | thorn |
| Q4-D-M2-003 | DAILY | MISSION_II | FIXED | Rose-Thorn-Bud | 내일 기대되는 일이 있어? | bud |
| Q4-D-M2-004 | DAILY | MISSION_II | ROTATION | 감정 | 오늘 마음 날씨는 맑음, 구름, 비, 천둥 중 뭐야? | mood_format |
| Q4-D-M2-005 | DAILY | MISSION_II | ROTATION | 감정 | 오늘 기분을 이모지 하나로 표현하면 뭐야? | mood_format |
| Q4-D-M2-006 | DAILY | MISSION_II | ROTATION | 감정 | 오늘 기분에 색깔을 붙인다면 무슨 색이야? | mood_format |
| Q4-D-M2-007 | DAILY | MISSION_II | ROTATION | 감정 | 오늘 마음 점수를 매긴다면 1점부터 10점 중 몇 점이야? | mood_format |
| Q4-D-M2-008 | DAILY | MISSION_II | ROTATION | 감정 | 오늘 가장 편안했던 순간은 언제였어? |  |
| Q4-D-M2-009 | DAILY | MISSION_II | ROTATION | 감정 | 오늘 가장 신났던 순간은 언제였어? |  |
| Q4-D-M2-010 | DAILY | MISSION_II | ROTATION | 감정 | 오늘 조금 긴장했던 순간이 있었어? 없으면 넘어가도 돼. |  |
| Q4-D-M2-011 | DAILY | MISSION_II | ROTATION | 감정 | 오늘 마음이 답답했던 순간이 있었어? 없으면 넘어가도 돼. |  |
| Q4-D-M2-012 | DAILY | MISSION_II | ROTATION | 감정 | 오늘 기분이 바뀐 순간이 있었어? |  |
| Q4-D-M2-013 | DAILY | MISSION_II | ROTATION | 감정 | 오늘 누군가의 말 때문에 기분이 좋아진 적이 있어? |  |
| Q4-D-M2-014 | DAILY | MISSION_II | ROTATION | 감정 | 오늘 혼자 있고 싶었던 순간이 있었어? |  |
| Q4-D-M2-015 | DAILY | MISSION_II | ROTATION | 감정 | 오늘 누군가와 이야기하고 싶었던 순간이 있었어? |  |
| Q4-D-M2-016 | DAILY | MISSION_II | ROTATION | 감정 | 지금 마음에 가장 가까운 말은 편안함, 신남, 피곤함, 속상함 중 뭐야? | mood_format |
| Q4-D-M2-017 | DAILY | MISSION_II | ROTATION | 감정 | 오늘 마음속에 오래 남아 있는 일이 있어? |  |
| Q4-D-M2-018 | DAILY | MISSION_II | ROTATION | 감정 | 지금 더 이야기하고 싶은 기분이 있어? 없으면 넘어가도 돼. |  |
| Q4-D-M2-019 | DAILY | MISSION_II | ROTATION | 가족·집 | 오늘 집에서 가장 편안했던 순간은 언제였어? |  |
| Q4-D-M2-020 | DAILY | MISSION_II | ROTATION | 가족·집 | 오늘 가족과 함께해서 좋았던 일이 있었어? |  |
| Q4-D-M2-021 | DAILY | MISSION_II | ROTATION | 가족·집 | 오늘 집에서 재미있었던 일이 있었어? |  |
| Q4-D-M2-022 | DAILY | MISSION_II | ROTATION | 가족·집 | 오늘 가족에게 이야기하고 싶은 일이 있어? |  |
| Q4-D-M2-023 | DAILY | MISSION_II | ROTATION | 가족·집 | 오늘 집에서 네가 도와준 일이 있었어? |  |
| Q4-D-M2-024 | DAILY | MISSION_II | ROTATION | 가족·집 | 오늘 가족이 너를 도와준 일이 있었어? |  |
| Q4-D-M2-025 | DAILY | MISSION_II | ROTATION | 가족·집 | 가족과 같이 해보고 싶은 일이 있어? |  |
| Q4-D-M2-026 | DAILY | MISSION_II | ROTATION | 가족·집 | 오늘 집에서 혼자 쉬는 시간이 있었어? 어땠어? |  |
| Q4-D-M2-027 | DAILY | MISSION_II | ROTATION | 가족·집 | 오늘 집에서 웃었던 순간이 있었어? |  |
| Q4-D-M2-028 | DAILY | MISSION_II | ROTATION | 가족·집 | 내일 가족에게 먼저 말해주고 싶은 게 있어? |  |
| Q4-D-M2-029 | DAILY | MISSION_II | ROTATION | 믿을 수 있는 어른 | 오늘 어른에게 도움을 받은 일이 있었어? |  |
| Q4-D-M2-030 | DAILY | MISSION_II | ROTATION | 믿을 수 있는 어른 | 궁금한 게 생기면 편하게 물어볼 수 있는 어른이 있어? |  |
| Q4-D-M2-031 | DAILY | MISSION_II | ROTATION | 믿을 수 있는 어른 | 오늘 선생님이나 어른이 해준 말 중 기억나는 게 있어? |  |
| Q4-D-M2-032 | DAILY | MISSION_II | ROTATION | 믿을 수 있는 어른 | 오늘 네 이야기를 잘 들어준 어른이 있었어? |  |
| Q4-D-M2-033 | DAILY | MISSION_II | ROTATION | 믿을 수 있는 어른 | 도움이 필요할 때 가장 먼저 떠오르는 어른은 누구야? |  |
| Q4-D-M2-034 | DAILY | MISSION_II | ROTATION | 믿을 수 있는 어른 | 내일 어른에게 물어보고 싶은 게 있어? |  |
| Q4-D-M2-035 | DAILY | MISSION_II | ROTATION | 하루 회고 | 오늘을 한 단어로 표현하면 어떤 말이 떠올라? |  |
| Q4-D-M2-036 | DAILY | MISSION_II | ROTATION | 하루 회고 | 오늘 다시 돌아가 보고 싶은 순간이 있어? |  |
| Q4-D-M2-037 | DAILY | MISSION_II | ROTATION | 하루 회고 | 오늘 다르게 해보고 싶은 일이 있어? |  |
| Q4-D-M2-038 | DAILY | MISSION_II | ROTATION | 하루 회고 | 오늘 가장 많이 웃은 때는 언제였어? |  |
| Q4-D-M2-039 | DAILY | MISSION_II | ROTATION | 하루 회고 | 오늘 조용히 쉬었던 순간은 언제였어? |  |
| Q4-D-M2-040 | DAILY | MISSION_II | ROTATION | 하루 회고 | 오늘 누군가에게 고마웠던 일이 있어? |  |
| Q4-D-M2-041 | DAILY | MISSION_II | ROTATION | 하루 회고 | 오늘 네가 누군가를 기쁘게 해준 일이 있었어? |  |
| Q4-D-M2-042 | DAILY | MISSION_II | ROTATION | 하루 회고 | 오늘 하루에서 하나만 간직한다면 어떤 순간을 고를래? |  |
| Q4-D-M2-043 | DAILY | MISSION_II | ROTATION | 하루 회고 | 오늘 생각보다 잘 풀린 일이 있었어? |  |
| Q4-D-M2-044 | DAILY | MISSION_II | ROTATION | 하루 회고 | 오늘 예상과 다르게 된 일이 있었어? 그다음엔 어떻게 됐어? |  |
| Q4-D-M2-045 | DAILY | MISSION_II | ROTATION | 자기효능감 | 오늘 포기하지 않고 계속해 본 일이 있어? |  |
| Q4-D-M2-046 | DAILY | MISSION_II | ROTATION | 자기효능감 | 오늘 네가 스스로 해결한 일이 있었어? |  |
| Q4-D-M2-047 | DAILY | MISSION_II | ROTATION | 자기효능감 | 오늘 용기 내서 해본 일이 있어? |  |
| Q4-D-M2-048 | DAILY | MISSION_II | ROTATION | 자기효능감 | 오늘 실수했지만 다시 해본 일이 있어? |  |
| Q4-D-M2-049 | DAILY | MISSION_II | ROTATION | 자기효능감 | 오늘 네 장점이 도움이 된 순간이 있었어? |  |
| Q4-D-M2-050 | DAILY | MISSION_II | ROTATION | 자기효능감 | 오늘 배운 것 중 내일도 써보고 싶은 게 있어? |  |
| Q4-D-M2-051 | DAILY | MISSION_II | ROTATION | 자기효능감 | 오늘의 너에게 칭찬 한마디를 해준다면 뭐라고 하고 싶어? |  |
| Q4-D-M2-052 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | 내일 아침에 일어나면 가장 먼저 하고 싶은 건 뭐야? |  |
| Q4-D-M2-053 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | 내일 재미있는 일이 하나 생긴다면 어떤 일이면 좋겠어? |  |
| Q4-D-M2-054 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | 내일 누구와 어떤 시간을 보내고 싶어? |  |
| Q4-D-M2-055 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | 내일의 너에게 미리 응원 한마디를 해줄래? |  |
| Q4-D-M2-056 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | 오늘 하루를 잘 마무리하기 위해 지금 하고 싶은 게 있어? |  |
| Q4-W-M2-001 | WEEKLY | MISSION_II | ROTATION | 감정 | 이번 주 통틀어 제일 좋았던 일은 뭐야? |  |
| Q4-W-M2-002 | WEEKLY | MISSION_II | ROTATION | 감정 | 이번 주에 조금 힘들거나 아쉬웠던 일이 있었어? 없으면 넘어가도 돼. |  |
| Q4-W-M2-003 | WEEKLY | MISSION_II | ROTATION | 자기효능감 | 이번 주에 끝까지 해낸 일은 뭐야? |  |
| Q4-W-M2-004 | WEEKLY | MISSION_II | ROTATION | 가족·집 | 이번 주 가족과 함께한 시간 중 가장 좋았던 순간은 언제였어? |  |
| Q4-W-M2-005 | WEEKLY | MISSION_II | ROTATION | 친구·또래 | 이번 주 친구와 있었던 일 중 마음에 남는 게 있어? |  |
| Q4-W-M2-006 | WEEKLY | MISSION_II | ROTATION | 하루 회고 | 이번 주에 다시 해보고 싶은 일이 있어? |  |
| Q4-W-M2-007 | WEEKLY | MISSION_II | ROTATION | 긍정 마무리 | 다음 주에 가장 기대되는 건 뭐야? |  |
| Q4-W-M2-008 | WEEKLY | MISSION_II | ROTATION | 자기효능감 | 다음 주의 너에게 응원해주고 싶은 말이 있어? |  |
| Q4-M-M2-001 | MONTHLY | MISSION_II | ROTATION | 감정 | 이번 달을 떠올리면 가장 먼저 어떤 기분이 생각나? |  |
| Q4-M-M2-002 | MONTHLY | MISSION_II | ROTATION | 자기효능감 | 이번 달에 네가 가장 뿌듯했던 일은 뭐야? |  |
| Q4-M-M2-003 | MONTHLY | MISSION_II | ROTATION | 관계 | 이번 달에 고마웠던 사람이 있어? 어떤 일이 있었어? |  |
| Q4-M-M2-004 | MONTHLY | MISSION_II | ROTATION | 긍정 마무리 | 다음 달의 너에게 기대하는 게 하나 있다면 뭐야? |  |
| Q4-Q-M2-001 | QUARTERLY | MISSION_II | ROTATION | 안전망 | 힘들 때 편하게 이야기할 수 있는 어른이 있어? |  |
| Q4-Q-M2-002 | QUARTERLY | MISSION_II | ROTATION | 자기효능감 | 세 달 전의 너에게 지금 해주고 싶은 말이 있어? |  |


## Dev 검증 완료 조건

다음 항목이 모두 PASS여야 Production 자동 배포를 진행한다.

### 데이터

- `grade4_common_v2` 정확히 140문항
- MISSION_I 70 / MISSION_II 70
- DAILY 112 / WEEKLY 16 / MONTHLY 8 / QUARTERLY 4
- 모든 ID 고유
- 모든 문항 `is_active=true`
- 서비스 출제 상태 `clinical_status='APPROVED'`
- 전문가 검토 상태 `expert_review_status='PENDING_REVIEW'`
- 기존 질문과 history 보존
- seed 재실행 후에도 140개 유지

### 선택 로직

- 1~6학년 모두 `grade4_common_v2`에서만 출제
- 각 미션 PRIMARY 10 + RESERVE 10
- 미션 간 질문 혼합 0건
- 주간·월간·분기 질문의 기간 내 중복 0건
- `mood_format` 하루 최대 1회
- `meal_daily` 하루 최대 1회
- 동일 영역 세션 최대 2개
- PENDING_REVIEW·구버전 질문 출제 0건
- 레거시 fallback 호출 0건
- `engine_version` 정확히 기록

### 시간

- 방학 MISSION_I: 10:00 입장 가능, 17:50 이후 불가
- 학기 MISSION_I: 13:00 입장 가능, 17:50 이후 불가
- MISSION_II: 18:00 입장 가능, 23:50 이후 불가
- 한국 시간대 기준 경계 테스트 PASS

### 실제 사용자 흐름

최소 2명의 Dev 테스트 아이로 각각 검증한다.

- MISSION_I 시작→질문→유효 답변 10개→완료
- MISSION_II 시작→Rose/Thorn/Bud 포함→유효 답변 10개→완료
- 짧지만 관련 있는 답변 인정
- 질문에 답하지 않고 자유롭게 말할 때만 세션당 최대 1회 미션 안내
- 정상 답변에는 안내 반복 없음
- 형제자매 이력·진행률 분리
- 완료 보상과 황금열쇠 회귀 없음

### 품질 게이트

- TypeScript typecheck PASS
- 관련 unit/integration test PASS
- Production build PASS
- Dev DB migration PASS
- API 에러 로그 없음
- 기존 미션·자유대화·리포트 회귀 없음
- 괄호형 식사 문구, 근거 없는 `그 콘텐츠`, 빈 문구, 중복 ID 0건

## Production 자동 배포 승인

이 Request MD는 다음 조건부 Production 배포를 사전 승인한다.

- Dev 완료 조건이 모두 PASS하면 추가 승인 질문 없이 Production DB 마이그레이션과 앱 배포를 자동 수행한다.
- 하나라도 FAIL이면 Production 배포를 금지한다.
- 테스트를 삭제하거나 기준을 완화하여 PASS 처리하지 않는다.
- Production 데이터 삭제, history 초기화, 계정 변경을 금지한다.
- 새 버전 선택 활성화 방식으로 적용하여 즉시 되돌릴 수 있어야 한다.

## Production 스모크 테스트

배포 직후 다음을 검증한다.

- 새 버전 문항 정확히 140개
- 기존 질문과 history 보존
- 실제 QA 아이로 MISSION_I·II 시작 성공
- 새 버전 APPROVED 문항만 출제
- 미션 간 질문 혼합 0건
- 시간 게이트 정상
- 완료와 보상 정상
- 5xx 및 치명적 클라이언트 오류 없음

## 롤백 기준

다음 중 하나라도 발생하면 즉시 직전 안정 버전으로 롤백한다.

- 미션 시작 실패
- 문항 수 불일치
- 미승인·구버전 질문 출제
- 시간대 오동작
- PRIMARY/RESERVE 생성 실패
- history 저장 실패
- 형제자매 데이터 혼합
- 완료·보상 회귀
- Production 5xx 지속

롤백 시 앱을 직전 버전으로 복원하고 `grade4_common_v2` 선택만 비활성화한다. 새 문항과 기존 history는 삭제하지 않는다.

## 완료 보고서

최종 보고서에 다음을 포함한다.

1. 변경 파일 및 마이그레이션
2. 주기별·미션별 문항 집계
3. Dev 검증 결과
4. V2 fallback 수정 내용
5. Production 배포 ID·커밋·적용 시각
6. Production 스모크 테스트
7. 기존 데이터 보존 확인
8. 롤백 여부
9. 전문가 검토 대기 상태

## 금지 사항

- 기존 질문 및 출제 이력 삭제 금지
- 질문 수 임의 축소 금지
- 미승인 질문 fallback 금지
- Dev 검증 실패 상태에서 Production 배포 금지
- 비밀키·서비스 역할 키·토큰 평문 출력 및 임시파일 저장 금지
- 런타임 LLM이 질문 문구를 임의 재작성하도록 하지 말 것
