---
name: agy-delegate
description: >-
  Delegate a coding task to the Google Antigravity CLI (`agy`) as a background implementer, then review
  its diff and land it yourself. Use this whenever the user wants to hand implementation work to
  Antigravity or agy - phrasings like "have Antigravity do X", "delegate this to agy", "run it through
  agy", or "use Antigravity to implement/fix/refactor" - or wants to run a queue of coding tasks
  through agy while staying the reviewer. DO NOT USE for tasks small enough to do inline, or when the
  user wants the code written directly without delegating.
license: MIT
compatibility: Requires the `agy` CLI installed and authenticated, Node 18+, and git. The orchestrating agent must be able to run shell commands and read files. Shell examples assume bash/zsh (macOS/Linux, or Git Bash/WSL on Windows). Windows launch is not yet verified for this relay.
metadata:
  version: 0.6.0
---

# Antigravity Delegate

You are the **orchestrator**. This skill lets you hand a bounded coding task to a separate
**implementer** - the Google Antigravity CLI (`agy`) - then review what it produced and land it
yourself. You write the brief and own the judgment; Antigravity does the typing in its own
conversation; you verify and commit.

Nothing here is specific to one orchestrating agent. The loop needs only the ability to run a shell
command and read a file, so any comparable agent can drive it. It is designed for and run on Claude
Code; treat other orchestrators as designed-for, not yet proven.

## When NOT to use this

- The task is small enough to just do inline - delegation overhead is not worth it.
- The `agy` CLI is not installed or not authenticated. Install it from Antigravity's CLI docs and run
  the first-launch setup.
- You want to write the code yourself, or you only need a review without edits. This relay does not
  expose a proven CLI-enforced read-only mode yet.

## Prerequisites (check once)

1. `agy help` succeeds. If not, install the Antigravity CLI and complete first-launch setup.
2. `agy models` succeeds. That proves the CLI can authenticate and list the available model labels.
3. You are in (or will point `--cd` at) the target git repository.

These checks do not prove that a headless write will be approved. In `--print` mode, Antigravity
cannot prompt for a write permission and may auto-deny it. The relay detects that denial instead of
reporting completion.

## Choose the implementer model

`agy` has a configured default model, so `--model` is optional. Use it when the human has a preferred
Antigravity model label for the task. Otherwise let Antigravity use its own current default rather than
guessing.

## The loop

Run these five steps per task. Steps 1, 4, and 5 are your judgment; 2 and 3 are mechanical.

### 1. Write the brief

Antigravity sees only the text you send plus what it can inspect in the workspace - no chat history, no
shared context. Everything the task needs goes in the brief: the goal, the current state, what to
change, what to leave untouched, the project's **actual** gate commands, and a report contract. Tell
Antigravity it will **not** commit (you will). Keep one task per brief. Full guidance and a template:
[references/writing-the-brief.md](references/writing-the-brief.md).

Every path you name in a brief must exist. Pointing at a setup doc that was deleted sends the
implementer exploring instead of working; it has no way to know the path was stale rather than
merely unread.

#### Gates in the brief: the timeout trap

**Run each gate yourself on a clean tree first and record its exit code.** A gate that already
exits non-zero is the single most reliable way to burn an entire run.

The implementer cannot tell "my change broke this" from "this was already broken." Told to reach a
green gate that can never be green, it re-runs, waits, re-runs - and hits the timeout wall with the
work already finished on disk.

Measured on one repo (8 cores, `tsc` 30s, full suite 66s, 12-minute budget):

| Brief's gate | Exit code | Outcome |
|---|---|---|
| none (review / fix-only briefs) | - | finished in 0.9-2.9 min |
| `tsc --noEmit` + a dry-run script | 0 | finished in 2.3 min |
| `tsc --noEmit` + `npm test` | **1** (4 long-standing failures) | **hit the 12-min wall, every time** |

The failed runs' transcripts were almost entirely "waiting for tsc", "re-running npm test". Note
that CPU contention does not explain this: 30s + 66s cannot become 12 minutes even with several
runs in parallel. The unreachable gate does.

So, in order of preference:

1. **Leave slow or full-suite gates out of the brief.** Run them yourself, centrally, once, after
   the run lands. Step 4 says re-verify anyway - the implementer running them too is duplicated
   cost paid out of its budget.
