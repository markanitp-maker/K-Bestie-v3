# 부모–케이 대화 통합 지식 Retrieval 구현 요청

## 0. 작업 목적

부모가 케이와 대화할 때, 케이는 부모에게 이미 제공된 아이 관련 정보를 기본적으로 알고 있어야 한다.

현재 부모–케이 대화는 `memory_facts` 중심으로만 retrieval하여, 부모 대시보드·일일 리포트·주간 리포트·상세 리포트에 존재하는 정보를 케이가 “관련 기록이 없다”고 답하는 문제가 있다.

이번 작업의 목표는 부모–케이 대화용 지식원을 아래와 같이 통합하는 것이다.

```text
① 부모 대시보드에 노출되는 전체 요약 정보
② 일일 리포트 전체
③ 주간 리포트 전체
④ 상세 리포트 전체
⑤ Memory Facts
⑥ 현재 부모–케이 대화 맥락
```

케이는 위 정보들을 기반으로 부모와 자연스럽게 대화해야 한다.

중요:

```text
memory_facts는 케이가 아는 정보의 전부가 아니다.
memory_facts는 여러 지식원 중 하나다.
```

Development와 Production 모두 동일하게 적용하고 실제 E2E 검증까지 완료한다.

---

## 1. 현재 확인된 Root Cause

진단 결과:

```text
부모 대시보드/리포트
→ daily_reports 등 리포트 데이터

부모–케이 대화
→ memory_facts / memory_embeddings만 retrieval
```

두 파이프라인이 분리되어 있어, 부모에게 이미 보여준 리포트 정보도 부모–케이 대화에서는 검색되지 않는다.

실제 사례:

```text
대시보드:
마음 흐름 = "야외에서 제일 즐거워해요"

부모 질문:
"서현이가 야외에서 노는 걸 좋아해?"

현재 케이:
"제가 확인할 수 있는 기록에는 관련된 구체적인 내용이 남아 있지 않아요."
```

진단상 해당 정보는 리포트에는 존재하지만 `memory_facts`에는 존재하지 않았고, parent-chat retrieval이 `daily_reports`를 검색하지 않아 NO_DATA fallback이 발생했다.

---

## 2. 핵심 요구사항

부모–케이 대화용 retrieval source를 아래처럼 통합한다.

```text
부모 질문
   ↓
Intent Routing
   ↓
통합 Retrieval
   ├─ 부모 대시보드 정보
   ├─ 일일 리포트
   ├─ 주간 리포트
   ├─ 상세 리포트
   └─ Memory Facts
   ↓
관련 근거 병합
   ↓
출처 + 날짜 + 신뢰도 정리
   ↓
LLM Context
   ↓
케이 답변
```

NO_DATA fallback은 아래 모든 지식원에서 관련 근거가 없을 때만 사용한다.

```text
dashboard = no match
AND daily report = no match
AND weekly report = no match
AND detailed report = no match
AND memory facts = no match
```

---

## 3. 구현 전 실제 데이터 구조 확인

테이블명·컬럼명·API 경로를 추측하지 않는다.

현재 코드와 DB를 먼저 확인하여 아래를 실제 기준으로 매핑한다.

| 지식원 | 실제 API | 실제 table/view/RPC | 주요 field | 기간 |
|---|---|---|---|---|
| 대시보드 | 확인 | 확인 | 확인 | 확인 |
| 일일 리포트 | 확인 | 확인 | 확인 | 확인 |
| 주간 리포트 | 확인 | 확인 | 확인 | 확인 |
| 상세 리포트 | 확인 | 확인 | 확인 | 확인 |
| Memory Facts | 확인 | 확인 | 확인 | 확인 |

확인 후 실제 구현 구조를 결과 보고에 포함한다.

---

## 4. 부모 대시보드 지식원

부모 대시보드에 노출되는 모든 아이 관련 요약 정보는 부모–케이 대화에서 retrieval 가능한 지식으로 취급한다.

현재 확인된 영역 예시:

```text
학교·학원 생활
친구 관계
마음 흐름
관심사·취향
공부 고민
디지털·콘텐츠
선생님·어른
반복 이야기
오늘의 한마디
```

주의:

- 실제 코드에 존재하는 필드 기준으로 구현
- UI 표시 문자열을 다시 화면에서 scrape하지 않음
- 동일 원천 DB/API의 구조화 데이터를 사용
- null/empty 필드는 제외
- child_id가 정확히 일치하는 데이터만 사용

---

## 5. 일일 리포트 지식원

일일 리포트에 존재하는 부모용 최종 요약 정보는 모두 부모–케이 대화에서 사용할 수 있어야 한다.

예:

```text
summary
학교·학원
친구 관계
감정/마음 흐름
관심사
공부 고민
콘텐츠
어른 관련
반복 주제
오늘의 대화거리
부모 가이드
기타 부모에게 노출되는 최종 요약 필드
```

