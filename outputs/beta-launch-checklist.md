# 베타 오픈 전 필수 체크리스트

## 1. 미션 시간 게이트 원복 (필수, 최우선)

**배경**: 2026-07-20 알파 테스트 목적으로 미션 진입 시간 제한(운영시간 게이트)을 두 환경 모두에서 임시로 우회 설정했다. 관련 코드(`app/api/config/child-time-restrictions/route.ts`)는 삭제하지 않고 `MISSION_TIME_GATE_MODE` 스위치만 추가했으므로, 베타 오픈 전 아래 두 환경변수만 되돌리면 즉시 기존 시간 정책(13-17시 1차, 19-23시 2차)이 복원된다.

- [ ] Vercel 프로젝트 `k-bestie-v3-dev` (Production 스코프): `MISSION_TIME_GATE_MODE` 값을 `bypass` → `enforced`로 변경 (또는 완전히 삭제)
- [ ] Vercel 프로젝트 `k-bestie-v3` (Production 스코프, app.k-bestie.com): `MISSION_TIME_GATE_MODE` 값을 `bypass` → `enforced`로 변경 (또는 완전히 삭제)
- [ ] 양쪽 모두 재배포 후 `GET /api/config/child-time-restrictions`가 `{"enabled": true}`를 반환하는지 확인
- [ ] 실제 시간 제한 밖(예: 새벽)에 아이 계정으로 `/child/missions` 접속 시 "운영시간이 아님" 안내로 정상 차단되는지 재확인

이 항목이 완료되지 않은 채 베타를 오픈하면, 하루 2회(1차/2차)로 설계된 미션 이용 정책이 24시간 상시 허용 상태로 방치된다.

## 2. 질문은행 v2.0(46개 그룹코드 + 92개 표현변형) 임상 검토 (필수, 최우선)

**배경**: 2026-07-20 서아·서현 알파 테스트를 위해 `data/questions/question-bank-v2.0.json`(기존 46개 base + 92개 variants, 신규 생성 없음)에 대해 클로드 오케스트레이터가 자동화된 콘텐츠 안전성 검토(중복/유도질문/강압/비난/진단성 라벨링/부모편향/연령부적합/민감정보 요구/거부권 침해 9개 기준)만 수행했다(`data/questions/alpha-approved-manifest.json` 참고). 이는 **임상적 검토가 아니며**, DB상 `clinical_status`는 46개 전부 여전히 `PENDING_REVIEW`이다. `alpha_safety_text_allowlist`에 등록된 얼파 허용 아동(서아/서현 등)에게만 코드/데이터 레벨 매니페스트로 노출을 한정했을 뿐, 일반 사용자에게는 노출되지 않는다(비얼파 아동은 기존 V1 5문항 로직 그대로 유지).

- [ ] 전문가(임상심리/아동상담 등)의 46개 그룹코드(92개 표현변형 포함) 전수 검토 및 승인
- [ ] 승인 완료 후 `mission_questions.clinical_status`를 해당 46개 행에 대해 `PENDING_REVIEW` → `APPROVED`로 갱신(Dev/Production 각각, 대표 승인 하에 진행)
- [ ] `Q5_1`/`Q5_2`/`Q5_3`(감정 강도 후속 질문, 위기 신호 시 즉시 중단 주의 원문 주석 있음)는 특히 우선 검토 대상으로 명시
- [ ] 임상 승인이 완료되기 전까지는 `alpha_safety_text_allowlist`에 등록된 계정 범위를 벗어나 이 콘텐츠를 확대 노출하지 않는다(외부 베타 대상 전체 확대 금지)

이 항목이 완료되지 않은 채 외부 베타를 오픈하면, 임상 검토 없는 `PENDING_REVIEW` 상태의 질문 콘텐츠가 일반 사용자에게 노출될 위험이 있다.

## 3. 얼파 질문은행 롤백 절차 (참고)

**배경**: 2026-07-20 얼파 테스트용 질문 선택 경로 추가 시, 값 노출 없는 스냅샷을 로컬에 별도 확보했다(Dev `mission_questions` 57행, Production 22행, 스크래치패드에 값 포함 저장·커밋 안 함).

- 질문 **선택 로직만** V1으로 즉시 되돌리는 방법: 해당 아동의 `alpha_safety_text_allowlist` 행을 삭제(또는 비활성화)하면 `isChildAlphaAllowedForQuestions`가 즉시 `false`를 반환하여 다음 미션 시작부터 자동으로 기존 V1 5문항 로직으로 복귀한다. 코드 롤백이나 재배포가 필요 없다.
- 이미 시드된 46개 질문 행(`mission_questions`, `is_active=false`, `clinical_status=PENDING_REVIEW`)은 `is_active=false`이므로 위 조치와 무관하게 비얼파 사용자에게는 애초에 노출되지 않는다.
- 완전한 데이터 롤백이 필요한 경우, 로컬 스냅샷(`mission_questions_dev_2026-07-20.json`)을 기준으로 시딩된 46행만 `id` 매칭으로 삭제하면 원상복구된다(기존 11개 더미 행은 스냅샷에 이미 포함되어 있어 영향 없음).
