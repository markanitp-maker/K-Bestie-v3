# 066 — 초등학교 1학년 미션 질문지 140문항 등록

## 1. 작업 목적

초등학교 1학년(만 6~7세) 발달 수준에 맞춘 미션 질문지 140문항을 새 버전으로 등록한다. 이번 작업은 1학년 전용 질문지이며 다른 학년 질문지와 섞어 출제하지 않는다.

Development에서 DB·API·실제 미션 흐름을 모두 검증한 뒤, 완료 조건이 전부 PASS하면 별도 승인 요청 없이 Production까지 자동 배포한다.

## 2. 질문지 버전 및 적용 대상

- 질문지 버전: `grade1_v1`
- 적용 학년: 초등학교 1학년만
- `source_grade=1`
- `applicable_grades=[1]`
- 기존 4학년 질문지와 기존 출제 이력은 삭제·덮어쓰기 금지
- 1학년 아이에게 다른 학년 질문지가 fallback으로 출제되지 않도록 fail-closed 적용
- 실제 출제 조건:
  - `questionnaire_version='grade1_v1'`
  - `is_active=true`
  - `clinical_status='APPROVED'`
- 상담사 검증 전 초안이므로 별도 상태:
  - `expert_review_status='PENDING_REVIEW'`
- `clinical_status`는 서비스 출제 승인 상태이며, 상담사 검증 완료를 의미하지 않는다.

## 3. 1학년 발달 원칙

대표가 제공한 1학년 원안을 기준으로 다음을 지킨다.

- 질문은 한 번 듣고 이해할 수 있도록 짧고 직접적으로 작성
- 추상적인 하루 전체 회고보다 `지금`, `오늘`, `한 가지` 중심
- 2지 또는 3지 선택형과 짧은 개방형을 혼합
- 선택지를 고른 뒤 아이가 더 말하면 자연스럽게 받되 추가 설명을 강요하지 않음
- 감정은 복잡한 감정어보다 얼굴·날씨·색깔·동물 표현을 우선 사용
- 집중 시간 3~5분을 고려해 질문과 반응을 짧게 유지
- 학교 적응, 친구 놀이, 몸 상태, 작은 성취를 주요 영역으로 배치
- `왜 그렇게 느꼈어?` 같은 원인 추궁 금지
- `몰라`, `없어`, `넘어갈래`는 정상 답변으로 처리하고 추가 추궁하지 않음

## 4. 미션 운영 시간

서비스 접근 시간은 기존 운영 정책을 유지한다.

- 방학 `MISSION_I`: 10:00~17:50
- 학기 중 `MISSION_I`: 13:00~17:50
- `MISSION_II`: 18:00~23:50

단, 1학년은 취침 시간을 고려해 다음 UX를 추가한다.

- 권장 완료 시간: 20:30~21:00
- 20:30 이후에는 `이제 잘 준비할 시간이야. 짧게 이야기하고 마무리하자.` 안내를 세션당 1회만 제공
- 권장 시간은 경고·차단이 아니며 서비스 접근 상한은 23:50 유지
- 운영 시간이 서로 다른 목적이므로 접근 시간과 권장 수면 안내를 혼합하지 말 것

## 5. 문항 배분

| 주기 | MISSION_I | MISSION_II | 합계 |
|---|---:|---:|---:|
| DAILY | 56 | 56 | 112 |
| WEEKLY | 8 | 8 | 16 |
| MONTHLY | 4 | 4 | 8 |
| QUARTERLY | 2 | 2 | 4 |
| 합계 | 70 | 70 | 140 |

## 6. 출제 방식

- 각 미션은 유효 답변 10개를 받아야 완료
- 세션마다 `PRIMARY 10개 + RESERVE 10개`
- `FIXED` 질문 및 도래한 `WEEKLY/MONTHLY/QUARTERLY` 질문을 PRIMARY 앞부분에 배치
- 주기 질문이 들어가도 총 질문 수는 늘리지 않고 DAILY ROTATION 질문을 대체
- MISSION_I와 MISSION_II 질문 풀을 완전히 분리
- 같은 영역은 한 세션 최대 2문항
- `daily_once_key`가 같은 질문은 MISSION_I·II 합산 하루 최대 1회
- 최근 출제 질문을 우선 회피
- 형제자매별 질문 이력과 진행 상태를 분리
- 꼬리 질문은 유효 답변 수에 포함하지 않음
- 1학년의 짧고 관련 있는 답변은 유효 답변으로 인정
- 선택형 답변은 아이가 선택지를 분명히 고르면 유효 답변으로 인정

## 7. 선택형 질문 규칙

- `CHOICE_2`: 두 선택지를 음성으로 짧게 제시
- `CHOICE_3`: 세 선택지를 음성으로 짧게 제시
- `CHOICE_YN_OPEN`: `응/아니` 또는 짧은 추가 설명 모두 허용
- 선택지를 고르지 않고 직접 다른 답을 말해도 질문과 관련 있으면 유효 답변
- 선택형 질문을 아이의 말을 제한하거나 특정 답으로 유도하는 방식으로 사용하지 말 것
- 위기 신호가 의심되는 상황에서는 선택형 확인 질문을 새로 생성하지 말고 기존 안전 전환 로직으로 즉시 넘길 것

