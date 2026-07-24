# K-Bestie-v3 전체 작업 장부 (2026-07-24 15:10 KST 전수 감사)

상태 구분: ①대표님테스트대기 ②개발완료·Dev배포 ③개발진행중 ④검증·빌드·배포진행중
⑤작업예정·미착수 ⑥차단·오류 ⑦보류·중단

## 요약
- 전체 트랙: 14개
- ①대표님테스트대기: 8  ②개발완료·Dev배포: 0(모두 ①에 포함되어 대기중)
  ③개발진행중: 1  ④검증진행중: 0  ⑤미착수: 3  ⑥차단: 0(외부의존 2건은 ⑦로 분류)
  ⑦보류/외부의존: 2

## 지금 바로 테스트 가능한 항목 (Dev: https://k-bestie-v3-dev.vercel.app)
1. **실서비스 미션 개인화+음성토글+이름호칭+마스코트**: 계정 ksh160202(김서현, 비번 기존 그대로)
   또는 ksa160202(김서아, 임시비번 `Ksa160202-Temp!` — 대표님 기존 비번으로 로그인 안 되면
   이걸로 로그인 후 변경) → /child/missions 진입 → "서아야/서현아" 이름으로 인사하는지 →
   답변에 구체적 내용 반영되는지("그렇구나!" 단독 안 나오는지) → 🔊 버튼으로 음성 껐다 켜기
2. **MBTI 통합**: testi02(비번 기존 QA 계정)로 /child/play → MBTI 카드 → 무료체험/차감/이어하기/완료
3. **리텐션 관리자**: /admin/retention → D1/D3/D7/D14/D30 확인 → CSV 다운로드 버튼

---

## 트랙별 상세

### ① 김서아·김서현 실서비스 미션 개인화+질문중복 제거 [P0]
- 상태: **①대표님테스트대기**
- 세부범위: `/api/mission/respond`(15자 제한→항상 "그렇구나!" 폴백) 제거, D/F 검증된
  reaction-lean+2200ms타임아웃+content-echo폴백 이식(!isLive만, tier1/2). 재마운트 시
  질문 중복 발화 버그 수정(askedIndexRef 가드).
- 담당: Claude 직접(설계)+agy(구현) — tmux `agy-mission-personalize`(종료, 정상완료)
- branch: feat/family-backend(메인, 단독소유)
- 마지막 커밋: `3551e9c`
- Dev: https://k-bestie-v3-dev.vercel.app
- Codex: 사용량제한으로 Claude 직접 diff검토 대체(isLive분기 미변경 확인)
- tsc/build: 통과
- DB migration: 없음(코드만)
- 대표님 테스트: 미실시(방금 배포) — Claude가 김서아 계정으로 3턴 자동 스모크: 내용반영 100%,
  "그렇구나!" 단독 0회, 질문 중복 0회 확인. 단 3턴 모두 reaction-lean 개인화 응답이 2200ms
  타임아웃되어 content-echo 폴백("OO 얘기 잘 들었어, 들려줘서 고마워!")만 사용됨 — 폴백
  자체는 내용 반영되지만 더 자연스러운 LLM 리액션은 아직 실사용 조건에서 못 봄(타임아웃 여유
  재조정 필요 가능성, 후속 관찰 대상).
- 차단원인: 없음(폴백 품질 관찰만 필요)
- 다음 실행: 대표님 실기기 재검증, 필요시 타임아웃 값 재조정
- 완료조건: 대표님 확인

### ② 케이 음성 켜기/끄기 통합 [P0]
- 상태: **①대표님테스트대기**
- 세부범위: 별도 화면/세션 없이 한 세션에서 TTS on/off, 끄면 즉시 정지+텍스트 진행,
  진행률/기록/보상 공유. tier1/2만 적용, tier3(김서둥)/Live 미적용.
