# 068 — 초등학교 3학년 미션 질문지 140문항 등록

## 1. 작업 목적

초등학교 3학년(만 8~9세) 발달 수준에 맞춘 미션 질문지 140문항을 새 버전으로 등록한다. 3학년 질문지는 기존 1·2·4학년 질문지와 분리하며, 다른 학년 질문이 fallback으로 섞이지 않도록 한다.

Development에서 DB·API·실제 미션 흐름 검증을 모두 통과하면 별도 승인 요청 없이 Production까지 자동 배포한다.

## 2. 질문지 버전 및 적용 대상

- 질문지 버전: `grade3_v1`
- 적용 학년: 초등학교 3학년만
- `source_grade=3`
- `applicable_grades=[3]`
- 기존 1·2·4학년 질문지 및 모든 출제 이력 보존
- 실제 출제 조건:
  - `questionnaire_version='grade3_v1'`
  - `is_active=true`
  - `clinical_status='APPROVED'`
- 상담사 검증 전 상태:
  - `expert_review_status='PENDING_REVIEW'`
- `clinical_status`는 서비스 출제 승인 상태이며 전문가 검증 완료를 의미하지 않는다.

## 3. 3학년 발달 원칙

대표가 제공한 3학년 원안을 기준으로 다음을 적용한다.

- 짧은 개방형 질문을 기본으로 사용
- `속상해`, `답답해`, `억울해`, `불공평해` 등 3학년이 이해할 수 있는 감정어 사용
- 감정 표현이 어려운 아이에게만 이모지·마음 날씨·점수 보조 제공
- 또래 소속감, 친구 관계, 학교·학원 경험, 공정함, 성취를 균형 있게 질문
- 한 문장에 한 가지 내용만 질문
- 사생활이나 가족 관계를 깊게 캐묻지 않음
- `왜?` 대신 `그다음엔 어떻게 됐어?`, `그때 기분은 어땠어?` 사용
- `없어`, `몰라`, `넘어갈래`는 정상적인 거절로 인정
- 4학년 수준의 복잡한 관계 분석이나 추상 질문은 사용하지 않음

## 4. 미션 운영 시간

서비스 접근 시간은 공통 운영 정책을 유지한다.

- 방학 `MISSION_I`: 10:00~17:50
- 학기 중 `MISSION_I`: 13:00~17:50
- `MISSION_II`: 18:00~23:50

3학년 취침 UX:

- 권장 완료 시간: 21:30
- 21:15 이후 `이제 잘 준비할 시간이야. 오늘 이야기는 짧게 마무리하자.` 안내를 세션당 1회
- 권장 안내는 차단이 아니며 접근 상한은 23:50 유지
- 접근 시간과 권장 취침 안내를 분리된 설정으로 관리

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
- FIXED 및 도래한 WEEKLY/MONTHLY/QUARTERLY 문항을 PRIMARY 앞부분에 배치
- 주기 문항은 DAILY ROTATION 문항을 대체하며 총 질문 수를 늘리지 않음
- MISSION_I와 MISSION_II 질문 풀 완전 분리
- 같은 영역은 한 세션 최대 2문항
- 같은 `daily_once_key`는 MISSION_I·II 합산 하루 최대 1회
- 최근 출제 질문 우선 회피
- 형제자매 질문 이력과 진행 상태 격리
- 짧지만 관련 있는 답변은 유효 답변으로 인정
- 꼬리 질문은 유효 답변 수에 포함하지 않음

## 7. 답변 방식

- `OPEN_SHORT`: 한 단어 또는 짧은 문장
- `CHOICE_2`: 두 선택지 또는 아이의 직접 표현
- `CHOICE_4`: 네 선택지 또는 아이의 직접 표현
- `CHOICE_YN_OPEN`: `응/아니`와 짧은 추가 설명
- `SCALE_1_10`: 1~10 숫자 선택, 이유 설명은 선택사항
- 선택지 밖 답변도 질문과 관련 있으면 유효
- 감정 점수·날씨·색깔·이모지는 모두 `mood_format`으로 묶어 하루 최대 1회

## 8. AI·비밀 고지

140문항과 분리된 시스템 고지로 관리한다.

### AI 고지

`나는 사람이 아니라 AI 친구 케이야. 그래도 네 얘기 진짜 잘 들어줄게.`

### 비밀 한계 고지

`우리 얘기는 대부분 비밀인데, 네가 위험하거나 많이 다칠 수 있는 일이면 너를 도와줄 수 있는 어른한테 알려줄 거야. 약속.`

구현 원칙:

- 첫 대화에서 반드시 고지
- 기존 주기적 반복 정책 재사용
- 부모가 위험 원인일 가능성이 있는 상황은 단순 부모 자동 알림으로 처리하지 않고 기존 별도 안전 경로 사용
- 법률·임상 검토 전까지 최종 검증 문구로 표시하지 않음

## 9. 위기 신호 전환

전 학년 공통 안전 전환 규칙을 유지한다.

- 명시적 자해·타해 언급
- 학대·성적 피해·심한 괴롭힘 암시
- 지속적 절망·무가치감
- 반복되는 학교 회피, 신체화, 두려움, 특정 인물·장소 회피
- `아무도 내 편이 아니야`, `없어지고 싶어` 등 간접·은유 표현

