# K-Bestie-v3 작업 현황 장부 (2026-07-24)

단계: 요청확정 → 개발중 → Dev배포 → 대표님테스트 → 통과
완료 근거 없는 항목은 "통과"로 표기하지 않는다. 각 항목에 커밋 SHA/배포 URL/근거를 명시한다.

## ① MBTI 메인 앱 통합
- 단계: **Dev배포** (대표님 테스트 대기)
- 브랜치: feat/family-backend (병합 완료, worktree agent-abff341a4bcc86362는 보존)
- 커밋: e6f1dff(메인 병합), 468bd77(완료 콜백 누락 수정)
- Dev: https://k-bestie-v3-dev.vercel.app
- 완료: 공통 놀이 시작 RPC, 무료체험/골든키 3개 원자적 차감, idempotency, 6시간 이어하기,
  MBTI_INIT/READY/ACK 15초 타임아웃+자동환불, MBTI_ERROR(stage=init) 자동환불, 완료 콜백,
  PLAY_BUG_REPORT, 관리자 조회 화면. testi02로 무료체험/골든키차감/중복클릭/이어하기/완료/버그신고
  실제 클릭 검증 완료(이 세션에서 직접 확인).
- 미완료(외부 의존): MBTI 앱 실제 Dev URL(팀에서 받아야 함, 현재 로컬 mock 폴백),
  frame-ancestors CSP(MBTI 앱 쪽 소관으로 추정, 이 저장소에 없음).
- 실계정(김서아/서현/서둥) 검증: **미실시** — 다음 착수 대상.

## ② 리텐션 관리자·집계·드릴다운·내보내기
- 단계: **개발중** (Phase 1-3 부분 완료, Phase 4-5 미완료)
- 커밋: 8e5f4d5~08946c0 (Phase 1-2 계측+집계 API 10개 완료)
- 완료: behavior_events 계측, 전체현황/코호트/부모·아이 리텐션/가족상세/기능실험 API 7개.
  app/admin/retention/page.tsx(f894788) 기본 대시보드 존재.
- 미완료: 대시보드가 D1/D7만 표시(D3/D14/D30 없음), 10개 API 중 드릴다운 UI로 연결된 것은
  일부뿐(children/families/parents 상세 페이지 미확인), CSV/PDF/PNG 내보내기 전혀 없음,
  실제 Dev 데이터로 검증 안 됨.
- 우선순위: MBTI 실계정 검증, 음성 레이아웃보다 낮음(대표님이 최근 세션에서 우선순위 밖에 둠) —
  단, 이번 지시로 병렬 재개 대상에 포함됨.

## ③ 실제 운영 통합 미션 화면 (D 기본 + 케이 음성 끄기=F1)
- 단계: **Dev배포** (대표님 테스트 대기)
- 커밋: 058bdbc
- Dev: https://k-bestie-v3-dev.vercel.app
- 완료: 별도 화면/세션 없이 하나의 세션에서 음성 on/off 토글, 끄면 즉시 재생 중단 후 텍스트만
  진행(sayText, TTS 미호출), 다시 켜면 다음 응답부터 음성 재생, 질문진행률/기록/보상 상태 공유.
  tier1(김서아)/tier2(김서현) 파이프라인 경로에만 적용, tier3(김서둥, Live/A·B 계열)은 영향 없음
  (요금제 자체가 실시간 음성이라 이번 토글 대상 아님 - 실제 설정 그대로).
- 미완료: 실사용자 스모크테스트 없음.

## ④ 새 미션 레이아웃·케이 스프라이트 애니메이션
- 단계: 마스코트 애니메이션 **Dev배포**, 레이아웃 개편(헤더고정·히스토리 페이드·중앙 액티브존·
  마이크 파형)은 **개발중 착수 전**
- 커밋: ae827a3 (KBestieMascotAnimation)
- Dev: https://k-bestie-v3-dev.vercel.app
- 완료: MissionInner의 정적 마스코트 자리를 캔버스 기반 스프라이트 애니메이션으로 교체
  (idle 10fps 루프, 프리로드, WebP 실패 시 정적 폴백, 탭 hidden 일시정지/복귀 재개,
  prefers-reduced-motion 정적 프레임). public/Mascot(대표님 제공 pet.json/spritesheet.webp/
  validation.json) 그대로 사용, 원본 캐릭터 변형 없음.
- 미완료: 전체 화면 레이아웃 재구성(고정 헤더+진행률, 히스토리 존 opacity 페이드, 중앙
  액티브 발화존+꼬리 말풍선, 하단 마이크 파형)은 아직 시작 전 — 다음 착수 대상.

## ⑤ D/F 파이프라인 연결 품질 안테나 (실서비스 화면)
- 단계: **요청확정** (미착수)
- 참고: A/B 테스트 화면용 ConnectionQualityIndicator는 이미 존재(components/
  ConnectionQualityIndicator.tsx)하나 WebSocket/Live 전용 지표 계산 로직이라 그대로 재사용
  불가 — STT/LLM/TTS 파이프라인용 새 지표 계산이 필요. 아직 설계만 되고 구현 착수 전.

