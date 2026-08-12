# D안 원본 실행 코드의 운영 MissionInner 직접 통합

## 작업 정보

- 우선순위: 긴급
- 선행 작업: 없음
- 병렬 처리: `003-real-account-password-recovery.md`와 가능
- `004`, `005`와는 공유 파일이 겹치므로 순차 처리
- 목표: D안을 참고해 재구현하지 않고 현재 testi01 D안의 실제 실행 코드를 운영 화면에서도 그대로 사용

## 범위

작업 전 `docs/conventions.md`를 먼저 읽고 따른다.

수정 허용:

- `app/child/missions/`
- `app/api/mission/reaction-lean/`
- `lib/mission/`
- 현재 `TestModeCDRunner`가 정의된 실제 파일
- 현재 D안 관련 테스트 파일

수정 금지:

- MBTI·리텐션·황금열쇠 코드
- A·B·C·E 중단 트랙
- Production 환경과 DB
- 김서아·김서현 비밀번호 및 세션
- D안과 무관한 미션 UI 재설계

## 현재 상태

- testi01의 D안은 대표님이 응답 품질 기준으로 선택했다.
- 운영 MissionInner에는 `personalizedReaction.ts` 등 별도 공통화 작업이 적용됐다고 보고됐지만, 대표님 실기기 비교에서 D안과 운영 화면의 반응이 달랐다.
- 운영 화면에만 content-echo fallback, 별도 사과 문구, 이름 주입 또는 rewrite가 나타난 사례가 있다.
- 커밋 `3551e9c`, `c12785d`가 존재하지만 D안 원본 코드 자체를 양쪽이 호출한다는 완료 근거는 없다.
- 동일 입력의 LLM 출력 문장 자체는 매번 달라질 수 있으므로 문장 일치가 아니라 코드 경로 동일성을 검증해야 한다.

## 요구사항

1. `TestModeCDRunner` D안의 실제 한 턴 처리 경로를 시작점부터 끝까지 추적한다.
   - 모델 호출
   - system prompt
   - payload
   - conversation context
   - timeout
   - fallback
   - 다음 질문 결합
   - 질문 index 처리
   - 최종 텍스트 반환

2. D안 코드를 참고해 새로 작성하거나 복사본을 만들지 않는다.

3. D안 로직이 인라인이면 해당 코드 블록을 의미 변경 없이 공통 함수로 이동한다.

4. D안과 MissionInner가 동일한 파일에서 동일한 함수를 import하고 동일한 핵심 인자를 전달하게 한다.

5. 운영 MissionInner에는 다음 wrapper만 남긴다.
   - 인증과 가족 소유관계 확인
   - 세션 및 DB 저장
   - 진행률
   - 레이아웃
   - TTS 켜기·끄기

6. 운영 전용으로 추가된 다음 경로가 있다면 제거한다.
   - 별도 개인화 반응 재구현
   - content-echo fallback
   - 별도 prompt
   - 반응 rewrite
   - 이름 기반 문장 변경
   - D안에 없는 안전문구 후처리

7. 기존 인증·DB 저장·멱등성·음성 토글은 유지한다.

8. 임시 진단 로그를 추가했다면 검증 후 제거한다.

## 데이터·환경변수·배포

- DB 스키마 변경: 없음
- 환경변수 변경: 없음
- Dev 배포: 필요
- Production 변경: 금지
- D안 회귀검증: `testi01`
- 운영 자동검증: 부모 `QA테스트`, 자녀 `QA테스트(5학년)`
- 김서아·김서현 자동 접근: 금지

## 완료조건

- D안과 MissionInner가 동일한 공통 turn 함수를 import
- 동일한 prompt·payload·timeout·fallback 코드 사용
- D안 원본을 재작성하지 않고 이동 또는 직접 연결한 근거 확보
- 운영 전용 반응 생성·rewrite·fallback 경로 제거
- 한 아이 발화당 반응 1개·다음 질문 1개
- 아이 발화 말풍선 0개
- 질문 중복 0회
- 음성 토글 시 텍스트·세션·진행률 동일, TTS만 변경
- `npx tsc --noEmit` 통과
- `npx next build` 성공
- 관련 테스트 통과
- Dev 배포 완료
- 허용 범위 밖 변경 0건

## 검증 시나리오

1. testi01 D안과 QA 운영 화면에 같은 입력 세트 10개 사용
2. 두 경로의 실제 import 파일과 호출 함수를 기록
3. 모델·prompt·payload·timeout·fallback 설정 비교
4. 최종 문장 완전 일치가 아니라 동일 코드 경로인지 판정
5. 운영 경로에서 별도 rewrite·fallback 호출이 0회인지 확인
6. 음성 켜기·끄기 각각 검증
7. 같은 발화를 빠르게 재전송해 중복 반응이 없는지 확인

## 공유파일 수정

수정 허용 공유파일:

- `app/child/missions/page.tsx`
  - D안 공통 turn 함수 호출 부분만 수정
  - 레이아웃·질문풀·연결품질 작업은 수정하지 않는다.

추가 공유파일 수정이 필요하면 `requests/_blocked.md`에 기록한다.

## 작업 및 리뷰 방식

- 1차 개발: 안티그래비티
- 오케스트레이션·코드 리뷰·통합: 메인 Claude Code
- 메인 Claude Code가 직접 수정한 경우: 별도 `claude-review` 읽기 전용 검증
- Codex는 사용 가능한 경우에만 추가 검증
- 완료 즉시 커밋·Dev 배포하고 다음 큐로 진행

## 최종 보고 형식

- D안 원본 함수 위치
- 공통으로 이동하거나 직접 연결한 파일
- D안과 MissionInner의 동일 import·호출 근거
- 제거한 운영 전용 경로
- 테스트 결과
- 리뷰 결과
- 변경 파일
- 커밋 SHA
- Dev URL
- 대표님 확인 항목