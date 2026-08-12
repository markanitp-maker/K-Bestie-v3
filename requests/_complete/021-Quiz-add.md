퀴즈마스터 실행 구조를 MBTI 놀이와 동일한 K-Bestie 내부 Full Screen Modal 방식으로 변경하라.

현재 문제:
- 퀴즈마스터 클릭 시 외부 Vercel URL로 이동
- 모바일 Safari 주소창, 공유 버튼, 브라우저 UI 노출
- 사용자가 내친구 케이 놀이가 아닌 별도 사이트로 이동한 느낌을 받음

변경 방향:
- 작업 대상은 K-Bestie-v3 메인 앱이다.
- 퀴즈마스터 프로젝트의 handoff token, completion callback, refund callback 계약은 유지한다.
- 외부 URL redirect 방식은 제거한다.
- iframe 방식도 사용하지 않는다.
- MBTI /play/mbti 실행 패턴을 기준으로 동일한 Full Screen Modal 놀이 컨테이너 구조를 적용한다.

구현 목표:
1. /child/play에서 퀴즈마스터 카드 클릭
2. K-Bestie 내부 Full Screen Modal 열기
3. Modal 안에서 퀴즈 진행
4. 완료 후 Modal 종료
5. K-Bestie 놀이 화면 복귀
6. 황금열쇠 차감 및 completion callback 정상 유지

검토 사항:
- 기존 QuizMaster 코드를 메인 앱으로 가져와야 하는 범위 분석
- API/DB 로직과 UI 컴포넌트 분리
- MBTI와 동일한 놀이 실행 경험 제공
- 모바일 PWA에서 Safari UI가 노출되지 않는지 확인

수정 후 반드시 확인:
- 황금열쇠 차감 정상
- handoff token 정상
- completion callback 정상
- refund callback 정상
- MBTI 회귀 없음