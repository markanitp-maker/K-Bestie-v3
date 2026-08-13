# 073 Mission v3 전환 경계 설계

> 모드: 설계 전용. 이 문서는 구현 순서와 계약만 확정하며 제품 코드·SQL·환경변수를 변경하지 않는다.
> 작성 기준일: 2026-08-13 (KST)

## 0. 결론

**채택안은 (E) 서버 정본 entry snapshot + 정책별 화면 격리이며, 배포 단위는 (D)처럼 홈과 미션 화면을 원자적으로 묶는다.**

- 서버의 단일 `entry snapshot`이 아동별 `policyVersion`, 당일 세션, 진행 상태, 시간 게이트, terminal 표시 상태를 한 번에 확정한다. 핵심 해석기는 기존 `resolveMissionPolicyVersionForChild`다. 이 함수는 cutover 뒤에도 당일 v2 행이 있으면 v2를 유지하도록 이미 구현돼 있다 (`lib/mission-v3/policyResolution.ts:35-64`).
- 홈과 미션 진입 화면은 같은 snapshot만 읽는다. v2/v3 **조회 결과를 화면이 조합하지 않는다.** 현재 v3 조회가 `daily_single`만 조회해 v2 진행을 버리는 문제는 서버 snapshot이 v2도 정규화해 해결한다 (`app/api/mission/v3/today-progress/route.ts:54-60`).
- 실제 실행 경로는 snapshot의 `policyVersion`에 따라 **화면 경계에서 한 번만** 갈린다. v2는 현재 레거시 화면/엔드포인트, v3는 별도 v3 화면/엔드포인트를 쓴다. v3 turn 라우트는 `daily_single` + `v3_single_daily`만 허용하므로 턴마다 임의 혼용할 수 없다 (`app/api/mission/v3/turn/route.ts:183-193`).
- 홈·미션·정규화 snapshot·정책 라우터가 모두 준비되기 전에는 어떤 화면 변경도 배포하지 않는다. 현재 홈 diff는 독립 배포 금지이며, 완전 revert 후 재작업할 필요는 없지만 아래 계약으로 **교체(supersede)** 해야 한다.
- `MISSION_V3_EFFECTIVE_AT`은 배선 스위치가 아니라 **신규 세션 정책 스위치**로만 쓴다. unset/future이면 v2, 유효 시각 이후면 v3라는 현재 기본 동작을 유지한다 (`lib/mission-v3/policyResolution.ts:10-32`).

이 방식의 불변식은 다음과 같다.

1. 한 아동의 한 KST business date에는 UI가 하나의 정책만 본다.
2. 이미 존재하는 당일 세션의 정책이 환경변수보다 우선한다.
3. 시간 게이트는 신규 시작에만 적용하고, 진행 중 세션은 정책과 무관하게 이어하기를 우선한다. v3 결정기는 이미 기존 비-terminal 세션을 시간 판정보다 먼저 `resume`한다 (`lib/mission-v3/timePolicy.ts:167-206`). v2 start도 당일 미완료 세션을 신규 시간 검사보다 먼저 복원한다 (`app/api/mission/start/route.ts:139-218`).
4. `daily_limit_reached`는 “오늘 새 세션을 만들 수 없음”이라는 quota 사실이지 “완료”의 동의어가 아니다. 서버가 terminal로 보는 상태는 `COMPLETED`, `SAFETY_PAUSED`, `FORCE_ENDED` 세 가지다 (`lib/mission-v3/timePolicy.ts:73`, `app/api/mission/v3/today-progress/route.ts:12`).

---

## 1. 전환 경계 후보 평가

### 판단 기준

| 기준 | 통과 조건 |
|---|---|
| cutover 순간 진행 보존 | 당일 v2 진행 세션은 종료까지 v2로 보이고 v2로 이어져야 하며, v3 신규 세션과 섞이지 않아야 한다. |
| 롤백 가능성 | 플래그를 되돌려도 이미 생긴 당일 v3 세션은 v3로 계속 보여야 하며, 행 변환·삭제가 없어야 한다. |
| 클라이언트 분기 복잡도 | 홈 및 공용 UI에는 정책별 데이터 조합이 없어야 하고, 실행 분기는 한 화면 경계에만 있어야 한다. |
| Production 복구 비용 | 새 배포/DB 복원 없이 우선 신규 v3 유입을 멈출 수 있고, 기존 세션 drain 뒤 완전 복귀할 수 있어야 한다. |

### 후보별 평가

