# 보류된 작업 백로그 (2026-07-20 Task 패널에서 이관)

대표님 요청으로 Claude Code 하단 Task 패널을 숨기기 위해, 기존에 등록돼 있던 태스크 정보를 여기 보존한 뒤 Task 시스템에서 전부 삭제/비활성 처리했다. 진행 상황은 이제 답변 본문에 4개 버그 상태표로만 표시한다. 아래 내용은 대표님이 다시 요청하실 때까지 참고용으로만 유지.

## 완료된 작업 (오늘, Dev 검증 완료)

- **#34** Register shared Prod AI keys on Dev Vercel — 완료
- **#35** Write dev-external-services-migration.md checklist — 완료 (`docs/dev-external-services-migration.md`)
- **#36** Redeploy Dev once with new AI env vars — 완료
- **#37** Verify freechat real Korean voice pipeline on Dev — 완료 (STT 무응답 무한침묵 버그, 리액션 중복생성 버그 수정+검증)
- **#38** Build/verify auto-manual voice mode switch (mission+freechat) — 완료 (`VoiceInputModeSwitch` 컴포넌트, STT/TTS 모드 확장)
- **#39** Fix mission question count regression (5/10 -> 10/10) — 완료
- **#40** Full Dev verification pass (today's scope only) — 완료
- **#41** Tag rollback point and deploy to Production — 완료 (`rollback-pre-alpha-test-20260721`, `rollback-pre-child-test-20260720` 태그, 이후 커밋도 반영)
- **#42** Production smoke test (형진님 family accounts only) — 완료
- **#43** Check batch schedule status, run manual batch if needed — 완료 (04:00 KST 스케줄/날짜계산 이슈 발견, 수동 실행은 보류)
- **#45** Alpha mission 10Q dry-run on Dev — 완료 (46개 질문 시딩, 10/10 완주+골드키 지급 확인)

## 보류 중 — [대표님 승인 후 프로덕션 이관]

- **#44** 서아/서현 최종 상태표 작성 — 개발 서버 통과 + 대표님의 프로덕션 배포 명시적 승인 전까지 착수 안 함. 승인 후 2026-07-21 리포트 생성·검증 완료 시점에 작성.
- **#46** daily_reports.viewed_at 마이그레이션 → 프로덕션 서버 — Dev 적용·200 검증 이미 완료(`supabase/migrations/20260721300000_daily_reports_viewed_at.sql`). 승인 후 프로덕션 서버(k-bestie-v3/fetvnhhjicndmxvhrffk)에 동일 SQL 적용 예정. 롤백 SQL: `ALTER TABLE daily_reports DROP COLUMN IF EXISTS viewed_at;`

## 진행 중 — [개발 서버 안서둥 검증] (현재 활성 작업, 답변 본문 상태표로 추적)

- **#47** 미션/음성/PWA P0 통합 수정 및 실기기 재테스트 준비 — 4개 버그로 세분화되어 계속 진행 중:
  1. 수동 모드 다음 턴 마이크 잠김
  2. 갤럭시 Android Tier 3 케이 음성 미출력
  3. 미션·자유대화 중 화면 자동 잠금 방지
  4. 케이 질문 발화 길이 축소
  - 백그라운드 에이전트 `afd55ecc2386ffea1`이 계속 작업 중(중단하지 않음).
  - PWA 아이 계정 설치 기능은 별도 에이전트(`acbff40e4f1a37330`)가 완료·검증 완료.

## 별도 백로그 (오늘 범위 아님, 명시적으로 제외됨)

- `family_join_requests`-`families` FK 관계 누락으로 인한 `/api/family-join-requests/incoming` 500 에러 — 스키마 관계 추가 필요, 별도 마이그레이션 필요.
- Tier 3 Live 경로 전체 기술 검증 — 오늘은 안서둥 실사용 테스트로 발견된 문제만 수정, 전면 검증은 별도 백로그.
- 04:00 KST 배치 스케줄이 실제로는 03:00 KST로 조정되어야 한다는 미적용 마이그레이션(`20260725500000_batch_schedule_kst_adjust.sql`, "실행 금지 — 대표 승인 후 직접 실행"으로 표시됨) — 미적용 상태 유지.
- `daily-batch` 함수의 `kstToday()`가 "어제"로 보정하지 않아 04시 근처 실행 시 잘못된 날짜를 집계할 수 있는 문제 — 수동 `date` 파라미터로 우회 가능하나 근본 수정은 안 함.

