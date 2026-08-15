# 083 부모–케이 날짜·맥락·아이에게 물어보기 정상화

## 목표

- KST 기준 날짜 표현을 LLM이 아닌 결정적 코드로 해석한다.
- 날짜 제약을 의미 유사도보다 먼저 적용하고, 질문 유형별 source 우선순위를 보장한다.
- 부모의 정정 발화는 직전 정보 질문을 찾아 다시 조회한다.
- 부분 근거와 무자료, 시스템 오류를 구분하고, 직전 미확인 세부 내용을 “물어봐줘”에 승계한다.
- 기존 가족 권한, 상세 리포트 요금제 제한, Green List OFF, Red/Crisis, 부모 최종 승인과 아이 거부권은 그대로 유지한다.

## 변경 대상

1. `lib/parentKChat/temporalQuery.ts` / `.test.ts`
   - KST Temporal Resolver, 후속 날짜 승계, source priority와 evidence date guard.
2. `lib/parentKChat/answerPolicy.ts` / `.test.ts`
   - `EVIDENCE_FOUND`, `PARTIAL_EVIDENCE`, `NO_DATA`, `SYSTEM_ERROR` 응답 계약과 아이 질문 맥락 구성.
3. `lib/parentKChat/parentKnowledgeRetrieval.ts` / `.test.ts`
   - 날짜 범위 DB scope, user-only effective query, temporal-first ranking, evidence 메타데이터.
4. `lib/parentKChat/intentClassifier.ts` / `.test.ts`
   - 날짜 정정 패턴과 plain “물어봐줘”의 직전 unknown-detail 승계.
5. `app/api/parent/k-chat/route.ts`
   - 정정 재검색, 날짜 guard, answer status 및 구조화된 ask-child context 응답.
6. `app/parent/guide/page.tsx`
   - K 응답의 temporal/unknown/proposal 메타데이터를 다음 요청에 안전하게 전달.
7. `package.json`
   - 신규 단위 테스트를 기본 테스트 묶음에 포함.

## 데이터 흐름

1. 현재 부모 발화와 이전 **부모 발화**에서 Temporal Resolver가 날짜/범위를 해석한다.
2. 정정 발화면 직전 부모 정보 질문의 topic과 현재 정정의 날짜를 결합한다.
3. Retrieval은 시간 유형에 따라 DB query를 제한하고 `Promise.allSettled`로 source를 조회한다.
4. Evidence는 source date와 temporal match를 가지며, mismatch evidence는 exact-date primary context에서 제외된다.
5. 서버가 근거 상태를 판정하고 LLM은 선택된 근거 안에서만 답변한다.
6. 미확인 세부 내용과 날짜를 응답 메타데이터 및 ask-child proposal에 담아 후속 “물어봐줘”가 재입력을 요구하지 않게 한다.

## 작업 단위

1. Temporal Resolver와 테스트 작성 — 10분
2. Retrieval date scope/source routing/date guard 구현 — 10분
3. Correction/Answer Policy/Ask Child context 구현 — 10분
4. API·부모 화면 계약 연결 — 10분
5. 단위 테스트·타입체크·diff 검증 — 10분
6. Development 배포 및 Scenario A~G 검증 — 10분 이상, 배포 상태에 따라 분리

1은 선행이며 2~4는 순차 의존한다. 5는 구현 후, 6은 정적 검증 통과 후 수행한다.

## 위험 및 제약

- 명시 날짜에서 다른 날짜 Memory가 다시 primary가 되면 잘못된 사실 응답이 재발한다.
- assistant의 과거 사실 답변을 검색 질의에 넣으면 오류가 증폭되므로 user turn만 사용한다.
- exact-date primary source 장애를 `NO_DATA`로 오인하지 않고 `SYSTEM_ERROR`로 구분한다.
- 신규 migration, DB 데이터 생성·수정·삭제, Green List 활성화는 하지 않는다.
- Production 배포는 Dev 검증 후 Owner 승인 시 동일 commit으로만 진행한다.