- 마지막 커밋: `058bdbc`
- Dev: https://k-bestie-v3-dev.vercel.app
- Codex: Claude 직접 검증
- tsc/build: 통과
- DB migration: 없음
- 대표님 테스트: 실기기에서 토글 동작 확인됨(이전 보고) — 단 이 시점엔 ①의 개인화 버그가
  아직 안 고쳐진 상태였음. 지금은 ①까지 합쳐진 상태로 재확인 필요.
- 차단원인: 없음
- 다음 실행: ①과 함께 재검증
- 완료조건: 대표님 확인

### ③ 확정 미션 레이아웃(고정헤더·히스토리페이드·액티브존·마이크파형) [P1]
- 상태: **③개발진행중** (컴포넌트 완성, 미션 화면에 미연결)
- 세부범위: `MissionConversationLayout` 프레젠테이션 컴포넌트(헤더/진행률, 히스토리 opacity
  페이드, 중앙 액티브 발화존+마스코트 슬롯, 하단 마이크 파형) — 순수 UI, 비즈니스로직 없음.
- 담당: agy — tmux `agy-layout`(종료, 정상완료)
- branch/worktree: `.claude/worktrees/track-layout` (branch track-layout)
- 마지막 커밋(worktree): `3937d20`
- Dev: 미배포(아직 MissionInner에 연결 안 됨)
- Codex: Claude 직접 검증(tsc 클린 확인)
- tsc/build: worktree 내 tsc 통과, 메인 통합 후 재빌드 필요
- DB migration: 없음
- 대표님 테스트: 불가(미연결)
- 차단원인: 없음 — Claude가 MissionInner에 실제 연결하는 통합 작업 필요(다음 단계)
- 다음 실행: MissionInner에 이 컴포넌트를 실제로 배치하는 통합 작업(신중한 별도 라운드 필요 —
  기존 동작 회귀 위험 있어 세심한 통합 요구)
- 완료조건: MissionInner 통합 + tsc/build + Dev배포 + 대표님 확인

### ④ 케이 마스코트 스프라이트 애니메이션 [P1]
- 상태: **①대표님테스트대기**
- 세부범위: pet.json/spritesheet.webp/validation.json 기반, canvas 렌더링, 10fps idle루프,
  프리로드+실패시 정적폴백, 탭hidden 일시정지, prefers-reduced-motion 정적프레임.
- 마지막 커밋: `ae827a3`
- Dev: https://k-bestie-v3-dev.vercel.app (MissionInner에 이미 연결됨)
- Codex: Claude 직접 검증
- tsc/build: 통과
- DB migration: 없음
- 대표님 테스트: 미실시
- 차단원인: 없음
- 완료조건: 대표님 확인

### ⑤ 마이크→STT→LLM→TTS 연결품질 안테나 + 아이탓 문구 제거 [P1]
- 상태: 아이탓 문구 제거는 **①대표님테스트대기**, 연결품질 안테나는 **③개발진행중**(훅 완성,
  미연결)
- 세부범위: "잘 안 들렸어/잘 못 들었어" 3곳 중립화(완료, 058bdbc에 포함) / STT·LLM·TTS
  성공·실패·지연 기반 0~5 품질 계산 훅(`usePipelineConnectionQuality`) 신규.
- 담당: agy — tmux `agy-connquality`(종료, 정상완료)
- branch/worktree: `.claude/worktrees/track-connquality` (branch track-connquality)
- 마지막 커밋(worktree): `0be9aa0`
- Dev: 훅 자체는 미배포(MissionInner 미연결), 문구 제거는 058bdbc로 이미 배포됨
- Codex: Claude 직접 검증(tsc 클린)
- DB migration: 없음
- 대표님 테스트: 문구 제거는 미확인, 안테나는 불가(미연결)
- 차단원인: 없음 — MissionInner의 실제 fetch 호출부에 훅을 연결하는 통합 작업 필요
- 다음 실행: MissionInner 통합(③ 레이아웃과 같은 라운드에 함께 처리 권장)
- 완료조건: MissionInner 통합 + Dev배포 + 대표님 확인

