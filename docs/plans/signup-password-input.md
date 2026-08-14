# 회원가입 자녀 비밀번호 입력 지연·불일치 수정 계획

## 원인

- 아이 등록의 모든 입력이 부모 `childDraft` 객체 전체를 교체한다.
- 비밀번호와 확인 입력 이벤트가 같은 렌더 주기에 연속 발생하면 각 handler가 동일한 이전 draft를 펼쳐 마지막 업데이트가 앞선 값을 덮어쓸 수 있다.
- iOS/Kakao 자동완성·빠른 입력에서 이 경로가 비밀번호 불일치와 입력 지연처럼 보일 수 있다.

## 변경 범위

- `app/signup/page.tsx`
  - 비밀번호 2개를 `ChildStep` 내부 상태와 동기 ref로 분리한다.
  - 나머지 draft 변경은 functional updater로 전환한다.
  - 모바일 password 입력 속성과 불일치 안내를 보강한다.
- `e2e/qa-signup-password-input.spec.ts`
  - 두 password input 이벤트를 한 브라우저 task에서 연속 발생시켜 값 유실이 없는지 검증한다.
  - 서버 제출·DB 변경 없이 Dev UI만 검증한다.

## 완료 조건

- 빠른 순차 입력과 두 필드 동시 자동완성 형태에서 두 DOM 값과 React 검증 값이 동일하다.
- 같은 비밀번호 6자 이상이면 CTA가 활성화되고, 다른 값이면 명시적 불일치 안내가 표시된다.
- 기존 아이 등록 API payload와 서버 eligibility/approval 경로는 변경하지 않는다.
- TypeScript, 관련 테스트, build, Dev E2E를 통과한다.
