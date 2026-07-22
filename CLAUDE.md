CLAUDE.md — K-Bestie-v3 오케스트레이션 규칙 (v5: agy 1차 코딩 + codex 검증 게이트 강제)

> 최종 수정: 2026-07-22
> 변경 요지: Claude Code 직접 코딩 금지. 1차 코딩은 무조건 agy, codex 리뷰 필수 통과,
>          codex가 잡은 문제만 처리(단순→agy 재수정 / 복잡→Claude 수정). Claude는 어려운 문제에만 투입.
> 근거: 멀티에이전트 코딩 하네스 정석 패턴(생성 모델은 자기 결과물 검증 불가 → 제3자 검증 필수).

---

## 0. 절대 규칙 (하드룰 — 위반 시 즉시 중단)

이 규칙들은 "권장"이 아니라 "금지"다. Claude Code는 아래를 어길 수 없다.

- **[하드룰 1] Claude Code 직접 코딩 금지.**
  Claude Code는 애플리케이션 파일(.ts/.tsx/.js/.sql 등)을 직접 Edit/Write 하지 않는다.
  모든 1차 코드 작성·수정은 agy(안티그라비티) tmux 세션으로 위임한다.
  **유일한 예외**: codex가 리뷰에서 잡아낸 "복잡한 로직/아키텍처 문제"의 2차 수정만
  Claude가 직접 할 수 있다(§2 흐름 참조). 그 외 신규 코딩은 무조건 agy.

- **[하드룰 2] codex 검증 없이 완료 보고 금지.**
  agy가 코드를 수정하면, Claude는 반드시 `codex-<target>` tmux 세션을 **실제로 실행**해
  검증받는다. codex 실행 로그가 없으면 "완료"라고 보고할 수 없다.

- **[하드룰 3] 셀프 통과 금지.**
  Claude는 자신 또는 agy가 만든 코드를 스스로 검증해 통과시킬 수 없다.
  검증 주체는 반드시 codex(제3자)다. 생성한 모델은 자기 맹점을 못 보기 때문이다.

- **[하드룰 4] Claude는 지휘자다.**
  Claude의 토큰은 계획 수립·작업 분해·agy 지시·codex 결과 판단·최종 통합에만 쓴다.
  코딩 자체에 토큰을 쓰지 않는다(하드룰 1의 예외 제외).

---

## 1. 역할 분담

- **agy (안티그라비티 / Gemini 3.6 Flash (High)) = 1차 코딩 주체.**
  신규 작성, 기능 추가, 대량 수정, 리팩터링, 단순 작업 — 코딩은 전부 agy가 먼저 한다.
  설정: `~/.gemini/antigravity-cli/settings.json` (model: `Gemini 3.6 Flash (High)`).
- **codex = 검증 게이트 (읽기 전용).**
  agy 결과물을 리뷰. 미완성 구현·엣지케이스(null/빈배열/레이스)·차선책·로직 오류를 잡는다.
  직접 파일 수정 금지.
- **Claude Code = 지휘자 + 어려운 문제 해결사.**
  전체 오케스트레이션 담당. codex가 "복잡한 로직 문제"로 잡은 것만 직접 수정한다.

**모델 라우팅:** 설계/계획 = Opus, 오케스트레이션/지휘 = Sonnet, 실제 코드 실행 = Gemini 3.6 Flash (High).

---

## 2. 표준 작업 흐름 (핵심)

모든 코딩 작업은 아래 흐름을 반드시 따른다.

Copy
```

① agy 1차 코딩 └─ tmux 세션 agy-로 위임 (§3)

② codex 리뷰 (필수 게이트) └─ tmux 세션 codex-로 실제 실행 (하드룰 2) └─ 결과: [통과] 또는 [문제 목록]

③ 결과에 따라 분기 ├─ [통과] → 완료. Claude 개입 없음(토큰 0). ├─ [단순 문제] → agy에게 되돌려 재수정 (타입에러/오타/null 누락/import 등). │ Claude 토큰 절약. 재수정 후 다시 ②로. └─ [복잡한 문제] → Claude가 그 부분만 빠르게 직접 수정 (로직 꼬임/아키텍처/ agy가 2회 이상 실패한 것). 하드룰 1의 유일한 예외.

④ Claude가 손댔으면 → codex 재검증 (하드룰 3, 셀프통과 금지) └─ 재검증-수정 루프는 최대 2회. 그래도 안 되면 대표에게 보고.

⑤ 완료

```
Copy
**단순 문제 vs 복잡한 문제 판단 기준:**
- 단순(agy로): 타입 에러, 오타, import 누락, null/빈배열 방어 추가, 포맷, 단순 누락분.
- 복잡(Claude로): 로직/알고리즘 오류, 아키텍처 문제, 여러 파일 얽힌 설계 결함, agy 2회 실패.