### ⑥ 성·이름 분리·호칭·이름질문 제거 [P0]
- 상태: **①대표님테스트대기**
- 세부범위: family_name/given_name 비파괴적 컬럼 추가+안전백필, 부모설정 성/이름 분리 입력,
  toKoreanVocative(서아→서아야, 서현→서현아 확인됨), "너 이름이 뭐니?" 하드코딩 질문을
  given_name 있으면 인사로 대체.
- 마지막 커밋: `ae827a3`(분리), `4a1f9f0`(이름질문 제거)
- Dev: https://k-bestie-v3-dev.vercel.app
- Codex: Claude 직접 검증
- tsc/build: 통과
- DB migration: `20260740000000_child_profiles_name_split.sql` (Dev DB 적용 확인 완료)
- 대표님 테스트: 미실시
- 차단원인: 없음
- 완료조건: 대표님 확인

### ⑦ MBTI 통합 [P0]
- 상태: **①대표님테스트대기** (핵심 기능), **⑦보류/외부의존** (실제 앱 URL)
- 세부범위: 무료체험/골든키3개 원자적차감/idempotency/6시간이어하기/15초INIT타임아웃자동환불/
  완료콜백/PLAY_BUG_REPORT/관리자조회 — 전부 구현+Claude가 testi02로 직접 클릭 검증.
- 마지막 커밋: `e6f1dff`, `468bd77`
- Dev: https://k-bestie-v3-dev.vercel.app (mock-mbti로 폴백 동작 중)
- Codex: 이전 라운드에서 실제 Codex 통과(2라운드) + 이후 Claude 직접 검증
- tsc/build: 통과
- DB migration: `20260739000000_play_iframe_bug_refund_support.sql`(Dev 적용 완료,
  테이블 사전 존재 확인)
- 대표님 테스트: 미실시(testi02로 Claude가 대신 자동검증만 완료)
- 차단원인: MBTI 독립 앱의 실제 Dev URL 미확정(NEXT_PUBLIC_MBTI_APP_URL 미설정) — 대표님/
  MBTI팀에게서 받아야 함, Claude가 임의 생성 불가. frame-ancestors CSP도 MBTI 앱 쪽 소관.
- 다음 실행: 실제 MBTI URL 수신 대기, 김서아·김서현·김서둥 실계정 검증
- 완료조건: 실제 URL 연결 + 실계정 검증 + 대표님 확인

### ⑧ 리텐션 관리자 (D1~D30+CSV) [P1]
- 상태: **①대표님테스트대기**
- 세부범위: 기존 D1/D7에 D3/D14/D30 동일 코호트 정의로 추가, CSV 내보내기(관리자 인증 확인).
  PDF/PNG는 미구현.
- 담당: agy — tmux `agy-retention`(종료, 정상완료) → Claude가 메인 병합
- 마지막 커밋: `7ee96e5`(worktree) → 메인 병합 커밋(직후 배포)
- Dev: https://k-bestie-v3-dev.vercel.app
- Codex: Claude 직접 검증(D1/D7과 동일 로직 확장 확인)
- tsc/build: 통과
- DB migration: 없음(기존 behavior_events 재사용)
- 대표님 테스트: 미실시
- 차단원인: 없음(PDF/PNG만 미구현 — 시간우선순위상 후순위 처리)
- 완료조건: 대표님 확인 (+ 필요시 PDF/PNG 추가 착수)

### ⑨ 퀴즈왕 마스터 통합 [P2]
- 상태: **⑤작업예정·미착수**
- 차단원인: 이 저장소·접근 가능한 서버 어디에도 관련 저장소·스펙이 없음(재확인 완료,
  grep 전체 검색 결과 없음). MBTI처럼 별도 외부 앱 연동으로 추정되나 확정 불가.
- 다음 실행: 대표님이 위치(저장소/스펙 문서/외부 앱 URL)를 알려주셔야 착수 가능.