## 8. AI·비밀 고지

140문항과 분리된 시스템 고지로 관리한다.

### AI 고지

`나는 진짜 사람은 아니고, 케이라는 AI 친구야. 그래도 네 얘기 잘 들어줄게!`

### 비밀 한계 고지

`우리 얘기는 비밀이야. 근데 네가 아프거나 위험한 일이 있으면, 너를 도와줄 수 있는 어른한테 꼭 알려줄 거야. 알았지?`

구현 원칙:

- 첫 대화에서 반드시 고지
- 기존 주기적 반복 정책이 있으면 재사용
- 부모가 위험 원인일 가능성이 있는 상황을 단순 부모 자동 알림으로 처리하지 말고 기존 별도 안전 경로 사용
- 법률·임상 검토 전까지 이 문구를 임상적·법적으로 최종 검증됐다고 표시하지 말 것

## 9. 위기 신호 전환

전 학년 공통 섹션 0을 유지하되 1학년 간접 표현을 별도로 고려한다.

- 명시적 자해·타해 언급
- 학대·성적 피해·심한 괴롭힘 암시
- 지속적 절망·무가치감
- 반복되는 `학교 가기 싫어`, `배 아파`, `무서워`, 놀이 속 피해 표현 등 간접·신체화 신호

주의:

- 간접 신호 하나만으로 위기 확정 금지
- 위기 신호 감지 레이어는 상담사 검증 대상
- 위기 전환 후 일반 질문, 꼬리 질문, 생성형 탐색 질문 즉시 중단
- 사건·인물·장소 캐묻기 금지
- 고정된 감정 인정과 믿을 수 있는 어른·공식 자원 연결 흐름 사용
- 위기 대응 문구는 LLM이 자유 생성하지 않도록 기존 고정 템플릿 사용

## 10. 주기 스케줄

- `DAILY`: 해당 미션이 열리는 날마다 후보
- `WEEKLY`: MISSION_I 토요일, MISSION_II 일요일에 각 1문항씩 순환
- `MONTHLY`: 매월 마지막 주 각 미션별 1문항
- `QUARTERLY`: 1·4·7·10월 첫 성공 미션에서 각 미션별 1문항
- 예정일에 미션을 하지 않으면 같은 주·월·분기 내 다음 성공 미션으로 1회 이월
- 동일 기간에 이미 출제한 주기 질문은 재출제 금지
- 한국 시간대 및 아이별 `business_date` 기준

## 11. V2 질문 엔진 안전 조건

- 1학년은 `grade1_v1` 질문만 선택
- APPROVED 활성 질문 외 출제 금지
- 문항 부족 시 다른 학년 또는 레거시 질문 풀 fallback 금지
- 실패 시 fail-closed하고 원인을 로그에 남김
- `engine_version='v2-grade1-v1'` 기록
- 실제 아이에게 전송된 질문에만 `asked_at` 기록
- 후보 선택과 실제 출제 이력을 구분

## 12. 데이터 모델

기존 스키마를 우선 재사용하되 다음 의미를 보존한다.

- `question_id`
- `questionnaire_version`
- `source_grade`
- `applicable_grades`
- `frequency`
- `mission_slot`
- `selection_type`
- `question_area`
- `question_text`
- `answer_mode`
- `daily_once_key`
- `sensitivity`
- `is_active`
- `clinical_status`
- `expert_review_status`
- `sort_order`
- `metadata`

마이그레이션과 seed는 멱등적으로 작성하고 `(questionnaire_version, question_id)`를 고유하게 보장한다.

## 13. 등록할 140문항

아래 문항 ID와 문구를 그대로 등록한다. 불가피한 맞춤법·조사 변경이 있으면 완료 보고서에 변경 전후를 기록한다.