| 후보 | 장점 | 단점 | 판정 |
|---|---|---|---|
| (A) 클라이언트 dual-read | 기존 v2/v3 API를 재사용할 수 있고 `policyVersion`으로 명시적 분기가 가능하다. | 홈이 정책 조회 뒤 다시 v2/v3 진행 조회를 해야 하므로 두 응답 사이의 시점 차이와 로딩/오류 분기가 늘어난다. 큰 레거시 화면 안에서 start·turn·완료 계약까지 섞으면 분기 누락 위험이 크다. | 단독 기각. 실행 transport 선택 원칙만 E의 한 경계에 제한해 사용. |
| (B) v3 today-progress가 v2를 정규화 | 홈과 미션 진입이 단일 read 계약을 써서 진행 소실과 시간 문구 불일치를 함께 제거한다. | 조회만 정규화해서는 충분하지 않다. v3 start는 정책 비활성 시 차단 응답을 내고 (`app/api/mission/v3/start/route.ts:147-182`), v3 turn은 v3 세션만 받는다 (`app/api/mission/v3/turn/route.ts:183-193`). 따라서 start/turn까지 무리하게 같은 응답 형태로 위장하면 서버 facade가 두 엔진을 재구현하게 된다. | read 경계로 채택, 실행 경계로는 불충분. |
| (C) Dev에서 v3만 배선 | v3 happy path 구현은 가장 단순하다. | unset 시 v2가 정식 폴백인 현재 정책 (`lib/mission-v3/policyResolution.ts:13-17`)과 당일 v2 고정 해석기 (`lib/mission-v3/policyResolution.ts:35-64`)를 화면이 지원하지 못한다. Production 롤백도 곧 UI 불능이 된다. | 기각. |
| (D) 홈·미션 동시 배선 + 단일 스위치 | 사용자에게 홈과 미션이 서로 다른 정책을 말하는 중간 배포를 없앤다. | 배포 묶음만 정할 뿐, v2 진행을 어느 응답으로 읽고 기존 세션을 어떻게 drain할지는 해결하지 않는다. | 필수 배포 원칙으로 채택하되 단독안으로는 불충분. |
| **(E) 서버 entry snapshot + 정책별 화면 격리 + D식 원자 배포** | read는 단일 계약, 실행은 정책별 엔진으로 격리한다. 기존 v2 세션은 그대로 이어지고 v3 전용 API의 엄격한 세션 검증도 유지된다. 롤백 때도 같은 dual-capable 빌드에서 신규 유입만 v2로 돌릴 수 있다. | snapshot 정규화와 resolver의 양방향 sticky 보강이 먼저 필요하다. 화면 파일을 순차 편집하더라도 배포는 전부 완료 뒤 한 번만 해야 한다. | **채택.** |

### 왜 단순 A가 아닌가

현재 홈 변경은 `/api/mission/v3/today-progress`를 직접 호출한다 (`app/child/home/page.tsx:156-175`). 그런데 그 라우트는 정책이 v2여도 진행 행을 `daily_single`로만 찾는다 (`app/api/mission/v3/today-progress/route.ts:54-60`). 화면이 이 결과의 `policy_not_effective`를 무시하면 (`app/child/home/page.tsx:284-301`) v2 3/5 진행이 기본 시작 문구로 바뀐다. E는 클라이언트가 두 read를 조합하게 하지 않고, 서버가 아동별 정책과 진행을 하나의 응답으로 확정하게 한다.

### resolver 보강: 롤백도 sticky여야 한다

현재 해석기는 글로벌 정책이 v3일 때만 당일 v2 행을 찾고, 글로벌 정책이 v2면 즉시 반환한다 (`lib/mission-v3/policyResolution.ts:45-55`). 따라서 cutover 뒤 v3 세션이 생긴 상태에서 env를 unset하면 기존 v3 세션을 찾지 않고 v2로 해석할 수 있다. Production 롤백 전에 다음 규칙으로 보강한다.

1. 해당 아동·KST business date의 `mission_progress`를 먼저 읽는다.
2. 기존 행이 모두 `v2_dual`이면 env와 무관하게 `v2_dual`; 기존 행이 `v3_single_daily`이면 env와 무관하게 `v3_single_daily`를 반환한다.
3. 행이 없을 때만 `MISSION_V3_EFFECTIVE_AT`으로 신규 정책을 정한다.
4. 두 정책 행이 동시에 존재하면 임의 우선순위를 주지 말고 오류로 fail-closed한다. 데이터 삭제·자동 변환은 하지 않는다.
5. v2 start도 이 resolver 결과를 확인해 v3로 확정된 아동에게 새 v2 행을 만들지 못하게 한다. 현재 DB의 v3 unique index는 `daily_single`에만 걸려 있어 (`supabase/migrations/20260810220000_mission_v3_daily_single_policy.sql:103-105`) 이 서버 가드 없이 v2/v3 혼합 방지를 주장해서는 안 된다.

