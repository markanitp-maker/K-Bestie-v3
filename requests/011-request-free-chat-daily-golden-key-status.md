# Free Chat Daily Golden Key Status — 오늘 황금열쇠 획득 여부 표시

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과
- 자유대화 화면에서 아이가 오늘 Free Chat 황금열쇠를 이미 받았는지 아직 못 받았는지 바로 확인할 수 있다.
- 오늘 아직 미획득이면 `아직 안 받았어` 상태가 표시된다.
- 오늘 획득 완료면 `오늘 받았어!` 상태가 표시된다.
- 화면 상태는 클라이언트 추측값이 아니라 `public.gold_key_ledger`의 실제 지급 기록을 Source of Truth로 사용한다.
- 오늘 여부는 KST 기준 `business_date`를 사용한다.
- Mission, 출석 룰렛, 관리자 지급 등 다른 황금열쇠 보상과 혼동하지 않는다.
- Free Chat 보상은 `reward_type = 'freechat_daily_engagement'`만 조회한다.
- 황금열쇠를 획득한 뒤 앱을 종료하거나 새로고침하고 다시 들어와도 `오늘 받았어!` 상태가 복원된다.
- `/api/chat/pause`에서 방금 황금열쇠가 지급되면 별도 재진입 없이 화면 상태가 즉시 `획득 완료`로 갱신된다.
- 기존 황금열쇠 지급 조건, 하루 1회 idempotency, Mission 보상 로직은 변경하지 않는다.
- Development 구현/QA 후 대표님 승인 전까지 Production 변경은 하지 않는다.
- 최종 상태는 `WAITING_FOR_OWNER_QA`.

### 대표님 테스트 정상 프로세스

#### A. 오늘 아직 미획득
1. Development 자유대화에 오늘 Free Chat 황금열쇠를 아직 받지 않은 QA 계정으로 접속한다.
2. 자유대화 화면에서 `오늘의 황금열쇠` 상태 영역을 확인한다.
3. `아직 안 받았어` 또는 동등한 미획득 상태가 표시되는지 확인한다.
4. Mission/출석 등으로 황금열쇠를 보유하고 있어도 Free Chat 일일 보상을 받지 않았다면 미획득으로 표시되는지 확인한다.

#### B. Free Chat 황금열쇠 획득 직후
5. 기존 Free Chat daily engagement 조건을 충족한다.
6. `/api/chat/pause`를 통해 실제 `freechat_daily_engagement` 보상이 지급되도록 한다.
7. 기존 `GoldKeyRewardModal`이 정상적으로 표시되는지 확인한다.
8. 모달 처리 후 같은 자유대화 화면에서 상태가 즉시 `오늘 받았어!`로 바뀌는지 확인한다.
9. 새로고침 없이 반영되는지 확인한다.

#### C. 재접속 복원
10. 황금열쇠 획득 후 페이지를 새로고침한다.
11. 다시 자유대화에 진입한다.
12. DB 실제 지급 기록을 조회하여 `오늘 받았어!` 상태가 복원되는지 확인한다.
13. 앱을 나갔다 다시 들어오는 경우에도 동일한지 확인한다.

#### D. 다른 보상과 구분
14. Mission 황금열쇠만 받은 QA 계정을 준비한다.
15. Free Chat 일일 engagement 보상 row가 없다면 `아직 안 받았어`로 표시되는지 확인한다.
16. attendance/admin reward만 있어도 동일하게 Free Chat 미획득으로 표시되는지 확인한다.

#### E. KST 날짜 전환
17. KST `business_date` 기준으로 오늘 지급 상태를 확인한다.
18. 이전 날짜에 받은 Free Chat 황금열쇠만 있고 오늘 row가 없으면 `아직 안 받았어`로 표시되는지 확인한다.
19. 오늘 row가 있으면 `오늘 받았어!`로 표시되는지 확인한다.

PASS 기준:
- 오늘 Free Chat 황금열쇠 미획득 상태가 화면에 명확히 표시됨.
- 오늘 Free Chat 황금열쇠 획득 완료 상태가 화면에 명확히 표시됨.
- Source of Truth는 `gold_key_ledger`.
- 판정 기준은 `child_id + reward_type='freechat_daily_engagement' + KST business_date`.
- Mission/출석/관리자 보상과 혼동 없음.
- 지급 직후 UI 즉시 갱신.
- 새로고침/재접속 후 DB 기준 상태 복원.
- 기존 Free Chat 황금열쇠 지급 조건/하루 1회 정책 회귀 없음.
- Production 변경 없음.
- 최종 상태 `WAITING_FOR_OWNER_QA`.

