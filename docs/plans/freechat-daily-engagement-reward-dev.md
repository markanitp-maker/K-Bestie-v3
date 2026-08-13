# 자유대화 황금열쇠 일일 참여 보상 누락 복구 — Dev 전용 실행 계획

## 범위와 불변조건

- Development에서만 구현·검증한다.
- Production deploy, Production DB migration, Production env 변경, 누락 기간 backfill은 수행하지 않는다.
- 적격성은 기존 `complete_freechat_daily_engagement` RPC가 판정한다. 클라이언트 `turnCount`는 세션 메타 갱신용 힌트일 뿐 보상 판단에 사용하지 않는다.
- `20260810170000_mission_event_daily_activity_policy.sql`과 후속 `20260812234500_gold_key_active_balance_cap_50.sql`은 Dev 적용 완료 상태이므로 재적용·복제하지 않는다.
- 기존 `app/chat/page.tsx`의 미커밋 키보드 padding 변경은 보존하며 이번 기능 커밋에 포함하지 않는다.

## 변경 파일

1. `components/rewards/GoldKeyRewardModal.tsx`
   - Mission 보상 모달의 키·+1·animation·focus trap·접근성 패턴을 공통 컴포넌트로 추출한다.
2. `app/child/missions/page.tsx`
   - 기존 Mission 동작/문구를 바꾸지 않고 공통 모달을 사용한다.
3. `app/api/chat/pause/route.ts`
   - RPC 성공 결과에 서버가 조회한 실제 활성 balance, 지급량, reward type, KST business date를 포함한다.
   - RPC/잔액 조회 실패는 서버 로그에 남기되 대화 종료 자체와 분리한다.
4. `lib/freechat/dailyEngagementReward.ts`
   - pause 응답의 런타임 파싱과 `earned === true`일 때만 모달을 여는 결정을 단일화한다.
5. `lib/freechat/dailyEngagementReward.test.ts`
   - 지급/이미지급/오류 응답의 UI 결정 계약을 검증한다.
6. `app/chat/page.tsx`
   - pause 실패를 `console.error`로 관측하고 대화 화면은 유지한다.
   - 서버 응답이 실제 지급(`earned === true`)일 때만 공통 황금열쇠 모달을 1회 표시한다.
7. `app/api/chat/pause/route.test.ts`
   - 서버 판정 위임, 응답 계약, 실패 로그 경로를 정적으로 검증한다.
8. `app/chat/freechatRewardIntegration.test.ts`
   - pause 실패 관측성, earned-only UI, 동일 세션 요청 가드, 메시지 저장 정착 순서를 검증한다.
9. `supabase/migrations/tests/mission_event_daily_activity_verification.sql`
   - migration을 재적용하지 않고 rollback fixture로 60초+2턴, Mission/Free Chat 동시 지급을 보강한다.
10. `scripts/qa-freechat-daily-engagement-dev.js`
   - Development 프로젝트를 고정하고 동시 RPC 2건이 ledger 1건만 만드는지 검증 후 fixture를 삭제한다.

## 정적 리뷰 반영

- Free Chat 종료 전에 해당 화면에서 시작한 `chat_messages` 저장 Promise를 모두 정착시켜 세 번째 meaningful turn 저장과 RPC 집계의 경쟁을 제거한다.
- `/api/chat/pause`가 최초 `ended_at`을 조건부 원자 업데이트로 고정하고 이후 retry/concurrent 요청은 같은 시각을 재사용해 KST 자정 경계에서도 동일 session의 business date가 바뀌지 않게 한다.
- 활성 잔액은 RPC 완료시각이 아니라 실제 조회시각을 기준으로 계산한다.
- service-role로 최초 완료시각을 고정하기 전에 사용자 접근권한과 `free_chat` 세션 유형을 검증한다.

## 검증

- 타입체크와 관련 Node 테스트.
- 기존 Mission reward presentation 테스트 회귀.
- Dev DB READ-ONLY로 migration 적용 로그, 최종 RPC 본문, advisory lock, Free Chat/Mission 부분 유니크 인덱스를 확인한다.
- Dev 트랜잭션 rollback 테스트로 60초/3턴 경계, same-day, next-day, Mission 공존을 확인한다.
- 별도 동시 RPC 검증으로 두 탭/재시도 상당의 concurrent 요청에서도 원장 +1만 확인한다.
- 별도 agy E2E QA로 실제 Free Chat 지급 모달 1회와 API 실패 로그를 확인한다.

## 완료 상태

모든 Dev 게이트 통과 후에도 `WAITING_FOR_OWNER_QA`로 두며 Production은 변경하지 않는다.