**Production 전환 전제:** dual-capable 배포 전의 구형 프론트가 더 이상 새 v2 start를 보내지 않는다는 배포 SHA 관측을 통과해야 한다. 현재 미션 화면은 `NEXT_PUBLIC_DEPLOYMENT_SHA`를 서버에 보고하는 경로가 있다 (`app/child/missions/page.tsx:2182-2207`). 관측 기간은 24시간으로 정하고, 구형 SHA 요청이 한 건이라도 있으면 effective-at을 연기한다. 이 전제와 v2 start 서버 가드가 준비되지 않으면 cutover 금지다.

---

## 2. 서버 entry snapshot 계약

`GET /api/mission/v3/today-progress?childId=...`의 역할을 “v3 진행 조회”에서 **정책 중립 mission entry snapshot**으로 바꾼다. URL은 이미 배선된 홈 diff를 최소화하기 위해 유지하되, 의미는 v2/v3 공통 read 계약으로 명시한다.

```ts
type MissionEntryState =
  | "start"
  | "resume"
  | "completed"
  | "safety_paused"
  | "force_ended"
  | "before_open"
  | "closed"
  | "unavailable";

interface MissionEntrySnapshot {
  policyVersion: "v2_dual" | "v3_single_daily";
  effectiveAt: string | null;
  businessDate: string;
  entryState: MissionEntryState;
  canEnter: boolean;       // start 또는 resume일 때만 true
  canStartNew: boolean;    // start일 때만 true
  sessionId: string | null;
  status: "IN_PROGRESS" | "COMPLETED" | "SAFETY_PAUSED" | "FORCE_ENDED" | null;
  completed: boolean;      // status === COMPLETED와 항상 동치
  blockReason: "before_open" | "closed" | "daily_limit_reached" | "unavailable" | null;
  progress: null | {
    kind: "valid_answers" | "conversation_goals";
    current: number;
    target: number;
  };
  timeGate: {
    enabled: boolean;
    allowedForNewStart: boolean;
    scheduleEnforced: boolean;
    reason: "before_open" | "closed" | null;
  };
}
```

계약 규칙:

- `policy_not_effective`는 서버 내부 정책 판단 사유로만 남기고 UI block reason으로 내리지 않는다. v2 정책이면 v2 진행을 정규화해 `start/resume/terminal/time` 중 하나를 반환한다.
- v2 진행은 기존 `valid_answer_count`와 `required_valid_count`를 정규화한다. 현재 v2 progress 라우트도 이 필드를 반환한다 (`app/api/mission/today-progress/route.ts:68-78`).
- v3 진행은 현재 Goal 진행 빌더 결과를 정규화한다. v3 라우트는 세션이 있을 때 Goal을 조회한다 (`app/api/mission/v3/today-progress/route.ts:66-74`).
- `completed`는 오직 `status === "COMPLETED"`일 때 true다. 현재 v3 응답도 이 등식을 사용한다 (`app/api/mission/v3/today-progress/route.ts:76-88`).
- terminal 세 상태는 모두 `blockReason:"daily_limit_reached"`일 수 있지만 `entryState`로 구분한다. `daily_limit_reached`만 보고 완료 문구를 고르는 것은 금지한다.
- snapshot 조회 실패 시 이전 값이나 “시작 가능”으로 낙관 폴백하지 않는다. 두 화면 모두 `unavailable`과 “미션 상태를 확인하지 못했어요. 잠시 후 다시 해 주세요.”를 표시한다.

---

## 3. 시간 게이트의 단일 출처

### 결정

**서버의 `evaluateMissionTimeGate` + 정책별 existing-session 우선 결정이 정본이다.** 홈과 미션은 시간 계산을 하지 않고 entry snapshot의 `entryState`, `canEnter`, `timeGate`만 읽는다.

현재 v3 evaluator는 `MISSION_SCHEDULE_ENFORCED`만 읽고 09:00 inclusive ~ 23:50 exclusive를 계산한다 (`lib/mission-v3/timePolicy.ts:116-145`). 반면 `/api/config/child-time-restrictions`는 `MISSION_TIME_GATE_ENABLED === "true" || scheduleEnforced`일 때 켜지고 서버 계산 `activeRound`를 내린다 (`app/api/config/child-time-restrictions/route.ts:19-23`). 두 플래그의 의미를 다음 우선순위로 한 함수에 모은다.

1. `MISSION_SCHEDULE_ENFORCED=true`: 신규 시작 허용창은 09:00 inclusive ~ 23:50 exclusive. 현재 v3 상수는 540/1430분이다 (`lib/mission-v3/timePolicy.ts:124-144`).
2. 위 값이 false이고 `MISSION_TIME_GATE_ENABLED=true`: rollback 중 v2 호환을 위해 현재 legacy `currentRound` 창을 보존한다. legacy 계산은 10:00~17:50, 18:00~24:00이고 schedule-enforced일 때 09:00~23:50이다 (`lib/mission/missionTimeGate.ts:42-65`). v3 신규 시작도 이 호환 게이트 결과를 그대로 사용해 홈/미션이 다르게 말하지 않게 한다.
3. 둘 다 false: 신규 시작을 24시간 허용한다. 현재 v3 테스트도 schedule 미강제 시 24시간 허용 계약을 고정한다 (`lib/mission-v3/timePolicy.test.ts:80-91`).
4. 어느 경우든 당일 `IN_PROGRESS`가 있으면 시간창보다 resume가 우선한다. 현재 v3 결정 순서가 이 원칙을 구현한다 (`lib/mission-v3/timePolicy.ts:181-206`).

