# K-Toon(comic_book) Dev Integration 요청

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과

- K-Bestie-v3 Dev에서 "만화책 읽기" 카드가 실제 실행 가능한 놀이 상태로 변경된다.
- 기존 "준비 중입니다" 상태가 제거된다.
- 사용자가 만화책 읽기를 선택하면 MBTI와 동일한 Execution Ticket 기반 Flow로 실행된다.
- 황금열쇠는 K-Bestie-v3 플랫폼에서만 관리한다.
- K-Toon은 독립 프로젝트로 유지되며 K-Bestie-v3 내부 컴포넌트로 이식하지 않는다.
- K-Toon은 PlayFrame iframe 내부에서 실행된다.
- K-Bestie 상단 X 닫기로 종료되며 iframe 내부에서 K-Bestie 화면으로 직접 이동하지 않는다.
- 이어하기 시 기존 progress가 복원되고 황금열쇠가 재차감되지 않는다.

### 대표님 테스트 정상 프로세스

1. K-Bestie-v3 Dev 로그인
2. 아이 선택
3. 놀이 화면 진입
4. 만화책 읽기 선택
5. 황금열쇠 2개 확인
6. Execution Ticket 발급
7. K-Toon Reader 진입
8. 책 목록 표시
9. 책 선택
10. Page Curl Reader 실행
11. 일부 진행 후 X 닫기
12. 다시 만화책 읽기 실행
13. 이어하기 확인
14. 이전 위치 복원 확인
15. 황금열쇠 추가 차감 없음 확인

---

# 1. 상태 / 우선순위 / 대상

- 상태: 신규
- 우선순위: HIGH
- 대상 프로젝트: `/mnt/e/VibeCoding/K-Bestie-v3`
- 개발 주체: K-Bestie-v3 Claude Code
- 연동 대상 프로젝트:
  - K-Toon 독립 프로젝트
- 적용 환경:
  - Dev Only
  - Production 변경 금지

---

# 2. 목표

K-Toon은 독립 놀이 앱으로 유지한다.

K-Bestie-v3 역할:

- 놀이 카드
- 황금열쇠
- Execution Ticket
- PlayFrame
- Session
- Progress 계약
- Completion/Error 처리

K-Toon 역할:

- 만화책 UI
- Viewer
- Catalog
- Reader
- Content
- Progress Payload 생성

---

# 3. 기존 구조 확인

Antigravity READ-ONLY 조사 결과:

## K-Toon 상태

완료:

- K-Toon Dev Vercel 배포 완료
- Reader 구현 완료
- 9:16 Viewer
- Page Curl
- Catalog
- Preview
- Book Lock
- Progress
- Resume
- Internal API 인증

Dev URL:

```
https://k-bestie-k-toon-dev.vercel.app
```

---

# 4. K-Bestie-v3 구현 요구사항

## 4-1. play_registry 등록

추가:

```
play_id = comic_book
display_name = 만화책 읽기
keys_cost = 2
is_active = true
is_visible = true
```

기존 MBTI 등록 구조와 동일하게 처리한다.

---

## 4-2. Route Handler Proxy 추가

신규 생성:

```
app/play/comic_book/[[...path]]/route.ts
```

조건:

- next.config.ts rewrite 사용 금지
- MBTI Proxy 패턴 재사용
- CSP frame-ancestors 제거
- 필요한 Header만 allowlist 통과
- 쿠키 필터링 유지

환경변수:

```
COMIC_BOOK_UPSTREAM_ORIGIN
COMIC_BOOK_INTERNAL_API_KEY
```

---

## 4-3. PlayFrame 연결

신규 생성:

```
app/child/play/comic_book/page.tsx
```

사용:

```
PlayFrame
```

설정:

```
title="만화책 읽기"
src="/play/comic_book"
messageSource="k-play-comic-book"
```

---

## 4-4. 놀이 카드 활성화

수정:

```
app/child/play/page.tsx
```

변경:

기존:

```
comingSoon=true
```

변경:

```
comingSoon=false
```

실행:

```
startTicketBasedPlay(childId,"comic_book")
```

---

# 5. 황금열쇠 처리 규칙

중요:

황금열쇠는 K-Bestie-v3 소유.

K-Toon 직접 차감 금지.

Flow:

```
놀이 선택
 ↓
K-Bestie reserve
 ↓
Execution Ticket
 ↓
K-Toon exchange-ticket
 ↓
ready
 ↓
황금열쇠 confirm
```

Ready 이전 실패:

- 자동 restore

Ready 이후 오류:

- 기존 refund 정책 사용

---

# 6. Ticket Contract

K-Toon 호출:

```
POST /api/internal/play/exchange-ticket
```

성공:

- playSessionId 생성
- ticket exchanged 상태 변경


준비 완료:

```
POST /api/internal/play/ready
```

Ready 성공 이후:

- 황금열쇠 확정 차감

---

# 7. Progress / Resume

Progress 저장:

```
opaquePayload
```

사용.

K-Bestie는 내부 내용을 해석하지 않는다.

예:

```
{
 currentPage,
 bookId,
 chapter,
 progress
}
```

형태는 K-Toon이 관리한다.

---

# 8. 종료 정책

반드시 기존 PlayFrame 정책 유지.

금지:

```
router.back()
history.back()
window.location.assign("/child/play")
```

사용 금지.

종료:

```
K-Toon
 ↓
postMessage
 ↓
K-Bestie PlayFrame
 ↓
iframe unmount
 ↓
/child/play
```

---

# 9. 이어하기

조건:

```
status=in_progress
AND
resume_expires_at > now()
```

만 허용.

이어하기:

- 기존 session 사용
- progress 복원
- 황금열쇠 추가 차감 없음

---

# 10. 금지사항

- K-Toon 코드를 K-Bestie components로 복사 금지
- K-Toon DB 직접 접근 금지
- 황금열쇠 직접 처리 금지
- next.config rewrite 사용 금지
- Production 변경 금지
- MBTI/Quiz Flow 변경 금지

---

# 11. QA

필수:

## 신규 시작

확인:

- Ticket 발급
- 황금열쇠 2개 reserve
- Ready 후 confirm

---

## 이어하기

확인:

- Progress 복원
- 추가 차감 없음

---

## 종료

확인:

- X 닫기
- iframe 제거
- 중첩 PlayModal 없음

---

## Android

확인:

- 실행
- 닫기
- 재실행

3회 반복.

확인:

- iframe 중첩 없음
- History 누적 없음

---

# 12. 완료 조건

완료 기준:

- comic_book play_registry 등록
- Proxy 동작
- PlayFrame 실행
- Ticket Exchange 성공
- Ready 성공
- 황금열쇠 confirm 성공
- Reader 실행
- Progress 저장
- Resume 성공
- X 닫기 정상
- MBTI 회귀 없음
- Quiz 회귀 없음

---

# 13. 완료 보고

보고:

- 변경 파일
- DB migration
- 환경변수
- Proxy 확인
- Ticket 결과
- Ready 결과
- 황금열쇠 결과
- Resume 결과
- Android 테스트 결과
- Dev URL
- Commit Hash