| 문항 ID | 주기 | 미션 | 유형 | 영역 | 답변 방식 | 질문 | daily_once_key | 민감도 |
|---|---|---|---|---|---|---|---|---|
| Q1-D-M1-001 | DAILY | MISSION_I | FIXED | 학교 적응 | OPEN_SHORT | 오늘 학교에서 제일 재미있었던 거 하나만 말해줄래? | daily_opening | LOW |
| Q1-D-M1-002 | DAILY | MISSION_I | ROTATION | 학교 적응 | CHOICE_2 | 오늘 학교에 갈 때 기분이 어땠어? |  | LOW |
| Q1-D-M1-003 | DAILY | MISSION_I | ROTATION | 학교 적응 | CHOICE_2 | 오늘 교실에 들어갔을 때 편했어, 조금 떨렸어? |  | LOW |
| Q1-D-M1-004 | DAILY | MISSION_I | ROTATION | 학교 적응 | OPEN_SHORT | 오늘 학교에서 처음 한 일은 뭐였어? |  | LOW |
| Q1-D-M1-005 | DAILY | MISSION_I | ROTATION | 학교 적응 | OPEN_SHORT | 오늘 학교에서 제일 기억나는 곳은 어디야? |  | LOW |
| Q1-D-M1-006 | DAILY | MISSION_I | ROTATION | 학교 적응 | CHOICE_YN_OPEN | 오늘 학교에서 어려웠던 게 있었어? 없으면 넘어가도 돼. |  | LOW |
| Q1-D-M1-007 | DAILY | MISSION_I | ROTATION | 학교 적응 | CHOICE_YN_OPEN | 오늘 학교에서 무서웠던 게 있었어? 없으면 넘어가도 돼. |  | LOW |
| Q1-D-M1-008 | DAILY | MISSION_I | ROTATION | 학교 적응 | OPEN_SHORT | 오늘 선생님이 해준 말 중에 기억나는 게 있어? |  | LOW |
| Q1-D-M1-009 | DAILY | MISSION_I | ROTATION | 학교 적응 | CHOICE_YN_OPEN | 오늘 학교에서 웃은 일이 있었어? |  | LOW |
| Q1-D-M1-010 | DAILY | MISSION_I | ROTATION | 학교 적응 | OPEN_SHORT | 오늘 학교에서 다시 하고 싶은 게 있어? |  | LOW |
| Q1-D-M1-011 | DAILY | MISSION_I | ROTATION | 학교 적응 | CHOICE_YN_OPEN | 오늘 학교에서 하기 싫었던 게 있었어? 없으면 넘어가도 돼. |  | LOW |
| Q1-D-M1-012 | DAILY | MISSION_I | ROTATION | 수업·활동 | CHOICE_2 | 오늘 그림 그렸어, 글씨 썼어? |  | LOW |
| Q1-D-M1-013 | DAILY | MISSION_I | ROTATION | 수업·활동 | CHOICE_YN_OPEN | 오늘 책에서 재미있는 그림을 봤어? |  | LOW |
| Q1-D-M1-014 | DAILY | MISSION_I | ROTATION | 수업·활동 | CHOICE_YN_OPEN | 오늘 숫자나 글자를 새로 배웠어? |  | LOW |
| Q1-D-M1-015 | DAILY | MISSION_I | ROTATION | 수업·활동 | CHOICE_YN_OPEN | 오늘 만들기나 색칠을 했어? |  | LOW |
| Q1-D-M1-016 | DAILY | MISSION_I | ROTATION | 수업·활동 | CHOICE_YN_OPEN | 오늘 노래하거나 몸을 움직였어? |  | LOW |
| Q1-D-M1-017 | DAILY | MISSION_I | ROTATION | 수업·활동 | OPEN_SHORT | 오늘 수업에서 쉬웠던 건 뭐였어? |  | LOW |
| Q1-D-M1-018 | DAILY | MISSION_I | ROTATION | 수업·활동 | OPEN_SHORT | 오늘 수업에서 조금 어려웠던 건 뭐였어? 없으면 넘어가도 돼. |  | LOW |
| Q1-D-M1-019 | DAILY | MISSION_I | ROTATION | 수업·활동 | OPEN_SHORT | 오늘 제일 잘했다고 생각하는 건 뭐야? |  | LOW |
| Q1-D-M1-020 | DAILY | MISSION_I | ROTATION | 수업·활동 | OPEN_SHORT | 오늘 다시 해보고 싶은 수업이 있어? |  | LOW |
| Q1-D-M1-021 | DAILY | MISSION_I | ROTATION | 수업·활동 | CHOICE_2 | 오늘 수업할 때 조용했어, 신났어? |  | LOW |
| Q1-D-M1-022 | DAILY | MISSION_I | ROTATION | 친구·놀이 | OPEN_SHORT | 오늘 누구랑 놀았어? |  | LOW |
| Q1-D-M1-023 | DAILY | MISSION_I | ROTATION | 친구·놀이 | OPEN_SHORT | 오늘 무슨 놀이 했어? |  | LOW |
| Q1-D-M1-024 | DAILY | MISSION_I | ROTATION | 친구·놀이 | CHOICE_YN_OPEN | 오늘 친구랑 같이 웃은 일이 있었어? |  | LOW |
| Q1-D-M1-025 | DAILY | MISSION_I | ROTATION | 친구·놀이 | CHOICE_YN_OPEN | 오늘 친구랑 나눠 쓴 게 있었어? |  | LOW |
| Q1-D-M1-026 | DAILY | MISSION_I | ROTATION | 친구·놀이 | CHOICE_YN_OPEN | 오늘 친구가 도와준 일이 있었어? |  | LOW |
| Q1-D-M1-027 | DAILY | MISSION_I | ROTATION | 친구·놀이 | CHOICE_YN_OPEN | 오늘 네가 친구를 도와준 일이 있었어? |  | LOW |
| Q1-D-M1-028 | DAILY | MISSION_I | ROTATION | 친구·놀이 | CHOICE_2 | 오늘 혼자 놀았어, 친구랑 놀았어? |  | LOW |
| Q1-D-M1-029 | DAILY | MISSION_I | ROTATION | 친구·놀이 | CHOICE_YN_OPEN | 오늘 같이 놀고 싶었던 친구가 있었어? |  | LOW |
| Q1-D-M1-030 | DAILY | MISSION_I | ROTATION | 친구·놀이 | CHOICE_YN_OPEN | 오늘 친구 때문에 속상한 일이 있었어? 없으면 넘어가도 돼. |  | LOW |
| Q1-D-M1-031 | DAILY | MISSION_I | ROTATION | 친구·놀이 | OPEN_SHORT | 내일 친구랑 무슨 놀이 하고 싶어? |  | LOW |
| Q1-D-M1-032 | DAILY | MISSION_I | ROTATION | 쉬는 시간 | OPEN_SHORT | 오늘 쉬는 시간에 뭐 했어? |  | LOW |
| Q1-D-M1-033 | DAILY | MISSION_I | ROTATION | 쉬는 시간 | CHOICE_2 | 오늘 운동장에서 놀았어, 교실에서 놀았어? |  | LOW |
| Q1-D-M1-034 | DAILY | MISSION_I | ROTATION | 쉬는 시간 | CHOICE_YN_OPEN | 오늘 제일 신나게 뛰었던 때가 있었어? |  | LOW |
| Q1-D-M1-035 | DAILY | MISSION_I | ROTATION | 쉬는 시간 | CHOICE_YN_OPEN | 오늘 조용히 쉬고 싶었던 때가 있었어? |  | LOW |
| Q1-D-M1-036 | DAILY | MISSION_I | ROTATION | 쉬는 시간 | CHOICE_2 | 오늘 쉬는 시간이 짧았어, 알맞았어? |  | LOW |
| Q1-D-M1-037 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | CHOICE_2 | 지금 배고파, 아니면 괜찮아? | hunger_daily | LOW |
| Q1-D-M1-038 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | CHOICE_2 | 지금 졸려, 아니면 괜찮아? | sleepiness_daily | LOW |
| Q1-D-M1-039 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | CHOICE_2 | 오늘 몸이 쌩쌩했어, 조금 피곤했어? |  | LOW |
| Q1-D-M1-040 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | CHOICE_2 | 오늘 많이 뛰었어, 조금 움직였어? |  | LOW |
| Q1-D-M1-041 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | OPEN_SHORT | 오늘 밥 뭐 먹었어? | meal_daily | LOW |
| Q1-D-M1-042 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | OPEN_SHORT | 오늘 먹은 것 중에 제일 맛있었던 건 뭐야? | meal_daily | LOW |
| Q1-D-M1-043 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | CHOICE_YN_OPEN | 오늘 물을 마셨을 때 시원했어? |  | LOW |
| Q1-D-M1-044 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | OPEN_SHORT | 오늘 어디가 불편했어? 없으면 넘어가도 돼. | body_discomfort_daily | LOW |
| Q1-D-M1-045 | DAILY | MISSION_I | ROTATION | 성취·자신감 | OPEN_SHORT | 오늘 '나 이거 잘했다!' 한 거 있어? |  | LOW |
| Q1-D-M1-046 | DAILY | MISSION_I | ROTATION | 성취·자신감 | CHOICE_YN_OPEN | 오늘 혼자 해낸 게 있어? |  | LOW |
| Q1-D-M1-047 | DAILY | MISSION_I | ROTATION | 성취·자신감 | CHOICE_YN_OPEN | 오늘 끝까지 해본 게 있어? |  | LOW |
| Q1-D-M1-048 | DAILY | MISSION_I | ROTATION | 성취·자신감 | CHOICE_YN_OPEN | 오늘 처음 해본 게 있어? |  | LOW |
| Q1-D-M1-049 | DAILY | MISSION_I | ROTATION | 성취·자신감 | CHOICE_YN_OPEN | 오늘 선생님이나 친구가 잘했다고 해줬어? |  | LOW |
| Q1-D-M1-050 | DAILY | MISSION_I | ROTATION | 성취·자신감 | CHOICE_YN_OPEN | 오늘 네가 마음에 든 작품이나 글씨가 있어? |  | LOW |
| Q1-D-M1-051 | DAILY | MISSION_I | ROTATION | 좋아하는 것 | OPEN_SHORT | 요즘 제일 좋아하는 놀이는 뭐야? |  | LOW |
| Q1-D-M1-052 | DAILY | MISSION_I | ROTATION | 좋아하는 것 | OPEN_SHORT | 요즘 제일 좋아하는 색은 뭐야? |  | LOW |
| Q1-D-M1-053 | DAILY | MISSION_I | ROTATION | 좋아하는 것 | OPEN_SHORT | 요즘 제일 좋아하는 동물은 뭐야? |  | LOW |
| Q1-D-M1-054 | DAILY | MISSION_I | ROTATION | 좋아하는 것 | CHOICE_YN_OPEN | 요즘 제일 좋아하는 노래가 있어? |  | LOW |
| Q1-D-M1-055 | DAILY | MISSION_I | ROTATION | 좋아하는 것 | CHOICE_YN_OPEN | 요즘 재미있게 보는 만화나 영상이 있어? |  | LOW |
| Q1-D-M1-056 | DAILY | MISSION_I | ROTATION | 좋아하는 것 | OPEN_SHORT | 지금 딱 하나 하고 싶은 놀이는 뭐야? |  | LOW |
| Q1-W-M1-001 | WEEKLY | MISSION_I | ROTATION | 학교 적응 | OPEN_SHORT | 이번 주 학교에서 제일 재미있었던 건 뭐야? |  | LOW |
| Q1-W-M1-002 | WEEKLY | MISSION_I | ROTATION | 친구·놀이 | OPEN_SHORT | 이번 주에 누구랑 제일 많이 놀았어? |  | LOW |
| Q1-W-M1-003 | WEEKLY | MISSION_I | ROTATION | 수업·활동 | OPEN_SHORT | 이번 주에 새로 배운 것 하나만 말해줄래? |  | LOW |
| Q1-W-M1-004 | WEEKLY | MISSION_I | ROTATION | 성취·자신감 | OPEN_SHORT | 이번 주에 네가 제일 잘한 건 뭐야? |  | LOW |
| Q1-W-M1-005 | WEEKLY | MISSION_I | ROTATION | 학교 적응 | OPEN_SHORT | 이번 주 학교에서 어려웠던 게 있었어? 없으면 넘어가도 돼. |  | LOW |
| Q1-W-M1-006 | WEEKLY | MISSION_I | ROTATION | 친구·놀이 | OPEN_SHORT | 이번 주에 친구랑 같이 웃은 일이 있었어? |  | LOW |
| Q1-W-M1-007 | WEEKLY | MISSION_I | ROTATION | 몸·컨디션 | OPEN_SHORT | 이번 주에 제일 신나게 움직였던 때는 언제야? |  | LOW |
| Q1-W-M1-008 | WEEKLY | MISSION_I | ROTATION | 좋아하는 것 | OPEN_SHORT | 다음 주에 꼭 하고 싶은 놀이는 뭐야? |  | LOW |
| Q1-M-M1-001 | MONTHLY | MISSION_I | ROTATION | 학교 적응 | OPEN_SHORT | 이번 달 학교에서 제일 기억나는 일은 뭐야? |  | LOW |
| Q1-M-M1-002 | MONTHLY | MISSION_I | ROTATION | 성취·자신감 | OPEN_SHORT | 이번 달에 새로 잘하게 된 게 있어? |  | LOW |
| Q1-M-M1-003 | MONTHLY | MISSION_I | ROTATION | 친구·놀이 | OPEN_SHORT | 이번 달에 친구랑 제일 재미있었던 일은 뭐야? |  | LOW |
| Q1-M-M1-004 | MONTHLY | MISSION_I | ROTATION | 좋아하는 것 | OPEN_SHORT | 다음 달에 새로 해보고 싶은 건 뭐야? |  | LOW |
| Q1-Q-M1-001 | QUARTERLY | MISSION_I | ROTATION | 성취·자신감 | OPEN_SHORT | 세 달 전보다 더 잘하게 된 게 있어? |  | LOW |
| Q1-Q-M1-002 | QUARTERLY | MISSION_I | ROTATION | 학교 적응 | CHOICE_2 | 학교가 처음보다 더 편해졌어, 아직 조금 어려워? |  | LOW |
| Q1-D-M2-001 | DAILY | MISSION_II | FIXED | 좋았던 일 | OPEN_SHORT | 오늘 좋았던 거 하나 말해줄래? | rose | LOW |
| Q1-D-M2-002 | DAILY | MISSION_II | FIXED | 속상했던 일 | CHOICE_YN_OPEN | 오늘 속상했던 거 있었어? 없으면 넘어가도 돼. | thorn | MEDIUM |
| Q1-D-M2-003 | DAILY | MISSION_II | FIXED | 내일 기대 | OPEN_SHORT | 내일 뭐 하고 싶어? | bud | LOW |
| Q1-D-M2-004 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | CHOICE_3 | 오늘 기분은 웃는 얼굴, 그냥 얼굴, 우는 얼굴 중에 뭐야? | mood_format | LOW |
| Q1-D-M2-005 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | CHOICE_3 | 오늘 마음은 맑음, 구름, 비 중에 뭐야? | mood_format | LOW |
| Q1-D-M2-006 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | OPEN_SHORT | 오늘 기분을 색으로 고르면 무슨 색이야? | mood_format | LOW |
| Q1-D-M2-007 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | CHOICE_2 | 지금 마음은 편안해, 조금 불편해? | mood_format | MEDIUM |
| Q1-D-M2-008 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | CHOICE_2 | 오늘은 신났어, 그냥 그랬어? | mood_format | LOW |
| Q1-D-M2-009 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | CHOICE_YN_OPEN | 오늘 마음이 콩콩 뛰었던 때가 있었어? |  | LOW |
| Q1-D-M2-010 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | CHOICE_YN_OPEN | 오늘 마음이 축 처졌던 때가 있었어? |  | LOW |
| Q1-D-M2-011 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | CHOICE_YN_OPEN | 오늘 웃음이 난 때가 있었어? |  | LOW |
| Q1-D-M2-012 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | CHOICE_YN_OPEN | 오늘 눈물이 날 것 같았던 때가 있었어? 없으면 넘어가도 돼. |  | MEDIUM |
| Q1-D-M2-013 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | CHOICE_YN_OPEN | 오늘 화가 난 때가 있었어? 없으면 넘어가도 돼. |  | MEDIUM |
| Q1-D-M2-014 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | CHOICE_YN_OPEN | 오늘 무서웠던 게 있었어? 없으면 넘어가도 돼. |  | MEDIUM |
| Q1-D-M2-015 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | OPEN_SHORT | 지금 기분을 동물로 말하면 어떤 동물이야? | mood_format | LOW |
| Q1-D-M2-016 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | OPEN_SHORT | 오늘 제일 편했던 때는 언제야? |  | LOW |
| Q1-D-M2-017 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | OPEN_SHORT | 오늘 제일 신났던 때는 언제야? |  | LOW |
| Q1-D-M2-018 | DAILY | MISSION_II | ROTATION | 감정 그림·선택 | CHOICE_YN_OPEN | 지금 더 말하고 싶은 마음이 있어? 없으면 넘어가도 돼. |  | LOW |
| Q1-D-M2-019 | DAILY | MISSION_II | ROTATION | 가족·집 | OPEN_SHORT | 오늘 저녁 누구랑 먹었어? | meal_company_daily | LOW |
| Q1-D-M2-020 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_2 | 오늘 저녁 맛있었어, 그냥 그랬어? |  | LOW |
| Q1-D-M2-021 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_YN_OPEN | 오늘 집에서 재미있었던 일이 있었어? |  | LOW |
| Q1-D-M2-022 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_YN_OPEN | 오늘 가족이랑 같이 한 게 있어? |  | LOW |
| Q1-D-M2-023 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_YN_OPEN | 오늘 가족한테 말하고 싶은 게 있어? |  | LOW |
| Q1-D-M2-024 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_YN_OPEN | 오늘 집에서 네가 도와준 게 있어? |  | LOW |
| Q1-D-M2-025 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_YN_OPEN | 오늘 가족이 너를 도와준 게 있어? |  | LOW |
| Q1-D-M2-026 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_YN_OPEN | 오늘 집에서 많이 웃었어? |  | LOW |
| Q1-D-M2-027 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_YN_OPEN | 오늘 집에서 조용히 쉬었어? |  | LOW |
| Q1-D-M2-028 | DAILY | MISSION_II | ROTATION | 가족·집 | OPEN_SHORT | 내일 가족이랑 같이 하고 싶은 게 있어? |  | LOW |
| Q1-D-M2-029 | DAILY | MISSION_II | ROTATION | 믿을 수 있는 어른 | CHOICE_YN_OPEN | 오늘 선생님이 도와준 일이 있었어? |  | LOW |
| Q1-D-M2-030 | DAILY | MISSION_II | ROTATION | 믿을 수 있는 어른 | CHOICE_YN_OPEN | 오늘 어른에게 물어본 게 있었어? |  | LOW |
| Q1-D-M2-031 | DAILY | MISSION_II | ROTATION | 믿을 수 있는 어른 | CHOICE_YN_OPEN | 오늘 네 말을 잘 들어준 어른이 있었어? |  | LOW |
| Q1-D-M2-032 | DAILY | MISSION_II | ROTATION | 믿을 수 있는 어른 | OPEN_SHORT | 도움이 필요하면 누구한테 말하고 싶어? |  | LOW |
| Q1-D-M2-033 | DAILY | MISSION_II | ROTATION | 믿을 수 있는 어른 | CHOICE_YN_OPEN | 내일 선생님이나 어른에게 물어보고 싶은 게 있어? |  | LOW |
| Q1-D-M2-034 | DAILY | MISSION_II | ROTATION | 하루 마무리 | OPEN_SHORT | 오늘을 한 가지 색으로 말하면 무슨 색이야? | mood_format | LOW |
| Q1-D-M2-035 | DAILY | MISSION_II | ROTATION | 하루 마무리 | CHOICE_YN_OPEN | 오늘 다시 하고 싶은 일이 있어? |  | LOW |
| Q1-D-M2-036 | DAILY | MISSION_II | ROTATION | 하루 마무리 | CHOICE_YN_OPEN | 오늘 안 하고 싶은 일이 있었어? 없으면 넘어가도 돼. |  | LOW |
| Q1-D-M2-037 | DAILY | MISSION_II | ROTATION | 하루 마무리 | OPEN_SHORT | 오늘 가장 많이 웃은 때는 언제야? |  | LOW |
| Q1-D-M2-038 | DAILY | MISSION_II | ROTATION | 하루 마무리 | OPEN_SHORT | 오늘 가장 조용했던 때는 언제야? |  | LOW |
| Q1-D-M2-039 | DAILY | MISSION_II | ROTATION | 하루 마무리 | CHOICE_YN_OPEN | 오늘 고마운 사람이 있어? |  | LOW |
| Q1-D-M2-040 | DAILY | MISSION_II | ROTATION | 하루 마무리 | CHOICE_YN_OPEN | 오늘 네가 누군가를 웃게 했어? |  | LOW |
| Q1-D-M2-041 | DAILY | MISSION_II | ROTATION | 하루 마무리 | OPEN_SHORT | 오늘 하나만 꼭 기억한다면 뭐야? |  | LOW |
| Q1-D-M2-042 | DAILY | MISSION_II | ROTATION | 하루 마무리 | CHOICE_YN_OPEN | 오늘 생각보다 잘된 일이 있었어? |  | LOW |
| Q1-D-M2-043 | DAILY | MISSION_II | ROTATION | 하루 마무리 | CHOICE_YN_OPEN | 오늘 계획과 다르게 된 일이 있었어? |  | LOW |
| Q1-D-M2-044 | DAILY | MISSION_II | ROTATION | 성취·자신감 | OPEN_SHORT | 오늘 혼자 해낸 걸 하나 말해줄래? |  | LOW |
| Q1-D-M2-045 | DAILY | MISSION_II | ROTATION | 성취·자신감 | CHOICE_YN_OPEN | 오늘 끝까지 해본 게 있어? |  | LOW |
| Q1-D-M2-046 | DAILY | MISSION_II | ROTATION | 성취·자신감 | CHOICE_YN_OPEN | 오늘 용기 내서 해본 게 있어? |  | LOW |
| Q1-D-M2-047 | DAILY | MISSION_II | ROTATION | 성취·자신감 | CHOICE_YN_OPEN | 오늘 다시 해본 게 있어? |  | LOW |
| Q1-D-M2-048 | DAILY | MISSION_II | ROTATION | 성취·자신감 | OPEN_SHORT | 오늘 네가 잘했다고 생각하는 건 뭐야? |  | LOW |
| Q1-D-M2-049 | DAILY | MISSION_II | ROTATION | 성취·자신감 | OPEN_SHORT | 오늘 배운 것 중 내일 또 해보고 싶은 게 있어? |  | LOW |
| Q1-D-M2-050 | DAILY | MISSION_II | ROTATION | 성취·자신감 | CHOICE_YN_OPEN | 오늘의 너에게 '잘했어'라고 말해줄 일이 있어? |  | LOW |
| Q1-D-M2-051 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 내일 아침에 제일 먼저 하고 싶은 건 뭐야? |  | LOW |
| Q1-D-M2-052 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 내일 재미있는 일이 생기면 뭐면 좋겠어? |  | LOW |
| Q1-D-M2-053 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 내일 누구랑 놀고 싶어? |  | LOW |
| Q1-D-M2-054 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 내일의 너한테 '힘내!' 말해줄래? |  | LOW |
| Q1-D-M2-055 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 지금 이불 속에 들어가면 하고 싶은 생각이 있어? |  | LOW |
| Q1-D-M2-056 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | CHOICE_2 | 지금 마음 편안해? 잘 자자. | bedtime_closing | LOW |
| Q1-W-M2-001 | WEEKLY | MISSION_II | ROTATION | 좋았던 일 | OPEN_SHORT | 이번 주에 제일 좋았던 일은 뭐야? |  | LOW |
| Q1-W-M2-002 | WEEKLY | MISSION_II | ROTATION | 속상했던 일 | OPEN_SHORT | 이번 주에 속상했던 일이 있었어? 없으면 넘어가도 돼. |  | MEDIUM |
| Q1-W-M2-003 | WEEKLY | MISSION_II | ROTATION | 감정 그림·선택 | OPEN_SHORT | 이번 주 마음은 맑음, 구름, 비 중에 뭐가 제일 많았어? |  | LOW |
| Q1-W-M2-004 | WEEKLY | MISSION_II | ROTATION | 가족·집 | OPEN_SHORT | 이번 주 가족이랑 제일 재미있었던 일은 뭐야? |  | LOW |
| Q1-W-M2-005 | WEEKLY | MISSION_II | ROTATION | 친구·놀이 | OPEN_SHORT | 이번 주 친구랑 제일 재미있었던 놀이는 뭐야? |  | LOW |
| Q1-W-M2-006 | WEEKLY | MISSION_II | ROTATION | 성취·자신감 | OPEN_SHORT | 이번 주에 네가 제일 잘한 건 뭐야? |  | LOW |
| Q1-W-M2-007 | WEEKLY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 다음 주에 제일 기다려지는 건 뭐야? |  | LOW |
| Q1-W-M2-008 | WEEKLY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 다음 주의 너한테 무슨 말을 해주고 싶어? |  | LOW |
| Q1-M-M2-001 | MONTHLY | MISSION_II | ROTATION | 감정 그림·선택 | CHOICE_3 | 이번 달 기분은 웃는 얼굴, 그냥 얼굴, 우는 얼굴 중에 뭐가 제일 많았어? |  | LOW |
| Q1-M-M2-002 | MONTHLY | MISSION_II | ROTATION | 성취·자신감 | OPEN_SHORT | 이번 달에 네가 제일 뿌듯했던 건 뭐야? |  | LOW |
| Q1-M-M2-003 | MONTHLY | MISSION_II | ROTATION | 관계 | OPEN_SHORT | 이번 달에 고마운 사람이 있어? |  | LOW |
| Q1-M-M2-004 | MONTHLY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 다음 달에 꼭 해보고 싶은 건 뭐야? |  | LOW |
| Q1-Q-M2-001 | QUARTERLY | MISSION_II | ROTATION | 안전망 | CHOICE_YN_OPEN | 힘들 때 말할 수 있는 어른이 있어? |  | MEDIUM |
| Q1-Q-M2-002 | QUARTERLY | MISSION_II | ROTATION | 성취·자신감 | OPEN_SHORT | 세 달 전보다 더 잘하게 된 게 있어? |  | LOW |