### `/api/config/child-time-restrictions` 처리

- **홈·미션 화면의 의존성은 폐기한다.** 기존 미션 화면의 fetch와 `phase:"closed"` 전환 (`app/child/missions/page.tsx:2369-2407`)을 entry snapshot 기반으로 교체한다.
- 라우트 파일 자체는 즉시 삭제하지 않고 **구형 클라이언트 및 env 롤백 호환 전용**으로 한 business-date + 24시간 유지한다. 새 화면 호출 0건과 구형 SHA 0건을 확인한 뒤 별도 저위험 정리 작업에서 삭제한다.
- 새 `phase:"closed"` 근거는 `entryState === "before_open" || entryState === "closed"`뿐이다. `resume`이면 `timeGate.allowedForNewStart === false`여도 닫지 않는다.
- 홈도 동일 상태를 사용한다. 현재처럼 `policy_not_effective`만 예외로 무시하는 분기 (`app/child/home/page.tsx:284-301`)는 제거한다.

아이 문구:

| entryState | 홈 | 미션 화면 |
|---|---|---|
| `before_open` | “아직 미션 시간이 아니야.” | `phase:"closed"`, “아직 미션 시간이 아니에요. 오전 9시에 다시 만나요!” (schedule-enforced 기준) |
| `closed` | “오늘 미션 시간이 끝났어.” | `phase:"closed"`, “오늘 미션 시간이 끝났어요. 내일 다시 만나요!” |
| `resume` + 게이트 밖 | “진행 중인 미션을 이어서 해요.” | 닫지 않고 기존 세션 이어하기 |
| `unavailable` | “미션 상태를 확인하지 못했어요.” | `phase:"error"`, “미션 상태를 확인하지 못했어요. 잠시 후 다시 해 주세요.” |

`MISSION_TIME_GATE_ENABLED` 호환창에서는 17:50~18:00처럼 다음 창 전인 구간을 `closed`가 아니라 일반 “지금은 미션 시간이 아니에요.”로 렌더링하도록 snapshot에 표시용 문구 키를 둘 수 있다. 이 키는 서버 판정을 바꾸지 않는 표시 metadata이며, 시간 자체를 클라이언트가 재계산해서는 안 된다.

---

## 4. terminal 상태 표시 계약

서버는 세 terminal 상태를 모두 하루 quota 소진으로 처리한다 (`lib/mission-v3/timePolicy.ts:183-192`). turn 응답은 이를 `completed`, `safetyPaused`, `earlyEnded`로 구분할 자료를 이미 내린다 (`app/api/mission/v3/turn/route.ts:495-507`). 화면은 아래 표를 정확히 따른다.

| status | completed | blockReason | entryState | 홈 카드/말풍선 | 미션 화면 | 동작 |
|---|---:|---|---|---|---|---|
| `COMPLETED` | `true` | `daily_limit_reached` | `completed` | 제목 “미션 완료”; 설명 “오늘의 미션을 모두 완료했어요”; 말풍선 “오늘의 미션을 모두 완료했어!”; 배지 “완료” | 완료 잠금 화면: “오늘의 미션을 모두 완료했어요. 이야기해 줘서 고마워!” | 새 시작/이어하기 없음. 자유대화 또는 홈 이동만 제공. |
| `SAFETY_PAUSED` | `false` | `daily_limit_reached` | `safety_paused` | 제목 “미션 잠시 쉬기”; 설명 “안전을 위해 오늘 미션을 잠시 쉬어요”; 말풍선 “오늘은 미션을 잠시 쉬어 갈게.”; 완료 배지 없음 | 안전 중단 화면: “안전을 위해 오늘 미션을 잠시 쉬고 있어요. 보호자 확인 후 다시 만나요.” | 새 시작/이어하기/보상 모달 금지. 홈 이동만 제공. |
| `FORCE_ENDED` | `false` | `daily_limit_reached` | `force_ended` | 제목 “오늘 미션 종료”; 설명 “오늘 미션은 여기까지예요”; 말풍선 “오늘 미션은 여기까지야. 내일 다시 만나자!”; 완료 배지 없음 | 종료 화면: “오늘 미션이 종료되었어요. 내일 다시 만나요.” | 새 시작/이어하기/보상 모달 금지. 홈 이동만 제공. |
| `IN_PROGRESS` | `false` | `null` | `resume` | 제목 “미션 계속하기”; 설명 “진행 중인 미션을 이어서 해요”; 정책별 진행 배지 | 이어하기 화면 | 동일 `sessionId`로 resume. 시간 게이트 밖이어도 허용. |
| `null` | `false` | `null` | `start` | 제목 “미션 진행”; 설명 “오늘의 미션을 시작해요” | 시작 준비 화면 | 시간 게이트가 허용할 때만 신규 시작. |