주의:

- 간접 신호 하나만으로 위기 확정 금지
- 위기 전환 후 일반 질문·꼬리 질문 즉시 중단
- 사건·인물·장소 캐묻기 금지
- 생성형 자유 탐색 금지
- 기존 고정 안전 템플릿과 별도 안전 경로 사용
- 감지 규칙은 상담사 검증 대상임을 명시

## 10. 주기 스케줄

- `DAILY`: 해당 미션이 열리는 날마다 후보
- `WEEKLY`: MISSION_I 토요일, MISSION_II 일요일에 각 1문항
- `MONTHLY`: 매월 마지막 주 각 미션별 1문항
- `QUARTERLY`: 1·4·7·10월 첫 성공 미션에 각 미션별 1문항
- 예정일 미진행 시 같은 주·월·분기 내 다음 성공 미션으로 1회 이월
- 같은 기간 이미 출제한 주기 문항 재출제 금지
- 한국 시간대와 아이별 `business_date` 기준

## 11. V2 질문 엔진 안전 조건

- 3학년은 `grade3_v1` 질문만 선택
- APPROVED 활성 문항 외 출제 금지
- 문항 부족 시 다른 학년·구버전·레거시 질문 fallback 금지
- 조회 실패 또는 문항 부족 시 fail-closed
- `engine_version='v2-grade3-v1'` 기록
- 실제 아이에게 전송된 질문에만 `asked_at` 기록
- 후보 선택 이력과 실제 출제 이력 구분

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

아래 문항 ID와 문구를 그대로 등록한다. 불가피한 맞춤법·조사 수정이 있으면 완료 보고서에 변경 전후를 기록한다.