### ⑩ 공통 놀이 인프라(차감·idempotency·이어하기·환불·버그신고) [P0]
- 상태: **①대표님테스트대기** (⑦MBTI와 동일 커밋, 실질적으로 완료+검증됨)
- 세부범위: ⑦과 동일 — MBTI 트랙에서 함께 완료.
- 완료조건: ⑦과 동일

### ⑪ 김서아=케어스타트·김서현=케어인사이트 요금제 검증 [P0]
- 상태: **①대표님테스트대기**
- 세부범위: Dev DB tier 직접 수정 완료(김서아=1, 김서현=2), voiceMode 매핑 확인(둘 다
  stt_tts 파이프라인 — ①②의 음성토글/개인화 대상 맞음).
- DB 변경: child_profiles.tier 직접 UPDATE(마이그레이션 아님, 1회성 데이터 수정) — Dev만.
- 대표님 테스트: 미실시
- 완료조건: 대표님 확인

### ⑫ testi01/testi02 및 A~F 테스트 화면 보존 상태 [P0 - 무결성]
- 상태: **①대표님테스트대기**(보존 확인 완료, 별도 조치 불필요)
- 확인: `components/TestModeABRunner.tsx`/`TestModeCDRunner.tsx`/`TestModeERunner.tsx`,
  `app/child/test-modes/page.tsx` 전부 파일 존재 확인, 삭제/변경 없음. A~F 관련 최근 커밋은
  이번 세션에서 발생하지 않음(마지막 관련 커밋은 aa7fb63 등 이전 라운드).
- 완료조건: 이미 충족(계속 보존만 하면 됨)

### ⑬ A/B/C/E 신규개발 중단 + 보존 브랜치 [P0 - 무결성]
- 상태: **⑦보류/중단** (의도된 상태)
- 확인: `paused/voice-session-resumption-ab` 브랜치에 A/B 음성 session resumption 작업
  보존됨(커밋 2dc99c7). 이후 A/B/C/E 관련 신규 커밋 없음(전부 D/F·MissionInner·MBTI·
  이름·마스코트·리텐션 트랙만 진행). 김서둥(tier3, Live/A·B 계열 voice_mode)도 요금제
  변경 없이 그대로 유지.
- 완료조건: 유지만 하면 됨(사용자 재개 지시 시까지)

### ⑭ retention/admin/family-backend 기존 미커밋 변경 보존 [P0 - 무결성]
- 상태: **①대표님테스트대기**(보존 확인, 정리 불필요)
- 확인: 세션 시작 시점부터 있던 미커밋 파일들(`app/admin/page.tsx`, `app/api/admin/
  usage-overview/route.ts`, `Plan01/02/03.md`, `outputs/*`, 각종 `repro-*.mjs` 등)을
  이번 세션 내내 건드리지 않고 그대로 보존함(git status로 계속 확인 중). 삭제/덮어쓰기 없음.
- 완료조건: 유지만 하면 됨(대표님이 별도로 커밋/정리 지시 시까지 대기)

---

## 살아있는 tmux 세션
없음 (agy-mission-personalize/agy-layout/agy-connquality/agy-retention 4개 모두
정상 종료 후 검증·커밋·병합 완료 또는 대기 상태로 전환됨)

## 오늘 남은 완료 목표 순서 (우선순위 순)
1. ③⑤(레이아웃·연결품질) MissionInner 실제 통합 — Claude 직접, 신중한 회귀 검증 필요
2. ⑦ MBTI 실제 앱 URL 수신 대기 → 연결 → 김서아/서현/서둥 실계정 검증
3. ⑨ 퀴즈왕 마스터 — 대표님 위치 확인 대기
4. ⑧ 리텐션 PDF/PNG 내보내기(선택)

---
마지막 갱신: 2026-07-24 15:10 KST (Claude, 전수 감사 기준). Codex 사용량 제한으로
검증은 Claude가 직접 diff 검토로 대체 중.
