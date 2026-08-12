# Request: 관리자 레이아웃 좌측 사이드바 / 우측 본문 독립 스크롤 구조로 변경

## 1. 작업 목적

현재 관리자 페이지에서 화면을 스크롤하면 왼쪽 사이드바 메뉴와 오른쪽 본문이 함께 움직인다.

관리자 사용성이 좋지 않으므로 관리자 전체 레이아웃을 아래 구조로 변경한다.

```text
상단 헤더: 고정
왼쪽 사이드바: 독립 스크롤
오른쪽 본문: 독립 스크롤
```

즉, 왼쪽 메뉴를 스크롤해도 오른쪽 본문 위치는 바뀌지 않고, 오른쪽 본문을 스크롤해도 왼쪽 메뉴 위치는 그대로 유지되어야 한다.

---

## 2. 목표 레이아웃

```text
┌──────────────────────────────────────────────┐
│ 내친구 케이 — 관리자                        │
│              상단 헤더 고정                  │
├───────────────┬──────────────────────────────┤
│               │                              │
│ 왼쪽 사이드바 │ 오른쪽 본문                 │
│               │                              │
│ 독립 스크롤   │ 독립 스크롤                 │
│      ↕        │       ↕                      │
│               │                              │
└───────────────┴──────────────────────────────┘
```

---

## 3. 핵심 동작 요구사항

### 3.1 상단 헤더

- 화면 최상단에 고정
- 페이지 본문 스크롤과 무관하게 항상 보임
- 현재 관리자 타이틀 및 햄버거 버튼 유지
- 기존 높이와 디자인 최대한 유지
- 불필요한 sticky 중첩 금지

### 3.2 왼쪽 사이드바

- 헤더 아래부터 화면 하단까지 높이를 사용
- 자체 `overflow-y: auto`
- 메뉴가 화면 높이보다 길 때만 세로 스크롤
- 메뉴가 짧으면 스크롤바 표시 불필요
- 오른쪽 본문 스크롤과 완전히 독립
- 기존 그룹형 아코디언 메뉴 펼침/접힘 유지
- 현재 선택 메뉴 활성 스타일 유지
- 아코디언을 펼쳐 메뉴가 길어져도 오른쪽 본문에는 영향 없음

### 3.3 오른쪽 본문

- 헤더 아래부터 화면 하단까지 높이를 사용
- 자체 `overflow-y: auto`
- 본문 내용이 길 때 오른쪽 영역만 스크롤
- 왼쪽 사이드바 위치는 변하지 않음
- 기존 페이지별 가로 스크롤 기능이 필요한 테이블은 유지
- 필요 시 `overflow-x: auto`
- `min-width: 0` 적용으로 flex overflow 문제 방지

### 3.4 Body / Root 스크롤

데스크톱 관리자 페이지에서는 브라우저 `body` 자체가 세로로 스크롤되지 않도록 한다.

권장:

```css
html,
body {
  height: 100%;
}

.admin-shell {
  height: 100dvh;
  overflow: hidden;
}
```

단, 전역 body 스타일로 일반 사용자 페이지까지 영향을 주지 말고 관리자 AdminShell 내부에서만 범위를 제한한다.

---

## 4. 권장 구조

실제 관리자 AdminShell 구조를 먼저 확인한 뒤 공통 레이아웃에서 수정한다.

권장 개념:

```tsx
<div className="admin-shell">
  <header className="admin-header">
    ...
  </header>

  <div className="admin-body">
    <aside className="admin-sidebar">
      ...
    </aside>

    <main className="admin-main">
      ...
    </main>
  </div>
</div>
```

권장 CSS 개념:

```css
.admin-shell {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.admin-header {
  flex: 0 0 auto;
}

.admin-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.admin-sidebar {
  flex: 0 0 var(--admin-sidebar-width);
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.admin-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: auto;
}
```

Tailwind 기반이면 동일 동작으로 구현한다.

예:

```text
h-dvh
overflow-hidden
flex
flex-col
min-h-0
overflow-y-auto
```

실제 프로젝트 스타일 시스템을 우선 사용하고, 동일 목적의 CSS를 여러 군데 중복 생성하지 않는다.

---

## 5. 수정 위치 원칙

먼저 아래를 확인한다.

- 관리자 공통 layout 파일
- AdminShell 컴포넌트
- Sidebar 컴포넌트
- Header 컴포넌트
- 모바일 Drawer
- 페이지별 wrapper에서 별도로 `min-height`, `overflow`, `height`를 설정한 곳

개별 페이지마다 수정하지 말고 가능한 한 관리자 공통 Shell 한 곳에서 해결한다.