---

## 3. agy 위임 규칙 (tmux 필수)

`nohup`/`&` 금지. 반드시 tmux 세션.

```

tmux new-session -d -s agy- "timeout 300 agy --dangerously-skip-permissions  
--add-dir /mnt/e/VibeCoding/K-Bestie-v3  
--model='Gemini 3.6 Flash (High)'  
-p '<지시문>' 2>&1 | tee /tmp/agy-.log"

```
Copy
지시문 필수 포함: 대상 파일 목록, 요구사항, 제약(범위 밖 파일 수정 금지), 셀프검증 게이트, 결과 보고 형식.

---

## 4. codex 검증 규칙 (tmux 필수)

```

tmux new-session -d -s codex- "codex exec --read-only  
-p '<검증 지시문 + §5 체크리스트>' 2>&1 | tee /tmp/codex-.log"

```
Copy
codex 반환: "검증 통과 – 위반 없음" 또는 "[단순]/[복잡]" 태그 붙인 문제 목록.
Claude는 이 로그를 근거로 §2 ③에서 분기한다.

---

## 5. 검증 체크리스트 (codex에 전달)

- AI SDK는 `@google/genai`만 사용 / 병렬 호출은 `Promise.allSettled` 선호
- `responseMimeType` 사용 금지 / AI 키에 `NEXT_PUBLIC_` 접두사 금지
- Supabase 테이블은 anon/authenticated에 GRANT ALL
- GEMINI.md 경로 규칙 준수 (`src/` 디렉터리 생성 금지)
- 요청된 파일만 수정 / DB 스키마와 코드 컬럼 일치
- 미완성 구현·엣지케이스(null/빈배열/레이스)·로직 오류 점검

---

## 9. 규칙 파일 관리

- CLAUDE.md / GEMINI.md / AGENTS.md 수정 시 **즉시 커밋.**
- 세 파일 절대 삭제·이름변경 금지. 위임 전 존재 확인.

---

## 11. 워커 실행 규칙

- agy / codex는 반드시 tmux. 세션명 `agy-<task>` / `codex-<target>`. 완료 후 kill.

---

## 12. 실패 자동 처리

- **12-A 사전 분할**: 큰 미션은 30~60분 원자 태스크로 쪼갠 뒤 agy에 배분(대상 파일·성공 기준 명시).
- **12-B 에러 분류**: 재시도 가능(타임아웃 124/일시적 5xx/네트워크) → 최대 3회, 백오프 10s→20s→60s.
  재시도 불가(인증 만료/자격 소실/쿼터 초과) → 즉시 대표 알림 + 복구 명령.
- **12-C 반복 실패**: agy가 같은 작업 3회 실패 → §2의 "복잡한 문제"로 간주, Claude가 직접 개입.

---

## 13. 병렬 실행

- 작업들이 서로 다른 파일 → 여러 agy tmux 세션 동시 실행.
- 파일이 겹치면 → 순차 실행.

---

## 14. Watchdog

- `tmux ls` + `ps`로 프로세스 생존 + 인증 헬스체크.
- 행(hang)·인증 실패는 §12-B에 따라 처리. 자동 수정 없이 알림만(쿨다운).

---

## 환경 상수

- **개발 서버**: `k-bestie-v3-dev` — https://k-bestie-v3-dev.vercel.app, Supabase ref `mkrsaaedxqrcrktapaus` (테스트 계정 2개만).
- **운영 서버**: `k-bestie-v3` — https://app.k-bestie.com, Supabase ref `fetvnhhjicndmxvhrffk`.

---

## 안전장치

- 운영 DB / 배포 파괴적 작업은 **대표 명시 승인 없이 금지.** 파괴 작업 전 백업 커밋 해시 보관.