불가능/불일치 조합의 fail-closed 규칙:

- `completed:true`인데 status가 `COMPLETED`가 아니면 계약 오류로 `unavailable`; 완료 문구/보상 모달 금지.
- `daily_limit_reached`인데 status가 세 terminal 중 하나가 아니면 `unavailable`; 완료로 추정 금지.
- `SAFETY_PAUSED`와 `FORCE_ENDED`에는 `completed:false`를 유지한다. 현재 홈의 `completed || daily_limit_reached` 완료 처리 (`app/child/home/page.tsx:284-288`)는 반드시 제거한다.
- v3 start의 현재 generic `daily_limit_reached` 문구 “오늘 미션은 이미 마쳤어요.” (`app/api/mission/v3/start/route.ts:160-182`)는 화면 표시 정본으로 쓰지 않는다. start 응답의 `status`로 위 표를 재해석하고, 정상 진입은 사전 snapshot에서 terminal 화면으로 차단한다.

---

## 5. 화면/실행 경계

### 화면 구조

1. `/child/home`은 entry snapshot만 읽고 위 표를 렌더링한다.
2. `/child/missions`는 entry snapshot을 다시 읽어 최신 정책을 확정한다.
3. `policyVersion === "v2_dual"`이면 기존 레거시 화면 흐름을 유지한다. 현재 레거시 화면은 `/api/mission/start`를 사용한다 (`app/child/missions/page.tsx:2059-2073`).
4. `policyVersion === "v3_single_daily"`이면 신규 `/child/missions/v3` 화면으로 `replace`한다. 이 화면만 `/api/mission/v3/start`와 `/api/mission/v3/turn`을 쓴다.
5. `/child/missions/v3` 직접 접근도 snapshot을 먼저 확인한다. 정책이 v2면 `/child/missions`로 되돌리고, terminal/time 상태면 해당 상태 화면만 표시한다.

별도 v3 화면을 쓰는 이유는 현재 레거시 화면이 질문 배열과 `questionId` 중심 턴을 구성하고 (`app/child/missions/page.tsx:775-813`, `app/child/missions/page.tsx:963-973`), 다음 질문을 `/api/mission/respond`로 가져오는 구조이기 때문이다 (`app/child/missions/page.tsx:1212-1273`). 반면 v3 turn은 발화 하나를 받아 Goal 평가·K 응답·terminal·보상을 한 응답으로 반환한다 (`app/api/mission/v3/turn/route.ts:495-507`). 한 컴포넌트 안에 두 상태기계를 섞지 않는다.

### 세션 정책 고정

- 홈에서 읽은 snapshot은 안내용이다. 실제 미션 진입과 start에서 서버가 resolver를 다시 실행해 최신 정책을 확정한다. v3 start가 이미 이 resolver를 호출한다 (`app/api/mission/v3/start/route.ts:134-154`).
- start 성공 뒤에는 응답의 `policyVersion`과 `sessionId`를 화면 세션에 고정한다. v3 start 응답은 저장된 progress 정책을 재조회해 돌려준다 (`app/api/mission/v3/start/route.ts:263-283`).
- 한 세션이 열린 뒤에는 env가 바뀌어도 endpoint를 재선택하지 않는다. session row의 정책이 transport를 결정한다.
- v2 화면에서 서버가 `MISSION_POLICY_CHANGED`를 반환하면 새 v2 세션을 만들지 않고 snapshot을 재조회한 뒤 v3 화면으로 한 번만 이동한다. 무한 redirect는 오류 화면으로 차단한다.

---

## 6. 배선 작업 재분할 (agy 10분 단위)

모든 구현 브리프에는 “작업 전 루트 `AGENTS.md` §6~§10(코딩 규약)을 읽고 지정 파일 밖을 수정하지 말라”를 포함한다. **U1/U2는 파일이 겹치지 않아 병렬 가능하고, U4/U5도 U3 통과 뒤 병렬 가능하다.** 나머지는 표의 의존관계대로 순차 실행한다. 어떤 중간 상태도 Dev/Production에 배포하지 않는다.

