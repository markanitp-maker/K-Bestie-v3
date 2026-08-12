# 협업 체계 개편: tmux send-keys 폐기 → 공식 위임 통로

## 배경
지금까지 codex/agy 워커를 tmux send-keys로 굴려왔다. 이 방식은 완료·실패 반환 채널이 없어
워커가 끝났는지 죽었는지 알 수 없었다. 이 구조를 폐기한다. 대체 수단 두 개는 이미 검증됐다.

- Codex: OpenAI 공식 플러그인 (`/codex:setup` 통과, `/codex:status` 표 출력 확인)
- AGY: agy-delegate 스킬 (`agy` = /home/home/.local/bin/agy, 인증 정상, 모델 목록 확인)

환경: Windows 10 + WSL(Ubuntu), 저장소 /mnt/e/VibeCoding/K-Bestie-v3, bash 기준.
Windows 네이티브 경로(C:\)나 PowerShell 명령은 쓰지 않는다.

## 원칙 (모든 위임 공통)
1. 워커는 브리프에 적힌 것과 워크스페이스에서 직접 볼 수 있는 것만 안다.
   대화 히스토리가 공유되지 않으므로 필요한 맥락은 전부 브리프에 적는다.
2. 워커는 커밋하지 않는다. 커밋은 리뷰한 자(너)의 몫이다.
3. 워커의 자기 보고를 신뢰하지 않는다. 게이트(타입체크·린트·테스트)는 네가 직접 다시 돌린다.
4. 브리프 1개 = 작업 1개. 묶지 않는다.
5. 브리프는 프로세스 목록(ps)에 노출되므로 시크릿을 넣지 않는다.
   또 120KB를 넘으면 거부되므로 큰 맥락은 파일로 두고 경로만 알려준다.

## 역할 분담
- Codex = 리뷰어 / 구조자. 코드 리뷰, 설계 반론, 버그 조사, 막힌 작업 인수.
- AGY = 구현자. 범위가 명확한 구현·리팩터·수정. 모델은 gemini-3.6-flash-high 기본.
- 너(Claude Code) = 오케스트레이터. 브리프 작성, 결과 검증, 게이트 실행, 커밋.

## Codex 사용법
| 명령 | 용도 |
|---|---|
| `/codex:review --background` | 현재 작업물 리뷰 (읽기 전용) |
| `/codex:review --base main --background` | 브랜치 전체 리뷰 |
| `/codex:adversarial-review --background <초점>` | 설계·트레이드오프 반론 리뷰 |
| `/codex:rescue` | 코덱스에 작업 위임 (버그 조사, 수정 시도) |
| `/codex:status` | 진행 상태·경과 시간 확인 |
| `/codex:result` | 완료된 결과 수령 |
| `/codex:cancel <job>` | 중단 |

규칙:
- 리뷰는 항상 `--background`로 던지고 다른 일을 한다. 붙잡고 기다리지 않는다.
- `/codex:status`가 running이면 정상 진행이다. 결과가 없다고 재실행하지 않는다.
- adversarial-review는 배포 직전 게이트에서 쓴다. 초점을 반드시 명시한다
  (예: 인증 우회, 데이터 손실, 롤백 경로, 레이스 컨디션).

## AGY 사용법
호출: `$agy-delegate` 스킬을 쓴다. relay.mjs가 agy --print를 감싸고 result.json을 쓴다.

```bash
node "<skill-dir>/scripts/relay.mjs" --brief brief.txt --cd /mnt/e/VibeCoding/K-Bestie-v3 \
  --model gemini-3.6-flash-high
```

권장 옵션:
- `--print-timeout 30m` (릴레이 기본값이 30m이므로 보통 생략 가능)
- `--timeout 31m` : agy가 자체 타임아웃을 넘겨 멈출 때 프로세스 트리를 죽이는 감시자.
  이걸 안 걸면 무한 대기 위험이 있다.
- `--resume-last` : 재작업(rework) 시. 델타 브리프만 보낸다. 전체를 다시 쓰지 않는다.
- `--dangerously-skip-permissions` : **금지.** 대표님이 명시적으로 허락하지 않으면 쓰지 않는다.

result.json 판정 (이것만 신뢰한다):
| status | 의미 | 조치 |
|---|---|---|
| completed | 정상 종료 | touchedFiles로 diff 리뷰 시작 |
| failed | 실패 또는 권한 자동 거부 | 원인 확인 후 보고. 자동 재시도 금지 |
| timeout | 시간 초과 (프로세스 강제 종료됨) | 보고. 브리프 범위를 쪼갤지 판단 |
| aborted | 중단됨 | 보고 |
| agy_unavailable | agy 실행 불가 (exitCode 127) | 즉시 보고. PATH 문제 |

중요 — 헤드리스 권한 자동 거부:
agy는 --print 모드에서 승인을 물어볼 수 없어 쓰기 권한을 자동 거부할 수 있다.
릴레이는 이 경우를 completed가 아니라 **failed로 보고**한다. 이게 이 스킬을 쓰는 핵심 이유다.
`touchedFiles`가 `[]`(빈 배열)이면 git은 정상 동작했고 트리가 깨끗하다는 뜻 = AGY가 아무것도
고치지 않았다는 뜻이다. status가 completed여도 touchedFiles가 비어 있으면 작업 미수행으로 본다.
`null`이면 git 자체가 보고를 못 한 상태다.

## 표준 협업 루프
1. 너가 브리프를 쓴다. 목표 / 현재 상태 / 바꿀 것 / 건드리지 말 것 /
   실제 게이트 명령어 / 보고 계약을 포함한다. "커밋하지 말라"를 명시한다.
2. AGY에 디스패치한다. 백그라운드로 돌리고 다른 일을 한다.
3. result.json을 읽는다. status와 touchedFiles를 확인한다.
4. diff를 직접 읽고 게이트를 직접 돌린다. AGY 보고는 근거로 쓰지 않는다.
5. 배포 전이면 `/codex:adversarial-review --background`로 반론 리뷰를 받는다.
6. 통과하면 너가 커밋한다.

## 금지
- tmux send-keys로 codex/agy에 새 작업을 지시하는 것 (기존 방식 폐기)
- 완료 판정을 pane 텍스트로 추정하는 것
- result.json 없이 완료 보고하는 것
- status=failed/timeout에서 자동 재시도
- --dangerously-skip-permissions 무단 사용
- 워커가 커밋하도록 브리프에 지시하는 것

## 규칙 파일 반영
- CLAUDE.md: 워커 위임은 codex 플러그인 또는 agy-delegate 경유만 허용. tmux send-keys 금지.
- AGENTS.md: Codex 역할을 리뷰어·구조자로 재정의. 위임 명령어 표 삽입.
- GEMINI.md: AGY 역할을 구현자로 정의. 모델 gemini-3.6-flash-high.
  status/touchedFiles 판정 기준 삽입. 자기 보고 신뢰 금지 조항 추가.

## 첫 작업
지금 진행 중인 작업 중 하나를 골라 AGY에 위임하는 브리프를 작성해 제시하되,
**디스패치 전에 브리프를 대표님께 먼저 보여주고 승인을 받는다.**
result.json 전문을 보고에 포함한다.

## 보고
- 스킬 설치 결과
- 첫 디스패치의 result.json 전문 (status, exitCode, touchedFiles 포함)
- 실패 시 명령과 에러 원문