## 1. 상태 / 우선순위 / 대상
- 상태: 신규 UX/상태 표시 요청
- 우선순위: P1 / HIGH
- 대상:
  - Free Chat 화면
  - Free Chat session initial load
  - Free Chat daily engagement reward state
  - Golden Key read API 또는 기존 session API 확장
- Source of Truth: `public.gold_key_ledger`
- Free Chat reward type: `freechat_daily_engagement`
- 현재 지급 action: `/api/chat/pause`
- 현재 session init: `/api/chat/session`
- 기존 total balance API: `/api/goldkey/balance`
- 구현 환경: Development
- Production 변경: Owner QA 전 금지
- 최종 상태: `WAITING_FOR_OWNER_QA`

## 2. 목표

현재 Free Chat daily engagement 황금열쇠는 실제 지급되더라도 아이가 자유대화 화면에서 `오늘 이미 받았는지 / 아직 못 받았는지` 확인할 수 없다.

현재 구조:
- Free Chat 진입 → `/api/chat/session` → `sessionId / businessDate` 수신 → 오늘 황금열쇠 지급 여부는 알 수 없음
- 대화 조건 충족 → `/api/chat/pause` → `reward.earned=true` → `GoldKeyRewardModal` 1회 표시
- 새로고침 / 재접속 → 오늘 이미 받았는지 복원하는 read path 없음

Canonical 판정:
- `child_id = 현재 아이`
- `reward_type = 'freechat_daily_engagement'`
- `business_date = 현재 KST business_date`
인 `gold_key_ledger` row가 존재하는지 확인한다.

총 황금열쇠 보유량은 이 판정에 사용하지 않는다.

## 3. 요구사항

### 3-1. Source of Truth
오늘 Free Chat 황금열쇠 획득 여부는 반드시 `public.gold_key_ledger`를 사용한다.

다음은 Source of Truth로 사용하지 않는다.
- 현재 황금열쇠 총 balance
- 클라이언트 localStorage
- 현재 세션에서 reward modal을 봤는지 여부
- 현재 session active time
- Mission 완료 여부

### 3-2. 다른 황금열쇠 보상과 분리
다음 보상을 오늘 Free Chat 획득으로 오인하면 안 된다.
- `mission_v3_complete`
- `attendance_roulette`
- `admin_adjustment`
- 기타 Mission/attendance/admin reward

반드시 `reward_type='freechat_daily_engagement'`를 기준으로 판정한다.

### 3-3. KST Business Date 사용
오늘 여부는 브라우저 local timezone으로 임의 계산하지 않는다.
현재 프로젝트의 canonical KST business date를 사용한다.
가능하면 기존 `/api/chat/session`의 `businessDate` Source를 재사용한다.

### 3-4. 최소 Read Contract
화면에 필요한 최소 contract:

```ts
{
  earnedToday: boolean;
  earnedAt: string | null;
  businessDate: string;
  rewardAmount: number;
}
```

전체 ledger history를 client에 보내지 않는다.

### 3-5. 조회 경로
현재 read API가 없으므로 현재 architecture를 확인한 뒤 다음 중 최소 변경을 선택한다.
- `/api/chat/session` 응답에 오늘 reward status 포함
- Free Chat 전용 read endpoint 추가

어느 방식을 사용하든 Source of Truth는 동일해야 한다.
불필요하게 별도 중복 API를 여러 개 만들지 않는다.

### 3-6. 화면 진입 시 상태 로드
Free Chat 화면 최초 진입 시 반드시 오늘 상태를 조회한다.

### 3-7. 지급 직후 즉시 갱신
기존 `/api/chat/pause` 응답에서 `reward.earned === true` 또는 현재 canonical success response가 오면:
- 기존 `GoldKeyRewardModal` 유지
- `earnedToday=true`
- `earnedAt` 반영
- `rewardAmount=1`
- 화면 상태 즉시 갱신

### 3-8. 재접속/새로고침 복원
클라이언트 메모리에 오늘 획득 상태가 없어도 새로고침/재진입 시 DB Source of Truth로 상태를 복원한다.

### 3-9. UI 위치
자유대화 화면에서 아이가 대화를 시작하기 전에 확인할 수 있는 위치에 `오늘의 황금열쇠` 상태를 표시한다.

미획득:
```text
🔑 오늘의 황금열쇠
아직 안 받았어
```

획득:
```text
🔑 오늘의 황금열쇠
오늘 받았어! ✓
```

현재 Free Chat UI와 디자인 시스템을 따른다.