## 14. 자연스러움·금지 표현 검사

다음 문구 또는 패턴이 질문지와 런타임 생성 질문에 나타나면 실패 처리한다.

- `오늘 하루 전체적으로 어땠어?`
- `기분이 복잡해?`
- `왜 그렇게 느꼈어?`
- `왜 그랬어?`
- `진짜야?`
- `그거 나쁜 거 아니야?`
- `점심(또는 저녁)`
- 근거 없는 `그 콘텐츠`, `그 친구`, `전에 말한 것`
- 위기 확인을 위한 유도형 선택 질문

## 15. Dev 검증 완료 조건

### 데이터 검증

- `grade1_v1` 정확히 140개
- MISSION_I 70 / MISSION_II 70
- DAILY 112 / WEEKLY 16 / MONTHLY 8 / QUARTERLY 4
- 질문 ID 중복 0건
- 빈 질문 0건
- 1학년 이외 적용 학년 포함 0건
- seed 재실행 후 140개 유지
- 기존 질문과 history 보존
- 모든 서비스 출제 문항 `clinical_status='APPROVED'`
- 모든 문항 `expert_review_status='PENDING_REVIEW'`

### 선택 로직 검증

- 1학년 아이에게 `grade1_v1` 질문만 출제
- 다른 학년 질문 fallback 0건
- PRIMARY 10 + RESERVE 10
- 미션 간 질문 혼합 0건
- 동일 영역 세션 최대 2개
- 같은 `daily_once_key` 하루 중복 0건
- 주간·월간·분기 기간 중복 0건
- 선택형 직접 답변도 관련 있으면 유효 처리
- 짧은 답변 유효성 회귀 없음
- `engine_version='v2-grade1-v1'`