실제 field 이름은 현재 DB schema 기준으로 확인한다.

원칙:

```text
raw conversation 원문 사용 X
부모에게 제공되는 final summary 사용 O
```

---

## 6. 주간 리포트 지식원

부모가 주간 리포트에서 본 아이의 변화·반복·패턴을 케이에게 물을 수 있어야 한다.

예:

```text
이번 주 친구 관계는 어땠어?
요즘 수학 얘기를 자주 해?
이번 주 기분 흐름은 어때?
지난주보다 달라진 게 있어?
```

주간 리포트 retrieval 시:

- report 기간을 context에 포함
- 현재 주와 이전 주 구분
- 최신 주간 리포트 우선
- 필요 시 최근 N개 주간 리포트를 비교 가능하도록 구성

---

## 7. 상세 리포트 지식원

상세 리포트에서 부모가 확인할 수 있는 전체 최종 분석·요약 정보를 부모–케이 대화의 검색 대상에 포함한다.

실제 서비스에서 “상세 리포트”가 어떤 상품/테이블/API에 연결되어 있는지 먼저 확인한다.

금지:

- 상세 리포트와 raw conversation을 동일시
- 내부 분석용 민감 필드를 부모에게 자동 노출
- 부모 화면에 원래 공개되지 않는 정보를 parent-chat에 추가 노출

원칙:

```text
부모 화면에서 볼 수 있는 최종 정보만 retrieval 가능
```

---

## 8. Memory Facts 지식원

기존 `memory_facts` retrieval은 제거하지 않는다.

역할:

```text
리포트 = 최근 상태·사건·변화
Memory Facts = 장기적 성향·취향·반복 기억
```

예:

```text
최근 리포트:
수학 숙제에 부담을 느껴요

Memory Fact:
로블록스를 자주 즐김
책과 만화책을 좋아함
```

두 지식원을 합쳐야 한다.

---

## 9. 현재 부모–케이 대화 맥락

현재 conversation context도 retrieval 결과와 함께 사용한다.

예:

```text
부모:
서현이가 야외에서 노는 걸 좋아해?

케이:
최근 리포트에서는 야외 활동을 특히 즐기는 모습이 있었어요.

부모:
원래도 그런 편이야?
```

두 번째 질문에서는:

```text
직전 topic = 야외 활동
질문 의도 = 장기 경향 확인
```

으로 이해하고 Memory Facts + 과거 리포트까지 확장 검색해야 한다.

후속 질문을 독립 질문으로 처리하지 않는다.

---

## 10. Retrieval 우선순위

모든 데이터를 무조건 프롬프트에 넣지 않는다.

질문과 관련된 근거만 검색·선별한다.

권장 우선순위:

```text
1. 현재/최근 일일 리포트
2. 최근 대시보드 요약
3. 최근 주간 리포트
4. 상세 리포트
5. Memory Facts
6. 필요 시 이전 리포트
```

질문 의도에 따라 우선순위 조정:

```text
"오늘/어제/최근"
→ 일일 리포트 우선

"이번 주"
→ 주간 리포트 우선

"평소/원래/계속/자주"
→ Memory Facts + 과거 리포트 우선

"리포트에 뭐라고 했어?"
→ 해당 리포트 source 우선
```

---

## 11. Retrieval 결과 구조화

LLM에 단순 문자열 묶음으로 전달하지 않는다.

예:

```json
{
  "source": "daily_report",
  "date": "2026-08-07",
  "area": "emotion_hint",
  "content": "야외에서 제일 즐거워해요",
  "relevance": 0.92
}
```

Memory Fact:

```json
{
  "source": "memory_fact",
  "date": "2026-08-01",
  "area": "interest",
  "content": "로블록스 게임을 즐겨 함",
  "relevance": 0.84
}
```

최종 LLM context 예:

```text
[최근 리포트 / 2026-08-07]
마음 흐름: 야외에서 제일 즐거워해요

[주간 리포트 / 2026-08-03~2026-08-09]
친구들과 함께하는 활동을 즐기는 경향이 확인됨

[누적 기억]
로블록스 게임을 즐겨 함
```

---

## 12. 답변 생성 정책

### 최근 정보가 있는 경우

부모:

```text
서현이가 야외에서 노는 걸 좋아해?
```

정상:

```text
네. 최근 리포트에서는 서현이가 야외에서 노는 걸 특히 즐기는 모습이 있었어요.
```

금지:

```text
관련 기록이 없어요.
```

### 최근 정보와 장기 기억이 다른 경우

부모:

```text
원래도 야외 활동을 좋아했어?
```

정상:

```text
최근에는 야외 활동을 즐기는 모습이 있었지만,
누적 기억만으로는 예전부터 계속 그랬다고 단정할 근거는 아직 부족해요.
```

