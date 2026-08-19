# Request: 관리자 미션 푸시 테스트 실제 발송 복구 — 084 Main 반영 + VAPID 정합성 + 테스트/정기 로그 분리

## 배경
Production 관리자 `운영 도구 > 푸시 테스트`에서 미션 1/2 즉시 발송 시 `발송 실패`가 발생한다.

Antigravity 진단 결과:
- 084 구조가 Main Repository에 반영되지 않고 `worktrees/req-084`에만 남아 있음
- Main의 `PushTestTab.tsx`는 여전히 `/api/cron/mission-start`를 직접 호출함
- QA 아이 push subscription은 존재하고 활성 상태이나 Provider에서 `PUSH_403 / 403 Forbidden`
- 유력 원인은 VAPID public/private key 미설정 또는 기존 subscription 생성 key와 서버 서명 key 불일치
- 테스트 실패가 scheduled용 `mission_notification_logs`와 섞여 Cron 상태를 오염시킬 위험이 있음

이번 작업 목표:
1. 084 구조 Main 실제 반영
2. VAPID 설정과 QA subscription 정합성 복구
3. admin_test와 scheduled 로그/idempotency 완전 분리

## 1. 금지사항
- Cron 인증 완화 금지
- CRON_SECRET/BATCH_SECRET 클라이언트 노출 금지
- VAPID private key 출력/로그/commit 금지
- push endpoint/p256dh/auth 원문 출력 금지
- Production 전체 push subscription 삭제 금지
- 실제 사용자 subscription 일괄 재등록 금지
- 실제 사용자 테스트 푸시 금지
- PUSH_403 bypass 금지

## 2. Main에 084 구조 반영
현재 HEAD와 `worktrees/req-084`를 diff한 뒤 필요한 변경만 반영한다.

Main에 반드시 존재:
- `app/api/admin/push-test/send/route.ts`
- `lib/mission/missionPushService.ts`

`PushTestTab.tsx`는 `/api/cron/mission-start`를 더 이상 직접 호출하지 않는다.

## 3. 관리자 UI
변경:
`GET /api/cron/mission-start?...`
→ `POST /api/admin/push-test/send`

Body:
```json
{"childId":"...","missionType":1}
```

관리자 session cookie 기반 인증만 사용한다.

## 4. 관리자 전용 API
`POST /api/admin/push-test/send`

필수:
1. `requireAdmin()`
2. body validation
3. child 존재 확인
4. missionType 1/2 검증
5. QA/Internal Test 계정 검증
6. 활성 push subscription 조회
7. 공통 missionPushService 호출
8. Provider 결과 반환
9. admin audit log 기록

실사용자면 403 + `테스트 계정만 발송할 수 있습니다.`

## 5. 테스트 계정 판정
우선:
- `child_profiles.is_internal_test`
- `family_members.is_internal_test`
- 기존 `getTestFamilyIds(...)`

`is_test_account`는 기존 의미 확인 후 보조 조건으로만 사용.

## 6. 공통 missionPushService
책임:
- child lookup
- missionType validation
- round_type 계산
- title/body 생성
- push_subscriptions 조회
- `sendPushNotificationWithRetry()` 호출
- Provider 결과 정규화
- 로그 기록

source:
- `scheduled`
- `admin_test`

를 분리한다.

## 7. VAPID Production 설정 확인
로컬 `.env*`만 보고 Production을 단정하지 않는다.

Vercel Production에서 아래 존재 여부만 확인:
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

값은 출력하지 않고 `설정됨/미설정`만 보고.

## 8. VAPID Pair 정합성
확인:
클라이언트 `pushManager.subscribe()`의 `applicationServerKey`
=
서버 web-push 서명에 사용되는 VAPID public/private pair의 public key

관련 코드의 실제 참조 위치까지 확인한다.

## 9. 기존 Subscription 호환
VAPID key를 변경해야 하는 경우 기존 subscription이 자동 호환된다고 가정 금지.

QA에서만:
`unsubscribe → 새 public key로 subscribe → push_subscriptions UPSERT`
검증.

Production 전체 구독 일괄 삭제 금지.

## 10. Provider 오류 전달
현재 `PUSH_403`이 generic 메시지로 덮인다.

관리자 UI에는 안전한 code와 설명 표시:
- `PUSH_403` → 푸시 인증 설정 불일치
- `NO_SUBSCRIPTION` → 구독 없음
- `PUSH_410` → 구독 만료