| 단위 | 예상 | 대상 파일 | 작업/완료 조건 | 의존 |
|---|---:|---|---|---|
| U1. 양방향 sticky resolver | 10분 | `lib/mission-v3/policyResolution.ts`, `lib/mission-v3/policyResolution.test.ts` | 기존 당일 v2 유지뿐 아니라 env rollback 뒤 당일 v3 유지, 혼합 정책 fail-closed 테스트를 추가. 행이 없을 때만 env 적용. | 없음 |
| U2. 단일 시간 게이트 | 10분 | `lib/mission-v3/timePolicy.ts`, `lib/mission-v3/timePolicy.test.ts` | 두 env 플래그의 우선순위, 신규 시작 gate, 기존 세션 resume 우선, 표시 reason을 한 결과로 고정. | 없음(U1과 병렬) |
| U3. 정책 중립 entry snapshot | 10분 | `app/api/mission/v3/today-progress/route.ts`, `lib/mission-v3/entryContract.ts`(신규) | v2는 legacy progress, v3는 Goal progress를 같은 계약으로 반환. terminal `entryState` 구분. `policy_not_effective` UI 노출 제거. | U1, U2 |
| U4. legacy start cutover guard | 10분 | `app/api/mission/start/route.ts` | resolver가 v3 또는 기존 v3 세션을 반환하면 v2 신규 생성 금지. 기존 v2 세션 resume는 유지. 오류 code를 `MISSION_POLICY_CHANGED`로 고정. | U1, U3 |
| U5. 클라이언트 entry parser/router | 10분 | `lib/mission-v3/clientEntry.ts`(신규), `lib/mission-v3/clientEntry.test.ts`(신규) | snapshot 런타임 검증, terminal 불일치 fail-closed, v2/v3 목적지 선택을 순수 함수로 구현. | U3 |
| U6. v3 화면 시작/이어하기 | 10분 | `app/child/missions/v3/page.tsx`(신규) | snapshot 재확인 → terminal/time 상태 → `/api/mission/v3/start` create/resume까지 구현. start 응답의 session 정책 고정. v2 정책의 직접 접근은 즉시 legacy 화면으로 복귀시켜 미완성 v3 턴 화면에 진입할 수 없게 하며, U7 전 배포 금지. | U5 |
| U7. v3 턴 송수신 | 10분 | `app/child/missions/v3/page.tsx` | `clientTurnId` 멱등 키로 `/api/mission/v3/turn` 호출, K 메시지·Goal 기반 진행 표현·재시도 처리. 레거시 answer/respond 호출 없음. | U6 |
| U8. v3 terminal/완료·보상 UI | 10분 | `app/child/missions/v3/page.tsx` | `COMPLETED`에만 완료/보상 UI, `SAFETY_PAUSED`·`FORCE_ENDED`는 §4 문구와 입력 잠금. | U7 |
| U9. 레거시 미션 entry 교체 | 10분 | `app/child/missions/page.tsx` | `/api/config/child-time-restrictions` fetch 제거. snapshot의 policy/time/terminal을 읽고 v3면 새 화면으로 이동, v2 resume/start만 기존 흐름으로 진입. `phase:"closed"`는 snapshot 근거만 사용. | U5, U8 |
| U10. 홈 교체 + 회귀 테스트 | 10분 | `app/child/home/page.tsx`, `app/child/missions/page.real-repro.test.ts` | 현재 direct-v3/`daily_limit_reached` 완료 처리 diff를 snapshot 계약과 §4 표로 교체. 홈→미션 정책/시간/terminal 일치 정적 사례 추가. | U9 |

### 기존 홈 변경 판정

**현재 형태는 되돌려야 하지만, 파일 전체를 예전 버전으로 기계적 revert할 필요는 없다.** 정확한 처리는 U10에서 기존 diff의 다음 두 의미를 제거하고 새 snapshot 렌더링으로 교체하는 것이다.

- v2 정책인데도 v3-only 진행을 그대로 신뢰하는 direct read (`app/child/home/page.tsx:156-175`).
- `daily_limit_reached`를 완료로 합치는 분기 (`app/child/home/page.tsx:284-288`).

따라서 현재 홈 diff는 **merge/deploy 금지**, U10 완료 뒤 하나의 원자 배포에만 포함한다. 이미 올바른 `Promise.allSettled` 사용 (`app/child/home/page.tsx:159-164`)과 타입 골격은 새 계약에 맞게 재사용할 수 있다.

### 게이트 순서

1. U1~U4 서버 경계를 먼저 게이트①에 올린다. resolver·시간·legacy guard가 통과하기 전 UI 작업 결과를 배포하지 않는다.
2. U5~U10 전체를 기능 묶음으로 게이트① 정적 리뷰한다.
3. 게이트① 통과 뒤에만 agy E2E QA: v2 진행 3/5 유지, v3 신규/이어하기, 08:59·09:00·23:49·23:50, 세 terminal, env rollback 뒤 당일 v3 resume를 각각 확인한다.
4. 게이트②까지 통과한 **동일 빌드**로 Dev를 배포한다. 홈만 또는 미션만 따로 배포하는 경로는 없다.