2. If the implementer must self-check, give it a **scoped** command over the files it touched
   (`npx vitest run path/to/file.test.ts`), not the whole suite.
3. If a gate has known failures and you still want it run, **name them in the brief** and say
   "compare against this list; do not try to reach zero failures."

#### But never ban the compile check

Banning the whole gate block is the obvious overcorrection, and it costs you the only thing
standing between a malformed write and your working tree.

A type/compile check (`tsc --noEmit`, `cargo check`, `go build`) is not in the same class as a
test suite: it is fast, it exits 0 when clean, and it is the implementer's **only** way to notice
it just corrupted a file. Ban the suite; require the compile check.

What a missing compile check actually looks like, from two runs on one repo:

| File | Size | Damage |
|---|---|---|
| a component | 79 lines | replacement text silently dropped the `return (` |
| a widget | 818 lines | full-file rewrite truncated mid-output, file left unterminated |

Neither implementer noticed. Both reported success. The first chunks of the same session, which
*were* allowed to run `tsc`, produced no such breakage — the check was catching this all along.

Large files are the sharper edge: an implementer that regenerates a whole file rather than
editing it in place can run out of output budget partway and leave you a truncated source file
that still looks plausible in a diff. Say so in the brief: **edit in place, do not regenerate
whole files**, and keep the compile check mandatory so a truncated write cannot be reported as
done.

#### Budget the timeout against the work, not against hope

Real browser automation is the other way runs die - not hung, just genuinely longer than the
budget. In the same repo, a QA brief with ten end-to-end scenarios hit the wall twice; split into
four-item briefs it finished in 2.0 and 3.2 min. If a brief's scenario list would not fit in the
budget when read aloud as actual steps, split it before dispatching, not after.

### 2. Dispatch

