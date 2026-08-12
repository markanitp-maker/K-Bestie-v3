# 086 회원가입 보호자 전화번호 입력 제거

> 완료: 2026-08-08 | main `128fad7` | Production `dpl_FRFfCqTbeQuF3f27w3pusNo4woiQ`

## 상태

- 완료 (Production 배포·실서비스 검증)

## 완료 결과

- 회원가입 2/4 `보호자 기본정보` 화면의 `휴대전화 번호` 입력 항목을 제거했다.
- signup profile API의 전화번호 필수 검증·빈값 오류·저장을 제거했다.
- 가입 재개 판정은 보호자 이름·아이와의 관계·법정대리인 확인값을 사용한다.
- 기존 DB `phone_number` 컬럼과 기존 사용자 값은 변경하지 않았다. 기존 migration에서 nullable `TEXT`임을 확인했다.
- 보호자 이름·아이와의 관계·법정대리인 확인은 유지했고 OAuth·약관·가족 생성·아이 등록은 수정하지 않았다.

## 검증

- TypeScript: PASS
- Production 대상 전체 build: 201페이지 PASS
- 전체 회귀: 232 PASS, 4 SKIP, 기존 무관 `E_REACTION_POOL` 기대값 불일치 1 FAIL
- Production E2E: 지정 QA 부모로 전화번호 필드 0개, POST body `phone` 없음, API 200, 2/4→3/4 전환, 기존 `phone_number` 불변, QA 부모 행 원상복구 PASS
- Production health: 200