페이지별 임시 `position: fixed` 또는 `height: calc(...)`를 반복 추가하지 않는다.

---

## 6. 헤더 높이 계산

가능하면 CSS flex 구조로 구현하여 헤더 높이를 숫자로 하드코딩한 `calc(100vh - 64px)` 사용을 최소화한다.

권장:

```text
shell = 100dvh
header = flex-none
body = flex-1 min-h-0
```

이 방식으로 브라우저별 헤더 높이와 변경에 안전하게 대응한다.

---

## 7. 100vh 대신 100dvh 우선

모바일 브라우저 주소창 변화까지 고려할 수 있는 환경이면 `100dvh`를 우선 사용한다.

fallback이 필요한 경우:

```css
height: 100vh;
height: 100dvh;
```

기존 브라우저 지원 정책을 확인한다.

---

## 8. 사이드바 스크롤바

왼쪽 메뉴가 길어진 경우에만 자체 스크롤이 발생해야 한다.

요구사항:

- 페이지 본문 스크롤바와 별도
- 브라우저 기본 스크롤바를 과도하게 숨기지 않음
- hover 전용 스크롤바처럼 발견하기 어려운 UX 금지
- 현재 메뉴가 하단에 위치하면 라우트 이동 시 선택 메뉴가 보이는 위치로 스크롤 가능

선택 메뉴 자동 스크롤은 필요하면 `scrollIntoView({ block: "nearest" })` 수준으로 구현한다.

---

## 9. 오른쪽 본문 스크롤 위치

라우트가 변경되면 새 페이지 본문은 기본적으로 상단에서 시작해야 한다.

권장 동작:

```text
페이지 A에서 본문을 아래로 스크롤
→ 다른 관리자 메뉴 클릭
→ 페이지 B 본문은 맨 위부터 표시
```

단, 동일 페이지 내 필터 변경이나 탭 변경 시에는 현재 UX를 확인한 뒤 불필요하게 스크롤을 초기화하지 않는다.

---

## 10. 가로 스크롤 보호

리텐션, 비용, LLM 현황, 리포팅 수동 실행 등 넓은 테이블이 있다.

오른쪽 본문 전체에 `overflow-x: auto`를 무조건 적용해 이중 스크롤이 생기지 않게 확인한다.

권장:

- 본문 세로 스크롤: `admin-main`
- 넓은 테이블 가로 스크롤: 해당 table wrapper

즉, 페이지 전체 하단에 불필요한 가로 스크롤바가 생기지 않도록 한다.

---

## 11. 기존 사이드바 아코디언과 연동

앞서 구현한 그룹형 사이드바 메뉴와 함께 정상 동작해야 한다.

검증:

- 대시보드 그룹 펼침
- 사용자 관리 펼침
- 고객 접수 펼침
- 리포팅·분석 펼침
- 이벤트·보상 펼침
- 운영 도구 펼침

여러 그룹을 펼쳐 메뉴가 길어지면 왼쪽 사이드바만 스크롤돼야 한다.

오른쪽 본문 높이나 위치는 변경되면 안 된다.

---

## 12. 데스크톱 동작

데스크톱에서는 아래 구조를 고정한다.

```text
Header
Sidebar | Main
```

사이드바 폭은 현재 디자인 시스템 값을 유지한다.

- 왼쪽 메뉴 고정 폭
- 오른쪽 본문 나머지 공간 사용
- 브라우저 창 크기 변경 시 정상 resize

---

## 13. 모바일 동작

모바일에서는 기존 Drawer 구조를 유지한다.

모바일에서 데스크톱처럼 좌/우를 동시에 표시하지 않는다.

필수:

- 헤더 고정
- 본문 독립 스크롤
- Drawer 내부 메뉴 자체 스크롤
- Drawer가 열려 있을 때 background body scroll 방지
- Drawer 닫으면 본문 스크롤 정상 복원
- iOS safe-area 대응

---

## 14. 스크롤 이벤트 영향 점검

기존 페이지 중 `window` 스크롤 이벤트를 기준으로 기능이 동작하는 코드가 있는지 검색한다.

예:

```text
window.scrollY
window.addEventListener("scroll")
document.documentElement.scrollTop
IntersectionObserver root = window
```

관리자 본문이 별도 scroll container로 바뀌면 기존 동작이 깨질 수 있다.

해당 코드가 있다면 필요한 경우 `admin-main` scroll container 기준으로 변경한다.

단, 일반 사용자 페이지에는 영향 주지 않는다.

---

## 15. sticky 요소 점검

페이지 내부에 아래가 있는지 확인한다.

