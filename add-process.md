\# 인박스 (미분류)

<!-- /triage-notes 로 분류·이관한다. 직접 고치지 마라. -->



- [2026-08-13] (1회) v13.2 아카이브 §7 코드베이스 구조 스캔 규칙 / §11 워커 실행 규칙(tmux 세션명 표)은 스킬 4종 어디에도 배정되지 않았다. 옮길 위치 미정 — 대표 판단 필요.
- [2026-08-13] (1회) agy-delegate relay(`relay.mjs`)에는 `--read-only` 옵션이 없다. CLAUDE.md §2-B와 `/delegate-run`의 "읽기형 QA → --read-only" 서술대로 붙이면 `relay: unknown option`으로 즉시 실패한다. relay는 기본적으로 쓰기 권한을 주지 않으므로(=`--dangerously-skip-permissions` 미부여) 읽기 전용은 브리프 문구로 강제하고 플래그는 붙이지 않는다. 규칙 문구 수정 필요.
- [2026-08-13] (1회) agy relay 헤드리스 세션은 셸 명령(Bash/RunCommand) 권한이 자동 거부되며, 한 번 시도하면 그 자리에서 세션이 죽고 `status: failed`가 된다(`ls -la supabase/migrations/202608*`로 실측). 조사·리서치 브리프에는 "셸 명령을 실행하지 마라. 파일 읽기·검색 도구만 써라"를 반드시 넣는다.
- [2026-08-13] (1회) 이 프로젝트에는 eslint 설정 파일이 없다(`eslint.config.*`·`.eslintrc.*` 모두 부재). `npm run lint`는 `next lint`이고 Next 16에서 제거 예정이라 지금은 대화형 프롬프트가 떠서 자동화가 불가능하다. 게이트의 정적 lint가 사실상 비어 있으므로 `npx tsc --noEmit` + `npx next build` 두 가지를 게이트 명령으로 쓴다. `next build`는 500초를 넘길 수 있으니 백그라운드로 돌린다.
- [2026-08-13] (1회) 날짜/시각 환경변수는 반드시 오프셋을 포함한 형식으로 쓴다(`2026-08-14T01:00:00+09:00`). `new Date("2026-08-14T01:00:00")`처럼 오프셋이 없으면 **서버 TZ로 해석**되어 Vercel(UTC)에서 9시간 밀린다. 이 리포의 WSL 로컬은 TZ=KST라 로컬 검증이 **거짓 통과**한다 — 시각 관련 검증은 반드시 `TZ=UTC node -e ...`로 다시 확인한다.
- [2026-08-13] (1회) agy relay를 `nohup ... &`로 디스패치하면 Bash 호출이 즉시 끝나 하베스가 "완료"로 알린다. 실제 워커 완료는 아무도 알려주지 않아 오케스트레이터가 모르고 논다. **디스패치 직후 반드시 `until [ -f <out>/result.json ]; do sleep 15; done`를 `run_in_background: true`로 함께 걸어야** 완료 알림이 온다. 디스패치와 대기를 한 쌍으로 취급한다.
- [2026-08-13] (2회) **이 리포에서 `next build`는 항상 `rm -rf .next` 후 클린 빌드로 돌린다.** 기존 `.next`가 있는 상태에서 소스가 바뀐 뒤 빌드하면 webpack이 `TypeError: Cannot read properties of undefined (reading 'length')` (WasmHash)로 죽는다(2026-08-13 3회 재현, 워커 0개 조용한 창에서도 발생). 클린 빌드는 정상 통과(5.8분). WSL2 drvfs + Node 24 + webpack 캐시 조합 문제로 추정. **코드 결함이나 워커 경합으로 오진하지 말 것.** 또한 `timeout N`으로 감싸 SIGTERM(exit 143)으로 끊으면 `.next` 캐시가 손상되고, 이후 모든 빌드가 `TypeError: Cannot read properties of undefined (reading 'length')` (webpack WasmHash)로 죽는다. **코드 오류가 아니다.** 조용한 창에서 돌려도 재현되며 `rm -rf .next` 후 재빌드하면 정상 통과한다(실측: 5.8분 소요, exit 0). **게이트 빌드에 `timeout`을 걸지 말고 `run_in_background`로 끝까지 돌린다.** 빌드 실패를 코드 결함이나 워커 경합으로 오진하지 말 것.
- [2026-08-13] (1회) 브리프에서 셸 명령을 금지하면 agy는 **테스트를 실행할 수 없다.** 그런데도 보고서에는 "N종 통과"라고 쓴다(실행 결과가 아니라 추정). 실제로 `utteranceSignals` 5종 중 1건이 실패했다. **워커의 테스트 통과 주장은 증거가 아니다. 테스트는 반드시 Claude가 직접 돌린다.** 브리프에는 "테스트를 작성하라"까지만 요구하고 "통과를 확인하라"는 요구하지 않는다(할 수 없는 일을 시키면 거짓 보고를 유도한다).
- [2026-08-17] (1회) 관리자 ManualReportingTab 의 formatDateTime(...).substring(11,19) 은 ko-KR 형식("2026. 8. 17. 오후 9:23:00")을 자르는 것이라 시각이 엉뚱하게 표시된다. 094 범위 밖이라 미수정.
- [2026-08-17] (1회) `/api/admin/child-approval-requests` 의 `.in("family_id", ids)` 는 family 약 200개를 넘으면 URL 길이 한계로 HTTP 414 가 난다. 현재 32개라 여유가 있고 실패해도 fail-open(전부 표시)이라 안전하지만, 승인 요청 가족이 200개를 넘기 전에 배치 조회로 바꿔야 한다.
- [2026-08-18] (1회) **코드는 배포됐는데 마이그레이션이 프로덕션에 안 적용돼 자유대화가 통째로 멈췄다.** `chat_messages.raw_transcript` 가 Dev 에만 있어 `POST /api/chat/messages` 가 전부 500(PGRST204). 어제 374건 → 오늘 0건, 30분 대화한 아이 기록이 통째로 사라졌고 황금열쇠도 못 받았다. 로그를 볼 때까지 아무도 몰랐다 — 클라이언트는 조용히 실패한다. **새 컬럼·테이블을 쓰는 코드를 프로덕션에 올릴 때는 배포 전에 프로덕션 스키마에 그것이 있는지 확인한다.** 확인 쿼리: `select count(*) from information_schema.columns where table_name='X' and column_name='Y'` (`--target=prod`). Dev 에서 통과했다는 것은 프로덕션 스키마에 대한 증거가 아니다.
- [2026-08-19] (1회) requests 폴더 운영: "프로덕션에 배포한 작업"만 `_done/`으로 이동한다. 개발서버에만 배포한 것은 `_done/`으로 옮기지 않고 `requests/`에 그대로 둔다. `_complete/` 이동은 대표님이 수동으로 하므로 Claude는 건드리지 않는다.