Secret/provider endpoint는 숨김.

## 11. sendPushNotificationWithRetry
기존 유틸 재사용.

정규화:
- 2xx success
- 404/410 expired/gone
- 401/403 auth/VAPID
- 429 rate limit
- 5xx provider temporary failure

## 12. admin_test/scheduled 로그 분리
현재 테스트 로그가 scheduled 상태를 오염시킬 수 있으므로 반드시 source를 분리한다.

가능하면:
- `source=admin_test`
- `source=scheduled`

기존 컬럼이 없으면 현재 schema 확인 후 최소 migration만 작성.

Cron의 idempotency/재시도 쿼리에서 `admin_test`는 제외.

## 13. 기존 오염 QA 로그
이미 섞인 로그는 자동 수정 금지.

QA 계정 + 관리자 테스트 시각 + PUSH_403 + audit correlation이 명확한 경우에만 remediation 여부를 판단하고 보고한다.

## 14. Push Test 검색 UX
검색 결과는 QA/Internal Test 계정만 노출하는 방향 권장.

표시:
- 아이 이름
- 로그인 ID
- `[테스트]`
- 푸시 구독 상태

구독 상태:
- 알림 등록됨
- 구독 없음
- 권한 거부
- 구독 만료

활성 구독이 없으면 발송 버튼 비활성 또는 경고.

## 15. 실행 결과
성공 예:
```text
발송 성공
대상: TestA
미션: 1
성공 구독: 1
실패 구독: 0
```

실패 예:
```text
발송 실패
PUSH_403
푸시 인증 설정을 확인해 주세요.
```

## 16. Cron 보안 회귀
반드시 유지:
- Authorization 없음 → 401
- 잘못된 Bearer → 401
- Vercel Cron 정상 호출 → 성공

관리자 API와 Cron 인증 경계를 합치지 않는다.

## 17. Production QA 검증 순서
1. 084 구조 Main 반영
2. Production VAPID 설정 확인
3. VAPID pair 정합성 검증
4. QA subscription 확인
5. 필요 시 QA 기기만 재구독
6. Mission1 발송
7. Provider success
8. 실제 PWA 수신
9. Mission2 동일 검증
10. admin_test 로그 확인
11. scheduled 로그 무오염 확인
12. Cron 인증 회귀

## 18. 수정 대상
최소:
- `app/admin/(dashboard)/PushTestTab.tsx`
- `app/api/admin/push-test/send/route.ts`
- `lib/mission/missionPushService.ts`
- `app/api/cron/mission-start/route.ts`
- `lib/notifications/push.ts`

필요 시:
- PWA subscription 등록 코드
- `mission_notification_logs` source migration

## 19. 완료 조건
- 084 구조 Main 실제 반영
- Cron direct fetch 제거
- 관리자 전용 push API 실제 존재
- missionPushService 실제 존재
- QA/Internal Test 서버 검증
- Production VAPID 설정 확인
- VAPID pair 정합성 확인
- QA subscription 호환 확인
- PUSH_403 해결
- Mission1 실제 수신 PASS
- Mission2 실제 수신 PASS
- Provider 오류 code 관리자 UI 표시
- admin_test/scheduled 로그 분리
- 테스트 발송이 Cron status/attempt_count 오염하지 않음
- Cron Secret 보호 유지
- 실사용자 테스트 발송 0건
- TypeScript 오류 0건
- Build 성공
- Dev E2E PASS
- Production 배포 완료
- Browser Console 401 0건

## 20. 완료 보고
1. 084 Main 미반영 원인
2. 반영 파일
3. 관리자 API 경로
4. 공통 push service 구조
5. Production VAPID 설정 여부
6. VAPID pair 정합성
7. QA subscription 호환 여부
8. PUSH_403 root cause 최종 확정
9. Provider 오류 전달 방식
10. admin_test/scheduled 로그 분리
11. 기존 오염 QA 로그 처리 여부
12. Mission1 Production QA 결과
13. Mission2 Production QA 결과
14. 실제 PWA 수신 결과
15. Cron 보안 회귀 결과
16. 실사용자 발송 차단 결과
17. TypeScript/Build/E2E
18. Production 배포 커밋
19. Deployment ID / READY
20. 남은 위험