### 3-10. 획득 시각 표시
필요 시 secondary detail로 `earnedAt`을 표시할 수 있다.
핵심은 `받음 / 아직 안 받음`이다.

### 3-11. 로딩 상태
상태 조회 전 `아직 안 받았어`를 먼저 표시하지 않는다.
조회 중에는 skeleton/neutral 상태/숨김 중 현재 UI에 맞는 방식을 사용한다.

### 3-12. 조회 실패 상태
Read API 실패 시 `아직 안 받았어`로 단정하지 않는다.
대화 기능은 사용할 수 있어야 하고 기술 오류를 아이에게 직접 노출하지 않는다.

### 3-13. 기존 보상 정책 유지
이번 요청에서 다음 정책은 변경하지 않는다.
- Active Conversation Time 60초
- meaningful child turns 최소 3
- KST business_date 기준 하루 최대 1회
- reward_type `freechat_daily_engagement`
- 황금열쇠 +1

### 3-14. Existing Idempotency 유지
현재 DB partial unique index와 `complete_freechat_daily_engagement`의 기존 하루 1회 지급 무결성을 유지한다.
이번 UI 기능을 위해 별도 지급 로직을 만들지 않는다.

### 3-15. Balance와 Status 분리
오늘 상태는 balance가 아니라 지급 이력이다.

### 3-16. UI State는 Cache일 뿐
client state는 화면 표시용 cache이며 Source of Truth가 아니다.
재진입 시 server/DB 기준으로 재확인한다.

### 3-17. 기존 GoldKeyRewardModal 유지
역할 분리:
- `GoldKeyRewardModal` = 방금 받았다는 이벤트/축하
- Daily Golden Key Status = 오늘 이미 받았는지 지속 확인

### 3-18. 개인정보/권한
client가 임의 `child_id`를 넣어 다른 아이 ledger를 조회할 수 없도록 현재 인증/세션 ownership 정책을 따른다.

### 3-19. Mission 영향 없음
이번 상태는 Free Chat 일일 reward 전용이다.
Mission 화면/보상 UI를 변경하지 않는다.

## 4. 기존 구조 확인

작업 전 현재 HEAD에서 다음을 확인한다.
- `public.gold_key_ledger`
- `reward_type`
- `reason`
- `business_date`
- `earned_at`
- `dailyEngagementReward.ts`
- `complete_freechat_daily_engagement`
- `/api/chat/pause`
- `reward.earned`
- `GoldKeyRewardModal`
- `/api/chat/session`
- `businessDate`
- `app/chat/page.tsx`
- `/api/goldkey/balance`

확정된 현재 구조:
- `/api/goldkey/balance`는 총 balance만 반환하여 오늘 Free Chat 획득 여부 판정에 사용할 수 없음.
- `/api/chat/session`은 현재 `businessDate`는 반환하지만 오늘 reward status는 반환하지 않음.
- `/api/chat/pause`는 지급 action이며 reload/re-entry용 read API가 아님.
- `gold_key_ledger`는 reward_type으로 Mission/Free Chat/attendance/admin 보상을 구분 가능.

## 5. 금지사항
- Production deploy 금지
- Production migration 금지
- Production env 변경 금지
- Production 데이터 수정 금지
- 과거 ledger row 수정/삭제 금지
- 기존 reward 지급 조건 변경 금지
- 60초/3 meaningful turns 정책 변경 금지
- 하루 1회 idempotency 변경 금지
- 총 balance만 보고 earnedToday 판정 금지
- Mission reward를 Free Chat reward로 오인 금지
- 브라우저 timezone 기준 날짜 판정 금지
- localStorage만으로 today status 관리 금지
- `/api/chat/pause`를 단순 조회용으로 재호출 금지
- 화면 진입 때 reward를 다시 지급하려는 로직 금지
- 상태 조회 실패를 `미획득`으로 표시 금지
- 실제 가족 계정 자동화 QA 금지
- Owner QA 전 Production 변경 금지

## 6. 모호성 처리
- 기존 `/api/chat/session`에 status를 추가하는 것이 자연스러우면 신규 endpoint를 만들지 않는다.
- 별도 read endpoint가 보안/책임 분리상 더 적합하면 최소 endpoint를 만든다.
- `rewardAmount`는 현재 정책상 해당 ledger row 존재 시 1로 표현한다.
- `earnedAt`은 canonical ledger `earned_at`을 사용한다.
- businessDate 계산 helper가 이미 있다면 중복 구현하지 않는다.
- UI 디자인은 현재 Free Chat design system을 따른다.
- 기존 baseline test failure와 이번 변경 failure를 분리 보고한다.

