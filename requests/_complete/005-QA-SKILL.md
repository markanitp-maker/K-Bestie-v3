대표님, **`qa-scope`는 프로젝트 공통 Skill로 만들고, 모든 코드 변경 작업의 QA 직전에 Claude가 자동으로 불러 사용하도록 설계하는 게 맞습니다.** Claude Code는 `.claude/skills/<name>/SKILL.md`를 프로젝트 Skill로 인식하고, `description`을 보고 관련 상황에서 자동 로드합니다. Skill 본문은 실제 호출될 때만 컨텍스트에 들어갑니다. 

다만 자동 호출은 모델 판단이므로 **100% 강제 장치는 아닙니다.** 그래서 `description`을 강하게 작성하는 동시에 `CLAUDE.md`에는 딱 **한 줄**만 넣어 “모든 변경 작업의 QA는 qa-scope 기준”으로 연결하는 게 안전합니다. Anthropic도 Skill의 자동 호출이 약하면 description/instructions를 강화하거나 결정론적 강제가 필요하면 hooks를 사용하라고 설명합니다. 

### 만들 파일

`.claude/skills/qa-scope/SKILL.md`

```md
---
name: qa-scope
description: Determine and execute the minimum sufficient QA scope for every code, UI, configuration, schema, or behavior change. MUST be used before running validation, tests, builds, E2E, regression, or other QA after an implementation or modification. Classify the actual change as QA-1 Trivial, QA-2 Scoped, or QA-3 Full based on the real diff and directly affected contracts. Prevent unnecessary broad testing for small changes while preserving strong validation for high-risk changes.
---

# QA Scope

## Purpose

Select the minimum sufficient QA required for the actual change.

QA effort MUST be proportional to the risk and direct impact of the final diff.

Do not expand QA simply because the overall project is important, large, production-facing, or contains high-risk systems elsewhere.

The purpose of QA is not to run the largest possible test suite.
The purpose is to obtain sufficient evidence that the actual change is correct and has not broken directly affected behavior.

---

## 1. Determine QA level from the actual diff

Before QA:

1. Inspect the final diff.
2. Identify which runtime behavior or contract actually changed.
3. Identify direct dependencies affected by that change.
4. Select exactly one initial QA level:
   - QA-1 Trivial
   - QA-2 Scoped
   - QA-3 Full

Judge from the actual implementation, not from the apparent size or importance of the Request.

A long Request can result in QA-1 or QA-2 if the actual diff is small.

A short Request can require QA-3 if the actual diff touches a high-risk contract.

---

# QA-1 — Trivial

Use QA-1 when the change does not alter application logic, data flow, API behavior, persistence, authorization, or shared contracts.

Typical examples:

- copy/text change
- typo correction
- label change
- placeholder change
- static icon change
- CSS-only spacing/layout adjustment
- color/style change
- static link or URL correction
- non-functional documentation/comment change
- other presentation-only changes with no behavioral effect

Required QA:

1. Inspect the final diff.
2. Verify the changed element directly in the affected file or UI.
3. Confirm no unintended adjacent change was introduced.

Default exclusions:

- full TypeScript check
- full lint
- production build
- full unit suite
- integration suite
- E2E suite
- regression suite
- DB/RLS verification
- unrelated browser flows

Do NOT run these merely for reassurance.

Example:

`문의하기 준비중` → `문의하기`

Expected QA:

- diff confirms only intended copy change
- affected UI displays `문의하기`

Then stop.

---

# QA-2 — Scoped

Use QA-2 when behavior changes, but the impact is contained to a specific feature, component, API path, or small dependency boundary.

Typical examples:

- component condition change
- local state change
- validation adjustment
- small bug fix
- one API request/response handling change
- isolated business logic change
- one feature flow change
- targeted refactor with stable external contract

Required QA:

1. Inspect the final diff.
2. Verify the changed behavior directly.
3. Run existing tests directly related to the changed behavior when available.
4. Run only the smallest relevant type/lint/static check when needed by the change.
5. Check directly affected callers or consumers where the diff changes their contract.

Do not automatically run:

- the entire test repository
- all E2E
- all regression
- unrelated package tests
- full production build

Run a broader check only when there is a concrete reason the change could affect that broader boundary.

---

# QA-3 — Full

Use QA-3 when the diff changes a high-risk or cross-system contract where failure could corrupt data, compromise access, duplicate value, break historical compatibility, or affect multiple major runtime paths.

Typical triggers:

- DB schema or migration
- RLS/security policy
- authentication or authorization
- payment or financial state
- reward/ledger/idempotency
- concurrent write guarantees
- shared/core Conversation Engine
- shared API contract used across multiple systems
- Cron/scheduler/data pipeline
- reports based on persisted production data
- destructive or large data migration
- historical/legacy compatibility
- production policy cutover
- cross-system transactional consistency
- infrastructure/config changes with broad runtime impact

QA-3 does NOT mean blindly run every test that exists.

Select the full set of checks needed for the affected high-risk contracts.

Possible QA-3 checks include:

- TypeScript/static checks
- unit tests
- integration tests
- targeted or full E2E
- production build
- DB constraint validation
- RLS/security validation
- concurrency/idempotency tests
- migration forward/backward compatibility
- historical-data regression
- cross-system consistency
- production smoke test

Only include checks relevant to the actual high-risk change.

---

## 2. Escalation rule

Start with the lowest level justified by the actual diff.

Escalate only when evidence appears that the change directly affects a higher-risk boundary.

Examples:

QA-1 → QA-2:
A text change unexpectedly requires modifying conditional rendering logic.

QA-2 → QA-3:
An isolated API change requires a DB migration or changes reward idempotency.

Do not escalate because:

- the repository is large
- Production exists
- the feature is important
- there are many unrelated tests
- extra testing feels safer
- a Request contains many historical requirements that the final diff did not touch

If implementation expands, reassess from the updated diff.

---

## 3. Ambiguity rule

If the QA level is unclear:

1. Inspect the relevant implementation.
2. Inspect directly related tests/contracts.
3. Determine the smallest affected runtime boundary.
4. Choose the minimum QA that provides sufficient evidence.

Do not resolve uncertainty by automatically selecting QA-3.

---

## 4. Explicit gate rule

An explicit mandatory gate from the user or an authoritative project policy takes precedence.

Example:

If the user explicitly requires `Production build PASS`, run it even if the change would normally be QA-1.

However, do not infer mandatory gates merely because an old Request template contains generic boilerplate.

If an explicit Request requirement clearly applies to the current task, honor it.

---

## 5. Failure rule

A failed QA check does not automatically justify running broader QA.

First:

1. determine whether the failure is caused by the current diff;
2. fix the relevant issue if it is;
3. rerun the smallest failed/relevant validation.

Escalate QA only if the failure reveals a broader affected contract.

Do not launch unrelated test suites to investigate an unrelated pre-existing failure.

Report pre-existing failures separately.

---

## 6. Stop rule

When the selected QA level has produced sufficient evidence and all directly relevant checks pass:

STOP QA.

Do not continue running additional tests simply because more tests are available.

---

## 7. Completion report

Report QA in this compact format:

QA: QA-1 | QA-2 | QA-3

Performed:
- <checks actually performed>

Result:
- PASS / FAIL

Skipped:
- <major broader QA intentionally not run> — <short reason>

Keep the QA report concise.

Do not produce a long QA narrative unless a failure or high-risk finding requires explanation.
```

