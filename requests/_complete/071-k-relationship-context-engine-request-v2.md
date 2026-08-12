# 071 — K Relationship Context Engine Request

케이는 아이와 친구처럼 관계를 이어가는 AI가 되어야 한다.

핵심:
- 미션: 케이가 질문하고 아이 답변을 받는 구조
- 자유대화: 아이가 이야기하면 케이가 친구처럼 반응
- 공통 Context: Profile + Session + Recent Episode + Memory Fact + Safety
- parent_questions는 미션 최우선 유지
- Memory는 모든 일반 턴에서 관련 검색하되 Silent Memory 기본
- daily/weekly/monthly/detail report는 아이 대화 prompt 직접 주입 금지
- sibling Memory 격리
- Mission/Free Chat 공통 Relationship Context Builder 적용

완료 기준:
아이에게 케이는 과거 이야기를 자연스럽게 기억하는 친구처럼 느껴져야 한다.
