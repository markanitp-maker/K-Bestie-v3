# Request 026 — PWA 통합 이벤트·알림함 및 미읽음 배지 정합성 구현

> 이 문서 하나만 전달하면 구현과 검증이 가능해야 한다.

## 0. 요청 메타

- 요청자: 대표님
- 대상 저장소: `markanitp-maker/K-Bestie-v3`
- 기준 브랜치: `main`
- 작업 브랜치: `feat/pwa-unified-notification-inbox`
- 우선순위: HIGH
- 작업 순서:
  1. Antigravity — 구현
  2. Codex — 정적 검증
  3. Antigravity — 검증 결과 수정
  4. Codex — 재검증
  5. Antigravity — iOS/Android PWA E2E QA
- 완료 조건: Codex 정적 검증 PASS + HIGH/MEDIUM 0건 + E2E PASS

### 변경 허용 범위

- 부모/아이 통합 알림함
- 기존 이벤트의 알림함 통합
- 미션 관련 알림
- 부모 리포트 알림
- 시스템/운영 알림
- 읽음/미읽음 상태
- 알림 개수 badge
- PWA 홈 화면 앱 아이콘 badge
- Push notification → 알림함 연결
- 알림 클릭 deep link
- 관련 Supabase notification 데이터 구조/API/RLS
- 기존 알림 localStorage 구조 제거 또는 전환
- 관련 Service Worker 처리

### 변경 금지 범위

- 미션 자체 비즈니스 규칙 변경
- 황금열쇠/보상 계산 규칙 변경
- 이벤트 참여 조건 변경
- 로그인/인증 정책 변경
- 알림과 무관한 DB 구조 변경
- 알림과 무관한 UI 전면 리디자인
- 부모/아이 권한 체계 전면 수정
- 기존 PWA 설치/자동로그인 정책 변경

---

# 1. 목적

현재 아이 PWA 홈 좌측 상단에는 다음 UI가 있다.

`[종 아이콘] 이벤트`

하지만 이 버튼은 실제 알림함이 아니라 이벤트 모달만 열기 때문에 사용자가 Push Notification을 받은 후 앱 안에서 해당 알림을 다시 확인할 장소가 없다.

또한 PWA 홈 화면 앱 아이콘에 `1`, `2` 등의 badge가 표시된 뒤 사용자가 관련 내용을 확인했음에도 숫자가 남아 있는 문제가 있다.

이를 다음 구조로 통합한다.

`Push Notification`
→ `통합 이벤트·알림함 저장`
→ `미읽음 +1`
→ `앱 내부 종 badge + PWA 앱 아이콘 badge`
→ `사용자가 해당 알림 확인`
→ `읽음 처리`
→ `미읽음 -1`
→ `0이면 모든 badge 제거`

핵심 원칙은 다음과 같다.

> Badge 숫자는 Push를 받은 누적 횟수가 아니라 현재 사용자가 아직 읽지 않은 알림의 개수다.

---

# 2. 현재 문제

## 2.1 아이 화면

현재:

`app/child/home/page.tsx`

좌측 상단 버튼이 Bell 아이콘과 `이벤트` 텍스트로 구성되어 있으며, 클릭 시 `AppEventAnnouncementModal`을 연다.

문제:

- 이벤트만 볼 수 있음
- Push로 받은 미션 알림을 다시 확인할 수 없음
- 다른 종류의 알림을 볼 수 없음
- 읽음/미읽음 개념이 없음
- badge와 실제 알림 데이터가 연결되어 있지 않음

---

## 2.2 부모 알림센터

현재:

`app/parent/notifications/page.tsx`

에는 이미 알림센터 UI가 존재한다.

현재 제공 기능:

- 전체
- 미읽음
- 개별 읽음
- 모두 읽음
- 알림 목록

그러나 현재 알림 데이터는 `lib/store.ts`의 localStorage 기반 구조를 사용한다.

현재 타입:

- today
- weekly
- mission
- setting

현재 구현은 Production에서 계정/기기 간 상태를 동기화할 수 있는 서버 기반 Single Source of Truth가 아니다.

따라서 현재 부모 알림센터 UI는 최대한 재사용하되 데이터 계층은 실제 서버 기반 알림 구조로 전환한다.

---

## 2.3 PWA 앱 아이콘 Badge