| 문항 ID | 주기 | 미션 | 유형 | 영역 | 답변 방식 | 질문 | daily_once_key | 민감도 |
|---|---|---|---|---|---|---|---|---|
| Q3-D-M1-001 | DAILY | MISSION_I | FIXED | 하루 열기 | OPEN_SHORT | 오늘 하루 중에 제일 기억에 남는 일 하나 얘기해줘. | daily_opening | LOW |
| Q3-D-M1-002 | DAILY | MISSION_I | ROTATION | 학교·수업 | OPEN_SHORT | 오늘 학교에서 제일 먼저 떠오르는 일은 뭐야? |  | LOW |
| Q3-D-M1-003 | DAILY | MISSION_I | ROTATION | 학교·수업 | OPEN_SHORT | 오늘 수업 중에 제일 재미있었던 건 뭐야? |  | LOW |
| Q3-D-M1-004 | DAILY | MISSION_I | ROTATION | 학교·수업 | CHOICE_YN_OPEN | 오늘 새롭게 알게 된 게 있어? |  | LOW |
| Q3-D-M1-005 | DAILY | MISSION_I | ROTATION | 학교·수업 | CHOICE_YN_OPEN | 오늘 수업 중에 조금 어려웠던 게 있었어? 없으면 넘어가도 돼. |  | LOW |
| Q3-D-M1-006 | DAILY | MISSION_I | ROTATION | 학교·수업 | OPEN_SHORT | 오늘 집중이 잘됐던 시간은 언제였어? |  | LOW |
| Q3-D-M1-007 | DAILY | MISSION_I | ROTATION | 학교·수업 | OPEN_SHORT | 오늘 쉬는 시간에는 주로 뭐 했어? |  | LOW |
| Q3-D-M1-008 | DAILY | MISSION_I | ROTATION | 학교·수업 | OPEN_SHORT | 오늘 선생님이 한 말 중에 기억나는 게 있어? |  | LOW |
| Q3-D-M1-009 | DAILY | MISSION_I | ROTATION | 학교·수업 | CHOICE_YN_OPEN | 오늘 발표하거나 앞에 나가서 한 일이 있었어? |  | LOW |
| Q3-D-M1-010 | DAILY | MISSION_I | ROTATION | 학교·수업 | CHOICE_YN_OPEN | 오늘 학교에서 웃었던 순간이 있었어? |  | LOW |
| Q3-D-M1-011 | DAILY | MISSION_I | ROTATION | 학교·수업 | OPEN_SHORT | 오늘 다시 해보고 싶은 수업이나 활동이 있어? |  | LOW |
| Q3-D-M1-012 | DAILY | MISSION_I | ROTATION | 학교·수업 | CHOICE_YN_OPEN | 오늘 별로라고 느낀 수업이 있었어? 없으면 넘어가도 돼. |  | LOW |
| Q3-D-M1-013 | DAILY | MISSION_I | ROTATION | 학교·수업 | CHOICE_YN_OPEN | 오늘 숙제나 준비물 때문에 기억나는 일이 있었어? |  | LOW |
| Q3-D-M1-014 | DAILY | MISSION_I | ROTATION | 친구·또래 | OPEN_SHORT | 요즘 제일 자주 이야기하는 친구는 누구야? |  | LOW |
| Q3-D-M1-015 | DAILY | MISSION_I | ROTATION | 친구·또래 | OPEN_SHORT | 오늘 그 친구랑 어땠어? |  | LOW |
| Q3-D-M1-016 | DAILY | MISSION_I | ROTATION | 친구·또래 | CHOICE_YN_OPEN | 오늘 친구랑 같이 해서 재미있었던 일이 있었어? |  | LOW |
| Q3-D-M1-017 | DAILY | MISSION_I | ROTATION | 친구·또래 | OPEN_SHORT | 오늘 친구가 해준 말 중에 기억나는 말이 있어? |  | LOW |
| Q3-D-M1-018 | DAILY | MISSION_I | ROTATION | 친구·또래 | CHOICE_YN_OPEN | 오늘 네가 친구를 도와준 일이 있었어? |  | LOW |
| Q3-D-M1-019 | DAILY | MISSION_I | ROTATION | 친구·또래 | CHOICE_YN_OPEN | 오늘 친구가 너를 도와준 일이 있었어? |  | LOW |
| Q3-D-M1-020 | DAILY | MISSION_I | ROTATION | 친구·또래 | OPEN_SHORT | 오늘 누구랑 제일 많이 놀았어? |  | LOW |
| Q3-D-M1-021 | DAILY | MISSION_I | ROTATION | 친구·또래 | CHOICE_YN_OPEN | 오늘 같이 있고 싶었던 친구가 있었어? |  | LOW |
| Q3-D-M1-022 | DAILY | MISSION_I | ROTATION | 친구·또래 | CHOICE_YN_OPEN | 오늘 친구 때문에 서운했던 일이 있었어? 없으면 넘어가도 돼. |  | MEDIUM |
| Q3-D-M1-023 | DAILY | MISSION_I | ROTATION | 친구·또래 | CHOICE_YN_OPEN | 오늘 친구랑 생각이 달랐던 일이 있었어? |  | LOW |
| Q3-D-M1-024 | DAILY | MISSION_I | ROTATION | 친구·또래 | CHOICE_YN_OPEN | 오늘 새롭게 이야기해 본 친구가 있었어? |  | LOW |
| Q3-D-M1-025 | DAILY | MISSION_I | ROTATION | 친구·또래 | OPEN_SHORT | 내일 친구랑 같이 해보고 싶은 게 있어? |  | LOW |
| Q3-D-M1-026 | DAILY | MISSION_I | ROTATION | 공정함·억울함 | CHOICE_YN_OPEN | 오늘 '이건 좀 불공평한데' 싶은 일이 있었어? 없으면 넘어가도 돼. | fairness_daily | LOW |
| Q3-D-M1-027 | DAILY | MISSION_I | ROTATION | 공정함·억울함 | CHOICE_YN_OPEN | 오늘 억울하거나 답답했던 일이 있었어? 없으면 넘어가도 돼. | fairness_daily | MEDIUM |
| Q3-D-M1-028 | DAILY | MISSION_I | ROTATION | 공정함·억울함 | CHOICE_YN_OPEN | 오늘 차례나 규칙 때문에 기억나는 일이 있었어? |  | LOW |
| Q3-D-M1-029 | DAILY | MISSION_I | ROTATION | 공정함·억울함 | CHOICE_YN_OPEN | 오늘 누군가 규칙을 지키지 않아서 신경 쓰인 일이 있었어? |  | LOW |
| Q3-D-M1-030 | DAILY | MISSION_I | ROTATION | 공정함·억울함 | CHOICE_YN_OPEN | 오늘 공평하게 나눴다고 느낀 일이 있었어? |  | LOW |
| Q3-D-M1-031 | DAILY | MISSION_I | ROTATION | 공정함·억울함 | CHOICE_YN_OPEN | 오늘 네 생각과 다르게 일이 정해진 적이 있었어? |  | LOW |
| Q3-D-M1-032 | DAILY | MISSION_I | ROTATION | 공정함·억울함 | OPEN_SHORT | 오늘 다시 정할 수 있다면 바꾸고 싶은 일이 있어? |  | LOW |
| Q3-D-M1-033 | DAILY | MISSION_I | ROTATION | 성취·자기효능감 | CHOICE_YN_OPEN | 오늘 '나 이거 잘했다'고 느낀 일이 있어? |  | LOW |
| Q3-D-M1-034 | DAILY | MISSION_I | ROTATION | 성취·자기효능감 | CHOICE_YN_OPEN | 오늘 끝까지 해낸 일이 있어? |  | LOW |
| Q3-D-M1-035 | DAILY | MISSION_I | ROTATION | 성취·자기효능감 | CHOICE_YN_OPEN | 오늘 처음 해봤거나 새로 도전한 게 있어? |  | LOW |
| Q3-D-M1-036 | DAILY | MISSION_I | ROTATION | 성취·자기효능감 | CHOICE_YN_OPEN | 오늘 조금 어려웠지만 해낸 일이 있어? |  | LOW |
| Q3-D-M1-037 | DAILY | MISSION_I | ROTATION | 성취·자기효능감 | CHOICE_YN_OPEN | 오늘 칭찬받은 일이 있었어? |  | LOW |
| Q3-D-M1-038 | DAILY | MISSION_I | ROTATION | 성취·자기효능감 | CHOICE_YN_OPEN | 오늘 스스로 해결한 일이 있었어? |  | LOW |
| Q3-D-M1-039 | DAILY | MISSION_I | ROTATION | 성취·자기효능감 | OPEN_SHORT | 요즘 전보다 잘하게 됐다고 느끼는 게 있어? |  | LOW |
| Q3-D-M1-040 | DAILY | MISSION_I | ROTATION | 디지털·콘텐츠 | OPEN_SHORT | 요즘 제일 많이 보는 영상이나 자주 하는 게임은 뭐야? |  | LOW |
| Q3-D-M1-041 | DAILY | MISSION_I | ROTATION | 디지털·콘텐츠 | CHOICE_YN_OPEN | 최근에 본 영상이나 게임에서 기억나는 장면이 있어? |  | LOW |
| Q3-D-M1-042 | DAILY | MISSION_I | ROTATION | 디지털·콘텐츠 | CHOICE_YN_OPEN | 요즘 친구들이 자주 이야기하는 게임이나 영상이 있어? |  | LOW |
| Q3-D-M1-043 | DAILY | MISSION_I | ROTATION | 디지털·콘텐츠 | CHOICE_2 | 게임은 혼자 하는 게 좋아, 같이 하는 게 좋아? |  | LOW |
| Q3-D-M1-044 | DAILY | MISSION_I | ROTATION | 디지털·콘텐츠 | CHOICE_YN_OPEN | 영상이나 게임에서 직접 해보고 싶은 게 있었어? |  | LOW |
| Q3-D-M1-045 | DAILY | MISSION_I | ROTATION | 디지털·콘텐츠 | CHOICE_YN_OPEN | 요즘 새로 재미있어진 콘텐츠가 있어? |  | LOW |
| Q3-D-M1-046 | DAILY | MISSION_I | ROTATION | 디지털·콘텐츠 | CHOICE_YN_OPEN | 친구에게 추천하고 싶은 게임이나 영상이 있어? |  | LOW |
| Q3-D-M1-047 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | CHOICE_2 | 오늘 몸은 괜찮았어, 조금 피곤했어? |  | LOW |
| Q3-D-M1-048 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | CHOICE_YN_OPEN | 오늘 많이 움직였던 순간이 있었어? |  | LOW |
| Q3-D-M1-049 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | CHOICE_YN_OPEN | 오늘 쉬고 싶다고 느낀 때가 있었어? |  | LOW |
| Q3-D-M1-050 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | OPEN_SHORT | 오늘 밥 뭐 먹었어? | meal_daily | LOW |
| Q3-D-M1-051 | DAILY | MISSION_I | ROTATION | 몸·컨디션 | OPEN_SHORT | 오늘 먹은 것 중에 제일 맛있었던 건 뭐야? | meal_daily | LOW |
| Q3-D-M1-052 | DAILY | MISSION_I | ROTATION | 학원·방과후 | OPEN_SHORT | 오늘 학원이나 방과후 활동에서 제일 기억나는 건 뭐야? |  | LOW |
| Q3-D-M1-053 | DAILY | MISSION_I | ROTATION | 학원·방과후 | CHOICE_YN_OPEN | 오늘 학원이나 방과후에서 새롭게 배운 게 있었어? |  | LOW |
| Q3-D-M1-054 | DAILY | MISSION_I | ROTATION | 학원·방과후 | CHOICE_YN_OPEN | 오늘 학원이나 방과후에서 잘됐다고 느낀 일이 있었어? |  | LOW |
| Q3-D-M1-055 | DAILY | MISSION_I | ROTATION | 학원·방과후 | CHOICE_YN_OPEN | 오늘 학원이나 방과후가 조금 힘들었어? 없으면 넘어가도 돼. |  | MEDIUM |
| Q3-D-M1-056 | DAILY | MISSION_I | ROTATION | 학원·방과후 | OPEN_SHORT | 오늘 학원이나 방과후가 끝난 뒤 제일 하고 싶었던 건 뭐였어? |  | LOW |
| Q3-W-M1-001 | WEEKLY | MISSION_I | ROTATION | 학교·수업 | OPEN_SHORT | 이번 주 학교에서 제일 기억에 남는 일은 뭐야? |  | LOW |
| Q3-W-M1-002 | WEEKLY | MISSION_I | ROTATION | 친구·또래 | OPEN_SHORT | 이번 주 친구와 함께해서 제일 재미있었던 일은 뭐야? |  | LOW |
| Q3-W-M1-003 | WEEKLY | MISSION_I | ROTATION | 성취·자기효능감 | OPEN_SHORT | 이번 주에 네가 가장 잘했다고 느낀 일은 뭐야? |  | LOW |
| Q3-W-M1-004 | WEEKLY | MISSION_I | ROTATION | 공정함·억울함 | OPEN_SHORT | 이번 주에 불공평하거나 억울했던 일이 있었어? 없으면 넘어가도 돼. |  | MEDIUM |
| Q3-W-M1-005 | WEEKLY | MISSION_I | ROTATION | 학교·수업 | OPEN_SHORT | 이번 주 수업 중에 제일 재미있었던 건 뭐야? |  | LOW |
| Q3-W-M1-006 | WEEKLY | MISSION_I | ROTATION | 디지털·콘텐츠 | OPEN_SHORT | 이번 주에 새로 재미있게 본 영상이나 게임이 있어? |  | LOW |
| Q3-W-M1-007 | WEEKLY | MISSION_I | ROTATION | 몸·컨디션 | OPEN_SHORT | 이번 주에 제일 신나게 움직였던 때는 언제야? |  | LOW |
| Q3-W-M1-008 | WEEKLY | MISSION_I | ROTATION | 관심사 | OPEN_SHORT | 다음 주에 꼭 해보고 싶은 게 있어? |  | LOW |
| Q3-M-M1-001 | MONTHLY | MISSION_I | ROTATION | 학교·수업 | OPEN_SHORT | 이번 달 학교생활에서 제일 기억에 남는 일은 뭐야? |  | LOW |
| Q3-M-M1-002 | MONTHLY | MISSION_I | ROTATION | 성취·자기효능감 | OPEN_SHORT | 이번 달에 새롭게 알게 됐거나 잘하게 된 게 있어? |  | LOW |
| Q3-M-M1-003 | MONTHLY | MISSION_I | ROTATION | 친구·또래 | OPEN_SHORT | 이번 달 친구와 있었던 일 중 제일 기억나는 건 뭐야? |  | LOW |
| Q3-M-M1-004 | MONTHLY | MISSION_I | ROTATION | 관심사 | OPEN_SHORT | 다음 달에 새로 해보고 싶은 게 있어? |  | LOW |
| Q3-Q-M1-001 | QUARTERLY | MISSION_I | ROTATION | 성취·자기효능감 | OPEN_SHORT | 세 달 전보다 더 잘하게 됐다고 느끼는 게 있어? |  | LOW |
| Q3-Q-M1-002 | QUARTERLY | MISSION_I | ROTATION | 관심사 | OPEN_SHORT | 세 달 전과 비교해서 새로 좋아하게 된 게 있어? |  | LOW |
| Q3-D-M2-001 | DAILY | MISSION_II | FIXED | 좋았던 일 | OPEN_SHORT | 오늘 제일 좋았던 일 하나만 말해줄래? | rose | LOW |
| Q3-D-M2-002 | DAILY | MISSION_II | FIXED | 힘들거나 아쉬웠던 일 | CHOICE_YN_OPEN | 오늘 힘들거나 아쉬웠던 일이 있었어? 없으면 넘어가도 돼. | thorn | MEDIUM |
| Q3-D-M2-003 | DAILY | MISSION_II | FIXED | 내일 기대 | OPEN_SHORT | 내일 기대되는 일이 있어? | bud | LOW |
| Q3-D-M2-004 | DAILY | MISSION_II | ROTATION | 감정 | SCALE_1_10 | 오늘 기분을 1점부터 10점 중에 고르면 몇 점이야? | mood_format | LOW |
| Q3-D-M2-005 | DAILY | MISSION_II | ROTATION | 감정 | CHOICE_4 | 오늘 마음 날씨는 맑음, 구름, 비, 천둥 중 뭐야? | mood_format | LOW |
| Q3-D-M2-006 | DAILY | MISSION_II | ROTATION | 감정 | OPEN_SHORT | 오늘 기분을 이모지 하나로 표현하면 뭐야? | mood_format | LOW |
| Q3-D-M2-007 | DAILY | MISSION_II | ROTATION | 감정 | OPEN_SHORT | 오늘 마음을 색깔로 말하면 무슨 색이야? | mood_format | LOW |
| Q3-D-M2-008 | DAILY | MISSION_II | ROTATION | 감정 | OPEN_SHORT | 오늘 가장 신났던 순간은 언제였어? |  | LOW |
| Q3-D-M2-009 | DAILY | MISSION_II | ROTATION | 감정 | OPEN_SHORT | 오늘 가장 편안했던 순간은 언제였어? |  | LOW |
| Q3-D-M2-010 | DAILY | MISSION_II | ROTATION | 감정 | CHOICE_YN_OPEN | 오늘 속상했던 순간이 있었어? 없으면 넘어가도 돼. |  | MEDIUM |
| Q3-D-M2-011 | DAILY | MISSION_II | ROTATION | 감정 | CHOICE_YN_OPEN | 오늘 답답했던 순간이 있었어? 없으면 넘어가도 돼. |  | MEDIUM |
| Q3-D-M2-012 | DAILY | MISSION_II | ROTATION | 감정 | CHOICE_YN_OPEN | 오늘 억울했던 순간이 있었어? 없으면 넘어가도 돼. |  | MEDIUM |
| Q3-D-M2-013 | DAILY | MISSION_II | ROTATION | 감정 | CHOICE_YN_OPEN | 오늘 기분이 갑자기 바뀐 순간이 있었어? |  | LOW |
| Q3-D-M2-014 | DAILY | MISSION_II | ROTATION | 감정 | CHOICE_YN_OPEN | 오늘 누군가의 말 때문에 기분이 좋아진 적이 있어? |  | LOW |
| Q3-D-M2-015 | DAILY | MISSION_II | ROTATION | 감정 | CHOICE_YN_OPEN | 오늘 혼자 있고 싶었던 때가 있었어? |  | LOW |
| Q3-D-M2-016 | DAILY | MISSION_II | ROTATION | 감정 | CHOICE_YN_OPEN | 오늘 누군가와 이야기하고 싶었던 때가 있었어? |  | LOW |
| Q3-D-M2-017 | DAILY | MISSION_II | ROTATION | 감정 | CHOICE_4 | 지금 마음에 제일 가까운 말은 편안함, 신남, 피곤함, 속상함 중 뭐야? | mood_format | MEDIUM |
| Q3-D-M2-018 | DAILY | MISSION_II | ROTATION | 감정 | CHOICE_YN_OPEN | 지금 더 이야기하고 싶은 기분이 있어? 없으면 넘어가도 돼. |  | LOW |
| Q3-D-M2-019 | DAILY | MISSION_II | ROTATION | 가족·집 | OPEN_SHORT | 오늘 집에서 제일 편안했던 순간은 언제였어? |  | LOW |
| Q3-D-M2-020 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_YN_OPEN | 오늘 가족과 함께해서 좋았던 일이 있었어? |  | LOW |
| Q3-D-M2-021 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_YN_OPEN | 오늘 집에서 재미있었던 일이 있었어? |  | LOW |
| Q3-D-M2-022 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_YN_OPEN | 오늘 가족에게 말하고 싶은 일이 있어? |  | LOW |
| Q3-D-M2-023 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_YN_OPEN | 오늘 집에서 네가 도와준 일이 있었어? |  | LOW |
| Q3-D-M2-024 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_YN_OPEN | 오늘 가족이 너를 도와준 일이 있었어? |  | LOW |
| Q3-D-M2-025 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_YN_OPEN | 오늘 집에서 웃었던 순간이 있었어? |  | LOW |
| Q3-D-M2-026 | DAILY | MISSION_II | ROTATION | 가족·집 | OPEN_SHORT | 내일 가족과 같이 하고 싶은 게 있어? |  | LOW |
| Q3-D-M2-027 | DAILY | MISSION_II | ROTATION | 가족·집 | CHOICE_YN_OPEN | 오늘 집에서 조금 불편하거나 속상했던 일이 있었어? 없으면 넘어가도 돼. |  | MEDIUM |
| Q3-D-M2-028 | DAILY | MISSION_II | ROTATION | 선생님·믿을 수 있는 어른 | CHOICE_YN_OPEN | 오늘 선생님이나 어른에게 도움받은 일이 있었어? |  | LOW |
| Q3-D-M2-029 | DAILY | MISSION_II | ROTATION | 선생님·믿을 수 있는 어른 | CHOICE_YN_OPEN | 오늘 네 이야기를 잘 들어준 어른이 있었어? |  | LOW |
| Q3-D-M2-030 | DAILY | MISSION_II | ROTATION | 선생님·믿을 수 있는 어른 | CHOICE_YN_OPEN | 궁금한 게 생기면 편하게 물어볼 수 있는 어른이 있어? |  | LOW |
| Q3-D-M2-031 | DAILY | MISSION_II | ROTATION | 선생님·믿을 수 있는 어른 | OPEN_SHORT | 도움이 필요할 때 가장 먼저 떠오르는 어른은 누구야? |  | LOW |
| Q3-D-M2-032 | DAILY | MISSION_II | ROTATION | 선생님·믿을 수 있는 어른 | OPEN_SHORT | 오늘 선생님이 해준 말 중 기억나는 게 있어? |  | LOW |
| Q3-D-M2-033 | DAILY | MISSION_II | ROTATION | 선생님·믿을 수 있는 어른 | CHOICE_YN_OPEN | 내일 어른에게 물어보고 싶은 게 있어? |  | LOW |
| Q3-D-M2-034 | DAILY | MISSION_II | ROTATION | 선생님·믿을 수 있는 어른 | CHOICE_YN_OPEN | 요즘 편하게 이야기할 수 있는 어른이 있어? |  | LOW |
| Q3-D-M2-035 | DAILY | MISSION_II | ROTATION | 하루 회고 | OPEN_SHORT | 오늘을 한 단어로 표현하면 어떤 말이 떠올라? |  | LOW |
| Q3-D-M2-036 | DAILY | MISSION_II | ROTATION | 하루 회고 | CHOICE_YN_OPEN | 오늘 다시 돌아가 보고 싶은 순간이 있어? |  | LOW |
| Q3-D-M2-037 | DAILY | MISSION_II | ROTATION | 하루 회고 | CHOICE_YN_OPEN | 오늘 다르게 해보고 싶은 일이 있어? |  | LOW |
| Q3-D-M2-038 | DAILY | MISSION_II | ROTATION | 하루 회고 | OPEN_SHORT | 오늘 가장 많이 웃은 때는 언제였어? |  | LOW |
| Q3-D-M2-039 | DAILY | MISSION_II | ROTATION | 하루 회고 | OPEN_SHORT | 오늘 조용히 쉬었던 순간은 언제였어? |  | LOW |
| Q3-D-M2-040 | DAILY | MISSION_II | ROTATION | 하루 회고 | CHOICE_YN_OPEN | 오늘 누군가에게 고마웠던 일이 있어? |  | LOW |
| Q3-D-M2-041 | DAILY | MISSION_II | ROTATION | 하루 회고 | CHOICE_YN_OPEN | 오늘 네가 누군가를 기쁘게 해준 일이 있어? |  | LOW |
| Q3-D-M2-042 | DAILY | MISSION_II | ROTATION | 하루 회고 | OPEN_SHORT | 오늘 하루에서 하나만 기억한다면 어떤 순간을 고를래? |  | LOW |
| Q3-D-M2-043 | DAILY | MISSION_II | ROTATION | 하루 회고 | CHOICE_YN_OPEN | 오늘 생각보다 잘 풀린 일이 있었어? |  | LOW |
| Q3-D-M2-044 | DAILY | MISSION_II | ROTATION | 하루 회고 | CHOICE_YN_OPEN | 오늘 예상과 다르게 된 일이 있었어? |  | LOW |
| Q3-D-M2-045 | DAILY | MISSION_II | ROTATION | 자기효능감 | CHOICE_YN_OPEN | 오늘 포기하지 않고 계속해 본 일이 있어? |  | LOW |
| Q3-D-M2-046 | DAILY | MISSION_II | ROTATION | 자기효능감 | CHOICE_YN_OPEN | 오늘 스스로 해결한 일이 있어? |  | LOW |
| Q3-D-M2-047 | DAILY | MISSION_II | ROTATION | 자기효능감 | CHOICE_YN_OPEN | 오늘 용기 내서 해본 일이 있어? |  | LOW |
| Q3-D-M2-048 | DAILY | MISSION_II | ROTATION | 자기효능감 | CHOICE_YN_OPEN | 오늘 실수했지만 다시 해본 일이 있어? |  | LOW |
| Q3-D-M2-049 | DAILY | MISSION_II | ROTATION | 자기효능감 | CHOICE_YN_OPEN | 오늘 네 장점이 도움이 된 순간이 있었어? |  | LOW |
| Q3-D-M2-050 | DAILY | MISSION_II | ROTATION | 자기효능감 | CHOICE_YN_OPEN | 오늘 배운 것 중 내일도 해보고 싶은 게 있어? |  | LOW |
| Q3-D-M2-051 | DAILY | MISSION_II | ROTATION | 자기효능감 | OPEN_SHORT | 오늘의 너에게 칭찬 한마디를 해준다면 뭐라고 하고 싶어? |  | LOW |
| Q3-D-M2-052 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 내일 아침에 일어나면 제일 먼저 하고 싶은 건 뭐야? |  | LOW |
| Q3-D-M2-053 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 내일 재미있는 일이 생기면 어떤 일이면 좋겠어? |  | LOW |
| Q3-D-M2-054 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 내일 누구와 어떤 시간을 보내고 싶어? |  | LOW |
| Q3-D-M2-055 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 내일의 너에게 응원 한마디를 해줄래? |  | LOW |
| Q3-D-M2-056 | DAILY | MISSION_II | ROTATION | 긍정 마무리 | CHOICE_2 | 지금 마음 편안해? 이제 잘 준비하자. | bedtime_closing | LOW |
| Q3-W-M2-001 | WEEKLY | MISSION_II | ROTATION | 좋았던 일 | OPEN_SHORT | 이번 주 통틀어 제일 좋았던 일은 뭐야? |  | LOW |
| Q3-W-M2-002 | WEEKLY | MISSION_II | ROTATION | 힘들거나 아쉬웠던 일 | OPEN_SHORT | 이번 주에 힘들거나 아쉬웠던 일이 있었어? 없으면 넘어가도 돼. |  | MEDIUM |
| Q3-W-M2-003 | WEEKLY | MISSION_II | ROTATION | 감정 | OPEN_SHORT | 이번 주 마음 날씨는 맑음, 구름, 비, 천둥 중 뭐가 제일 많았어? |  | LOW |
| Q3-W-M2-004 | WEEKLY | MISSION_II | ROTATION | 가족·집 | OPEN_SHORT | 이번 주 가족과 함께한 시간 중 제일 좋았던 순간은 언제였어? |  | LOW |
| Q3-W-M2-005 | WEEKLY | MISSION_II | ROTATION | 친구·또래 | OPEN_SHORT | 이번 주 친구와 있었던 일 중 제일 기억나는 건 뭐야? |  | LOW |
| Q3-W-M2-006 | WEEKLY | MISSION_II | ROTATION | 자기효능감 | OPEN_SHORT | 이번 주에 네가 제일 잘했다고 느낀 일은 뭐야? |  | LOW |
| Q3-W-M2-007 | WEEKLY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 다음 주에 제일 기대되는 건 뭐야? |  | LOW |
| Q3-W-M2-008 | WEEKLY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 다음 주의 너에게 응원 한마디를 해줄래? |  | LOW |
| Q3-M-M2-001 | MONTHLY | MISSION_II | ROTATION | 감정 | OPEN_SHORT | 이번 달을 떠올리면 어떤 기분이 제일 먼저 생각나? |  | LOW |
| Q3-M-M2-002 | MONTHLY | MISSION_II | ROTATION | 자기효능감 | OPEN_SHORT | 이번 달에 네가 제일 뿌듯했던 일은 뭐야? |  | LOW |
| Q3-M-M2-003 | MONTHLY | MISSION_II | ROTATION | 관계 | OPEN_SHORT | 이번 달에 고마웠던 사람이 있어? 어떤 일이 있었어? |  | LOW |
| Q3-M-M2-004 | MONTHLY | MISSION_II | ROTATION | 긍정 마무리 | OPEN_SHORT | 다음 달에 꼭 해보고 싶은 게 있어? |  | LOW |
| Q3-Q-M2-001 | QUARTERLY | MISSION_II | ROTATION | 안전망 | CHOICE_YN_OPEN | 힘들 때 편하게 이야기할 수 있는 어른이 있어? |  | MEDIUM |
| Q3-Q-M2-002 | QUARTERLY | MISSION_II | ROTATION | 자기효능감 | OPEN_SHORT | 세 달 전의 너보다 지금 더 잘하게 된 게 있어? |  | LOW |


