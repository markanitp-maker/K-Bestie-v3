\---

name: triage-notes

description: add-process.md에 쌓인 미분류 항목을 CLAUDE.md / .claude/rules / .claude/skills / docs 로 분류·이관한다. 사용자가 명시적으로 호출할 때만 실행.

disable-model-invocation: true

\---



\# 인박스 분류



\## 절차

1\. 리포 루트 `add-process.md`를 읽는다. 비어 있으면 "인박스 비어 있음"만 보고하고 종료.

2\. 항목마다 아래 표로 목적지를 판단해 제안한다. 이 단계에서 파일을 만들거나 고치지 않는다.

3\. 대표 승인을 받은 항목만 이관한다.

4\. 이관한 원문은 `add-process.archive.md`로 옮기고 `add-process.md`에서 삭제한다.

5\. 최종 보고: 생성·수정한 파일 경로 목록 + CLAUDE.md 최종 줄 수.



\## 분류 기준

| 항목 성격 | 목적지 |

|---|---|

| 항상 참인 사실·금지 규칙 | CLAUDE.md (200줄 초과하면 재검토) |

| 특정 경로에서만 적용되는 관례 | `.claude/rules/<주제>.md` + `paths:` |

| 2회 이상 반복된 절차·체크리스트 | `.claude/skills/<이름>/SKILL.md` |

| 긴 표·설정법·레퍼런스 | `docs/<주제>.md` (스킬에서 한 줄로 참조) |

| 1회성 메모 | 아카이브만, 승격 금지 |

| 반드시 실행돼야 하는 것 | 훅 후보로 보고만 (직접 만들지 않음) |



\## 작성 규칙

\- CLAUDE.md는 200줄 미만 유지. 절차성 내용은 스킬로 뺀다.

\- 스킬 본문은 짧게. 긴 자료는 별도 .md로 분리해 한 줄로 연결.

\- 부작용 있는 절차는 `disable-model-invocation: true`.

\- `@import`는 토큰 절감 효과가 없으므로 쓰지 않는다.



\## 금지

\- 승인 없이 파일 생성·수정

\- 아카이브 없이 인박스 원문 삭제

\- CLAUDE.md와 스킬에 같은 내용 중복 유지

\- 파일 전체 출력 (변경된 부분만 보여준다)