현재 Push 수신 이후 홈 화면 PWA 아이콘에 빨간 `1` badge가 남을 수 있다.

사용자가 관련 콘텐츠를 이미 확인해도 badge가 제거되지 않는다.

이는 UX상 허용하지 않는다.

예:

알림 1개
→ badge 1

해당 알림 읽음
→ badge 0
→ 앱 아이콘 숫자 제거

알림 2개
→ badge 2

1개 읽음
→ badge 1

나머지 1개 읽음
→ badge 0
→ 앱 아이콘 숫자 제거

---

# 3. 구현 요구사항

## 3.1 통합 알림 모델

이벤트와 Push Notification을 별도 시스템으로 운영하지 말고 사용자가 확인하는 알림은 하나의 notification domain으로 통합한다.

기존 notifications 관련 DB 구조가 이미 존재하는지 migration 전체를 먼저 확인한다.

기존 구조가 사용 가능하면 확장하고, 동일 목적의 중복 테이블을 만들지 않는다.

필요한 최소 데이터 모델 예시:

```text
notifications
- id UUID PK
- user_id UUID NOT NULL
- child_id UUID NULL
- role parent | child
- type event | mission | report | reward | system
- title TEXT NOT NULL
- body TEXT NULL
- target_url TEXT NULL
- source_id TEXT/UUID NULL
- idempotency_key TEXT UNIQUE
- created_at TIMESTAMPTZ
- read_at TIMESTAMPTZ NULL
- expires_at TIMESTAMPTZ NULL
```

`is_read`를 별도 boolean으로 중복 저장하기보다는 가능하면:

`read_at IS NOT NULL`

을 읽음 기준으로 사용한다.

---

## 3.2 알림 대상 분리

알림은 최소 다음을 정확하게 구분해야 한다.

- parent
- child
- family
- user_id
- child_id
- 알림 type

다른 가족의 알림이 노출되어서는 안 된다.

부모 알림이 아이 알림함에 나타나서도 안 된다.

아이 A의 알림이 아이 B에게 나타나서도 안 된다.

RLS 및 서버 권한 검증을 반드시 적용한다.

---

# 4. 아이 홈 좌상단 UI 변경

현재:

`🔔 이벤트`

변경:

`🔔`

기존 `이벤트` 텍스트를 제거한다.

미읽음 알림이 존재하는 경우 Bell 우측 상단에 작은 숫자 badge를 표시한다.

예:

```text
🔔¹
```

미읽음이 없으면 숫자를 표시하지 않는다.

### 클릭 동작

Bell 클릭 시:

`이벤트 및 알림`

통합 알림함을 연다.

별도의 이벤트 전용 진입 버튼으로 동작하지 않는다.

---

# 5. 아이 통합 알림함

필요하면 신규 route를 생성한다.

권장:

`/child/notifications`

기존 프로젝트 navigation 구조에 더 적합한 방식이 있으면 기존 패턴을 따른다.

화면 제목:

`이벤트 및 알림`

---

## 5.1 표시 대상

다음 항목을 하나의 목록에 시간 역순으로 표시한다.

### 이벤트

예:

- 새로운 이벤트가 시작됐어요
- 오늘 황금열쇠 룰렛에 참여할 수 있어요
- 이벤트 종료가 얼마 남지 않았어요

### 미션

예:

- 오늘의 미션을 시작할 시간이야
- 지금 미션을 할 수 있어
- 새로운 미션이 열렸어

### 보상

예:

- 황금열쇠를 받았어
- 새로운 보상을 확인해봐

### 시스템

예:

- 새로운 기능 안내
- 중요한 서비스 공지

---

## 5.2 목록 UI

각 알림은 최소 다음 정보를 표시한다.

- type icon
- title
- body preview
- 발생 시각
- 읽음/미읽음 상태

미읽음 항목은 시각적으로 구분한다.

정렬:

`created_at DESC`

---

## 5.3 필터

최소 다음을 제공한다.

- 전체
- 미읽음

기존 부모 Notification Center의 UX를 재사용할 수 있으면 재사용한다.

---

## 5.4 모두 읽음

`모두 읽음`

기능을 제공한다.

명시적으로 사용자가 `모두 읽음`을 눌렀을 때만 현재 미읽음 항목 전체를 읽음 처리한다.