## 7. QA

### 7-1. 오늘 미획득
오늘 `freechat_daily_engagement` row 없음.
기대:
- `earnedToday=false`
- `rewardAmount=0`
- UI `아직 안 받았어`

### 7-2. 오늘 획득
오늘 row 존재.
기대:
- `earnedToday=true`
- `earnedAt` 존재
- `rewardAmount=1`
- UI `오늘 받았어!`

### 7-3. Mission 보상만 존재
기대:
- Free Chat status `아직 안 받았어`

### 7-4. Attendance/Admin 보상만 존재
기대:
- Free Chat status 미획득

### 7-5. 지급 직후
`/api/chat/pause`에서 `reward.earned=true`.
기대:
- Reward modal 정상
- 상태 즉시 `오늘 받았어!`
- 별도 새로고침 불필요

### 7-6. 새로고침
오늘 획득 후 reload.
기대:
- server read
- `earnedToday=true` 복원

### 7-7. 재접속
다른 화면 이동 후 Free Chat 재진입.
기대:
- DB status 복원

### 7-8. 어제만 획득
어제 row 존재 / 오늘 row 없음.
기대:
- 오늘 미획득

### 7-9. KST 자정 경계
KST businessDate 기준 날짜 전환 fixture.
기대:
- 이전 날짜 row를 오늘 획득으로 보지 않음

### 7-10. Read API 실패
기대:
- 대화 기능 유지
- 미획득으로 오표시하지 않음
- 기술 오류 child 노출 없음

### 7-11. Duplicate 지급 방지
오늘 이미 지급된 상태에서 조건을 다시 충족.
기대:
- ledger duplicate 없음
- 기존 idempotency 유지
- 화면 `오늘 받았어!` 유지

### 7-12. Security
다른 child status 조회 시도.
기대:
- 현재 auth/ownership 정책에 따라 차단
- 다른 child ledger 노출 없음

### 7-13. Regression
- Free Chat session creation
- Free Chat conversation
- `/api/chat/pause`
- GoldKeyRewardModal
- Golden Key balance
- Mission reward
- attendance reward
- ledger idempotency
- typecheck
- lint
- build

## 8. 완료조건
- Free Chat 화면에 `오늘의 황금열쇠` 상태 표시 존재.
- 미획득/획득 완료가 명확히 구분됨.
- Source of Truth는 `public.gold_key_ledger`.
- canonical 조건은 `child_id + reward_type='freechat_daily_engagement' + KST business_date`.
- total balance를 earnedToday 판정에 사용하지 않음.
- Mission/attendance/admin reward와 혼동 없음.
- 화면 진입 시 server/DB 기준 status 로드.
- 지급 직후 UI 즉시 갱신.
- 새로고침/재접속 후 상태 복원.
- 조회 중 미획득으로 오표시하지 않음.
- 조회 실패 시 false state를 보여주지 않음.
- 기존 GoldKeyRewardModal 유지.
- 기존 60초 + 3 meaningful turns + 하루 1회 지급 정책 유지.
- 기존 DB idempotency 유지.
- 다른 child ledger 접근 차단.
- Mission reward flow 회귀 없음.
- 자동 테스트/typecheck/lint/build 결과 보고.
- Development QA 완료.
- Owner QA 전 Production 변경 없음.
- 최종 상태 `WAITING_FOR_OWNER_QA`.

## 9. 완료보고

### Source of Truth
- table:
- reward_type:
- businessDate source:
- earnedToday query condition:

### API
- 사용 endpoint:
- 기존 API 확장 / 신규 read endpoint:
- auth/ownership 방식:
- response contract:

### Free Chat UI
- 표시 위치:
- loading 상태:
- 미획득 상태:
- 획득 상태:
- earnedAt 표시 여부:

### State Sync
- initial load:
- `/api/chat/pause` 지급 직후:
- reload:
- re-entry:
- KST date change:

### Reward Separation
- Mission:
- Attendance:
- Admin:
- total balance:

### QA
- today not earned:
- today earned:
- Mission-only reward:
- Attendance/Admin-only reward:
- immediate update:
- reload:
- re-entry:
- yesterday-only:
- KST boundary:
- API failure:
- duplicate reward:
- security:

### Regression
- Free Chat:
- GoldKeyRewardModal:
- Gold Key balance:
- Mission rewards:
- ledger idempotency:

### Build
- unit:
- integration:
- typecheck:
- lint:
- build:

### 배포
- Development URL:
- Production changed: NO
- Production migration applied: NO
- 최종 상태: `WAITING_FOR_OWNER_QA`
- commit:
