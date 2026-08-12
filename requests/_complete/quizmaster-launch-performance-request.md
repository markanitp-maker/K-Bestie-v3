# 긴급 요청: 퀴즈마스터 실행 속도 개선

## 대상 프로젝트
- `/mnt/e/VibeCoding/K-Bestie-v3`
- 필요 시 병목 구간에 따라 `/mnt/e/VibeCoding/Quiz` 수정 항목을 별도 분리해 보고

## 현상
내친구 케이 앱에서 퀴즈마스터 카드를 클릭한 뒤 실제 퀴즈 첫 화면이 표시되기까지 약 10초가 소요된다.

## 목표
- 클릭 후 시각적 첫 화면 표시: 1초 이내
- 학년/과목 선택 등 실제 조작 가능 상태: 3초 이내
- 황금열쇠, handoff, 이어하기, 환불, 보안 및 멱등성은 기존 동작을 유지

## 작업 지침
1. 추측으로 수정하지 말고 아래 전체 흐름을 단계별로 계측한다.
   - 퀴즈 카드 클릭
   - 황금열쇠 2개 차감
   - handoff token 발급
   - `/play/quiz` reverse proxy 요청
   - Quiz 앱 session claim
   - 아이 학년 조회
   - active attempt 조회
   - 첫 화면 렌더링
2. 각 단계의 서버 처리시간, 네트워크 시간, TTFB를 Dev와 Production에서 각각 측정한다.
3. 서로 의존하지 않는 학년 조회, active attempt 확인, 초기 데이터 준비는 병렬 처리한다.
4. 중복 Supabase 조회, 중복 인증 검증, 불필요한 API 왕복을 제거한다.
5. 퀴즈 카드가 보이는 시점에 `/play/quiz` 및 Quiz 배포 대상에 preconnect/prefetch 적용 가능 여부를 검토한다.
6. 첫 화면에 필요하지 않은 리더보드, 오답 데이터, 전체 문제 목록, 무거운 이미지와 JavaScript는 지연 로딩한다.
7. 클릭 즉시 전체화면 셸과 내친구 케이 로고, K 마스코트, `퀴즈를 준비하고 있어요` 로딩 상태를 표시한다.
8. 로딩 중 중복 클릭으로 황금열쇠가 재차감되거나 handoff 요청이 중복 생성되지 않게 막는다.
9. 다음 항목도 함께 점검한다.
   - Vercel cold start
   - reverse proxy 다중 왕복
   - CDN 캐시 설정
   - 정적 이미지 용량
   - Next.js 초기 번들 크기
   - Supabase 연결 및 조회 지연
10. 보안 검증, 황금열쇠 차감·환불, 이어하기, attempt 및 callback 멱등성을 약화하지 않는다.

## 검증
- 모바일 Safari와 Chrome에서 각각 측정
- cold start 5회, warm start 5회
- Dev와 Production 모두 확인
- 수정 전후 시간을 동일 조건으로 비교
- 실제 아이 계정 흐름에서 아래 항목 회귀 검증
  - 황금열쇠 2개 차감
  - 이어하기 재차감 없음
  - handoff token 정상 claim
  - 학년/과목 화면 정상 표시
  - 완료 callback
  - 오류 환불 callback

## 완료 보고
- 확인된 병목 원인
- 단계별 수정 전후 시간
- 수정한 파일 목록
- K-Bestie-v3 수정 사항
- Quiz 프로젝트 수정 사항이 있다면 별도 구분
- 모바일 Safari/Chrome cold·warm 측정 결과
- 미해결 위험 및 후속 권장 사항