단순히 알림함에 들어갔다는 이유만으로 모든 알림을 읽음 처리하지 않는다.

---

# 6. 이벤트 통합

현재:

`AppEventAnnouncementModal`

에서 제공하는 이벤트 기능 자체는 제거하지 않는다.

다만 홈 좌상단 `이벤트` 버튼은 없앤다.

이벤트가 발생하면 알림함에 notification item을 생성한다.

예:

```text
🎁 케이와 친해지는 30일 이벤트
오늘 황금열쇠 룰렛에 참여할 수 있어요.
```

사용자가 이벤트 알림을 누르면:

- 기존 Event Modal을 열거나
- 이벤트 상세 화면으로 이동

하도록 연결한다.

현재 이벤트의 참여 조건, 룰렛 규칙, 보상 규칙은 수정하지 않는다.

---

# 7. 읽음 처리 정책

이 부분은 이번 Request의 핵심이다.

## 7.1 알림함 진입

사용자가 Bell을 눌러 알림 목록을 열기만 한 경우:

`읽음 처리하지 않는다.`

---

## 7.2 개별 알림 확인

사용자가 개별 알림 항목을 눌러 실제 내용을 확인하면:

1. notification의 `read_at` 기록
2. 서버 unread count 재계산
3. 앱 내부 Bell badge 갱신
4. PWA 앱 아이콘 badge 갱신
5. target 화면 또는 상세 내용 표시

---

## 7.3 예시

초기 상태:

```text
미읽음 = 2
Bell badge = 2
PWA icon badge = 2
```

알림 A 확인:

```text
A = read
B = unread

미읽음 = 1
Bell badge = 1
PWA icon badge = 1
```

알림 B 확인:

```text
A = read
B = read

미읽음 = 0
Bell badge 제거
PWA icon badge 제거
```

---

# 8. Push Notification 클릭

Push Notification에는 가능하면 해당 서버 notification의 `notification_id`를 포함한다.

사용자가 OS Push Notification을 클릭하면:

1. notification_id 확인
2. 해당 notification 읽음 처리
3. unread count 재계산
4. PWA badge 갱신
5. target URL로 deep link

순서로 처리한다.

예:

미션 Push 클릭:

`Push`
→ `notification read`
→ `/child/...mission target`

부모 리포트 Push 클릭:

`Push`
→ `notification read`
→ 해당 리포트 상세

---

# 9. OS 알림 닫기와 읽음의 차이

사용자가 OS Notification Center에서 알림을 단순히:

- swipe 삭제
- 닫기
- clear

한 것은 서비스 콘텐츠를 읽은 것으로 간주하지 않는다.

따라서 server notification은 unread 상태를 유지한다.

앱에서 실제 관련 콘텐츠를 확인했을 때 read 처리한다.

---

# 10. PWA 앱 아이콘 Badge

미읽음 개수가 1 이상인 경우, Badge API가 지원되는 환경에서는:

```javascript
navigator.setAppBadge(unreadCount)
```

에 해당하는 처리를 한다.

미읽음 개수가 0이면:

```javascript
navigator.clearAppBadge()
```

를 수행한다.

반드시 feature detection을 적용한다.

Badge API를 지원하지 않는 환경에서 앱 오류가 발생해서는 안 된다.

---

# 11. Badge Single Source of Truth

다음 숫자를 각각 별도로 관리하지 않는다.

- Push 수신 횟수
- Bell 숫자
- PWA icon 숫자
- localStorage 숫자

모두 서버의 실제 unread notifications 결과를 기준으로 한다.

개념적으로:

```text
unread_count =
COUNT(notifications)
WHERE recipient = current user
AND read_at IS NULL
AND expired != true
```

이 값을 기준으로:

```text
Server unread count
       ↓
 ┌───────────────┐
 │               │
Bell badge   PWA app badge
```

두 badge를 동일하게 유지한다.

---

# 12. 앱 Lifecycle 동기화

다음 시점에는 server unread count를 다시 확인하고 badge를 동기화한다.

- 로그인 세션 복원 완료
- PWA 첫 실행
- PWA 재실행
- 앱 foreground 복귀
- `visibilitychange`로 visible 전환
- 알림함 진입
- 개별 알림 읽음 처리 후
- 모두 읽음 후
- Push Notification 클릭 후

