# Mission v3 Production 전환 인수인계 (2026-08-14)

작성: Claude 세션 종료 시점 10:30 KST. 이후 작업은 Codex가 이어받는다.

## 현재 상태 — 정상 동작 중

Production은 Mission v3로 동작한다. 오늘 완료 2건, 런타임 오류 없음.

| 항목 | 값 |
|---|---|
| `MISSION_V3_EFFECTIVE_AT` | `2026-08-14T00:00:00+09:00` (Production) |
| `MISSION_SCHEDULE_ENFORCED` | Production `true` (09:00~23:50) / Dev `false`(24시간) |
| 최신 커밋 | `9d9a079` 이후 재적용 금지 경고 커밋 |
| 롤백 | 재배포 아님 → `vercel env rm MISSION_V3_EFFECTIVE_AT production` 후 재배포 |

완료 기준: **Goal 10개 생성 / 5개 달성**.

## 반드시 알아야 할 함정

### 1. 완료 기준이 3곳에 흩어져 있다

하나만 고치면 반드시 사고난다. 2026-08-14에 이것으로 3번 장애가 났다.

1. **TypeScript** — `lib/mission-v3/goalEngine.ts` (`CONVERSATION_GOAL_COUNT`, `getCompletionThreshold`), `rewardPolicy.ts`
2. **DB 제약** — `conversation_goals_goal_order_check` (goal_order 상한이 목표 개수를 제한)
3. **DB 함수** — `start_mission_turn_v3`(완료 임계), `award_mission_v3_reward`(목표수 일치 + 임계 + COMPLETED 전이)

현재 전부 `LEAST(5, 목표수)` 기준으로 통일돼 있다.

### 2. ⚠️ `20260812234500_gold_key_active_balance_cap_50.sql` 재적용 금지

이 파일이 `award_mission_v3_reward`를 옛 기준(목표 정확히 4개 / 임계 3)으로 정의한다.
단독 재적용하면 **아이가 미션을 완료해도 황금열쇠가 안 나가고 COMPLETED 전이도 안 된다.**
2026-08-14 01:00에 고친 것이 이 파일 재적용으로 되돌아가 오전에 실제 사고가 났다.

최신 정의: `20260814100500_award_mission_v3_reward_threshold_10_5.sql`
마이그레이션은 **타임스탬프 순 전체 적용**만 하고 개별 파일을 골라 재실행하지 마라.

### 3. SKIPPED는 Goal 종료가 아니다

LLM 판정에서 `SKIPPED`는 "이번 발화와 무관"이라는 뜻이다. 종료는 `SATISFIED`/`DECLINED`뿐.
열린 Goal 판단은 반드시 `isOpenGoal()`(`lib/mission-v3/goalEngine.ts`)을 써라.
이 판정이 두 곳에 복제돼 있어 한 곳만 고쳤다가 재발했고, 그래서 공용 함수로 합쳤다.

### 4. `vercel --prod`는 커밋이 아니라 작업 디렉터리를 업로드한다

반드시 **격리 워크트리**에서 clean checkout으로 배포하라. 리포에 다른 세션의 미커밋
변경(`app/chat/page.tsx` 등)이 남아 있어 그대로 배포하면 검증 안 된 코드가 올라간다.

### 5. `.vercel/project.json`이 세션 간 공유된다

배포 전 `projectName`이 의도한 대상인지 매번 확인하라.
Dev `prj_I9nJJTE0EwJut9M4uHLDaJntXGW0` / Prod `prj_7uTHei8ux61x9wYi9PTWhgqGPRaz`

### 6. 편집 도구가 CRLF를 LF로 바꾼다

`app/child/missions/page.tsx`는 CRLF 혼합 파일이다. 편집 후 `git diff --stat`이
수천 줄로 찍히면 줄바꿈이 전면 변경된 것이니 원본 바이트를 유지하도록 되돌려라.

## 남은 작업

### 검증
- **깨끗한 완주가 아직 0건.** 완주 2건은 둘 다 개입이 있었다(수동 유도 / 서버 직접 완료).
  `박서현`·`TestA`·`TestB`가 오늘 미사용이니 이 중 하나로 개입 없이 완주 확인 필요.
- 자유대화 황금열쇠는 수정 후 Production 실지급 기록이 아직 없다(조건 충족 사용자 미발생).

### 미해결 이슈
- **대화기록이 이전 것으로 표시된다** — 대표님 보고, 미조사.
- 목표 유도 문구를 강화했다(`missionAdapter.ts buildAdapterInstruction`).
  케이 질문이 기계적으로 느껴지면 강도를 낮춰라.

### 큐
- `073`·`101` 완료됐는데 `requests/`에 남아 있다 → `_done/` 이동 + `_log.md` 기록.
- Codex 단독 가능: `025`(PlayModal) · `027`(랜딩 문의) · `028`(CS 알림).
- 미션 파일과 충돌하므로 순차 진행: `075` · `076` · `001`. 실기기 재현이 필요하고,
  과거 "완료" 처리됐다가 실제로는 안 고쳐진 이력이 있다.
- `074` 관계 엔진은 **대표님 승인 대기**(신규 테이블·임계값). 착수 금지.
- 초성게임 4~6단계 미착수.

## 진단 명령

```bash
# 프로덕션 미션 현황
node scripts/run-query.js "SELECT status, count(*) FROM mission_progress WHERE business_date='YYYY-MM-DD' GROUP BY 1;" --target=prod --confirm=PRODUCTION

# 옛 기준 잔존 검사 (0건이어야 함)
node scripts/run-query.js "SELECT proname, prosrc FROM pg_proc WHERE proname IN ('start_mission_turn_v3','award_mission_v3_reward');" --target=prod --confirm=PRODUCTION

# 런타임 오류
npx vercel logs https://app.k-bestie.com | grep -i error
```

`scripts/run-query.js`는 **쿼리가 첫 인자**여야 하고, Production은
`--target=prod --confirm=PRODUCTION`을 뒤에 붙인다. 플래그를 앞에 두면 쿼리로 해석된다.
