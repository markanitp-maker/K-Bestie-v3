기존 .claude/skills/k-bestie-voice-mission-qa 스킬을 v2로 업데이트하라. 기존 QA 기준은 유지하고, 이번 전체 회귀 QA에서 발견된 문제(답변·LLM 응답은 정상이나 미션 진행률 증가가 안 되는 서비스 흐름 결함)를 반영하여 "사용자 행동 기반 E2E 검증" 중심으로 강화하라. 앱 코드는 수정하지 말고 스킬 문서만 수정한다.

수정 대상:
- .claude/skills/k-bestie-voice-mission-qa/SKILL.md
- .claude/skills/k-bestie-voice-mission-qa/references/voice-mission-test-matrix.md
- .claude/skills/k-bestie-voice-mission-qa/templates/qa-report.md

반드시 추가할 내용:

1. QA 기본 원칙 추가
- API 성공 응답이나 로그 정상만으로 PASS 판정 금지
- "아이 행동 → K 응답 → 서비스 상태 변경 → 화면 변화" 전체 흐름이 완료되어야 PASS
- 자동 테스트 PASS와 실제 사용자 경험 PASS를 구분

2. 음성 미션 E2E 검증 단계 추가

모든 미션 테스트는 아래 순서를 기준으로 검증한다.

아이 행동:
- K 질문 수신
- 아이 음성 답변
- STT 인식 결과 확인

AI 처리:
- 답변 분류 결과 확인
- VALID / REFUSAL / NO_RESPONSE 처리 확인
- K 응답 생성 확인
- TTS 재생 상태 확인

서비스 상태:
- valid_answer_count 증가 여부
- mission progress 증가 여부
- session 상태 유지 여부
- 다음 질문 선택 여부
- 미션 완료 조건 도달 여부

화면:
- 진행률 게이지 변화
- 상태 표시 변화
- 오류 메시지 노출 여부
- 다음 질문 표시 여부

3. 필수 테스트 시나리오 추가

A. 정상 답변
목적:
아이의 정상 답변 1회가 실제 진행률 증가로 연결되는지 확인

검증:
- 질문 1개 표시
- 아이 정상 답변
- K 정상 응답
- progress +1
- 게이지 증가
- 다음 질문 이동

B. 10개 VALID 완료
목적:
정상적인 미션 완료 검증

검증:
- 10개 유효 답변
- 완료 상태 변경
- 보상 지급
- 세션 completed 처리

C. REFUSAL 답변
목적:
아이 거부 상황 처리 검증

검증:
- 답변 거부
- RESERVE 질문 전환
- 진행률 유지
- 질문 소진 방지

D. NO_RESPONSE / 잘못된 답변
목적:
재질문 및 질문 이동 검증

검증:
- 재질문 횟수
- 다음 질문 이동 조건
- 무한 반복 여부

E. PRIMARY 10 + RESERVE 10 검증
목적:
질문 풀 소진 방지

검증:
- 최초 PRIMARY 질문 수
- RESERVE 확보 여부
- 20개 질문 소진 이후 처리
- 미답변 문항 재순환 정책 확인

F. 이어하기
검증:
- 기존 session 유지
- progress 유지
- 중복 차감 없음
- 첫 질문 재시작 금지

G. 장애 상황
검증:
- STT 실패
- LLM timeout
- TTS 실패
- 네트워크 지연
- fallback 동작
- 아이에게 잘못된 "기억 상실", "서버 문제" 표현 금지

4. 성능 검증 항목 추가

각 턴마다 기록:
- 아이 발화 종료 → K 응답 시작 latency
- K 응답 생성 시간
- TTS 시작 시간
- 전체 turn latency

판정 기준은 코드에 정의된 실제 기준을 확인 후 적용하고 추측하지 않는다.

5. 상태 표시 검증 추가

VoiceConversationStateBadge 관련:

필수 상태:
- 듣는 중
- 생각하는 중
- 말하는 중
- 연결 중
- 오류 상태

검증:
- 실제 pipeline stage와 UI 표시 일치
- 정상 대화 중 불필요한 오류 표시 없음
- 연결 불안정 메시지는 실제 장애 조건에서만 표시

6. QA 보고서 템플릿 변경

qa-report.md에 아래 섹션 추가:

## 사용자 행동 기반 E2E 결과

| 시나리오 | 결과 | 증거 |
|---|---|---|
| 정상 답변 진행률 증가 | | |
| 10개 완료 | | |
| REFUSAL 처리 | | |
| RESERVE 전환 | | |
| 이어하기 | | |
| 장애 복구 | | |

## 서비스 체인 검증

아이 행동
→ STT
→ LLM 판단
→ DB 상태 변경
→ UI 반영

각 단계별 PASS/FAIL 기록

7. 기존 스킬의 목적 변경

기존:
"음성 미션 기능 QA"

변경:
"아이와 AI 친구 간 실제 대화 경험을 검증하는 E2E 서비스 QA"

수정 후:
- dry run 실행
- 변경 파일 목록 출력
- 기존 앱 코드 변경 여부 확인
- 커밋 전 결과 보고

코드 수정은 절대 하지 않는다.