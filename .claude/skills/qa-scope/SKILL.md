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