## ⑥ 아이 성·이름 분리·호칭·이름질문 제거
- 단계: **Dev배포** (대표님 테스트 대기)
- 커밋: ae827a3(성/이름 분리), 4a1f9f0(이름질문 제거)
- Dev: https://k-bestie-v3-dev.vercel.app
- 완료: child_profiles.family_name/given_name 비파괴적 추가(마이그레이션
  20260740000000, Dev DB 적용 완료) + 순수 한글 2~4자 이름 안전 백필(김서아/서현/서둥/
  testi01 홍길동 확인됨) + 부모 설정 성/이름 분리 입력 UI + 호격 헬퍼(koreanName.ts).
  실서비스 확인된 버그 수정: `app/child/missions/page.tsx`가 매 새 세션마다 Q1을
  "안녕~ 난 케이야. 넌 이름이 뭐니?"로 하드코딩 - DB로 김서둥 12회/김서현 4회 실제
  반복 확인됨. given_name 있으면 호격 인사 후 원래 첫 질문 이어가도록 수정, 없으면
  기존 동작 유지(하위호환).
- 미완료: reaction-lean 등 LLM 프롬프트 레벨에서 "이름이 뭐니"류 질문을 스스로 생성할
  가능성은 별도 미확인(D/F 테스트에서는 프롬프트가 새 질문 생성 자체를 금지하므로
  낮은 위험으로 판단) — 실사용자 대화 다회차 관찰 필요.

## ⑦ 김서아·김서현·김서둥 실계정 통합 검증
- 단계: **개발중** (요금제 조정 완료, 화면 기능 배포 완료, 종단 테스트 미실시)
- 완료: 요금제 Dev 반영(김서아=케어스타트, 김서현=케어인사이트, 김서둥=케어프리미엄 유지),
  로그인 계정 확인(ksa160202/ksh160202/ksd160202).
- 미완료: 로그인→실제 미션 화면 진입→이름만 호칭→음성 on/off→10문항 완료→보상 지급까지
  실제 자동/수동 검증 없음. 기존 활성 세션(김서둥 다수 in_progress, 김서현 일부)이 새 검증에
  섞이지 않게 하는 처리도 아직 없음.

## ⑧ 퀴즈왕 마스터 통합
- 단계: **요청확정** (미착수)
- 기존 저장소/스펙 확인 안 됨 — MBTI와 같은 공통 놀이 인프라(consume/refund/progress/
  bug-report) 재사용 대상.

## ⑨ 공통 놀이 인프라
- 단계: **Dev배포** (MBTI 트랙과 함께 완료됨)
- 커밋: e6f1dff, 468bd77
- 완료: 무료체험 원자적 차감, 골든키 3개 원자적 차감, idempotency_key 중복 방지, 6시간
  이어하기 무재차감, 완료 콜백, 초기 실패 자동환불, PLAY_BUG_REPORT, 관리자 조회 —
  testi02로 직접 실측 검증됨(이 세션에서).

---

## 진행 중인 병렬 에이전트 (2026-07-24 14:54 시작)

| tmux 세션 | 담당 트랙 | worktree/브랜치 | 소유 파일 |
|---|---|---|---|
| agy-mission-personalize | ①(신규 발견) 실서비스 MissionInner 개인화+중복질문 수정 | 메인 저장소(feat/family-backend) | app/child/missions/page.tsx (단독 소유, tier1/2만) |
| agy-layout | ④ 미션 레이아웃 컴포넌트 | .claude/worktrees/track-layout (branch track-layout) | components/MissionConversationLayout.tsx (신규) |
| agy-connquality | ⑤ 파이프라인 연결 품질 훅 | .claude/worktrees/track-connquality (branch track-connquality) | hooks/usePipelineConnectionQuality.ts (신규) |
| agy-retention | ② 리텐션 D3/D14/D30+CSV 내보내기 | .claude/worktrees/track-retention (branch track-retention) | app/admin/retention/page.tsx, app/api/admin/retention/route.ts, app/api/admin/retention/export/route.ts (신규) |

파일 소유권: app/child/missions/page.tsx는 agy-mission-personalize만 수정한다.
layout/connquality 트랙은 새 독립 파일만 만들고 missions/page.tsx에 아직 연결하지
않는다(연결은 트랙①이 완료된 뒤 Claude가 직접 통합). retention 트랙은 완전히 다른
파일 집합이라 충돌 없음.

**신규 발견(이번 라운드)**: 실제 운영 MissionInner는 D/F 테스트 화면이 쓰는
`answer-lean`/`reaction-lean`이 아니라 구버전 `/api/mission/answer`+`/api/mission/respond`를
쓰고 있었다 — `respond`의 15자 제한이 비현실적으로 타이트해 거의 매 턴 "그렇구나!"로
폴백(김서아·김서현 실제 세션에서 100% 재현 확인). 재접속 시 같은 질문이 반복 출제되는
버그도 같은 파일에서 확인(`askedIndexRef` 재마운트 시 초기화). agy-mission-personalize가
이 두 가지를 함께 수정 중.

⑥ 이름 요구사항 관련 추가 확인: 이번 라운드 지시에서 "김서아=서아야·김서현=서현아"
호칭이 재확인됨 — 이미 배포된 toKoreanVocative()가 정확히 이 결과를 내는지(받침
없는 "서아"→서아+야, 받침 없는 "서현"→서현+아... 실제로 "서현"은 받침 없는
음절로 끝나 "서현아"가 맞는지 재확인 필요, "서아"도 마찬가지) 병렬 트랙 완료 후 직접
재확인 예정.

⑧ 퀴즈왕 마스터: 여전히 이 저장소·접근 가능한 서버 어디에도 관련 코드/스펙 없음(재확인).
착수하려면 대표님이 위치를 알려주셔야 한다 — MBTI처럼 외부 앱 연동으로 추정되나 확정
불가.

---
마지막 갱신: 2026-07-24 (Claude, 이 세션). Codex 사용량 제한으로 검증은 Claude가
직접 diff 검토로 대체 중.