---

## 7. Production cutover 절차

### 사전 조건

- U1~U10 게이트①·② 통과.
- Production에 dual-capable 동일 빌드를 **2026-08-13 23:30 KST까지** 먼저 배포하고, 그 배포에 `MISSION_V3_EFFECTIVE_AT=2026-08-14T01:00:00+09:00`을 사전 설정한다. 01:00에 별도 수동 환경변수 변경이나 재배포를 요구하지 않는다.
- `MISSION_SCHEDULE_ENFORCED=true`를 먼저 별도 배포에서 확정한다. 이 플래그는 현재 서버 전용이며 (`lib/mission/missionScheduleFlag.ts:1-10`), v3 신규 시작창을 09:00~23:50으로 만든다 (`lib/mission-v3/timePolicy.ts:144-168`).
- 기존 “T-24h 이상 soak”는 2026-08-13 당일 준비 확정 일정과 양립하지 않으므로 이번 cutover의 충족 조건으로 사용하지 않는다. 대체로 배포 직후부터 T까지 구형 SHA mission start 요청, resolver 오류, mixed-policy, v2 resume 오류를 연속 관측하고, T 직전 read-only 점검을 한 번 더 수행한다. 구형 SHA 요청 또는 mixed-policy가 1건이라도 있으면 cutover를 중단한다. 이번 cutover에는 이 당일 대체 관측이 §9의 24시간 SHA 관측 문구보다 우선한다.
- 같은 날짜에 v2/v3가 섞인 아동 0명, resolver 오류 0건을 read-only 점검한다. SQL 수정은 하지 않는다.

### 확정 시각과 파싱 계약

1. 확정값은 **`MISSION_V3_EFFECTIVE_AT=2026-08-14T01:00:00+09:00`**이다. `+09:00`을 포함한 값을 그대로 사용한다.
2. resolver는 값을 `new Date(configuredEffectiveAt)`로 파싱하고 `now.getTime() >= effectiveAt.getTime()`으로 절대시각 비교한다 (`lib/mission-v3/policyResolution.ts:50-68`). 위 값은 UTC로 `2026-08-13T16:00:00.000Z`다.
3. 오프셋 없는 `2026-08-14T01:00:00`은 Production 서버 TZ인 UTC로 해석되어 **2026-08-14 10:00 KST**에 전환되므로 금지한다. KST 로컬 검증만으로는 이 오류가 거짓 통과할 수 있다.
4. `getKstBusinessDate`는 `Intl.DateTimeFormat`에 `Asia/Seoul`을 명시한다 (`lib/utils/kstBusinessDate.ts:5-15`). 따라서 T의 businessDate는 `2026-08-14`이며 기존 `2026-08-13` 행과 날짜가 달라, 08-14 행이 없는 아동은 env 판정을 적용받는다.

### 자동 전환과 관측 순서

1. **배포 후~T 직전:** 설정값이 정확한지 마스킹하지 않아도 되는 비밀 아닌 값으로 확인하고, 동일 빌드에서 01:00 전 `policyVersion=v2_dual` 경계 테스트 결과와 v2 resume를 확인한다. `MISSION_TIME_GATE_ENABLED`는 변경하지 않는다.
2. **T = 2026-08-14 01:00 KST:** 서버 시각 비교로 자동 전환한다. 수동 env 변경, 수동 재배포, 09:00으로의 재설정은 하지 않는다.
3. **T 직후:** 해당 businessDate에 progress가 없는 QA 전용 계정의 read-only 응답에서 `policyVersion=v3_single_daily`, `effectiveAt=2026-08-13T16:00:00.000Z`, time gate가 `closed`(신규 시작 비허용)인지 확인한다. 내부 reason/displayKey는 09:00 전이므로 `before_open`일 수 있다. 01:00은 09:00~23:50 운영시간 밖이므로 이 상태는 정상이며 장애로 판정하지 않는다 (`lib/mission-v3/timePolicy.ts:144-168`).
4. 당일 v2 row가 이미 있는 아동은 resolver sticky 규칙으로 v2를 끝까지 사용하고, row가 없는 아동만 v3를 사용한다. 기존 v2 행은 v3로 변환하지 않는다 (`supabase/migrations/20260810220000_mission_v3_daily_single_policy.sql:77-101`).
5. **09:00 오픈 직후:** QA 전용 계정으로 Production 전체 시작→턴→완료→보상 스모크를 수행한다. 01:00에는 gate가 닫혀 있으므로 이 전체 스모크를 억지로 수행하지 않는다.
6. T부터 09:00 스모크 종료까지 `policyVersion`, `entryState`, start/turn 오류, mixed-policy fail-closed, terminal 표시를 집중 관측한다. **mixed-policy 1건 또는 진행 세션이 start로 보이는 사례 1건은 즉시 롤백 조건**이다.