### 근거가 전혀 없는 경우

아래 모든 지식원에서 관련 근거가 없을 때만:

```text
제가 확인할 수 있는 리포트와 누적 기록에는 아직 관련 내용이 없어요.
```

그 뒤 필요 시:

```text
아이에게 물어보기
```

Parent Query Router로 전환한다.

---

## 13. Parent Query Router와의 관계

부모–케이 retrieval과 Parent Query Router는 구분한다.

```text
부모:
서현이가 야외 활동 좋아해?
→ 기존 정보 조회
→ 통합 Retrieval
→ 답변

부모:
그럼 이번 주말에 뭐 하고 싶은지 물어봐줘
→ Parent Query Request
→ Parent Query Router
```

중요:

```text
기존 정보가 있는데도
무조건 "아이에게 물어보기"로 보내지 않는다.
```

순서:

```text
정보 조회 질문
→ 먼저 통합 Retrieval

아이에게 질문 요청
→ Parent Query Router

정보 조회 결과 NO_DATA
→ 그때만 "아이에게 물어보기" 제안 가능
```

---

## 14. 개인정보·데이터 정책

부모–케이 대화에서 사용할 수 있는 정보:

```text
부모 대시보드에 이미 노출되는 요약 정보
일일 리포트 최종 정보
주간 리포트 최종 정보
상세 리포트에서 부모에게 제공되는 최종 정보
Memory Facts 중 부모 대화에 사용 가능한 정보
```

사용 금지:

```text
raw conversation 원문
corrected conversation 원문
부모에게 원래 제공되지 않는 내부 분석 정보
시스템 내부 민감 메타데이터
다른 가족/다른 아이 데이터
```

기존 raw/corrected 7일 파기 정책과 충돌하지 않도록 final report 기반 retrieval을 사용한다.

---

## 15. Child ID 및 가족 격리

모든 retrieval source에서 동일한 대상 아이를 가리키는지 검증한다.

확인:

```text
dashboard child id
daily report child id
weekly report child id
detailed report child id
memory_facts child id
parent-chat child id
```

다른 ID namespace 혼용 금지.

다른 가족·형제자매 데이터 혼입은 0건이어야 한다.

---

## 16. 성능 및 비용

매 질문마다 모든 리포트를 전부 LLM context에 넣지 않는다.

권장:

```text
질문 분석
→ source 후보 결정
→ source별 top-K retrieval
→ dedupe
→ 최신성/관련성 정렬
→ context budget 내 병합
```

필수:

- source별 최대 retrieval 수 제한
- 중복 요약 제거
- 동일 내용이 daily report와 dashboard에 동시에 있으면 dedupe
- 최신 정보 우선
- 장기 질문에는 memory weight 증가
- LLM context token 과다 사용 방지

---

## 17. Fallback 정책 변경

현재:

```text
memory_facts 결과 없음
→ 즉시 "관련 기록 없음"
```

변경:

```text
memory_facts 결과 없음
→ report source 검색 계속

daily 없음
→ weekly 검색

weekly 없음
→ detailed 검색

모든 source 없음
→ NO_DATA
```

즉:

```text
NO_DATA = 통합 Retrieval 전체 결과 없음
```

이어야 한다.

---

## 18. 구현 방식

기존 코드를 먼저 분석하고 최소 변경으로 통합한다.

기존 `searchMemoryFactsDetailed()`만 호출하는 구조라면 상위에 통합 orchestrator를 둔다.

예:

```ts
retrieveParentKContext({
  childId,
  query,
  conversationContext,
});
```

결과 예:

```ts
{
  sources: [...],
  hasEvidence: true,
  maxRelevance: ...,
  contextText: ...
}
```

실제 저장소 구조와 기존 모듈을 먼저 확인한 뒤 구현한다. 존재하지 않는 파일·API를 추측해 만들지 않는다.

---

## 19. Development 테스트

### Test 1 — 대시보드/일일 리포트

부모 질문:

```text
서현이가 야외에서 노는 걸 좋아해?
```

근거:

```text
야외에서 제일 즐거워해요
```

기대:

```text
관련 근거 기반 답변
NO_DATA 금지
아이에게 물어보기 자동 제안 금지
```

### Test 2 — 공부 고민

질문:

```text
서현이가 요즘 공부 때문에 힘들어해?
```

근거:

```text
수학 숙제에 부담을 느껴요
```

기대:

```text
수학 숙제 부담을 최근 근거로 설명
```

### Test 3 — 콘텐츠

질문:

```text
요즘 무슨 게임 좋아해?
```

근거가 대시보드/리포트와 Memory Facts 양쪽에 존재하면 두 source를 병합하되 중복 답변은 금지한다.