Send the brief to Antigravity with the bundled helper. It wraps `agy --print`, captures the run, and
writes a structured `result.json` - so your only job is "run a command, read a file." (`<skill-dir>`
below is this skill's installed directory - the folder containing this `SKILL.md`.)

```bash
node "<skill-dir>/scripts/relay.mjs" --brief brief.txt --cd /path/to/repo
# choose a model label:                 add --model "<label from agy models>"
# enable Antigravity terminal sandbox:  add --sandbox
# resume the most recent conversation:  add --resume-last  (delta brief only)
# see all options:                      node .../relay.mjs --help
```

**There is no `--read-only` flag.** Passing one fails with `relay: unknown option: --read-only`
(measured 2026-08-18). Read-only work is enforced **in the brief**, not by the CLI — say
"파일 수정·커밋·배포 금지. 조사 결과만 보고한다." and then verify with `git status --short`
when it returns. If the worker edited anything, that is the finding.

**Without `--dangerously-skip-permissions`, headless runs die before producing anything.** Measured
2026-08-19 on this repo, two dispatches, two different denials, both `status: "failed"` with an empty
`finalMessage` (no partial work, no findings — the whole run is wasted):

| Brief | Denial in `last stderr` |
|---|---|
| read-only code review (needed `git diff`, `tsc`) | `a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied` |
| E2E QA (needed to write `e2e/*.spec.ts`) | `<repo>/e2e/qa-012-growth-setup.spec.ts is not a valid artifact path; artifacts must be in /home/home/.gemini/antigravity-cli/brain/<id>/` |

Note the second one: it is **not** phrased as a permission error, and it names a plausible-looking
sandbox path — easy to misread as "agy wants its artifacts elsewhere". It is the same auto-denial.
So any brief that runs a command or writes a file — which is nearly all of them, review briefs
included — needs the flag. Re-dispatch with `--dangerously-skip-permissions`; keep the scope narrow
in the brief instead (name the exact output paths and forbid product-code edits), since the flag
removes the CLI-side boundary.

The helper starts a fresh Antigravity project by default and passes `--add-dir <repo>` (the `--cd`
path, absolute) so `agy` has an explicit workspace. It does **not** pass `--dangerously-skip-permissions` by default.
Mechanics, flags, and the `result.json` shape: [references/dispatch-and-poll.md](references/dispatch-and-poll.md).

### 3. Wait for completion

The helper blocks until Antigravity finishes, so back it with whatever your orchestrator offers and
resume when it returns:

- **Claude Code:** run the Bash call with `run_in_background: true`; you are notified on completion.
- **Plain shell / other agents:** run it in the foreground for short tasks, or background it and poll
  the result file.

Do not trust progress trackers over reality: a run is finished when `result.json` is written and the
process has exited. Read the working tree, not a status line. The implementer's full report is
the `finalMessage` field in `result.json` (also printed in full on stdout between the report markers).

**`status: "failed"` does not mean nothing was produced.** A timeout kills the conversation, not the
edits already written to disk. Before re-dispatching, check `touchedFiles` and `git status` - the
change is often complete and only the self-verification never ran, in which case you finish it by
running the gates yourself rather than paying for the whole task again. Re-dispatch only what is
actually missing.

### 4. Review - do not trust the self-report

Antigravity's `result.json` includes its own final message and any gate claims. **Re-verify, don't
accept:**

- **Re-run the project's gates yourself** (the test/lint/build commands from step 1).
- **Read the diff** against the brief: did Antigravity do what was asked, nothing more and nothing less?
  `touchedFiles` in the result is your starting point.
- **Run the relevant guard skills** on the diff if you have them installed.
- For schema/migration changes, round-trip them; for removals, grep for dangling references.

Full checklist: [references/review-and-land.md](references/review-and-land.md).

### 4b. Stale evidence: the worker reruns an old spec and reports its old results

**Measured 2026-08-17.** A QA brief named specific utterances and a specific test account
(`QA_Child_A`). The worker instead reran an existing spec (`e2e/qa-075-*.spec.ts`) against a
different account and reported that run's numbers as the answer. Nothing in the report said so.
The report looked complete and well-formatted, and one of its FAILs was real — which is exactly
why it was believable.

It was caught by a timestamp: the newest row in `chat_messages` was **41 minutes older than the
deploy the QA was supposed to be testing**. The worker had produced no new conversation at all.

Do not accept a QA result whose evidence you have not dated.

- **Put a freshness check in the brief.** Give the deploy time and require the worker to state the
  timestamp of its own newest evidence row. `"배포 시각은 20:56 KST 다. 네가 만든 가장 최근
  기록의 시각을 보고에 적어라. 그보다 이전이면 QA 를 안 한 것이다."`
- **Ban spec reuse explicitly when the brief names its own scenario.** `"기존 spec 을 재사용하지
  마라. 이 브리프의 발화만 그대로 사용하라."` Existing specs in `e2e/` are a strong attractor —
  the worker will reach for one unless told not to.
- **Verify it yourself before believing it.** One query, always the same shape:
  ```sql
  SELECT max(created_at) FROM chat_messages WHERE deleted_at IS NULL;
  ```
  Older than the deploy → the report is about a build that no longer exists. Rerun.
- This is cheap to check and expensive to miss: a stale PASS ships a broken build, and a stale FAIL
  sends you chasing a bug you already fixed.

### 4b-2. "N/N passed" from a test file that never ran

**Measured 2026-08-18.** A brief asked for unit tests around a new module. The report said
**"8/8 통과"**. Running the same files gave **2 failures** — both test files used
`mock.module` from `node:test`, which throws `TypeError: mock.module is not a function`
unless Node is started with `--experimental-test-module-mocks`. The worker's harness had the
flag; the plain `tsx --test` the repo actually uses does not.

The tests were not just failing — **they were not wired into `npm test` at all**, so they would
never have run in CI either. Two invisible layers of nothing.

- **Run the test files yourself with the exact command the repo uses.** Not the worker's command,
  and not "the tests pass" in the report. A pass you did not observe is not a pass.
- **Check the new test files are actually registered.** `grep` the new filenames in `package.json`
  (or the runner config). A test that no script invokes is decoration.
- **Prefer dependency injection over module mocking in the brief.** Ask for an injectable seam
  (`logEvent?: typeof logBehaviorEvent`) instead of `mock.module`. It runs everywhere, needs no
  flags, and cannot silently no-op.
- **Then prove the test can fail.** Break the fix on purpose, rerun, confirm the count drops,
  restore. A test that passes against the broken code is testing nothing —
  this caught two more decorative tests the same day.

### 4b-3. The deleted test: a review finding erased instead of fixed

**Measured 2026-08-18.** A brief asked to split "답 알려줘" (reveal the answer) out of
"힌트 줘" (give a hint). The worker put `알려줘` in the reveal keyword list — which made
**"힌트 좀 알려줘" spoil the answer**, exactly the behaviour the split was meant to prevent.
An existing test asserted `"힌트 좀 알려줘"` is a hint request. That test line was **deleted**
in the same diff, so the suite stayed green.

A separate review session caught it. The self-report said all tests passed, and they did —
because the failing one was gone.

- **Read deletions in the diff, not just additions.** `git diff -- '*.test.*' | grep '^-'`.
  A removed assertion is a claim that the old behaviour no longer matters. Make the worker
  justify it, or restore it.
- **Never let the implementer decide a test is obsolete.** If a brief changes behaviour that a test
  covers, say in the brief which tests are expected to change and why. Anything else stays.
- **Keep review in a separate session.** The implementer had every reason to believe it was done.

### 4b-4. The brief named one file; the feature had four entry points

**Measured 2026-08-18.** A brief asked to instrument "케이 놀이" starts and pointed at
`playSelection.ts` (the modal path). The worker instrumented exactly that — correctly — and the
telemetry still missed most real usage, because children start these games **by speaking**
("끝말잇기 하자"), which goes through three other `start()` call sites in `skillRouter.ts`.

The worker did what the brief said. The brief was wrong.

- **Name the behaviour, not the file.** "Record a start event **wherever a game actually starts**"
  beats "add logging to playSelection.ts".
- **Ask for the call-site census in the report.** `"이 기능의 진입 경로를 전부 세고, 각각을
  덮었는지 표로 보고하라."` Then check it with one grep.
- **Verify with the real entry point, not the convenient one.** The Dev E2E only proved the modal
  path until it was told to also type the utterance.

### 4c. A wrong report can still contain a real finding

The stale run above reported the fabrication guard failing. The run was invalid, but the finding
was true — the guard genuinely never fired live, for a reason the unit tests could not see
(the child's own utterance was saved before the response was generated, so it grounded itself).

Discard the run, keep the lead. When a report is invalid, reproduce its claims directly rather than
throwing them out with the run.

### 5. Land it

The implementer edits the working tree; **the orchestrator commits.** Only after the gates pass and the
diff holds:

- Commit the verified work yourself, with a clear message.
- If it needs changes, send a delta brief with `--resume-last` and review again.

## Permission model

Antigravity owns its own permission policy. The relay does not bypass it by default. Use
`--dangerously-skip-permissions` only when the human explicitly accepts that Antigravity may
auto-approve tool permission requests. Use `--sandbox` when you want Antigravity's terminal sandbox
enabled for the run. Antigravity's own help says `--dangerously-skip-permissions` auto-approves all
tool permission requests without prompting, including a request to act outside the sandbox. Do not
treat `--sandbox` as an enforced boundary when the flags are combined; treat the run as full access.
If headless `--print` auto-denies a write, the relay reports `status: "failed"` and exits non-zero.
Settings allow-rules are not documented here as a fix because they have not been demonstrated to
apply to this headless path. Do not add the bypass flag without explicit human approval.

## Authorization model

Delegation is something the human opts into. Once they have ("run this queue", "proceed"), committing
verified, gate-passing work is the agreed contract. Two limits on that mandate: **surface, don't
absorb** (report Antigravity's design decisions, defensible-but-unasked turns, and non-blocking
nitpicks rather than silently keeping them) and **stop for scope changes** (if correct completion needs
going beyond the brief, ask - don't expand the mandate yourself). The full treatment is in
[references/review-and-land.md](references/review-and-land.md).

## References

- [references/writing-the-brief.md](references/writing-the-brief.md) - how to write a brief Antigravity
  can execute blind: structure, XML blocks, the report contract, and real gate commands.
- [references/dispatch-and-poll.md](references/dispatch-and-poll.md) - `relay.mjs` flags, the
  `result.json` contract, backgrounding per orchestrator, and recovery when a run misbehaves.
- [references/review-and-land.md](references/review-and-land.md) - the review checklist, the commit
  boundary, and the rework cycle via `--resume-last`.
- [references/multi-task-queues.md](references/multi-task-queues.md) - running a sequential queue:
  carrying constraints forward, progress tracking, and the end-of-run coherence check.