## §23 비용/손익 관리자 — 후속 고도화 백로그 (2026-07-22 Deep Interview에서 이번 범위 명시 제외)

Plan01 §23 이번 2주 범위는 "리포팅 대시보드 + 기간·서비스·A~E 필터 + 드릴다운 + CSV/XLSX 내보내기"까지로 확정. 아래는 후속 고도화 항목으로만 기록(이번 착수 안 함):

- **예산 임계치 + 자동 알림** — 일/월 비용이 설정 임계치 초과 시 관리자 알림(앱 내/이메일). 신규 배치·알림 채널 필요.
- **실시간 환율(FX) 연동** — 현재 `USD_TO_KRW=1400` 고정. 실시간/일별 환율 소스 연동은 후속.
- **실청구 배분 정밀화(4종 전체)** — BigQuery `billing_export`에는 STT·TTS·Live(Audio/Text In·Out)·LLM(Text In·Out·Thinking) SKU가 모두 존재해 **회사 전체·서비스·SKU 단위 실청구는 조회 가능**하다. 다만 회사 전체 청구서라 **A~E 모드·아이·가족·세션 단위 실청구는 직접 식별 불가** → 현재는 `usage_events` 사용량 비중 기반 '배분 추정액'으로 제공. 더 정밀한 배분 근사 방법론(예: 세션 길이·토큰 가중)은 후속 과제.
- **[승인 게이트] `GCP_BILLING_*` SA 키/IAM 설정** — 새 자격증명 필요 → 대표님 승인 후에만. 미설정 시 대시보드 '설정 안 됨' 안전 표시(현행 유지).

## A~E 대화엔진 — 후속(2026-07-22 E안 오케스트레이션 완료 후 남은 작업)

- **demo_mode 리포트 제외 배선(기존 갭)** — `chat_sessions.demo_mode`(20260729 추가)가 어떤 리포트/집계 쿼리에도 필터로 배선돼 있지 않음(코드 전체에서 report 측 참조 0건). 테스트 미션 세션이 정식 일일·주간 리포트에서 실제로 제외되려면 `lib/batch/generateDailyReports`·`supabase/functions` 등 리포트 집계 chat_sessions 조회에 `demo_mode=false` 필터 추가 필요. (테스트 계정은 별도 가족이라 실사용자 리포트 오염은 없음.)
- ~~**E안 클라이언트 UI**~~ **완료(2026-07-22)** — **`/child/missions` 실제 실행 경로에 연결**: 기본 export를 `MissionRouteGate`로 교체해 테스트계정+E override면 `components/TestModeERunner`(공통 오케스트레이터 test-mission/start→answer→respond→chat/messages 재사용, TTS 없음, conversation_mode='E' 태깅) 렌더, **일반 계정은 기존 `MissionInner` 그대로(게이트가 'e' 확정 전엔 미마운트 → 회귀 없음)**. 검증: 헤드리스 10턴/100%/황금열쇠·chat_messages turn_id·display_sequence·restore, dev server respond LLM + usage_events(conversation_mode='E', kind='llm'), **Playwright: /child/missions에서 testi01=E안 렌더+흐름, 일반아이=E안 아님(회귀X), 10턴 완주(완료UI·황금열쇠) ALL PASS**, codex 통과(2건 지적→수정→재검증). 남은 것: 실제 사람 음성 STT만 대표님 브라우저·마이크 확인.
- **C·D안** — STT→LLM→TTS 파이프라인 전송 + TTS on + D는 아이 말풍선만 숨김(발화 저장·유효성·진행률·usage_events 유지). 기존 useVoiceChat 재사용.
- **A·B안** — Gemini Live 전송 + barge-in + 응답종료 후 다음입력 + B는 아이 말풍선만 숨김. 기존 useGeminiLive 재사용.
- **실음성·barge-in 검증** — STT/TTS/Live 실동작은 헤드리스 불가 → 대표님 브라우저·마이크 검증(Dev/Preview).