- sticky filter
- sticky table header
- sticky action bar

새로운 scroll container 안에서도 정상 동작해야 한다.

`position: sticky`는 가장 가까운 scroll container 기준으로 동작하므로 각 관리자 페이지에서 깨짐이 없는지 확인한다.

---

## 16. 접근성

- 키보드로 사이드바와 본문 모두 접근 가능
- scroll container가 포커스를 가두지 않음
- 마우스 휠 정상
- 트랙패드 정상
- PageUp/PageDown 정상
- 모바일 터치 스크롤 정상

---

## 17. 테스트 대상 페이지

최소 아래 관리자 페이지에서 검증한다.

```text
전체 현황
매출·가입자 상세
나갈 돈·비용 상세
LLM 사용 현황
부모 계정 관리
아이 계정 관리
문의 접수
건의 접수
버그 접수
리포팅 수동 실행
사용자 리텐션
이벤트 현황
미션 이벤트
퀴즈 리더보드
상품권 지급 관리
푸시 발송 테스트
회원가입 유입 링크 관리
회원가입 유입 현황
휴지통
```

실제로 구현되지 않은 페이지는 제외하고 보고한다.

---

## 18. E2E 검증 시나리오

### Case 1. 오른쪽 본문 스크롤

1. LLM 사용 현황 접속
2. 오른쪽 본문을 최하단까지 스크롤
3. 왼쪽 사이드바 메뉴 위치 확인

기대:

```text
왼쪽 사이드바 scrollTop 변화 없음
오른쪽 본문만 이동
```

### Case 2. 왼쪽 메뉴 스크롤

1. 사이드바 그룹 여러 개 펼침
2. 왼쪽 메뉴를 최하단까지 스크롤
3. 오른쪽 본문 위치 확인

기대:

```text
오른쪽 본문 scrollTop 변화 없음
왼쪽 메뉴만 이동
```

### Case 3. 라우트 이동

1. 본문을 아래로 스크롤
2. 다른 메뉴 클릭

기대:

```text
새 페이지 본문 상단 표시
사이드바는 선택 메뉴가 보이는 위치 유지
```

### Case 4. 긴 테이블

비용 상세 또는 리텐션 화면에서:

- 세로 스크롤 정상
- 테이블 가로 스크롤 정상
- 페이지 전체 body 가로 스크롤 없음

### Case 5. 모바일

- Drawer 내부 메뉴 스크롤
- 본문 스크롤
- Drawer open 시 background scroll 차단

---

## 19. 완료 조건

아래를 모두 만족해야 완료다.

- 상단 관리자 헤더 고정
- 왼쪽 사이드바 독립 세로 스크롤
- 오른쪽 본문 독립 세로 스크롤
- 오른쪽 스크롤 시 왼쪽 scrollTop 불변
- 왼쪽 스크롤 시 오른쪽 scrollTop 불변
- 관리자 데스크톱 body 자체 세로 스크롤 없음
- 기존 아코디언 메뉴 정상
- 현재 선택 메뉴 정상 표시
- 긴 테이블 가로 스크롤 정상
- sticky 요소 정상
- 관리자 페이지 라우트 이동 정상
- 모바일 Drawer 스크롤 정상
- TypeScript 오류 0건
- Build 성공
- Dev E2E PASS
- Production 배포 완료
- Production 스모크 테스트 PASS
- 기존 관리자 기능 회귀 오류 없음

---

## 20. 완료 보고 형식

완료 후 아래 순서로 보고한다.

1. 기존 관리자 scroll 구조
2. 함께 스크롤되던 정확한 원인
3. 수정한 AdminShell 구조
4. Header / Sidebar / Main overflow 설정
5. body/root scroll 처리
6. 수정·추가한 파일
7. window scroll 의존 코드 점검 결과
8. sticky 요소 점검 결과
9. 데스크톱 독립 스크롤 검증
10. 모바일 Drawer 검증
11. 긴 테이블 가로 스크롤 검증
12. TypeScript / Build 결과
13. Dev E2E 결과
14. Production 배포 커밋
15. Production Deployment ID / READY 상태
16. Production 스모크 테스트 결과
17. 남은 위험 또는 예외 페이지

---

## 21. 작업 제한

- 관리자 페이지 외 일반 사용자 화면의 전역 scroll 구조 변경 금지
- 페이지별 임시 fixed/absolute 배치 남발 금지
- 기존 라우트/API/DB 로직 변경 금지
- 사이드바 기능·권한 로직 변경 금지
- Production 사용자 데이터 변경 금지
- API Key, Token, Service Role Key 등 비밀정보 출력 금지