### cutover 순간 진행 중 세션

- 같은 KST date의 v2 세션: v2 snapshot + v2 화면 + v2 endpoint로 계속한다. 진행률과 `sessionId`를 바꾸지 않는다.
- 같은 KST date의 v3 세션: v3 snapshot + v3 화면 + v3 endpoint로 계속한다.
- 새로고침/홈 왕복: resolver가 기존 row 정책을 먼저 선택하므로 같은 화면으로 돌아간다.
- terminal v2/v3 세션: 새 정책으로 재시작하지 않고 §4 상태 화면을 유지한다.
- 두 정책 row가 동시에 보이면 자동 치유하지 않고 `unavailable`로 막아 잘못된 미션/보상을 방지한다.

---

## 8. 롤백

### 즉시 유입 차단(1차 롤백)

1. `MISSION_V3_EFFECTIVE_AT`을 **제거(unset)**한 dual-capable 빌드를 배포한다. 미래 시각이나 잘못된 문자열로 바꾸지 않는다. unset이면 신규 판정은 v2로 돌아간다 (`lib/mission-v3/policyResolution.ts:50-54`).
2. `MISSION_SCHEDULE_ENFORCED`와 `MISSION_TIME_GATE_ENABLED`는 동시에 바꾸지 않는다. 시간 문구/진입 조건까지 함께 흔들면 원인 분리가 불가능하다.
3. env가 제거되어도 이미 당일 v3 progress가 있는 아동은 progress sticky로 v3를 계속 drain하고, 당일 v2 progress가 있는 아동은 v2를 유지하며, progress가 없는 아동만 v2로 신규 진입한다 (`lib/mission-v3/policyResolution.ts:117-135`).
4. dual-capable 프론트와 v3 API는 당일 v3 세션이 0이 될 때까지 유지한다. **pre-cutover 바이너리로 즉시 되돌리지 않는다.** 그렇게 하면 v3 row를 가진 아이가 이어갈 화면을 잃는다.

### 완전 복귀(2차 롤백)

1. 다음 KST business date 이후 당일 v3 row 0건과 진행 중 v3 세션 0건을 read-only 확인한다.
2. 그 뒤에도 최소 24시간 dual-capable 빌드에서 v2-only 신규 유입을 관측한다.
3. 필요하면 그 후 pre-cutover 화면 빌드로 되돌린다. DB row, migration, 보상 ledger는 삭제·변환하지 않는다.
4. `/api/config/child-time-restrictions`는 이 drain/관측 기간이 끝난 후에만 제거한다.

### 심각 장애 시 표시 원칙

v3 세션 자체가 손상되어 resume할 수 없는 경우에도 v2 세션으로 위장하거나 새 v2 미션을 만들지 않는다. snapshot을 `unavailable`로 내려 “미션 상태를 확인하지 못했어요. 잠시 후 다시 해 주세요.”라고 표시하고 운영 복구 대상으로 남긴다. 아이에게 틀린 완료·시작 가능 안내를 주는 것보다 명시적 일시 오류가 안전하다.

---

## 9. 위험요소와 승인 지점

| 위험 | 통제 |
|---|---|
| env rollback이 기존 v3 세션까지 v2로 해석 | U1 양방향 sticky resolver 없이는 Production cutover 금지. |
| 구형/캐시 클라이언트가 cutover 뒤 v2 신규 생성 | 24시간 SHA 0건 관측 + U4 legacy start guard 없이는 cutover 금지. |
| home/missions 중간 배포 불일치 | U1~U10을 동일 배포 단위로 고정. |
| `daily_limit_reached` 완료 오표시 | `entryState`와 status를 정본으로 사용하고 불일치 fail-closed. |
| 시간 플래그 동시 변경 | schedule을 먼저 안정화하고 effective-at만 별도 플립. |
| mixed v2/v3 row | 자동 수정 금지, `unavailable`, mixed 1건 즉시 롤백. |

Production env 변경과 Production 배포는 대표 승인 후에만 실행한다. 이 계획은 승인·배포·SQL 실행을 수행하지 않는다.

---

## 10. 완료 조건

- 서버 snapshot 하나로 홈과 미션의 정책·진행·시간·terminal 판정이 동일하다.
- cutover 시점의 당일 v2 진행 세션이 같은 `sessionId`와 진행률로 이어진다.
- rollback 뒤 당일 v3 진행 세션이 v3로 이어지고, 세션 없는 아동만 v2로 돌아간다.
- `COMPLETED`만 완료 문구/보상 UI를 보며 `SAFETY_PAUSED`·`FORCE_ENDED`는 정직한 별도 문구를 보인다.
- `/api/config/child-time-restrictions`를 새 홈·미션 화면이 호출하지 않는다.
- 홈·미션 어느 한쪽만 먼저 배포되는 상태가 없다.
