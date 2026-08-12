# QuizMaster In-App 화면 기능 동기화 요청

## 목적

현재 내친구 케이 메인 앱은 requests/021 결정에 따라 퀴즈마스터를 외부 redirect 방식이 아닌 인앱 Full Screen Modal 방식으로 실행한다.

하지만 현재 실제 사용자 화면인:

components/quiz/QuizPlayScreen.tsx

에는 독립 QuizMaster 프로젝트에서 이후 개발 완료된 기능들이 반영되어 있지 않다.

독립 QuizMaster 프로젝트의 검증 완료 기능을 메인 앱 내장 화면으로 동기화한다.

---

# 현재 상황

확인 결과:

QuizMaster 프로젝트:

정상 구현 완료:

- 자동 다음 문제 이동
- 진행 상태 저장
- 이어하기 API
- 리더보드 표시
- 결과 화면

메인 앱:

실제 사용자 화면:

components/quiz/QuizPlayScreen.tsx

에는 위 기능이 누락되어 있음.

기능 삭제가 아니라 두 저장소의 화면 구현이 분리된 상태임.

---

# 구현 요구사항

## 1. 자동 다음 문제 이동

문제 풀이 완료 후:

현재:
- 사용자가 직접 다음 문제 버튼 필요

변경:

- 정답/오답 결과 표시
- 짧은 피드백 시간 후 자동 다음 문제 이동
- 마지막 문제는 결과 화면 이동

---

## 2. 이어하기 기능

사용자가:

- 앱 종료
- 화면 잠금
- 백그라운드 이동
- 네트워크 단절

후 다시 진입하면:

진행 중 퀴즈가 있으면 이어하기 가능해야 한다.

예:

총 10문제

완료:
1~6번

현재:
7번

재진입:

이어하기 선택

→ 7번 문제부터 시작

조건:

- 새 attempt 생성 금지
- 황금열쇠 재차감 금지
- 기존 attempt_id 유지

---

## 3. 리더보드 표시

퀴즈 완료 후:

결과 화면에서:

- 점수
- 순위
- 리더보드

표시 기능을 기존 QuizMaster 프로젝트 기준으로 동기화한다.

---

# 절대 변경 금지

다음 로직은 수정하지 않는다.

- 황금열쇠 차감
- reward_transaction_id
- 환불 callback
- completion callback
- 퀴즈 문제 출제 API
- 서버 채점 로직

---

# 구현 방식

새로운 퀴즈 엔진을 만들지 않는다.

기존 QuizMaster API 계약 사용:

- 문제 조회 API
- progress 저장 API
- submit API
- active attempt 조회 API
- claim API

기반으로 메인 앱 화면만 동기화한다.

---

# 검증 조건

완료 후 확인:

1. 새 퀴즈 시작 정상 동작
2. 중간 종료 후 이어하기 정상 동작
3. 이어하기 시 황금열쇠 재차감 없음
4. 7번 문제 진행 중 종료 후 7번부터 복원
5. 완료 후 리더보드 표시
6. 기존 MBTI 놀이 기능 영향 없음

---

# 작업 전 확인

먼저 현재:

- components/quiz/QuizPlayScreen.tsx
- quiz 관련 API 호출 구조
- 황금열쇠 연동 코드

분석 후 구현한다.

구현 계획은 docs/quizmaster-inapp-sync-plan.md 작성 후 진행한다.