## 14. 금지 표현·자연스러움 검사

다음 표현 또는 패턴이 질문지 및 런타임 생성 질문에 나타나면 실패 처리한다.

- `요즘 네 정체성에 대해 어떻게 생각해?`
- `친구 관계가 복잡해?`
- `왜 그렇게 느꼈어?`
- `왜 그랬어?`
- `진짜야?`
- `그거 나쁜 거 아니야?`
- `점심(또는 저녁)`
- 근거 없는 `그 콘텐츠`, `그 친구`, `전에 말한 것`
- 위기 확인을 위한 유도형 선택 질문
- 한 문장에 서로 다른 질문 두 개 이상 포함

## 15. Dev 검증 완료 조건

### 데이터 검증

- `grade3_v1` 정확히 140문항
- MISSION_I 70 / MISSION_II 70
- DAILY 112 / WEEKLY 16 / MONTHLY 8 / QUARTERLY 4
- 질문 ID 중복 0건
- 빈 질문 0건
- 3학년 외 적용 학년 포함 0건
- seed 재실행 후 140개 유지
- 기존 1·2·4학년 질문 및 history 보존
- 모든 문항 `clinical_status='APPROVED'`
- 모든 문항 `expert_review_status='PENDING_REVIEW'`

### 선택 로직 검증