localStorage에 남은 stale badge 숫자를 신뢰하지 않는다.

---

# 13. 다중 기기 처리

부모 또는 아이가 두 개 이상의 기기를 사용할 수 있다.

예:

```text
iPhone
iPad
```

iPhone에서 알림 1개를 읽었다면 서버의 notification은 read 상태가 된다.

iPad가 다음 번:

- foreground
- 앱 실행
- 알림 동기화

할 때 unread count를 다시 조회하여 badge를 제거한다.

즉 읽음 여부는 device-level이 아니라 recipient account-level을 기준으로 한다.

Push Subscription 자체는 device-level로 유지한다.

---

# 14. 기존 부모 Notification Center 전환

현재:

`app/parent/notifications/page.tsx`

UI는 최대한 재사용한다.

단 현재 사용하는:

`lib/store.ts`

의 localStorage notification 데이터는 Production Single Source of Truth로 사용하지 않는다.

다음 함수의 사용처를 분석한다.

- `getNotifications`
- `seedNotifications`
- `pushNotification`
- `markNotifRead`
- `markAllRead`

Production notification은 서버 기반으로 교체한다.

`seedNotifications()`와 같은 mock/test 데이터는 Production 경로에서 실행되어서는 안 된다.

필요하면 Development 전용 fixture로 분리한다.

---

# 15. 부모 알림함

부모도 동일한 notification domain을 사용한다.

부모 알림 예:

### 일일 리포트

```text
오늘의 아이 리포트가 준비됐어요
어제 아이가 케이와 나눈 활동과 변화를 확인해보세요.
```

### 시스템

```text
새로운 기능이 추가됐어요
```

### 필요한 부모 관련 이벤트

기존 제품 정책에 해당하는 이벤트만 포함한다.

아이 미션용 메시지를 부모에게 무조건 노출하지 않는다.

---

# 16. 중복 알림 방지

동일 이벤트나 동일 미션에 대해 scheduler 또는 API가 재시도되더라도 notification이 두 번 생성되어서는 안 된다.

`idempotency_key`를 사용한다.

예:

```text
child:{child_id}:mission:{mission_id}:{scheduled_date}
```

```text
parent:{parent_id}:report:{report_date}
```

```text
child:{child_id}:event:{event_id}:{event_occurrence}
```

DB unique constraint 또는 이에 준하는 서버 측 원자적 처리를 적용한다.

---

# 17. 실패 처리

## 읽음 API 실패

사용자가 알림을 눌렀지만 서버 read update가 실패한 경우:

- 영구적으로 읽은 것처럼 local state만 남기지 않는다.
- UI optimistic update를 사용한다면 실패 시 rollback한다.
- badge도 서버 상태와 다시 동기화한다.

## Badge API 실패

- notification read 자체는 성공해야 한다.
- badge failure 때문에 알림 읽음 처리를 rollback하지 않는다.
- 오류 로그만 기록한다.

---

# 18. RLS 및 보안

필수 검증:

- 부모 A가 부모 B의 notification 조회 불가
- 아이 A가 아이 B의 notification 조회 불가
- 아이가 부모 전용 notification 조회 불가
- 부모가 허용되지 않은 다른 family notification 조회 불가
- 타 사용자의 notification `read_at` 수정 불가

RLS가 존재하지 않는 notification table을 Production에 배포하지 않는다.

Service Role을 클라이언트에서 사용하지 않는다.

---

# 19. 변경 허용 파일/디렉터리

현재 확인된 범위에서 다음 파일 수정 허용:

```text
app/child/home/page.tsx
app/parent/notifications/page.tsx
components/notifications/**
components/events/AppEventAnnouncementModal.tsx
lib/notifications/**
lib/store.ts
supabase/migrations/**
```

필요 시 신규 생성 허용:

```text
app/child/notifications/**
app/api/notifications/**
components/notifications/**
lib/notifications/**
tests/**
```

기존 Push/Service Worker 구현 파일은 먼저 실제 위치를 확인한 후 필요한 최소 범위만 수정한다.

기존 Service Worker가 존재하는 경우 동일 목적의 두 번째 Service Worker를 새로 만들지 않는다.

완료 보고 시 실제 변경 파일 전체를 명시한다.

---

# 20. 변경 금지 파일/영역

다음은 이번 Request를 이유로 수정하지 않는다.