### 실제 사용자 흐름

Dev 1학년 테스트 아이 최소 2명으로 확인한다.

- MISSION_I 시작→10개 유효 답변→완료
- MISSION_II 시작→고정 3문항 포함→10개 유효 답변→완료
- 아이가 `몰라`, `없어`, `넘어갈래`라고 했을 때 추궁 없음
- 질문에 답하지 않고 자유롭게 말할 때만 세션당 최대 1회 미션 안내
- 정상 답변에는 안내 반복 없음
- 형제자매 상태 격리
- 보상 및 황금열쇠 정책 회귀 없음
- 20:30 이후 권장 수면 안내 1회
- 20:30 이전 권장 수면 안내 없음

### 품질 게이트

- TypeScript typecheck PASS
- 관련 unit/integration test PASS
- Production build PASS
- Dev DB migration PASS
- API 오류 없음
- 기존 4학년 질문지와 기존 미션 회귀 없음
- 금지 표현 자동 검사 PASS
- 로그에 아이 발화·개인정보·비밀키 원문 노출 없음

## 16. Production 자동 배포 승인

이 Request MD는 조건부 Production 배포를 사전 승인한다.

- Dev 완료 조건이 모두 PASS하면 추가 승인 요청 없이 Production DB 마이그레이션과 앱 배포 진행
- 하나라도 FAIL이면 Production 배포 금지
- 테스트 삭제·완화로 PASS 처리 금지
- 기존 질문·history·아이 계정 삭제 금지
- 새 버전 활성화 방식으로 적용하여 즉시 롤백 가능하게 구현