- 3학년 아이에게 `grade3_v1` 질문만 출제
- 다른 학년·레거시 fallback 0건
- PRIMARY 10 + RESERVE 10
- 미션 간 질문 혼합 0건
- 동일 영역 세션 최대 2개
- 동일 `daily_once_key` 하루 중복 0건
- 주간·월간·분기 기간 중복 0건
- 짧은 답변 유효성 정상
- `engine_version='v2-grade3-v1'`
- 실제 전송 질문에만 `asked_at` 기록

### 실제 사용자 흐름

Dev 3학년 테스트 아이 최소 2명으로 검증한다.

- MISSION_I 시작→유효 답변 10개→완료
- MISSION_II 시작→Rose/Thorn/Bud 포함→유효 답변 10개→완료
- `몰라`, `없어`, `넘어갈래` 후 추궁 없음
- 질문에 답하지 않고 자유롭게 말할 때만 세션당 최대 1회 미션 안내
- 정상 답변에는 안내 반복 없음
- 형제자매 상태 격리
- 완료 보상·황금열쇠 회귀 없음
- 21:15 이후 권장 수면 안내 1회
- 21:15 이전 권장 수면 안내 없음

### 품질 게이트

- TypeScript typecheck PASS
- 관련 unit/integration test PASS
- Production build PASS
- Dev DB migration PASS
- API 오류 없음
- 기존 1·2·4학년 미션 회귀 없음
- 금지 표현 자동 검사 PASS
- 로그에 아이 발화·개인정보·비밀키 원문 노출 없음

## 16. Production 자동 배포 승인

이 Request MD는 조건부 Production 배포를 사전 승인한다.

- Dev 완료 조건이 모두 PASS하면 추가 승인 질문 없이 Production DB 마이그레이션과 앱 배포 진행
- 하나라도 FAIL이면 Production 배포 금지
- 테스트 삭제·완화로 PASS 처리 금지
- 기존 질문·history·아이 계정 삭제 금지
- 새 버전 활성화 방식으로 적용해 즉시 롤백 가능하게 구현

## 17. Production 스모크 테스트

- Production `grade3_v1` 정확히 140문항
- 기존 1·2·4학년 질문 및 history 보존
- Production QA 3학년 아이로 MISSION_I·II 시작 성공
- 3학년 질문만 출제
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

롤백 시 앱을 직전 안정 버전으로 복원하고 `grade3_v1` 선택만 비활성화한다. 새 질문과 기존 history는 삭제하지 않는다.

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
- 런타임 LLM이 질문 문구를 임의 재작성하도록 하지 말 것
- 위기 신호 확인을 위해 유도형 질문을 새로 생성하지 말 것
