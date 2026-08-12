퀴즈마스터 프로젝트
✅ 완료
- 퀴즈 실행
- handoff token 소비
- completion callback 호출
- refund callback 호출


내친구 케이 메인 앱 (K-Bestie-v3)
🔄 현재 작업 대상
- 놀이 카드 추가
- 시작 버튼 연결
- 황금열쇠 차감
- handoff token 발급
- callback 수신
- 놀이 기록 저장
```

아래 내용을 `requests/011-quizmaster-kbestie-integration.md`로 만들어서 K-Bestie-v3 프로젝트에 넣으면 됩니다.

```md
# 퀴즈마스터 - 내친구 케이 메인 앱 연동

## 목적

내친구 케이(K-Bestie-v3) 놀이 플랫폼에 두 번째 놀이로 퀴즈마스터를 연동한다.

현재 상태:

- 놀이 플랫폼 목표: 총 9개 놀이 확장
- 1번째 놀이: MBTI
  - 메인 앱 연동 완료
  - 황금열쇠 Core 사용
  - playSessionId 기반 진행
  - 완료 이벤트 처리 완료
- 2번째 놀이: 퀴즈마스터
  - 퀴즈마스터 프로젝트 구현 완료
  - Dev Supabase 적용 완료
  - handoff token / completion callback / refund callback 계약 완료

이번 작업은 퀴즈마스터 기능 개발이 아니라 K-Bestie 메인 앱과 연결하는 작업이다.

---

# 기본 원칙

## 반드시 유지

- 황금열쇠는 K-Bestie 메인 앱이 소유한다.
- 모든 놀이는 공통 황금열쇠 Core를 사용한다.
- reward_transaction_id 기반 거래 추적을 유지한다.
- MBTI 기존 코드는 변경하지 않는다.

## 변경 금지

아래 영역은 수정하지 않는다.

```
k_play_sessions
/api/play/*
progress_state.mbti
mbti_completion_events
기존 MBTI 황금열쇠 소비 흐름
```

퀴즈마스터 때문에 기존 MBTI 구조를 일반화하거나 변경하지 않는다.

---

# 목표 구조

```
내친구 케이 메인 앱

/child/play

 ├─ MBTI
 │
 └─ 퀴즈마스터
        |
        |
        ↓
  황금열쇠 Core
        |
        ↓
 quiz_handoff_tokens
        |
        ↓
 퀴즈마스터 서비스
        |
        |
  ----------------
  |              |
완료 callback   환불 callback
  |              |
  ↓              ↓
놀이 기록      황금열쇠 복구
```

---

# 작업 1. 놀이 카드 추가

위치:

```
/child/play
```

기존 놀이 선택 화면에 퀴즈마스터 카드를 추가한다.

필요 정보:

- 놀이 이름: 퀴즈마스터
- 필요 황금열쇠 수량
- 현재 진행 상태
- 시작하기 버튼
- 이어하기 상태 표시 가능 구조

MBTI 카드와 동일한 UX 패턴을 따른다.

---

# 작업 2. 퀴즈 시작 handoff 구현

사용자가 퀴즈마스터 시작 클릭 시:

처리 순서:

```
1. 로그인 사용자 확인
2. 선택한 아이 확인
3. 아이 학년 조회
4. 황금열쇠 잔액 확인
5. 황금열쇠 1개 차감
6. reward_transaction_id 생성
7. quiz_handoff_tokens 생성
8. 퀴즈마스터 이동
```

---

## quiz_handoff_tokens 저장

기존 테이블을 재사용한다.

필수 필드:

```sql
token
user_id
status
expires_at
child_id
grade
reward_transaction_id
```

조건:

- grade는 아이 프로필 실제 학년 사용
- 허용값 1~6
- 학년 정보 없으면 시작 차단
- 임의 기본값 사용 금지
- reward_transaction_id는 황금열쇠 거래 ID와 동일하게 연결

---

# 작업 3. 퀴즈마스터 이동 방식

iframe 사용 금지.

이유:

- 모바일 PWA 문제
- 인증/스토리지 문제
- MBTI에서 발생했던 cross-domain 문제 재발 방지

방식:

```
K-Bestie
   |
   ↓
퀴즈마스터 URL 이동
   |
   ↓
handoff token 전달
```

---

# 작업 4. 완료 Callback 처리

Endpoint:

```
POST /api/quiz/completion
```

처리:

- reward_transaction_id 검증
- 황금열쇠 정상 소비 확정
- 퀴즈 완료 기록 저장
- 중복 callback 방지

중복 처리:

동일 reward_transaction_id 재호출 시:

- 완료 기록 1회
- 추가 보상 없음

---

# 작업 5. 환불 Callback 처리

Endpoint:

```
POST /api/rewards/golden-key/refund
```

처리:

- quiz 전용 refund RPC 사용
- 기존 MBTI 환불 RPC 수정 금지
- reward_transaction_id 기준 환불

조건:

- 동일 transaction 반복 호출 시 1회만 환불
- 완료 처리된 거래는 환불 불가

---

# 작업 6. 놀이 기록 저장

완료 후 K-Bestie 놀이 기록에 저장한다.

예:

```
play_type:
quizmaster

child_id

score

completed_at

reward_transaction_id
```

향후 부모 화면에서:

```
오늘 아이가 한 놀이

✅ MBTI
✅ 퀴즈마스터
```

형태로 활용 가능해야 한다.

---

# 검증 시나리오

## 정상 실행

1. 아이 로그인
2. 놀이 화면 진입
3. 퀴즈마스터 선택
4. 황금열쇠 1개 차감
5. handoff token 생성
6. 퀴즈마스터 진입
7. 완료 callback 수신
8. 완료 기록 확인

---

## 오류 환불

1. 퀴즈 실행 중 오류 발생
2. refund callback 수신
3. 황금열쇠 복구
4. 중복 callback 테스트

---

## MBTI 회귀 테스트

확인:

- MBTI 시작
- MBTI 진행 저장
- MBTI 완료
- 황금열쇠 차감
- 이어하기

퀴즈마스터 변경으로 MBTI 영향이 없어야 한다.

---

# 완료 조건

- /child/play에서 퀴즈마스터 실행 가능
- 황금열쇠 1개 정상 차감
- quiz_handoff_tokens 정상 생성
- 학년 정보 정상 전달
- 퀴즈마스터 이동 정상
- completion callback 정상 처리
- refund callback 정상 처리
- 중복 callback 방지
- MBTI 회귀 테스트 PASS
- 모바일 PWA 환경 검증 완료
- 변경사항 commit 생성