## 17. Production 스모크 테스트

- Production `grade1_v1` 정확히 140문항
- 기존 4학년 질문지 및 history 보존
- Production QA 1학년 아이로 MISSION_I·II 시작 성공
- 1학년 질문만 출제
- 미승인·다른 학년·레거시 질문 출제 0건
- 시간 게이트 정상
- 권장 수면 안내 정상
- 완료·보상 정상
- 치명적 5xx 및 클라이언트 오류 없음

## 18. 롤백 기준

다음 중 하나라도 발생하면 직전 안정 버전으로 즉시 롤백한다.

- 미션 시작 실패
- 문항 수 불일치
- 다른 학년 또는 미승인 질문 출제
- PRIMARY/RESERVE 생성 실패
- 질문 이력 저장 실패
- 시간 게이트 또는 권장 수면 안내 오동작
- 형제자매 데이터 혼합
- 완료·보상 회귀
- Production 5xx 지속

롤백 시 앱 버전을 복원하고 `grade1_v1` 선택만 비활성화한다. 새 질문과 기존 history는 삭제하지 않는다.

## 19. 완료 보고서

1. 변경 파일 및 마이그레이션
2. 문항 수와 주기·미션별 집계
3. 답변 방식별 집계
4. Dev 검증 결과
5. Production 배포 ID·커밋·적용 시각
6. Production 스모크 테스트
7. 다른 학년 질문과 분리 확인
8. 기존 데이터 보존 확인
9. 롤백 여부
10. 상담사 검토 대기 상태

## 20. 금지 사항

- 기존 질문 및 history 삭제 금지
- 질문 수 임의 축소 금지
- 다른 학년 질문 fallback 금지
- Dev 실패 상태에서 Production 배포 금지
- 서비스 역할 키·토큰·비밀번호 평문 출력 또는 임시파일 저장 금지
- 런타임 LLM의 질문 문구 임의 재작성 금지
- 아이 응답을 유도하기 위한 선택지 변경 금지
