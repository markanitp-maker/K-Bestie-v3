# 부모-케이 대화 Q&A 탭 404 오류 수정 요청

## 문제
부모-케이 대화 화면 상단 Q&A 버튼 클릭 시 Next.js 404 페이지로 이동한다.

재현:
1. 부모 계정 로그인
2. 케이와 대화 화면 진입
3. 상단 Q&A 탭 클릭
4. 404 발생

## 요구사항

Q&A는 부모-케이 대화 화면 내부 탭으로 동작해야 한다.

현재:
대화 화면
→ Q&A 버튼
→ 별도 route 이동
→ 404

변경:
대화 화면
→ Q&A 탭 클릭
→ 동일 페이지 내부 상태 변경
→ 질문 목록 표시

## 점검 항목

1. Q&A 버튼 click handler 확인
2. router.push / href 경로 확인
3. 실제 존재하는 route 확인
4. App Router page.tsx 존재 여부 확인
5. Dev/Production route 차이 확인
6. 기존 parent_questions 데이터 연결 확인

## 정상 동작

대화 탭:
- 기존 부모-K 대화 표시

Q&A 탭:
- 질문 목록
- 질문 대기 중
- 답변 완료
- 답변하지 않음 상태 표시

## 배포

Development 수정 후 검증
→ 동일 Commit Production 적용
→ 모바일 PWA 검증

완료 기준:
- Q&A 클릭 시 404 없음
- 대화/Q&A 탭 전환 정상
- 기존 parent_questions 데이터 표시
- Dev/Production 동일 동작