- 미션 점수/완료 로직
- 황금열쇠 지급 계산
- 룰렛 확률
- 이벤트 참여 횟수 계산
- AI 대화
- Gemini Live
- 부모 리포트 생성 로직 자체
- 인증/자동로그인
- 결제
- reward ledger
- unrelated RLS
- unrelated migration
- 디자인 시스템 전면 변경

필요성이 발견되면 임의 수정하지 말고 완료 보고의 별도 이슈로 남긴다.

---

# 21. 수용 기준

다음이 모두 만족되어야 한다.

### AC-01

아이 홈 좌상단에서 `이벤트` 텍스트가 제거된다.

### AC-02

Bell 버튼을 누르면 이벤트와 각종 알림이 포함된 통합 알림함이 열린다.

### AC-03

이벤트가 notification item으로 표시된다.

### AC-04

미션 알림이 notification item으로 표시된다.

### AC-05

부모 리포트 알림이 부모 Notification Center에 표시된다.

### AC-06

알림 목록을 열었다는 이유만으로 전체가 읽음 처리되지 않는다.

### AC-07

개별 알림을 실제로 확인하면 해당 항목만 read 처리된다.

### AC-08

미읽음 2개에서 한 개를 읽으면 badge가 1이 된다.

### AC-09

마지막 미읽음까지 읽으면 내부 badge가 사라진다.

### AC-10

미읽음이 0이면 PWA 홈 화면 앱 아이콘 badge도 제거된다.

### AC-11

Push Notification 클릭 시 해당 알림이 read 처리되고 target 화면으로 이동한다.

### AC-12

OS Notification을 단순 swipe 삭제한 경우 서버 notification은 unread 상태를 유지한다.

### AC-13

앱 재시작 후 서버 unread count와 badge가 일치한다.

### AC-14

같은 알림이 scheduler 재실행으로 중복 생성되지 않는다.

### AC-15

부모/아이/가족 간 알림 데이터가 섞이지 않는다.

### AC-16

iOS 설치형 PWA에서 badge 동작을 실제 확인한다.

### AC-17

Android 설치형 PWA에서 가능한 badge/notification 동작을 실제 확인한다.

### AC-18

Badge API 미지원 환경에서도 앱 기능은 정상 동작한다.

---

# 22. 필수 테스트

## Scenario A — 알림 1개

```text
신규 notification 생성
→ unread = 1
→ Bell = 1
→ PWA icon = 1

알림 열기
→ read
→ unread = 0
→ Bell 숫자 제거
→ PWA icon badge 제거
```

PASS 필수.

---

## Scenario B — 알림 2개

```text
알림 A unread
알림 B unread

unread = 2
```

A 읽음:

```text
unread = 1
```

B 읽음:

```text
unread = 0
```

각 단계의 Bell/PWA badge 동일성 확인.

---

## Scenario C — 이벤트

```text
이벤트 notification 생성
→ 알림함 표시
→ unread +1
→ 이벤트 알림 클릭
→ 기존 이벤트 UI 연결
→ read
→ unread -1
```

---

## Scenario D — 미션 Push

```text
미션 시작
→ notification 저장
→ Push 발송
→ PWA badge 표시
→ Push 클릭
→ notification read
→ 해당 미션 화면 이동
→ badge 갱신
```

---

## Scenario E — OS 알림 삭제

```text
Push 수신
→ unread = 1

사용자가 OS notification swipe 삭제

서버 notification:
unread 유지
```

---

## Scenario F — 앱 재시작

```text
server unread = 0
local stale badge = 1
PWA 재실행
```

결과:

```text
server 기준 재동기화
badge = 0
```

---

## Scenario G — 다중 기기

기기 A에서:

```text
notification read
```

기기 B에서 앱 foreground:

```text
server unread 재조회
badge 갱신
```

---

## Scenario H — 부모

```text
리포트 notification 생성
→ 부모 알림센터 표시
→ 클릭
→ report 이동
→ read
→ badge 감소
```

---

## Scenario I — RLS

다른 사용자 token으로:

```text
GET notification
PATCH read_at
```

모두 차단되는지 확인한다.

---

# 23. 필수 정적 검증

Codex는 구현 코드를 작성하지 않고 다음을 정적 검증한다.

## Notification Architecture