그리고 **루트 `CLAUDE.md`에는 이것만 추가**합니다.

```md
## QA
모든 구현·수정 작업의 검증 범위는 반드시 `qa-scope` Skill을 적용해 결정하며, 실제 diff의 위험도에 필요한 최소 충분 QA만 수행한다.
```

이 구조에서 중요한 건 Request MD도 같이 바뀐다는 겁니다. 앞으로 제가 Request에 예전처럼 매번 `TypeScript / unit / integration / build / E2E / regression`을 장황하게 박지 않습니다.

Request에는 특별한 QA 계약이 없는 한 그냥:

```md
## QA
`qa-scope` 기준으로 수행한다.
```

**이 한 줄이면 됩니다.**

그리고 073처럼 정말 특별한 검증 계약이 있는 Request만:

```md
## QA
`qa-scope`를 적용한다.
단, Reward/Event idempotency, legacy progress 보존, daily max 2는 이번 변경의 필수 Gate다.
```

처럼 **그 작업에서 절대로 놓치면 안 되는 특수 Gate만 추가**합니다.

이렇게 하면 “글자 두 글자 변경 → QA-1 → 화면 확인하고 끝”, “API 작은 버그 → QA-2 → 관련 테스트만”, “073 Mission/Reward/Event 전환 → QA-3”로 일관되게 움직이게 됩니다. 

[Claude Code]

```text
프로젝트에 `.claude/skills/qa-scope/SKILL.md`를 위 정의로 생성하고 루트 `CLAUDE.md`에는 `모든 구현·수정 작업의 검증 범위는 반드시 qa-scope Skill을 적용해 결정하며, 실제 diff의 위험도에 필요한 최소 충분 QA만 수행한다.`라는 최소 연결 규칙만 추가하라; 기존 제품 코드·테스트·설정은 변경하지 말고 이번 작업에서는 Skill 생성과 CLAUDE.md 연결만 수행하라.
```