### Test 4 — 장기 경향

질문:

```text
원래도 로블록스를 좋아했어?
```

기대:

```text
Memory Facts 및 과거 기록 기반 답변
```

### Test 5 — 정보 없음

질문:

```text
서현이가 요즘 어떤 색 신발을 사고 싶어해?
```

모든 source에 근거가 없다면:

```text
관련 기록 없음
→ 필요 시 아이에게 물어보기 제안
```

### Test 6 — 후속 대화

```text
부모: 서현이가 야외에서 노는 걸 좋아해?
케이: 최근 리포트에서는...
부모: 원래도 그래?
```

기대:

- `야외 활동` topic 유지
- 장기 retrieval 수행
- 독립 질문으로 오인 금지

---

## 20. 주간·상세 리포트 테스트

각 report source에만 존재하는 실제 사례를 찾아 검증한다.

예:

```text
일일에는 없음
주간에는 있음
```

부모가 해당 내용을 질문했을 때 답변 가능해야 한다.

동일하게:

```text
daily 없음
weekly 없음
detailed report에만 있음
```

인 경우에도 답변 가능해야 한다.

---

## 21. 회귀 테스트

반드시 확인:

- 기존 부모–케이 일반 대화
- Parent Query Router
- Green 질문 등록
- Red 차단
- Crisis 잠금 정책
- Q&A
- 부모 대시보드
- 일일 리포트
- 주간 리포트
- 상세 리포트
- Memory Facts
- 형제자매 전환
- 다른 가족 데이터 격리
- 모바일 PWA
- PC 브라우저

---

## 22. Development → Production 적용

1. 현재 Development/Production Commit 확인
2. 실제 report schema/API 확인
3. 통합 retrieval 구현
4. 단위 테스트
5. 타입 검사·린트·빌드
6. Development 배포
7. 실제 안서현 사례 E2E
8. 주간/상세 report-only 사례 E2E
9. Parent Query Router 회귀
10. 가족 데이터 격리 테스트
11. PASS 후 동일 Commit Production 배포
12. Production QA 계정 검증
13. Production 실제 답변 검증
14. 결과 보고

Development만 수정하고 완료 처리하지 않는다.

---

## 23. 완료 기준

- [ ] 대시보드 전체 정보가 부모–케이 retrieval 대상
- [ ] 일일 리포트 전체가 retrieval 대상
- [ ] 주간 리포트 전체가 retrieval 대상
- [ ] 상세 리포트 전체가 retrieval 대상
- [ ] Memory Facts 유지
- [ ] 현재 대화 context 유지
- [ ] source/date를 구분해 LLM context 구성
- [ ] daily/dashboard 중복 dedupe
- [ ] 최근 상태와 장기 성향 구분
- [ ] 모든 source가 없을 때만 NO_DATA
- [ ] 기존 정보가 있으면 “아이에게 물어보기” 자동 제안 금지
- [ ] raw/corrected 원문 사용 금지
- [ ] 다른 가족/아이 데이터 혼입 0건
- [ ] Development E2E PASS
- [ ] Production E2E PASS
- [ ] 모바일 PWA/PC 회귀 PASS
- [ ] Parent Query Router 회귀 PASS

---

## 24. 결과 보고 형식

```text
1. 변경 전 parent-chat retrieval 구조
2. 실제 dashboard source
3. 실제 daily report source
4. 실제 weekly report source
5. 실제 detailed report source
6. 실제 memory_facts source
7. 통합 retrieval 구현 구조
8. source 우선순위
9. context dedupe 방식
10. NO_DATA 변경 내용
11. Parent Query Router와 intent 분리
12. 안서현 "야외 활동" 실제 E2E 결과
13. "수학 숙제" 실제 E2E 결과
14. weekly-only E2E
15. detailed-report-only E2E
16. 장기 memory E2E
17. 가족 격리 테스트
18. Development 배포 Commit/URL
19. Production 배포 Commit/URL
20. 회귀 테스트 결과
21. 남은 제한사항
```

실제 결과 예:

```text
질문:
서현이가 야외에서 노는 걸 좋아해?

retrieved_sources:
- daily_report / 2026-08-07 / emotion_hint
- dashboard / latest / emotion_hint

memory_fact:
- match 없음

최종 답변:
최근 리포트에서는 서현이가 야외에서 노는 걸 특히 즐기는 모습이 있었어요.

NO_DATA:
false
```

---

## 25. 보안 원칙

Production service role key, API key, 비밀번호, 토큰 등 중요 비밀정보는:

- 평문 하드코딩 금지
- 로그 출력 금지
- 임시 파일 저장 금지
- 테스트 코드 삽입 금지

기존 보안 환경변수·Secret Manager·Vercel/Supabase Secrets에서 런타임에만 불러오고 값은 반드시 마스킹한다.