- notification의 authoritative source가 하나인지
- localStorage와 DB가 이중 source of truth가 되지 않는지
- unread count 계산이 일관적인지
- read_at 경쟁 상태가 없는지

## Badge

- `setAppBadge` / `clearAppBadge` feature detection
- unsupported browser 예외 처리
- stale local badge 문제
- read 후 badge update 누락
- 앱 lifecycle 재동기화

## Service Worker

- notification_id 전달 여부
- `notificationclick` read 처리
- deep link
- 중복 창 발생 가능성
- 기존 Service Worker와 충돌 여부

## Security

- RLS
- 사용자 간 notification 노출
- child_id 검증
- role 검증
- client에서 Service Role 사용 여부

## Duplicate

- scheduler retry
- Push retry
- idempotency key
- unique constraint

## Existing Code Regression

특히 다음을 확인한다.

```text
app/child/home/page.tsx
app/parent/notifications/page.tsx
lib/store.ts
components/events/AppEventAnnouncementModal.tsx
components/notifications/**
```

Codex 결과에 BLOCKED/HIGH/MEDIUM이 존재하면 완료 처리하지 않는다.

수정 후 Codex 재검증한다.

---

# 24. 필수 빌드/테스트

프로젝트의 실제 package scripts를 먼저 확인한 뒤 해당 명령을 사용한다.

최소:

```text
TypeScript check
Lint
Unit test
Build
Notification 관련 targeted test
RLS/security test
```

기존 프로젝트가 사용하는 명령을 우선하며 임의의 명령을 문서에 맞추기 위해 만들지 않는다.

---

# 25. 실제 기기 QA

최소:

### iPhone

- 홈 화면 설치형 PWA
- Push 수신
- 앱 아이콘 badge
- 알림 클릭
- 읽음 처리
- badge 감소
- badge 0 제거
- 앱 종료/재실행

### Android

- 설치형 PWA
- Push 수신
- notification click
- unread sync
- 지원 가능한 badge 동작 확인

플랫폼 제약으로 iOS/Android 결과가 다르면 숨기지 말고 실제 결과를 보고한다.

---

# 26. 완료 증빙

작업 완료 보고에 반드시 포함한다.

1. 변경 파일 목록
2. DB migration 파일
3. notification schema
4. RLS 정책
5. child 통합 알림함 Screenshot
6. parent 알림센터 Screenshot
7. unread 2 → 1 → 0 테스트 결과
8. iPhone PWA badge 1 → 0 결과
9. Push notification click 결과
10. Event notification 결과
11. Mission notification 결과
12. Parent report notification 결과
13. 다중 기기 동기화 결과
14. TypeScript 결과
15. Lint 결과
16. Build 결과
17. 테스트 결과
18. Codex 정적 검증 결과
19. Antigravity E2E 결과
20. 남아 있는 플랫폼 제한사항

민감한 endpoint/token/key는 증빙에 노출하지 않는다.

---

# 27. 커밋/PR 규칙

작업 브랜치:

```text
feat/pwa-unified-notification-inbox
```

직접 `main`에 구현하지 않는다.

DB migration은 기존 migration을 수정하지 말고 새로운 migration으로 추가한다.

알림 기능과 관계없는 formatting/refactor를 함께 넣지 않는다.

PR 설명에는 최소 다음을 포함한다.

```text
Why
What
DB changes
RLS changes
Notification flow
Read/unread flow
Badge flow
Push click flow
Tests
Known limitations
```

---

# 28. 완료 흐름

이번 Request의 완료 순서는 다음으로 고정한다.

```text
Antigravity 구현
        ↓
Codex 정적 검증
        ↓
BLOCKED/HIGH/MEDIUM 존재?
   ├─ YES → Antigravity 수정 → Codex 재검증
   └─ NO
        ↓
Antigravity 실제 PWA E2E
        ↓
iOS / Android PASS
        ↓
Request 완료
```

Codex 검증에서 단순 코드 스타일이 아니라 다음 세 가지를 가장 높은 우선순위로 본다.

1. 읽었는데 badge `1`이 남는 문제가 완전히 제거됐는가
2. 이벤트·미션·리포트 알림을 사용자가 앱 안에서 실제로 다시 확인할 수 있는가
3. 부모·아이·기기 간 unread 상태가 섞이거나 어긋나지 않는가
