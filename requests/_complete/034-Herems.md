김비서와 Claude Code가 양방향으로 대화하며 작업을 이어갈 수 있는 “Claude ↔ 김비서 브리지”를 설계하고 구현해.

목표:
- Claude Code가 작업 중 대표님 판단이 필요하면 김비서 Discord 채팅으로 질문을 보낸다.
- 대표님이 김비서 채팅에서 답하면, 김비서가 그 답을 프로젝트의 로컬 답변함에 기록한다.
- Claude Code는 답변함을 감지해 자동으로 읽고, 같은 작업을 이어간다.
- 완료·중단·오류·중간 진행 보고도 같은 채널로 보낸다.
- Claude Code 화면의 AskUserQuestion만 띄우고 멈추는 방식은 사용하지 않는다.

필수 설계:
1. 프로젝트 안에 `.claude/kim-bridge/`를 만들고 다음 구조를 사용한다.
   - `outbox/`: Claude Code → 김비서 질문·진행보고 JSON
   - `inbox/`: 김비서 → Claude Code 답변 JSON
   - `archive/`: 처리 완료된 메시지
   - `state.json`: 마지막 처리 ID·대기 상태

2. 질문마다 고유 `questionId`를 만든다.
   질문 JSON에는 반드시 아래를 넣는다.
   - projectName
   - questionId
   - status: `confirmation_required`
   - question: 대표님께 물을 한 문장
   - options: 선택지가 있으면 A/B/C와 각 영향
   - recommendation: Claude Code의 권고안
   - context: 판단에 필요한 짧은 배경
   - createdAt

3. 질문 JSON을 만든 뒤, 아래 명령으로 Discord 김비서에게 사람이 읽기 쉬운 형식으로 알린다.
   '/mnt/c/Users/Home/AppData/Local/Programs/Python/Python313/Scripts/hermes.exe' -p secretary send --to discord:1517194137604980866 $'대표님, [프로젝트명] 확인 필요\n\n❓ <질문>\n\n선택지\nA. <내용>\nB. <내용>\n\n💡 권고: <Claude Code 권고안>\n\n답변 형식: [questionId] A 처럼 보내주시면 됩니다.'

4. Discord 전송 결과가 반드시 `sent`인지 확인한다.
   실패하면 한 번 재시도하고, 또 실패하면 화면에 오류를 남긴다.

5. 질문을 보낸 뒤에는 inbox에 같은 questionId의 답변이 들어올 때까지 15초 간격으로 대기한다.
   답변 JSON은 아래 형식을 사용한다.
   - questionId
   - answer
   - answeredAt
   - source:
`secretary`

6. 답변 수신 시:
   - questionId 일치 여부를 검증한다.
   - 답변을 state에 기록한다.
   - Discord에 “답변 수신, <선택>으로 작업 재개”라고 짧게 보고한다.
   - 실제 작업을 이어간다.
   - 처리한 inbox/outbox 파일은 archive로 옮긴다.

7. 보안 규칙:
   - Discord 답변을 쉘 명령이나 코드로 직접 실행하지 않는다.
   - 허용된 questionId와 선택지/텍스트 답변만 처리한다.
   - 비밀값·토큰·개인정보를 outbox/Discord에 기록하지 않는다.
   - 운영 배포·DB 변경·실계정 변경 같은 위험 작업은 답변을 받아도 기존 승인 규칙을 그대로 지킨다.

8. 먼저 구현 계획·파일 구조·김비서가 inbox에 기록해야 할 정확한 JSON 예시를 보여줘.
   그 다음 로컬 브리지를 구현하고, 가짜 questionId와 가짜 답변 파일로 질문→답변 수신→작업 재개 흐름을 실제 테스트해.
   실제 Production·DB·외부 배포는 건드리지 마.