# Project Lessons Learned

> Append-only catalog of lessons learned during fin_news development.
> Each entry captures a pattern that, if remembered, prevents the next
> regression of the same shape.

---

## Categories

- **process** — workflow / review / brainstorming patterns
- **spec** — design-doc writing discipline
- **code** — implementation patterns + anti-patterns
- **validation** — testing / verification / sanity-check protocols

## Format per entry

```
## YYYY-MM-DD — <category> — <one-line title>
**Trigger:** <session / incident that exposed it>
**Pattern:** <general statement>
**Why:** <root cause / cost-of-violation>
**How to apply:** <concrete next-time action>
**Reference:** <related commits / specs / triage docs>
```

When a future session learns a new pattern, append at the bottom (chronological).

---

## Entries

### 2026-04-26 — process — Robust subagent review catches production drift

**Trigger:** Pipeline core fixes implementation (T1-T12 in `docs/plans/2026-04-26-pipeline-core-fixes.md`). Two-stage review (spec compliance + code quality) caught 4 critical bugs that would have shipped to production despite spec/plan/code/tests all passing.

**Pattern:** Always run code-quality-reviewer subagents against **real production data**, not just fixture data. Self-confirming closed loops (spec says X → code uses X → tests fixture X → all pass) only break when an outside source verifies against reality.

**Why:** Spec/plan/code/tests can be perfectly aligned with each other and still wrong. The 4/22 incident root causes were exactly this shape — every internal artifact agreed, but production data had a different shape (mentions vs top_mentions, dict envelope vs list, missing _metadata).

**How to apply:**
- Always dispatch code-quality-reviewer subagents AFTER spec-compliance review passes
- Reviewer prompt must include "run against real production data files in `data/`" verification step
- Don't trust "tests pass" as evidence of correctness for data-shape contracts
- 4-stage review > 2-stage even at extra dispatch cost when stakes are high

**Reference:** Commits `52f1e21` (top_mentions key fix), `2f10a1f` (signal_events dict envelope fix), `2bc4224` (x_analysis _metadata fix). Triage `docs/audits/triage/round-1.md` C1 → 4 follow-up critical fixes.

---

### 2026-04-26 — spec — Sanity-check production data shape BEFORE writing spec

**Trigger:** Same session. Multiple spec defects propagated to plan/code/tests because the spec author didn't verify production-data shape before writing.

**Pattern:** Before committing any spec that asserts data shape, run `cat`/`grep`/`python3 -c "json.load(...)"` against actual production files to verify each assumption. Spec author's mental model of "what production looks like" is consistently optimistic.

**Why:** The spec → plan → code → tests pipeline preserves whatever shape the spec author wrote down. If the spec was wrong, all downstream artifacts inherit the error and reinforce each other. Only running against real files breaks the closed loop.

**How to apply:**
1. Draft the spec
2. For every "data has shape X" / "field Y exists" / "method Z returns W" claim, run a sanity-check shell command verifying it against production
3. Update spec where reality differs
4. THEN commit
5. The implementer should re-run sanity checks at execution time too (drift between spec writing and implementation)

**Reference:** Companion spec `docs/specs/2026-04-26-pipeline-companion-fixes-design.md` self-review pass found 3 critical drifts (audit_state.json field names, ibkr_client method enumeration, x_analyzer formatted-output path). Caught during commit `a75e8df` before plan stage.

---

### 2026-04-26 — spec — Self-confirming closed loops are dangerous

**Trigger:** F-025 search-tweet linkage bug — spec wrote "mentions" key, plan copied it, code used it, tests fixture seeded "mentions", all internal artifacts agreed. Real production analyzer emits `top_mentions`. Bug would have shipped silently.

**Pattern:** When spec, plan, code, and tests all reference the same field/shape/contract, that's not 4 confirmations — it's 1 assertion duplicated 4 times. To verify, you need an external source (production data, real API response, real DB schema).

**Why:** Internal consistency provides no evidence of correctness when the source-of-truth is external. The 4 "agreements" are all dependent on the spec being right; they collapse together if the spec was wrong.

**How to apply:**
- For every contract assertion, name the EXTERNAL source-of-truth (production file, API doc, real DB schema)
- Test cases that ASSERT shape should pull values from the external source whenever feasible (read production fixture file, not seed inline)
- Code reviews should explicitly ask: "what's the external evidence this is correct?"

**Reference:** Same as previous lesson. Critical fix at commit `52f1e21` —  caught only because reviewer subagent ran the new code against real `data/analysis/x_analysis_*.json`.

---

### 2026-04-26 — process — Brainstorm exhausts design questions before spec

**Trigger:** Main spec (`docs/specs/2026-04-26-pipeline-core-fixes-design.md`) went through 7 self-review iterations adding 200+ lines of refinements because design questions surfaced AFTER spec was drafted. Companion spec did better by surfacing design questions during brainstorm.

**Pattern:** During brainstorming, enumerate every non-trivial HOW decision and get user confirmation BEFORE drafting spec. "Non-trivial" = anything where two reasonable approaches exist (API design, error semantics, edge case behavior, naming).

**Why:** Spec rework is much more expensive than brainstorm Q&A. Each Q&A round is ~5 minutes; spec rework cycles through self-review + edits + recommit.

**How to apply:**
- Before drafting spec, enumerate design questions in a list
- Present them to user one-at-a-time (multiple choice when possible)
- Get explicit answers before any prose
- The spec should commit decisions, not surface them

**Reference:** Companion spec brainstorm at commit `f3db6a2` — 3 design questions answered (C6 _metadata placement, C8 helper enforcement level, C11 correction-record mechanism) before any spec text was written. Saved 4-5 self-review cycles.

---

### 2026-04-26 — code — Fail-loud over silent fallback

**Trigger:** F-024 (match_tweet_ids silent empty), F-053 (secdef_search silent `[]`), F-046 (build_market_context silent `{}`), F-013 (x_analyzer empty silent), F-022 (lookup_source_category silent None) — same anti-pattern across the codebase.

**Pattern:** Silent fallbacks (`return None` / `return []` / `return {}` on error) hide bugs and make debugging harder. Prefer fail-loud: raise a typed exception, log at WARNING+, exit with a distinct code.

**Why:** A silently-degraded pipeline produces "results" that look successful but contain garbage. The 4/22 incident propagated through 3 silent fallback sites before finally surfacing in the LLM hallucination. Each silent fallback adds a layer of indirection between the bug and the symptom.

**How to apply:**
- New error-handling code: prefer `raise SpecificError(...)` over `return None`/`[]`/`{}`
- For interactive tools (premarket_check, etc.), warn loudly to stderr if degraded
- For batch pipelines (cron jobs), exit non-zero so cron failure trap fires
- When silent fallback IS the right answer (e.g., legitimate "missing is OK"), document why with a comment

**Reference:** All Round 1 / Round 2 triage findings tagged Pattern B in `docs/audits/2026-04-26-pipeline-audit-findings.md`.

---

### 2026-04-26 — code — Atomic landing for interdependent changes

**Trigger:** C1 cited_in_events fix had 4 sub-changes (schema migration, F-040 producer fix, F-025 producer fix, SQL JOIN consumer). Each individually broken: split commits would have crashed production at intermediate states. Spec §4.1.6 mandated single atomic commit.

**Pattern:** When multiple changes are functionally interdependent (any subset makes things worse than the original), they must land in a single commit. Don't optimize for review-friendly small commits if it produces broken intermediate states.

**Why:** Cron jobs / continuous pipelines sample arbitrary commit states. If commit N is broken (because commit N+1 hasn't landed yet), production breaks for that window. Plus rollback semantics fail — reverting commit N+1 also reverts commit N's prerequisite.

**How to apply:**
- During planning, identify "interdependent change groups"
- Plan task = single commit for those groups (multiple steps, single commit at end)
- Document in spec why atomicity is required
- Verify via production smoke after commit lands

**Reference:** Plan task T6 in `docs/plans/2026-04-26-pipeline-core-fixes.md`. Spec §4.1.6 lists the 4 changes + rationale.

---

### 2026-04-26 — validation — Test fixtures vs production shape drift

**Trigger:** test_writeback_main.py used list-shaped signal_events JSON; production files are dict-envelope. Tests passed; production crashed.

**Pattern:** Test fixtures inherit the spec author's mental model. When that model is wrong, tests confirm the spec instead of catching the bug. Fixtures should match production shape when shape is part of what's being tested.

**Why:** Same as "self-confirming closed loops" lesson — fixtures are a 4th copy of the spec's shape assertion, not external evidence.

**How to apply:**
- Before writing fixtures, read production data files to learn actual shape
- Prefer copying real production files (anonymized if sensitive) into `tests/fixtures/` over inline-seeded dicts
- Test names should mention "matches production shape" when applicable
- A test that asserts contract should fail if production shape changes

**Reference:** Commit `2f10a1f` — fixed by switching test `_write_signal_events` helper from list-only output to dict-envelope.

---

### 2026-04-26 — code — Validator relaxation for production drift (type-dispatch + optional fields)

**Trigger:** T9 had to relax `validate_market_data` (accept legacy list shape) and `_validate_llm_kind` (make _metadata optional) because production producers haven't been Phase-3-hardened yet. Strict validators rejected production data.

**Pattern:** When production reality differs from spec ideal AND fixing the producer is out of scope, type-dispatch validators (separate strict/relaxed code paths) are robust. Don't loosen the strict path; add a parallel relaxed path.

**Why:** Strict validators block legitimate production data; just-loosen-the-rule loses the strict-path benefits. Type-dispatch keeps strict semantics for files that DO conform AND accepts files that don't yet, with a clear migration path (when producers are hardened, the relaxed path becomes dead code → remove).

**How to apply:**
- When validator must accept multiple shapes, dispatch on a discriminator (top-level type, presence of `_metadata`, etc.)
- Document in the validator AND in spec/amendment which shape is "future strict target" vs "current production reality"
- Plan future cleanup task to remove the relaxed branch when producers conform

**Reference:** Commit `25f59aa` (T9 validator relaxation). Spec amendment in `docs/specs/2026-04-25-data-integrity-pipeline-design.md` Amendment section.

---

### 2026-04-26 — code — Typed exception hierarchy for extensibility

**Trigger:** C8 audit-staleness and C9 ibkr_client errors both needed multiple error variants. Single generic Exception → caller can't discriminate. Per-method bespoke exceptions → re-invents the wheel each time.

**Pattern:** Define base class + subclass hierarchy:
```python
class IbkrClientError(Exception): pass
class SecDefSearchError(IbkrClientError): pass
class HistoryError(IbkrClientError): pass
```
Caller can `except IbkrClientError` for "any IBKR issue" or `except SecDefSearchError` for granular handling. Future methods follow the pattern.

**Why:** Versatility without scope creep. Future error variants are 1-line additions, not architectural rework.

**How to apply:**
- For any module that has (or might have) >1 error variant, define a base class
- Subclass per error condition with a docstring explaining when raised
- Spec/code-review should ask "is the typed hierarchy in place" for any new error site

**Reference:** Companion spec §3.2 + §4.4 + §4.5.

---

### 2026-04-26 — process — Caller-side compatibility check before changing internal API

**Trigger:** T6 changed match_tweet_ids signature from 3-arg to 2-arg. Implementer remembered to update the in-process caller (enrich_event) but the test fixture builder was still passing 3 args.

**Pattern:** When changing internal API (signature, return type, error semantics), grep for ALL callers in:
- In-process (production code)
- Subprocess (`subprocess.run([...])`, shell scripts)
- Tests (fixtures, mocks, assertions)

**Why:** Spec describes "the change"; callers may not all be in scope of the spec. Test files especially get missed. Subprocess callers (regenerate_analysis.py invokes x_writeback.py via subprocess) are easy to forget but pass an in-process compatibility check.

**How to apply:**
```bash
grep -rn "<function_name>\|<old_signature>" --include="*.py" --include="*.sh" .
```
Don't only look at imports — look at subprocess invocations and test fixtures too.

**Reference:** Multiple T6 fixture-update follow-ups during code review. The grep approach was added explicitly to subsequent task prompts.

---

### 2026-04-26 — validation — Production-smoke-check after every critical change

**Trigger:** T6 critical fix (top_mentions key) was caught by code-quality-reviewer running the new code against real `data/analysis/x_analysis_*.json` files. Tests alone passed; reality alone failed.

**Pattern:** After every commit that changes data-handling logic, run a smoke test against real production files (read-only). Smoke = not full integration, just "does the new code accept production shape and return non-degenerate output".

**Why:** Tests use fixtures → fixtures inherit spec mental model → loop. Production-smoke breaks the loop. Cost is ~10 seconds per smoke; payoff is catching the F-025-class bugs that fully-passing test suites miss.

**How to apply:**
- Build a 5-line `python3 -c "..."` smoke command per change type
- Code-reviewer subagent prompt should include the smoke command and report its output
- Implementer reports smoke output in the DONE message
- For critical fixes: smoke output goes in the commit message body

**Reference:** Commits `52f1e21`, `2f10a1f`, `2bc4224` all had smoke checks in commit messages.

---

### 2026-04-26 — process — Documentation finalization task as plan checklist

**Trigger:** During companion-spec plan self-review, found that several secondary docs (progress-log.md, data-integrity spec, lessons-learned.md itself) wouldn't get updated unless explicitly listed in the plan. User caught this gap with "记得更新下各种牵扯到的documentation".

**Pattern:** Implementation plans must include a final "documentation finalization" task that lists EVERY doc touched (directly or indirectly) by the change. Code changes that introduce new conventions (e.g., `_metadata.empty_data` flag) need spec amendments where the convention was originally codified.

**Why:** Without an explicit task, doc updates get forgotten. Spec/code drift then accumulates silently — exactly the failure mode the project is fighting.

**How to apply:** Every implementation plan must end with a "documentation finalization" task that:
1. Updates progress-log.md (project changelog)
2. Updates any spec amendments for new conventions introduced
3. Updates lessons-learned.md (new patterns captured)
4. Greps for stale references (broken links, deleted module mentions, etc.)
5. Verifies CLAUDE.md still accurately describes the workflow

Add this as a checklist task template in superpowers writing-plans skill — every plan benefits.

**Reference:** Task T19 in `docs/plans/2026-04-26-pipeline-companion-fixes.md`.

---

### 2026-04-26 — spec — Spec amendments preserve historical decisions while documenting drift

**Trigger:** When T9 relaxed `_validate_market_data` and `_validate_llm_kind`, the data-integrity spec's strict §6.4/§6.5 rules became inaccurate. Solution: append an "Amendment" section to the spec rather than rewriting the original rules. Same pattern reused for C6 _metadata addition.

**Pattern:** When a previously-shipped spec needs to be updated to reflect new code reality (relaxation, extension, schema change), append an "## Amendment (DATE, work-unit ID)" section rather than editing the original prose. Original spec preserves intent; amendment captures evolution.

**Why:** Specs serve two audiences: future implementers who need current truth, and reviewers tracing why the design evolved. Rewriting the original loses the second audience. Amendments serve both — original tells you "what we originally meant", amendment tells you "what reality is now and why it diverged".

**How to apply:**
- For changes that contradict an existing spec: add `## Amendment (DATE, work-unit)` section at the END of the spec
- Reference original section number explicitly ("amends §6.4 ...")
- Document the reason for divergence (production drift, scope decision, etc.)
- Mark TIME-BOUNDED: if the amendment is meant to be temporary (e.g., until C6 producers are hardened), note that explicitly so a future cleanup task can find and delete it

**Reference:** `docs/specs/2026-04-25-data-integrity-pipeline-design.md` Amendment sections (T9 + C6).

---

### 2026-04-26 — validation — Tautological tests (the `dict.get(...)` anti-pattern)

**Trigger:** T14 (companion spec) added 14 new tests for the C6 empty-data fail-loud chain across 3 consumers (build_prompt, build_signal_prompt, x_writeback). Code review caught that **7 of 14 were tautological** — they constructed a hand-rolled dict and asserted that `analyzer_data.get("_metadata", {}).get("empty_data")` returned the expected value. Never called `build_prompt.main()` or any production code path. The tests would pass even if the production check were deleted entirely.

**Pattern:** A test that re-implements the production logic on synthetic input and asserts the synthetic input matches expectations is a tautology. It tests Python's `dict.get()` semantics, not the codebase. The defining tell: **the test never imports or calls the production function it claims to test.**

**Why:** Tautological tests are worse than no tests — they create false confidence. The test passes (so reviewers move on), the diff looks plausible (assertions on real-looking data), and the test name ("test_build_prompt_exits_6_on_empty_data") accurately describes the INTENT but not the actual VERIFICATION. Implementer's justification for the shortcut ("main() requires many other files seeded") was disproven empirically by the reviewer in 30 seconds — the real integration test was achievable.

**How to apply:**
- Every test asserting "code X does Y" should call `code_X` directly. Grep for the production function name in the test body — if it's absent, the test is suspect.
- Reviewers MUST verify that test bodies call into production code, not just hand-rolled fixtures.
- When implementer reports "couldn't write integration test because [reasons]", reviewer must verify those reasons empirically, not accept them at face value.
- The remediation pattern: replace the dict-assertion with `with self.assertRaises(SystemExit) as ctx: production_function()` + `self.assertEqual(ctx.exception.code, 6)`. Real integration test is usually 10-15 lines, not the implementer's claimed 50+.

**Reference:** Commit `278e687` replaced 7 tautological tests in `test_build_prompt.py` + `test_writeback.py` with real integration tests calling `build_prompt.main()`, `build_signal_prompt.main()`, and `x_writeback._load_analyzer_optional()`. Net test count went 14 → 7 (replaced more thoroughly), with 3 of the new tests verifying real `SystemExit(6)` from production code paths.

---

### 2026-04-26 — validation — Test environment isolation: ALL state files, not just the obvious ones

**Trigger:** T10's `test_clean_result_when_no_gaps` was flaky — it ran `audit_data.py --since 2099-01-01` expecting "no expected files → clean", but actually got `critical_gaps`. The test set `AUDIT_STATE_OVERRIDE` to isolate `data/.audit_state.json` but did NOT isolate `logs/cron_failures.json`. Production cron failures from prior sessions leaked into the test, always classified as critical regardless of audit date window.

**Pattern:** When integration-testing against subprocesses that read multiple state/log files, identify EVERY file the subprocess might read and provide an env-var override for each. Isolating only the obvious one creates a flaky test.

**Why:** Subprocess invocation is opaque from the test's perspective — you can't easily list what files it touches. Tests that "work on my machine" but fail elsewhere are usually missing isolation for some auxiliary state file. The cost of partial isolation: flaky CI, wasted debug time, false negatives.

**How to apply:**
- Before writing a subprocess-based test, grep the production code for ALL file reads (`open(...)`, `Path(...).read_text()`, `glob(...)`, etc.).
- For each file read, ensure either (a) the file is in the test tmpdir, or (b) the production code accepts an env-var override pointing to a tmpdir path.
- If the production code lacks an override mechanism for a state file, ADD the override (mirroring the pattern used for the existing isolated file). This is a small refactor with high resilience payoff.
- Document the override env vars in the production code's docstring.

**Reference:** Commit `92f3038` added `CRON_FAILURES_OVERRIDE` env var to `audit_data.py` (mirroring existing `AUDIT_STATE_OVERRIDE`) so tests fully isolate from production state. Test went from flaky to reliably green across environments.

---

### 2026-04-26 — validation — Isolated smoke beats full-pipeline smoke

**Trigger:** T12 added an audit-gate snippet at the top of `pipeline/run_daily_analysis.sh`. The plan's smoke test ran `bash pipeline/run_daily_analysis.sh` to verify the gate. Reviewer caught that this would actually execute the entire cron pipeline (x_analyzer + LLM calls + writeback) just to verify a 5-line gate. Way too aggressive — produces noisy output, takes minutes, costs API tokens.

**Pattern:** When testing a small piece of logic embedded in a larger script, **extract the snippet to a tmp file and run it in isolation**. Don't run the whole pipeline.

**Why:** Full-pipeline smoke tests have side effects (API calls, DB writes, file creation) that contaminate environment AND obscure what the test is actually verifying. If the gate fails, you can't tell if it's the gate logic or some downstream pipeline step. Isolated smoke directly answers "does the gate logic work?" with no noise.

**How to apply:**
- For shell-script gates / preflight checks: extract the snippet to `/tmp/test_<name>.sh`, invoke directly, assert exit code.
- For Python startup checks: invoke the helper function directly (`data_io.verify_audit_clean()`), don't run the whole `main()`.
- For multi-step pipelines: test each step in isolation; only run the integration when verifying inter-step contracts.
- Mock external dependencies (API clients, subprocess) so smokes are reproducible.

**Reference:** T12 plan rewrite extracted the audit-gate to `/tmp/audit_gate_test.sh`; clean state verified exit 0, stale state verified exit 7. Total smoke runtime: ~1 second (vs full pipeline ~minutes).

---

### 2026-04-26 — process — Plan templates inevitably have defects; budget implementer adaptation

**Trigger:** Across 20 companion-spec tasks, implementers caught and corrected plan-template defects ~10 times. Examples: T4's malformed JSON test fixture (was actually valid JSON, would never trigger except branch); T13's INSERT statement missing NOT NULL columns; T17's UNH P&L cascade affecting 9+ downstream cells (plan only mentioned 1); T11's naive-timestamp test would have been timezone-dependent on UTC+N machines.

**Pattern:** Plan-stage author can't anticipate every edge case in production data shapes, schema constraints, or downstream cascade effects. Plans should give the implementer ENOUGH spec detail to know what to do AND ROOM to adapt when reality differs. The implementer's correctness reports should explicitly note adaptations made.

**Why:** Over-prescribed plans (every line of code dictated) leave implementers with no path to flag spec defects — they either follow the broken instructions or silently improvise. Under-prescribed plans (vague directives) create ambiguity. Sweet spot: spec the contract clearly + show example code + tell the implementer "verify against actual code/data first; report deviations."

**How to apply:**
- In plan task descriptions, explicitly call out "verify line numbers", "verify enum values", "read the existing function body before editing".
- In implementer prompts, ALWAYS include "before changing the file, read the actual current shape" + "report any divergence from the plan template in your DONE message".
- Budget for ~5-10% plan-defect rate; treat implementer's adaptations as evidence the plan was approximate, not as misbehavior.
- Reviewer should verify the adaptation is sound (catches occasional implementer-introduced bugs from wrong adaptation).

**Reference:** Multiple commits across the companion spec series. Notable: `1b24b76` (T13 fixed schema), `daa9df3` (T11 fixed naive-tz test), `1fa0b21` (T3 corrected line numbers).

---

### 2026-04-26 — process — Spec tightness should be per-clause, not uniform

**Trigger:** C7 fetch_ibkr_data spec second-pass review (this session). User pushed for thoroughness; I tightened 13 things in one pass; some made the spec stronger (typed exception ABI, file format contract, fail-loud guard against try/except symmetry), others were over-specification (mandating function-internal structure, mandating "copy verbatim", mandating both positive AND negative manual smoke). User then said "don't over-correct; judge per-section".

**Pattern:** Spec authors tend to apply uniform tightness — either "everything is exact" or "everything is illustrative". Reality: each constraint should be tight or loose based on **cost-of-drift**, evaluated independently.

**Why:** Over-specifying low-cost-of-drift sections turns the implementer into a typist (loses their judgment, produces brittle code). Under-specifying high-cost-of-drift sections risks shipping bugs (silent data corruption, broken contracts, regressed behavior). Both errors are real and have opposite remediations.

**How to apply:** For each constraint in spec, ask: *"What breaks if implementer drifts here?"*

| Drift cost | Spec treatment |
|------------|---------------|
| **Inviolate** (data shape contract, exit codes, exception ABI, atomic-landing units, fail-loud-vs-silent decisions, on-disk JSON keys) | Lock down with concrete code/values + the word "inviolate" or equivalent |
| **Floor** (minimum behavior; implementer may exceed) | "At least N", "preserve these K fields", "must include but may add" |
| **Illustrative** (skeleton code, helper structure, internal naming, mock-vs-subprocess test pattern) | Show the shape + label "illustrative, not literal" + state the contract that must be preserved |

The `_log_cron_failure` example crystallizes it: the JSON shape is inviolate (audit/ack workflow depends on it); the function structure is illustrative (refactor for testability is welcome). One sentence each, both flagged.

**Anti-pattern to watch for:** the second-pass review reflex of "user wants thoroughness → tighten everything". Each tightening pass has diminishing returns and increasing rigidity cost. After tightening, ask "would deletion of this constraint produce a worse outcome, OR is the constraint just protecting me from a low-probability failure mode at the cost of the implementer's judgment?" Delete the latter.

**Reference:** Spec `docs/specs/2026-04-26-fetch-ibkr-data-phase3-design.md` (commit `fa7dc9b` second-pass tightening + follow-up loosening commit). Five over-tightenings caught and relaxed: KEY_FIELDS list (floor not exhaustive), `_log_cron_failure` "copy verbatim" → "JSON shape inviolate, structure your call", `_snapshot_to_dict` exact-code → output keys inviolate, anti-tautology specific assertions → "at least 3 distinct values" pattern, manual smoke negative case from required → recommended.

---

### 2026-04-26 — process — Plausible narrative ≠ accurate narrative when writing post-hoc

**Trigger:** T5 retro for 2026-04-26 pipeline audit. I wrote Bug 1 (F-025) mechanism as "SQL `NULL == NULL` join always-false on `tweet.author_id`" — plausible-sounding, internally coherent, completely wrong. Actual bug per commit `aad36ad`: a Python-side filter `mention.source == author` excluded all search-tweet mentions before they reached the SQL JOIN. Reviewer caught it by reading the commit diff.

**Pattern:** When writing post-hoc narratives (retros, root-cause analyses, bug summaries, session logs), the writer fills in the plausible-sounding mechanism if they don't have ground-truth in mind. The result reads correct (matches surrounding context, has the right shape, uses the right vocabulary) but doesn't match what the code actually does.

**Why:** Memory drift compresses time + loses specifics. By the time you write the retro, you remember "it was the cited_in_events join" but not "the bug was in the Python filter that fed the join, not the join itself." You substitute a plausible mechanism. The result is fiction-shaped-like-fact.

This is distinct from Lesson 1 (robust review against real production data) — that's about REVIEWING. This is about WRITING. The writer themselves is the source of the inaccuracy, not a downstream consumer.

**How to apply:**
- When writing post-hoc bug/incident narratives, every mechanism claim must be verified against the actual fix commit (`git show <sha>`) or the actual code path.
- Don't write "the bug was X" from memory — open the diff, then write what the diff shows.
- For older incidents, if the original commit is hard to find, write the narrative at higher abstraction ("a filter excluded search tweets") rather than fabricating a specific mechanism ("SQL NULL=NULL").
- Reviewer must verify post-hoc narratives by running `git show` on every cited commit and checking that the prose mechanism matches the diff. Plausible-sounding ≠ accurate.

**Reference:** T5 retro (`docs/retros/2026-04-26-pipeline-audit-retro.md`) initial draft (commit `bc4641a`) had wrong F-025 mechanism. Fixup commit `3dade9e` corrected it after review caught the discrepancy. Same review also caught "C7 implemented as T11 robustness" (C7 was actually deferred — fabricated attribution) and `referenced_tweet_ids` column name (actual column: `tweet_ids`).

---

### 2026-04-26 — process — Triage must consider deduplication when findings cluster on duplicated code paths

**Trigger:** C7 (`fetch_ibkr_data` Phase 3 migration) brainstorming. The 2026-04-26 audit found 12 findings (Theme F) on `scripts/fetch_ibkr_data.py`. Triage labeled this "mechanical migration — copy patterns from `fetch_market_data.py`" and routed it to a separate sub-spec. That framing implicitly assumed **in-place hardening** of the duplicate — fix the same 12 findings in the wrong place. The script was ALSO duplicating IBKR API logic (auth, HTTP, isinstance) that already lived in `pipeline/ibkr_client.py` (post-C9 hardening). Caught at brainstorming Q1, but only because the brainstormer happened to read both files.

**Pattern:** "Mechanical migration" is the most common triage outcome for clustered findings, and it's the framing where consolidation gets silently dropped. The cheap option (mechanical) becomes expensive when you discover the duplicated layer needs the same fixes — you've now hardened the same surface twice with no shared abstraction.

**Why:** Triage decides scope BEFORE spec/plan/code investment. If triage routes findings to "mechanical migration of duplicate", spec writers tend to respect that framing — they fix the listed findings in place, don't surface the consolidation question. By the time brainstorming catches it (if at all), spec drafting has already absorbed the assumption. The system worked for C7 (caught at brainstorming), but a less-careful brainstormer might have missed it, and the project would now have 2x the IBKR API code to maintain.

**How to apply:**
- Triage rubric should explicitly ask: "do these findings cluster on a code path that DUPLICATES another module's responsibilities (HTTP layer, parsing, storage, validation)?"
- If yes: triage must answer "deduplicate or fix-in-place?" — not implicitly assume one. Document the answer in the triage doc.
- For deduplication: note which existing module absorbs the duplicate, estimate consolidation cost vs. mechanical-migration cost.
- For fix-in-place: explicitly justify why duplication is acceptable (e.g., "different API contract", "intentional separation of concerns").
- Brainstorming Q1 should re-validate this triage decision — but the goal is for triage to catch it, not depend on brainstorming to compensate.

**Reference:** Triage `docs/audits/triage/round-2.md` Theme F (line 104-124) routed C7 as "mechanical migration." Brainstorming Q1 (this session, the 4-question design dialogue) re-opened it as "extend `IBKRClient` (option A) vs. mechanical patches in place (B) vs. hybrid (C)." User picked A. Implementation followed; saved ~⅓ duplication of auth + HTTP + isinstance logic.

---

### 2026-04-26 — validation — Distinguish "spec-faithful" from "actually-correct" in code review

**Trigger:** T4 of C7 (`get_account_summary` implementation, commit `8c992a2`). Code quality reviewer caught that `v.get("value") or v.get("amount")` short-circuits on falsy 0.0 — returns `amount` instead of legitimate zero balance. Spec §1.4 mandated this exact expression (line 195). Plan template copied it verbatim. Implementer was spec-faithful. Spec-compliance review approved (matches spec). Only code-quality review caught the bug — by asking the right question. The bug entered via legacy `scripts/fetch_ibkr_data.py:141` (pre-C7), copied through audit → spec → plan → code with every link preserving the spec text faithfully.

**Pattern:** When migrating legacy code to a typed/hardened version, latent bugs in the legacy version copy through the entire pipeline. Spec compliance review CANNOT catch these (the bug IS the spec). Code quality review can — but only if the reviewer is asking the right question.

**Why:** Spec compliance review's mental model is "does the implementation match the contract written down?" — useful for catching deviations from intended behavior. But when the spec itself encodes a legacy bug, faithful implementation reproduces the bug. The reviewer's mental model needs to switch from "match" to "audit." This is a different review mode than lesson 1 (review against real production data shapes) — that catches data-shape bugs; this catches LOGIC bugs the spec mandated.

**How to apply:**
- Code quality reviewers must ask BOTH:
  1. "Does this match spec?" (spec compliance — covered by separate reviewer)
  2. "If I were writing this from scratch, would I write it this way?" (code quality)
- For migrations of legacy code: actively flag any expression copied from the legacy version. Verify it's correct in the new context, not just preserved faithfully.
- Common shapes of "spec-faithful but wrong" (watch for these in legacy-migration specs):
  - Falsy short-circuit on numeric zero (`x or default`) where 0.0 is a legitimate value
  - String concat where path joining is needed
  - Type-coerce silently swallowing parse errors (`int(x) → ValueError → return None`)
  - Defaults that hide missing-data bugs (`dict.get("key", 0)` masking absent keys)
- Reviewer should distinguish action: spec-faithful-but-wrong is a **spec amendment** (don't rework T4), not implementation defect.

**Reference:** T4 review (`docs/specs/2026-04-26-fetch-ibkr-data-phase3-design.md` §1.4 line 195 has the legacy expression; tracked as known concern at C7 merge time, not fixed this round to preserve legacy behavior). Code quality reviewer's verdict explicitly noted: "implementation is spec-faithful — but the spec itself contains a latent bug. Recommend follow-up spec amendment." Distinguish from lesson 1 — lesson 1 catches PRODUCTION-SHAPE drift; lesson 21 catches SPEC-MANDATED LOGIC bugs.

---

## Adding New Entries

When a future session learns a new pattern:
1. Append a new entry below this line at the bottom of the file
2. Use the format from the top
3. Cross-reference: which session, which commits, which spec section
4. Update CLAUDE.md only if the lesson is foundational (changes how every session should work)

The catalog grows; no entries are deleted (history matters). If a lesson is later refined or contradicted, add a new dated entry that references the older one.

---

### 2026-04-27 — process — Sanity check is brainstorm continuation; design Q catalog can grow

**Trigger:** 2026-04-27 cleanup batch session. Brainstorm settled 8 design Qs (Q1-Q8) for 4 cleanup tasks. After "design locked," sanity check on actual `pipeline/ibkr_client.py` source revealed Q9 — hierarchy choice (rename only vs hierarchy unification under Q9=B) — was a non-trivial dimension brainstorm hadn't asked. Selecting Q9=B led to substantive scope addition (`IbkrAuthError` / `IbkrRequestError` → `IbkrClientError` subclass) and Theme 10 placeholder.

**Pattern:** Brainstorm exhausts the Qs that the brainstormer can imagine; sanity check (reading actual production code) surfaces Qs the brainstormer didn't realize existed. Don't treat brainstorm as "one-and-done — locked, drafting now." Sanity check phase is Phase 1.5 — design Qs may still need answers.

**Why:** A closed brainstorm phase pressures "stop asking, start writing." But code reality has dimensions the brainstormer's mental model didn't include (hierarchy depth, indirect callers, mixed-style patterns). When sanity check surfaces these, ignoring them creates "spec-faithful but design-incomplete" outcomes (Lesson 21 variant — design contract was incomplete).

**How to apply:**
- After brainstorm, BEFORE drafting plan, do a sanity-check pass: read every source file the plan would touch, every caller, every test
- For each surface, ask: "would brainstorm have noticed this if it were the brainstormer?" If no → new Q for the brainstorm queue
- Return to brainstorm Q&A for any new Qs surfaced; don't draft plan with unanswered Qs
- Mark plan's self-sanity-check section explicitly: include "additional Qs surfaced during sanity check" as a verification item
- This complements Lesson 4 (brainstorm exhausts design Qs) — Lesson 4 says "ask all Qs"; this lesson says "the Q catalog isn't fixed at brainstorm-end, it can grow during sanity check"

**Reference:** `docs/plans/2026-04-27-cleanup-batch-leverage-tasks.md` (decisions table includes Q9 added during sanity check). Commit `ed9ace5` implements Q9=B hierarchy unification. Plan section §"Plan Self-Sanity-Check" line 463+ documents the discovery process.

---

### 2026-04-27 — process — Plan amendments mid-execution are normal; small ones land in same commit

**Trigger:** 2026-04-27 cleanup batch session, Task #2 (I7 calendar). Stage B subagent review surfaced gap in plan's [INVIOLATE] warn-trigger contract — original `year + 1 not in cal` missed the worse case `current year not in cal`. Implementer was spec-faithful (Lesson 21 territory). Decision: amend plan with A1 amendment section + extend impl + add 1 test, all in same commit. ~10 LOC + 1 test, low risk, scope-coherent (still about startup warn).

**Pattern:** Reviewers regularly catch plan contract gaps that brainstorm + spec self-review missed. For small gaps within current task scope (rule of thumb: <20 LOC + <3 tests), amend plan + fix impl + commit atomically. Don't defer to follow-up commit (loses momentum, creates context switch). For large gaps (cross-task scope, design rework), defer to separate task.

**Why:** Plan amendments mid-execution are evidence the review process works — they're the surface of caught gaps. Treating every plan-deviation as scope creep creates two failure modes: (a) deferred items pile up unaddressed (Lesson 21 spec-faithful-but-wrong outcomes accumulate), or (b) implementer silently improvises (Lesson 17 violation). The healthy pattern is "amend plan + commit" with explicit amendment section preserving history (Lesson 13 pattern).

**How to apply:**
- When reviewer surfaces gap, classify size: small (current task scope, <20 LOC) vs large (cross-task, >20 LOC, design rework)
- Small: amend plan with `## Amendment (DATE, surface-source)` section + fix impl + commit atomically
- Large: defer to follow-up task; record as Theme entry in optimization-directions.md
- Plan amendment section preserves historical contract (Lesson 13 reuse — amendments don't rewrite original prose)
- Implementer's "Adaptation Rights" section in plan formalizes this expectation upfront (Lesson 17)

**Reference:** `docs/plans/2026-04-27-cleanup-batch-leverage-tasks.md` "Amendment (2026-04-27, Task #2 review-surfaced)" section (A1: warn trigger broadened, A2: patch path corrected). Commit `2139a65` lands plan amendment + impl + 1 new test atomically.

---

### 2026-04-27 — validation — Implementer adaptation rights formalized: HALT-and-flag, don't silently improvise

**Trigger:** 2026-04-27 cleanup batch session. 4 subagent implementer dispatches all included "Implementer Adaptation Rights" section in prompt + `Adaptation:` prefix mandate in DONE message. Multiple substantive adaptations surfaced cleanly: (a) Task #2 patch path drift (`pipeline.trading_calendar.date` vs `trading_calendar.date` — empirically required), (b) Task #4 pre-existing test rewrite (3 tests had hidden dependency on the bug being fixed; rewritten to in-process + mock-today pattern), (c) Task #5 line-number drift (185/194 vs plan's 222/231) + session-log out-of-scope edit (justified). Each adaptation reported, validated by reviewer, accepted by orchestrator.

**Pattern:** When plan diverges from reality (line drift, missed callsites, hidden test dependencies, unanticipated import structure), implementer's correct response is HALT-and-FLAG, not silently improvise. Subagent prompt formalizes via:
1. "Implementer Adaptation Rights" section in plan (top-level)
2. `Adaptation:` prefix mandate in DONE messages
3. Reviewer validates each adaptation against intent, not just plan literal

**Why:** Without explicit adaptation rights, implementer faces dilemma: follow plan (broken instructions) or silently improvise (creates drift). Both fail. Adaptation rights provide third path: surface deviation, justify, continue. Reviewer's job becomes "validate adaptations are sound" alongside spec compliance. Orchestrator updates plan amendment if adaptation reveals plan defect.

**How to apply:**
- Every implementer subagent prompt MUST include "Implementer Adaptation Rights" section (formalize the HALT-and-flag protocol)
- DONE message format MUST include `Adaptation:` prefix block (lists all deviations from plan literal)
- Reviewer prompts MUST include "verify adaptations are sound" verification step
- Treat adaptations as evidence the plan was approximate, not as misbehavior (Lesson 17 — plan templates inevitably have defects)
- Orchestrator decides: accept adaptation as-is, OR amend plan to formalize, OR re-dispatch with corrected plan

**Reference:** `docs/plans/2026-04-27-cleanup-batch-leverage-tasks.md` §"Implementer Adaptation Rights" (lines 22-28). Commit `44b0341` (Task #4) shows the cleanest example: 3 pre-existing tests rewritten as adaptation, reviewer validated, orchestrator accepted, no plan amendment needed (adaptation was orthogonal to plan contract).

---

### 2026-04-27 — code — Pattern-similar but semantic-different — `or` fallback for string vs numeric

**Trigger:** 2026-04-27 Batch 1 brainstorm Q2 + stress-test mental-simulation of fix shape. Initial recommendation B (sweep `pos.get("ticker") or pos.get("contractDesc", "?")` at `fetch_ibkr_data.py:115` alongside the numeric falsy bug at `ibkr_client.py:398`) was retracted: changing the string-fallback site from `or` to `dict.get(default)` would CHANGE behavior in the empty-string case (return `""` instead of falling back to descriptive name).

**Pattern:** When sweeping legacy patterns under Lesson 21 ("spec-faithful but actually-correct distinction"), the pattern's **semantic fit** must match the field type:
- **Numeric field** (`value=0.0` legitimate) → `dict.get("X", default)` correct; `or`-fallback is a falsy bug
- **String field** (`value=""` unusable for display, fallback desired) → `or`-fallback correct; `dict.get` would suppress the desired fallback

**Why:** Pattern matching is necessary for sweep efficiency, but Lesson 21's "if I wrote this from scratch" question must be answered for EACH pattern instance, not extrapolated. Sweep-by-pattern-only risks introducing new bugs in semantically-correct sites.

**How to apply:**
- During Lesson 21 sweep, for each match: classify field type (numeric / string / other) AND its real-world semantic (is the falsy value a legitimate data state or an unusable state requiring fallback?)
- For numeric where 0/0.0 is legitimate: `or`-fallback IS the bug — fix
- For string where empty/None is unusable: `or`-fallback may be intentional — verify by reading the surrounding consumer (display logic, computational use)
- Hand-read each match — no grep-only sweep
- This complements Lesson 21 by adding type-awareness to "is this site a fix candidate?"

**Reference:** `docs/plans/2026-04-27-batch1-quick-wins.md` Decisions Table Q2-revised. Brainstorm transcript shows initial B recommendation + stress-test catch + revision to A. Net: 1 site fixed (numeric, line 398, commit `4cd7e5a`), 1 site preserved (string, line 115).

---

### 2026-04-27 — process — Cron-environment import smoke check (pytest sys.path != cron sys.path)

**Trigger:** 2026-04-27 Batch 1 Task C investigation surfaced that Session 6 C7-D1 (commit `7bba334`) introduced `from pipeline.cron_log import log_cron_failure` in 3 fetch scripts. Pytest passes (project_root in sys.path); cron's `python3 scripts/X.py` form sets sys.path[0] to `scripts/` directory, NOT project_root → `pipeline.*` import fails. Today's cron at 13:15 PT silently failed at module import in fetch_market_data + fetch_fred_data (Lesson 5 silent-failure-of-failure-logger: the cron failure trap couldn't fire because the SAME failed import is what `log_cron_failure` requires). Cascade: today's data files missing → preflight failed at 13:30 PT → audit critical_gaps. Hot-fix `df6adf7` changed to `from cron_log import` (matches existing `import data_io` pattern; pipeline/ already in sys.path via explicit `sys.path.insert`).

**Pattern:** Test environment ≠ cron environment for sys.path. Specifically:
- pytest discovery / `python3 -m pytest`: cwd-rooted sys.path[0] (project_root if invoked from project_root)
- Cron's `python3 scripts/X.py` form: script-directory-rooted sys.path[0] (`scripts/` ≠ project_root)
- Module imports must work in BOTH environments

**Why:** A change that "passes tests" can ship a production regression because tests don't exercise the cron sys.path shape. Silent-failure-of-failure-logger is particularly dangerous: when the failure-handling mechanism itself fails to import, you lose the diagnostic signal.

**How to apply:**
- When changing imports in cron-dispatched scripts, run cron-equivalent invocation BEFORE merging:
  ```bash
  cd /tmp && python3 /full/path/to/scripts/X.py [--safe-flag]
  # or
  cd /tmp && python3 -c "import importlib.util; spec=importlib.util.spec_from_file_location('m', '/path/to/X.py'); spec.loader.exec_module(importlib.util.module_from_spec(spec))"
  ```
- Stage B reviewer prompts MUST include "run script via cron-equivalent invocation; verify imports resolve" for any script that runs via cron
- Avoid `from pipeline.X import` in scripts/ unless project_root is explicitly added to sys.path; prefer `from X import` form when pipeline/ is added to sys.path[0] (matches existing `import data_io` pattern)
- D-2 lint candidate: detect `from pipeline.*` imports in `scripts/` that lack project_root sys.path setup
- Complementary to existing Lesson 11 (production-smoke-check after every critical change) — adds cron-environment dimension

**Reference:** Hotfix commit `df6adf7` (changed 3 fetch scripts + test_fetch_ibkr_data.py from `from pipeline.cron_log import` to `from cron_log import`). Diagnosis trail: `logs/market_data.log` traceback at line 19 + `logs/cron_failures.json` empty (no fetch_market_data entry — silent-failure-of-failure-logger).

---

### 2026-04-27 — validation — Mocking immutable C-type methods via subclass-via-factory hook

**Trigger:** 2026-04-27 Batch 1 Task C implementation. Plan suggested `unittest.mock.patch.object(sqlite3.Connection, 'close')` to track close-call count for resource-leak regression test. Failed on Python 3.14+: `AttributeError: 'sqlite3.Connection' object attribute 'close' is read-only` (instance-level monkey-patch); `TypeError: cannot set 'close' attribute of immutable type` (class-level patch.object). C-level types in CPython 3.14+ enforce immutability for builtin methods.

**Pattern:** When testing requires intercepting a built-in C-type method that has been marked immutable, use the API's own factory hook. For sqlite3:
```python
class TrackedConn(sqlite3.Connection):
    def close(self):
        close_calls.append(1)
        super().close()

with patch.object(sqlite3, 'connect', wraps=sqlite3.connect) as connect_mock:
    # Inject the subclass via factory= kwarg
    connect_mock.side_effect = lambda path: sqlite3.connect(path, factory=TrackedConn)
    # ... run code that calls sqlite3.connect(...)
```

**Why:** `unittest.mock.patch` works for Python-level methods but not for C-level immutable types. Subclass-via-factory uses the API's documented extension point (`factory=` parameter) — preserves all parent contract while adding instrumentation. Stage A reviewer verified RED→GREEN bisection: tests genuinely fail without `with closing(...)` wrap (close not called on exception path), pass with wrap.

**How to apply:**
- For C-type immutability errors during mock setup: look up the API's factory hook (sqlite3 has `factory=`; many APIs have similar extension points)
- Subclass with override + delegate to `super()`; inject via the factory hook
- Avoid attempting to monkey-patch the C-type directly — won't work and obscures intent
- Document the pattern in test docstring (cite the C-type immutability + factory rationale) so future test authors don't repeat the dead-end attempt
- Cross-references for sqlite3 specifically: `tests/test_x_analyzer.py:113-172` and `tests/test_writeback_main.py:196-273` (Batch 1 Task C tests)

**Reference:** Commit `c5bfdb1` (Task C) + Stage A surgical RED→GREEN bisection verification. Pattern is narrow (sqlite3-specific syntax) but principle is general — when monkey-patching fails on immutable C-types, look for the API's factory hook before resorting to higher-level mocking.

---

### 2026-04-27 — process — Pre-commit gates distinguish commit-causal vs environmental state via `git stash` bisection

**Trigger:** 2026-04-27 Batch 1 Task C surfaced via Plan Amendment A2. Original Cross-Cutting Flow point 6 said "audit_data.py must exit 0 BOTH before commit AND after commit" — too strict. Today's audit was already in `critical_gaps` state due to a separate Session 6 C7-D1 cron import regression (fixed in hot-fix `df6adf7` between Task B and Task C); today's `llm_daily_*.json` + `signal_events_*.json` remained missing because they require LLM calls (out-of-scope for hotfix). Strict gate would block legitimately-clean code-only Task C commit due to environmental issue.

**Pattern:** Pre-commit gates that check global state (audit clean, lint clean, etc.) must distinguish:
- **Commit-causal**: state caused by THIS commit's changes (must be remediated before commit)
- **Environmental**: pre-existing state, unrelated to this commit (must be acknowledged but not block)

The remediation: `git stash` the uncommitted changes, re-run the gate, compare. If gate state is IDENTICAL before/after the stash-pop, the commit is non-causal — gate exemption applies. Document the bisection result in the commit message.

**Why:** Strict gates fail-stop on environmental state, blocking legitimate forward progress. Loose gates miss commit-introduced regressions. The bisection methodology threads the needle: gate enforces "no NEW gaps introduced", not absolute purity.

**How to apply:**
- Pre-commit: run gate (audit, lint, etc.). Note gap state.
- If gate passes: commit normally.
- If gate fails: `git stash` uncommitted changes; re-run gate.
  - If gate STILL fails (same gaps): environmental, not commit-causal. Stash-pop, document gaps in commit message ("pre-existing critical_gaps from <cause>; verified non-causal via git stash bisection"), commit.
  - If gate now passes: commit IS causal. Investigate what your changes broke; do NOT commit until resolved.
- Plan / process docs MUST allow the bisection methodology as gate exemption (otherwise gate becomes blocker for legitimate code-only commits during environmental issues)
- Reviewer prompts: include "verify commit non-causality via `git stash` bisection if gate fails" as Stage A check

**Reference:** Plan `docs/plans/2026-04-27-batch1-quick-wins.md` Amendment A2 (Cross-Cutting Flow point 6 amendment). Tasks C/D/E commits demonstrate the methodology: each commit's diff verified non-causal to today's pre-existing critical_gaps.

---

### 2026-04-27 — process — Lesson 21 latent-bug pattern sweep should be cross-module (entire-repo grep)

**Trigger:** 2026-04-27 Batch 1 Task D Stage B reviewer found that `scripts/audit_data.py:86-95` `load_audit_state()` has the EXACT same silent-swallow JSONDecodeError → `{}` anti-pattern that Theme 9 just fixed for cron_failures.json. The Lesson 21 sweep during Theme 9 brainstorm + impl was scoped to `pipeline/cron_log.py` and direct callers; would have missed `audit_data.py` if not for Stage B's broader grep.

**Pattern:** When fixing a Lesson 21 latent-bug pattern in module X, the sweep should grep the ENTIRE repo for the pattern signature, not just module X. Other modules likely have the same anti-pattern (especially common idioms like `try: json.load(...) except JSONDecodeError: return <empty>`).

**Why:** Single-module sweeps create future-Theme noise — the same anti-pattern shows up in adjacent modules within weeks/months as someone else hits the limitation. Cross-module sweep at fix time turns "1 fix + 5 future themes" into "1 fix + 1 followup task to apply the same fix shape elsewhere".

**How to apply:**
- Stage B reviewer mandate (extending Lesson 21 from "is this site fix candidate?" to "what other sites have the same shape?"):
  ```bash
  # Example: when fixing silent-swallow JSONDecodeError pattern
  grep -rnE 'try:.*\n\s*.*json\.load.*\n\s*except.*JSONDecodeError.*:\s*\n\s*return\s*(\[\]|\{\}|None)' pipeline/ scripts/
  ```
- Report findings as: (a) candidates for current fix (if scope-coherent), OR (b) Future Theme entries (if requires separate planning), OR (c) intentional-silent justified by docstring (no action)
- Implementer adaptation rights (Lesson 24) apply: small scope-coherent extensions land same commit; larger ones become Future Theme

**Reference:** `docs/lessons-learned.md` 2026-04-27 entry "Pattern-similar but semantic-different" (Lesson #25 — adds field-semantic-vs-type classifier). `docs/future/2026-04-26-optimization-directions.md` Theme 18 (audit_state.json same-pattern, surfaced because Stage B applied this principle). Commit `e8d48ea` (Task D) closed Theme 9; Stage B review surfaced Theme 18 via the cross-module sweep.

---

### 2026-04-27 — process — Spec planner verifies inline constants against config before treating as ground-truth

**Trigger:** 2026-04-27 Batch 1 Task E NFLX adaptation. Plan's `WATCH_SYMBOLS` regression contract said "same 10 symbols" based on the pre-edit inline `CONIDS` dict. But production `config/ibkr_conids.json` (45 entries, 2 commits of history) had NEVER included `NFLX.US`. Pre-edit inline was already drift from config. With Task E's new fail-loud-at-startup loader, retaining NFLX would crash even on happy-path real-config load. Implementer dropped NFLX (10 → 9) with documentation comment + git log evidence trail.

**Pattern:** When refactoring an inline-constant → config-load (or any inline-source → external-source migration), the planning step MUST verify inline = external source BEFORE drafting smoke / tests / regression contracts. The plan's "regression: same N items" claim is a hidden assumption that pre-edit inline matches the eventual source-of-truth.

**Why:** Without this verification, the plan reifies pre-edit inline drift as "ground truth", forcing the implementer to either (a) re-add the drifted item to the external source (silent fix masking the drift cause), or (b) drop the item with documentation (Stage A adaptation classification + lesson capture). The implementer's halt-and-flag works (Lesson 24), but spec planner doing the check upfront avoids the need for adaptation entirely.

**How to apply:**
- Plan Self-Sanity-Check checklist item: "for any inline-constant → config migration, verify pre-edit inline == external source-of-truth via grep/diff before locking smoke/tests/contracts"
- For example: when plan says "WATCH_SYMBOLS = current 10 inline symbols", run `python3 -c "import json; cfg=json.load(open('config/X.json'))['mapping']; inline=[...]; print(set(inline) - set(cfg))"` and reconcile mismatch
- Compose with Lesson 7 (test fixtures vs production drift) and Lesson 1 (production-data verification): both already mandate production-shape checks, but specifically for inline-vs-external drift this lesson adds the pre-spec timing requirement
- If inline-vs-external drift IS desired (e.g., script-local subset of broader config), document explicitly in plan: "WATCH_SYMBOLS is intentional 10/45 subset of config; if regression count changes, scope decision required"

**Reference:** `docs/plans/2026-04-27-batch1-quick-wins.md` §Task E + adaptation comment at `scripts/fetch_ibkr_data.py:56-62`. Commit `96cd997` (Task E) lands the NFLX drop with rationale. Theme 12 `docs/future/2026-04-26-optimization-directions.md` captures the followup dedupe work.

**Validation note (post-batch user confirmation):** The NFLX drop adaptation was *retroactively even more correct* than analyzed at impl time. User confirmed NFLX position was liquidated (4/20 TSLA-spread strategy funded by NFLX sell); pre-edit inline `CONIDS` and `premarket_check.CONIDS` both had NFLX as **leftover from prior portfolio state**. Lesson reinforces: when refactoring inline-constant lookups, also cross-check against current product/business state (here: `portfolio/holdings.json`) — not just config — for stale entries that the planner may not realize are dead. premarket_check.py NFLX subsequently removed in followup commit; symbol sets now aligned at 9.

---

### 2026-04-27 — code/process — Failure logger must not depend on its own success to log failures (Lesson #31)

**Trigger:** 2026-04-27 13:15 PT cron failed silently because `from pipeline.cron_log import log_cron_failure` in 3 fetch scripts raised `ModuleNotFoundError` (C7-D1 regression from Session 6). The `if __name__ == '__main__': try: main(); except: log_cron_failure(...)` trap couldn't fire because `log_cron_failure` was never bound — the import that defines it was the SAME failing import. Cascade: data files missing → 13:30 PT preflight surfaced via separate logging path 15 minutes later.

**Pattern:** When wrapping production code in failure-logging traps, the failure logger MUST be reachable EVEN IF other parts of the system are broken. Architectural rule: **failure logger has zero dependencies that the production code also has**. Concretely:
- Failure logger should be importable via stdlib only (no project-internal imports), OR
- Failure logger import wrapped in `try/except ImportError` with stdlib-only inline fallback that mirrors the same shape

**Why:** The whole purpose of the failure logger is to log failures. If it can fail silently when production code fails, you've created a feedback loop where failures are invisible. Recovery requires noticing the absence (no log entry) — much harder than noticing presence (log entry exists). The C7-D1 incident propagated through 15 minutes of silent state before preflight (separate logging mechanism) caught it.

**How to apply:**
- Cron-dispatched scripts: wrap `from <project>.failure_logger import` in `try/except ImportError` with stdlib-only inline fallback
- Mark fallback path with sentinel marker (`_fallback_used: True`) so audit can detect "fallback fired" → indicates import regression worth investigating immediately
- Long-term: prefer stdlib-only failure loggers; project-internal `cron_log.py` is already stdlib-only internally, but the IMPORT itself can still fail
- Generalizes: any "watchdog" / "monitor" / "observer" code should have minimal dependencies — decoupled from the system it observes

**Reference:** Hot-fix `df6adf7` was symptom band-aid. T4 (`docs/plans/2026-04-27-c7-d1-architectural-fix.md` §T4, commit `68d3495`) implements this lesson — 3 fetch scripts wrap `from pipeline.cron_log import` with try/except + stdlib-only fallback (same 6-key JSON shape + `_fallback_used: True` sentinel). Stage B did real-world simulation: moved `pipeline/cron_log.py` aside → ran fetch script → fallback fires + JSON written + WARNING to stderr. Pattern adopted from defensive systems engineering (e.g., dual-path emergency systems in aviation/automotive).

---

### 2026-04-27 — code — Module identity gotcha across import paths (Lesson #32)

**Trigger:** 2026-04-27 C7-D1 fix T1 implementation. After scripts/ migrated from bare `import data_io` to `from pipeline import data_io`, 2 test files broke (`test_audit_data.py:367` identity assertion + `test_fetch_ibkr_data.py` `data_io._PROJECT_ROOT` monkeypatch). Plan §Q3 claimed "tests/ no migration needed" — empirically false.

**Pattern:** When the same `.py` file is imported via two different module names (e.g., bare `import X` vs `from pkg import X`), Python creates TWO distinct `sys.modules` entries with TWO distinct module objects. Functions / classes / module-level state defined in those modules are also distinct objects. Module-level monkeypatches (e.g., `pkg.X._PROJECT_ROOT = tmp`) and identity assertions (e.g., `assertIs pkg.X.fn is bare_X.fn`) FAIL across the two paths. Empirical verification: `>>> from pipeline import data_io as pdi; >>> import data_io; >>> pdi is data_io  # → False`.

**Why:** Spec author's mental model assumes module identity is preserved across import paths in Python. It's not. Tests with module-level mocks or identity assertions are sensitive to which sys.modules entry is being patched/asserted. When SUT changes import form, every test that mocks/asserts on the SUT's module attributes must use the SAME import form.

**How to apply:**
- Before architectural import-style migrations (e.g., bare → package), audit tests for: (a) `self.assertIs(SUT_module.X, ...)` patterns; (b) `module_attr = ...` reassignments at class-method level; (c) `patch.object(module, ...)` with module-level state
- When SUT changes import form, every test that mocks/asserts on the SUT's module attributes must use the SAME import form
- Add to grep checklist for cross-module sweeps (Lesson 29) when migrating import patterns
- Distinct from Lesson #25 (semantic-vs-type field classifier) and Lesson #29 (cross-module pattern sweep) — this is about MODULE IDENTITY, not field semantics or repo-wide patterns

**Reference:** Plan Amendment A3 in `docs/plans/2026-04-27-c7-d1-architectural-fix.md` documents the missed classifier. T1 commit `ee2aa01` migrated 2 affected test files. 4 OTHER tests with `data_io._PROJECT_ROOT` monkeypatches were classified SAFE (they test pipeline-internal modules which themselves use bare imports — same sys.modules entry → patch works). Stage A reviewer cross-checked classification.

---

### 2026-04-27 — Lesson #33 — DROPPED during 2026-04-27 consolidation

**Original draft title:** "Lint script self-bootstrapping". **Dropped because:** the observation "lint script that walks its own dir should pass its own rule" is more reassurance than transferable lesson — not actionable advice, just internal-consistency check. Idea preserved as a 1-sentence side-benefit note within Lesson #34 (AST grammatical vs semantic). See git history for original draft if curious.

---

### 2026-04-27 — code — AST is grammatical, not semantic (Lesson #34)

**Trigger:** 2026-04-27 C7-D1 fix T2 design. Choosing AST vs regex vs runtime-inspection for the lint rule.

**Pattern:** AST-based lint checks the SHAPE of statements (grammatical), not their runtime resolution (semantic). For rules like "is this `import X` statement targeting a name in PIPELINE_MODULES?" — AST is the right tool. For rules like "does this import resolve at runtime to pipeline/X.py?" — AST cannot answer; needs name-resolution (mypy plugin / pyflakes / runtime exec).

**Why:** Trading off the right tool for the rule's question matters. AST is fast (no name resolution needed), stdlib-only, deterministic. But it has blind spots: dynamic imports (`importlib.import_module("X")`, `__import__("X")`), aliased names whose resolution depends on runtime state, conditional imports under `try/except` whose actual binding is unclear at parse time.

**How to apply:**
- For rules checking statement SHAPE: use AST (`ast.parse` + `ast.walk`)
- For rules checking statement SEMANTICS: use mypy plugin or runtime inspection (heavier deps, slower)
- Document the trade-off + known blind spots in lint docstring
- For dynamic-import detection: AST CAN see `Call(Name(id='importlib.import_module'), Constant(value='X'))` — partial coverage; document explicitly

**Side benefit (absorbed from dropped #33):** when a lint script walks `<dir>/rglob('*.py')` AND lives inside that dir, it scans itself — design it to pass its own rule, gives free internal-consistency assertion at zero cost.

**Reference:** `scripts/lint/check_pipeline_imports.py` (T2). Stage A verified 8 violation shapes caught (bare/aliased/from/multiline/conditional/try-except/comma-list); 1 known blind spot (dynamic `importlib.import_module`) acceptable per scope. Future Theme 26 (dynamic-import detection) extends.

---

### 2026-04-27 — process — Test-coverage list itself can miss the very edge case future maintenance is designed to catch (Lesson #35)

**Trigger:** 2026-04-27 C7-D1 fix T3 Stage A review. Plan §T3 ILLUSTRATIVE list of 10 cron-dispatched scripts MISSED 2 scripts (`pipeline/build_prompt.py` + `pipeline/build_signal_prompt.py`) that are invoked by `pipeline/run_daily_analysis.sh`. Plan §Q3 itself enumerated these 4 modules as "vulnerable to C7-D1 class". Implementer faithfully reproduced the omission. Stage A reviewer cross-checked against `run_daily_analysis.sh` and surfaced the gap.

**Pattern:** When defining a "list of X to test/lint" in a plan/spec, the spec author MUST grep against EVERY invocation surface (cron + every shell script + manual workflow docs) and produce an EXHAUSTIVE list as part of the plan, not an illustrative one. The list itself becomes the test's correctness anchor; if it's incomplete, the test passes but doesn't actually cover the intended scope.

**Why:** Tests defined against a hardcoded list inherit the list's gaps. A test that "fails when a regression hits a script in the list" doesn't fail when a regression hits a script NOT in the list. The C7-D1 defensive layer is only as good as the test list it operates against. Future maintenance (Lesson 30 principle of avoiding stale lists) only works if the seed list is complete to start with.

**How to apply:**
- During plan write, when defining a "test against this list" pattern, require pre-edit grep against ALL invocation surfaces:
  - `crontab -l` direct entries
  - Every `*.sh` script (search for `python3 .../X.py`)
  - Manual workflow docs (CLAUDE.md, README, etc.)
- Mark plan section as INVIOLATE not ILLUSTRATIVE for the list itself
- Reviewer Stage A MUST cross-check the list against actual invocation surfaces before approving
- **Distinct from Lesson 30** (planner verifies inline constants vs config): Lesson 30 is about CONSTANT (e.g., WATCH_SYMBOLS) vs source-of-truth-CONFIG (e.g., ibkr_conids.json) drift; this lesson (#35) is about TEST/LINT-COVERAGE LIST vs INVOCATION-SURFACES drift. Both are "list-vs-source-of-truth" patterns, BUT:
  - Lesson 30: the source-of-truth is data (config file content); the list is a hardcoded subset
  - Lesson 35: the source-of-truth is invocation surfaces (crontab + shell scripts + manual workflow); the list is a test-coverage enumeration
  - Different mitigations: Lesson 30 → auto-discover from data; Lesson 35 → grep all invocation surfaces during plan-write
  - Composite application: a plan that defines BOTH a config-driven constant (Lesson 30) AND a test list (Lesson 35) needs both verifications

**Reference:** Plan Amendment A4 in `docs/plans/2026-04-27-c7-d1-architectural-fix.md` documents the gap + correction. T3 commit `57829cf` extends `CRON_DISPATCHED_SCRIPTS` to 12 entries. Stage A R1 was the surfacing review.

---

### 2026-04-27 — validation — Subprocess smoke tests must sanitize env to enforce target environment (Lesson #36)

**Trigger:** 2026-04-27 C7-D1 fix T3 Stage B review. Subprocess-based test inherits parent env including PYTHONPATH. Cron itself does NOT set PYTHONPATH, but pytest CI environments often do (`PYTHONPATH=$(pwd) pytest`). Without explicit env sanitization, parent env inheritance could MASK the very C7-D1 sys.path bug the test is designed to catch — project_root injected via PYTHONPATH would rescue a broken `from pipeline.X import` statement, making test FALSELY PASS.

**Pattern:** Any test that subprocesses to verify "production environment X" must explicitly construct env X, NOT assume parent env IS X. Common offenders for cron-equivalent tests:
- `PYTHONPATH` (cron doesn't set; CI sometimes does → can mask sys.path bugs)
- `PWD` / `OLDPWD` (cron's cwd differs from pytest's)
- `PATH` modifications (pytest may add venv bin)

**Why:** The whole point of a subprocess smoke test is to exercise the script in a target environment (cron, prod, etc.) different from the test environment. If the subprocess inherits test env as-is, you're testing the test environment, not the target. Could land FALSE GREEN if the test env happens to rescue a real failure mode.

**How to apply:**
- For cron-equivalent tests: pass `env={k: v for k, v in os.environ.items() if k != "PYTHONPATH"}` (or build target env from scratch)
- Document the rationale in test docstring — cron doesn't set PYTHONPATH; we sanitize to enforce cron-equivalent worst case
- Generalize: when subprocessing for environment-X smoke, explicitly construct env X — don't rely on inheritance
- D-2 lint candidate (Theme 28): "subprocess smoke test must sanitize env"

**Caveat: choosing the right no-side-effect probe (absorbed from folded #37):** `--help` is the canonical no-side-effect probe IFF the script uses argparse's standard `--help` handling. Scripts that bypass argparse to execute main() body (e.g., `scripts/premarket_check.py` would touch network/DB on `--help`) must NOT use `--help` as the probe — would either time out (network) or have side effects. Alternative probes:
- `python3 -c "import importlib.util; spec = ...; mod = ...; spec.loader.exec_module(mod)"` (loads module, runs top-level code, skips main())
- `python3 -c "from <module> import <symbol>"` (import-only check)
Before adding a script to a `--help`-based smoke list, verify `python3 /path/X.py --help` exits cleanly (no side effects); else use alternative probe + document.

**Reference:** Stage B R3 in T3 review. T3 commit `57829cf` `_run_cron_equivalent` passes `env={**os.environ, ...minus PYTHONPATH...}`. Production cron unaffected (cron doesn't set PYTHONPATH); CI safety improved. `scripts/premarket_check.py` is the in-codebase example of a script needing alternative probe (executes premarket check on any invocation; not in CRON_DISPATCHED_SCRIPTS for this reason).

---

### 2026-04-27 — Lesson #37 — FOLDED into #36 during 2026-04-27 consolidation

**Original draft title:** "Scripts without --help-as-no-side-effect-probe must be excluded from --help-based smoke tests". **Folded because:** the rule is a narrow caveat to Lesson #36 (subprocess smoke tests sanitize env), not a standalone learning. Content absorbed as **"Caveat: choosing the right no-side-effect probe"** sub-section within Lesson #36 (above). See git history for original draft if curious.

---

### 2026-04-27 — code — Read-modify-write race on shared JSON array files (Lesson #38)

**Trigger:** 2026-04-27 C7-D1 fix T4 Stage B latent-bug scan. Both `pipeline/cron_log.log_cron_failure` AND its T4 fallback exhibit RMW race: `existing = json.load(f); existing.append(entry); json.dump(existing, ...)`. Empirically reproduced — 5 parallel writes → 3-4 entries persisted (1-2 lost to race). Cron-failures case is the discovery instance; the lesson is general — applies to any state file using array-rewrite append pattern.

**Pattern:** Read-modify-write of a JSON array file is racy under concurrent invocation:
1. Process A reads file → has `[entry1, entry2]` in memory
2. Process B reads file → also has `[entry1, entry2]` in memory (PRE-A's append)
3. Process A appends → memory `[entry1, entry2, entry_A]` → writes
4. Process B appends → memory `[entry1, entry2, entry_B]` (NO entry_A!) → writes → entry_A LOST

Last writer wins; concurrent reads see stale state; entries silently lost. Race window is ~10ms (read + parse + append + serialize + write), small but reproducible. Pattern instances in this codebase: `cron_failures.json` (cron-side write + audit-side write); future state files following the same pattern would have the same vulnerability.

**Why:** Cron is typically sequential per host, so the race is rare in single-host single-cron-line setups. But cron can fire multiple scripts simultaneously (e.g., chained `&&` in same cron line + parallel cron lines), AND operator-init audit running concurrently with cron could trigger. The lost-entries failure mode is silent: you don't know an entry was lost unless you compare pre-write file hash vs post-write file hash externally. As event frequency grows (more cron jobs, more failure types tracked), race probability scales.

**How to apply:**
- **For high-frequency append-only logs**: prefer line-delimited JSON (NDJSON) with O_APPEND mode (atomic up to PIPE_BUF ≈ 4KB per entry on POSIX) over array-rewrite. Trade-off: breaks `json.load(open(path))` consumers — they need line-by-line read.
- **For low-frequency rewrite-required formats**: wrap RMW with `fcntl.flock(LOCK_EX)` advisory locking. Trade-off: invisible to consumers; ~5-10 LOC overhead per writer.
- **For state files** (vs append logs) where rewrite-in-place is intentional: same flock pattern; document race-window in docstring.
- **General rule**: don't introduce new RMW patterns on shared files; if forced (legacy contract requires JSON array format), document the race + add stress test reproducing it (verifies the fix when applied).
- Mark race-prone writers in their docstring with `# RACE: RMW append; concurrent writes lose entries — see Theme 31 fix`.

**Reference:** Stage B T4 review. NOT a T4 regression (real `pipeline/cron_log.log_cron_failure` inherits same race). Captured as Theme 31 (atomic append for cron_failures.json) in `docs/future/2026-04-26-optimization-directions.md`. Real-world risk minimal (single-host cron); stress test reproducible (5 parallel writes → 3-4 persisted). Generalization beyond cron: any future state file using JSON-array-rewrite pattern (e.g., audit_state, signal_quality aggregates, etc.) inherits same vulnerability.

---

### 2026-04-27 — process — Matrix-driven test specification methodology (Lesson #39)

**Trigger:** I3 batch (Batch 2) — first matrix-driven spec batch in this codebase. 5-phase hybrid (static + empirical + reconcile + closure) replaced "list of tests" with verifiable artifact.

**Pattern:** When batch's deliverable is "test coverage for an existing system":
1. **Phase 0:** Authority declaration — name external SoTs (CLAUDE.md table, production logs, incident archive)
2. **Phase 1:** Static enumeration — what failure modes COULD production produce? (read code; consult contract docs)
3. **Phase 2:** Empirical sampling — what failure modes HAS production produced? (grep logs/incidents/audits)
4. **Phase 3:** Reconcile — disposition every (cell × failure_mode) cross-product per 6 enums (accepted_with_real_fixture / accepted_with_hypothesized_fixture / rejected_unreachable / rejected_out_of_scope / rejected_superseded / discovery_action_required); empirical-only hits MUST trigger investigation (not silently ignored).
5. **Phase 4:** Closure — spec-lock = matrix closed; impl-time additions require Plan amendment per Lesson #23.

Plus 4 cross-cutting tightenings:
- **Tier 1 fixture quality**: real `subprocess.CompletedProcess` (not MagicMock); attribute typo raises AttributeError vs silently returning Mock
- **Tier 2 failure-mode taxonomy**: cells driven by failure modes, not "1 test per call"
- **Tier 3 mutation thought experiment**: each cell's docstring articulates which production-code mutation it would catch (Lesson #14 anti-tautology operationalized)
- **Tier 4 scope-split protocol**: when test reveals prod gap (RED unexpected), HALT-and-flag per Lesson #24

**Why:** Self-confirming closed loops (Lesson #3) collapse when spec/plan/code/tests all agree but external SoT differs. Matrix architecture forces cross-validation: static (CLAUDE.md / source) ↔ empirical (logs / incidents) ↔ test fixtures (real production samples for marquee Z1 cells). Ratio of cross-validation pairs scales with cell count → robust per-cell.

**How to apply:**
- For future test-coverage batches (D1 LLM integrity, D2 lint, Layer-3): reuse 5-phase hybrid + cell schema (cell_id, fixture_source, expected_handling, expected_exception_type, mutation_thought_experiment, disposition, state_isolation_ref)
- Meta-test enforces matrix-vs-test bidirectional coverage (test_every_cell_has_at_least_one_test + test_every_test_cell_id_is_in_matrix)
- 3-real-fixture marquee anchoring: at least 3 cells with real production samples to break self-confirming closed loops
- Lesson #32 dual-form module identity (when scripts/ uses `from pipeline import` and tests use bare `import`) — A2 helpers patch BOTH module objects in setUp/tearDown

**Reference:** Spec `docs/specs/2026-04-27-i3-subprocess-test-coverage-design.md`, plan `docs/plans/2026-04-27-batch2-i3-subprocess-test-coverage.md`, commits e76bb26 / 18056df / 5cf42d8 / 6f5627e / 28d9aff / d4daec9 / abb99b4 / b010e60 / fd6abc2.

---

### 2026-04-28 — process — Self-stress-test structurally drifts; "0 findings" is suspicious signal (Lesson #40)

**Trigger:** Batch 5 D1 LLM Integrity Gate design session. Spec self-stress-test claimed "0 CRITICAL / 0 SIGNIFICANT" — author signed off as clean. User pushed: "根据 lesson learned 再认真审一下". Re-audit caught 1 CRITICAL + 6 SIGNIFICANT + 10 MINOR. Same pattern repeated for plan: first self-test "0 findings", re-audit caught 1 CRITICAL + 7 SIGNIFICANT + 5 MINOR. Then independent reviewer (fresh eyes, ran Python against real production data) caught **18 NEW findings** my self-tests had entirely missed (3 CRITICAL: `_resolve_anchor` couldn't parse `<TICKER>.US.<field>` paths; `build_anchor_pack` failed on list-format prev day; holdings dotted-path couldn't escape ticker keys with dots).

**Pattern:** Same-author self-stress-test of own design work systematically drifts. The "0 findings" verdict from self-review is not a clean signal — it's a Lesson #19 plausible-narrative drift signature. The self-reviewer is the same person who wrote the design, sharing all the same blind spots, mental model gaps, and unexamined assumptions. They cannot easily catch what they didn't think of in the first place.

**Why:** Self-review reads what was intended (memory of design intent), not what was written (literal text). Author's mental model fills in gaps that the actual text doesn't cover. The "0 findings" verdict reflects the author's *belief* that the design is sound, not empirical evidence that it is.

**How to apply:**
- "0 findings" from self-stress-test of one's own design work is **never a clean signal**. Treat it as preliminary; require independent verification.
- Independent reviewer subagent (preferably running code against real data, not just reading the doc) is the next layer.
- For high-stakes design (multi-task plans, architecture decisions, spec docs >1000 LOC): mandate at least one independent reviewer pass BEFORE any implementation begins. The cost of fixing a design flaw at impl time is 10x the cost at design time.
- When invoking reviewer, include explicit instruction: "Don't recapitulate findings already fixed; surface NEW findings that fresh eyes catch via empirical verification."
- Fresh-eye empirical verification (running snippets, grep'ing production state) is what breaks self-confirming closed loops (Lesson #3).

**Reference:** Batch 5 D1 design session. 3 self-stress-test rounds (claimed "0 findings" twice initially) all missed the 3 CRITICAL findings independent reviewer caught via direct Python execution against real `data/2026-04-22.json` and `pipeline/data_io.py`. Spec commits 24f6381 / 3809a8a + plan commit d4d65ac (self-tests, partial coverage); 756e8f9 (reviewer cycle 1, 18 findings) + eee94b3 (reviewer cycle 2, 5 more findings).

---

### 2026-04-28 — code — Production-data value-type heterogeneity (string-typed numerics coexisting with float) (Lesson #41)

**Trigger:** Batch 5 D1 design session reviewer cycle 2. After fixing 3 CRITICAL findings (one of which was list-vs-dict shape heterogeneity), reviewer empirically discovered a THIRD heterogeneity dimension: production market_data files have 3 value-type shapes coexisting:
- Dict-format with **float** values (4/22 — source: `ibkr_history_backfill`)
- List-format with **string** values (4/23, 4/24 — legacy longbridge)
- Dict-format with **string** values (4/27 — source: `longbridge_quote_realtime`)

`build_anchor_pack(date(2026, 4, 22))` synthesized prev_close from string-typed 4/21 prev day, then crashed on `(today_last:float - baseline:string) / baseline:string * 100` arithmetic — `TypeError: unsupported operand type(s) for -: 'float' and 'str'`.

**Pattern:** When data flows through multiple producer paths over time, value-type heterogeneity accumulates silently. A spec's Lesson #2 sanity-check that only verifies *container* shape (list vs dict) misses *value type* drift. Both must be verified.

**Why:** Producers serialize numerics differently:
- Backfill code (Python) writes floats verbatim: `387.70`
- Longbridge JSON deserialization preserves source format: `"387.70"` (string)
- IBKR API responses contain mixed (some fields string, some float)

These coexist because no migration pass coerced legacy files. Forward code that does arithmetic on the values will TypeError on heterogeneous reads.

**How to apply:**
- Lesson #2 sanity-check template should explicitly verify TRIPLE heterogeneity:
  1. **Container shape**: dict vs list (post-Phase-3 vs legacy)
  2. **Numeric value type**: float vs string (per producer source)
  3. **Null vs missing**: explicit `null` value vs absent key (different producers handle differently)
- Any code that does arithmetic on numeric reads must coerce defensively: `float(v)` or `int(v)` with `try / except (TypeError, ValueError) → INDETERMINATE`.
- New helper convention: `_to_float(v)` returns None on failure; arithmetic guarded by `if x is not None`.
- For schema drift detection: include value-type assertion in fixture tests (`assertIsInstance(quote['last'], float)` for new dates).

**Reference:** Batch 5 D1 reviewer cycle 2 (commit eee94b3). Empirically reproduced via plan's own `build_anchor_pack(date(2026, 4, 22))` snippet — crashed on first ticker before function returned. Fix: `_to_float` helper in `build_anchor_pack` + same coercion in validator's percent/dollars/count paths + `verify_fact_future` threshold compare. Distinct from Lesson #25 (semantic-vs-type field classifier) — that was about `or`-fallback semantics for strings vs numerics; this is about WIRE-FORMAT type heterogeneity within a single semantic field.

---

### 2026-04-28 — process — Reviewer cycles are adversarial discovery, not one-shot (Lesson #42)

**Trigger:** Batch 5 D1 design session. Independent reviewer cycle 1 caught 18 findings (3 CRITICAL + 10 SIGNIFICANT + 5 MINOR). All fixed inline. Reviewer cycle 2 (verifying fixes don't introduce new issues) caught **2 NEW BUGS** my fixes had introduced (string×float TypeError in arithmetic) + 3 minor fixes-of-fixes. Two cycles caught ~23 findings total; my self-tests caught ~0 of these.

**Pattern:** Reviewer cycles are not one-shot validation — they are adversarial discovery rounds. Each cycle catches:
- Cycle 1: Original design defects
- Cycle 2 (post-fix): NEW bugs introduced by fixes themselves
- Cycle 3+ (rare): Residual bugs from cycle 2 fixes (diminishing returns)

The pattern is structural: any fix has non-zero probability of introducing regressions, especially when the original code was design-stage (not yet stress-tested in production).

**Why:** Fixes for CRITICAL findings often touch core algorithms (e.g., my `_tokenize_path` rewrite + `_lookup_quote` introduction). Any non-trivial fix has new edge cases. Reviewer cycle 2 catches these because cycle-2 reviewer is fresh-eyed about the FIX (not the original design).

This is different from Session 9 stress-test 2-pass pattern (same author re-reading own work). Cycle 2 reviewer is independent agent re-checking against real data after fixes land.

**How to apply:**
- For high-stakes design work (multi-task plans, atomic landing groups, spec docs that gate 20+ hours of impl):
  - Cycle 1 reviewer pass on fresh design — expect to find issues
  - Apply fixes inline
  - **Cycle 2 reviewer pass on the fixes** — expect MORE issues (fixes introduce regressions)
  - Apply cycle-2 fixes inline
  - Cycle 3+ rare; if cycle 2 catches >5 new findings, scope to cycle 3 may be warranted
- Mandate cycle-2 reviewer prompt: "Don't recapitulate the original 18 findings — assume those are real and the fixes are claimed. Verify the FIXES."
- Budget reviewer time accordingly: ~2 cycles × 30-45 min each = 1-1.5h reviewer time per batch.
- Cycle-2 finding rate >2-3x signals systematic blind spot (e.g., my type-coercion blind spot — surfaces in ALL arithmetic paths, not just one).

**Reference:** Batch 5 D1 design session. Cycle 1 (commit 756e8f9): 18 findings, mostly anchor resolution + value-type. Cycle 2 (commit eee94b3): 5 findings, all my fixes' new TypeErrors. Total reviewer dispatches: 2; total findings: 23; cost: ~2h reviewer + ~3h my fix application. Saved estimated 10-20h impl-time debugging from spec-faithful-but-broken plan code.

---

### 2026-04-29 — process — Producer prompt rules + data assembly are coupled (Lesson #43)

**Trigger:** Batch 5 D1 Task 6 A/B regression iter 1 + iter 2. Producer prompt rules P1-P15 were carefully drafted (P1 anchor citation discipline / P11 Call 2 cross-validation against anchor_pack / P12-P15 various) but iter 1 + iter 2 both failed L5 incidents — not because P-rule wording was wrong, but because **producer's prompt input data didn't include the data the rules required**. Iter 1 root cause: P1 used qualifier names (`regular_close`) as JSON paths instead of actual fields (`last`) — fixed by P1 wording. Iter 2 root cause (post-P1-fix): producer couldn't see AH/PM/synthesized/market_data_prev/FRED data because `build_market_context` only emitted regular session — meaning P11 Call 2 cross-validation against anchor_pack was **architecturally unenforceable** (producer couldn't cite what it didn't see). C0 audit gap matrix (`tmp/c0_audit_gap_matrix.md` 514 LOC) empirically built: 14 P-rules × current data exposure → headline gap "anchor_pack data exists but doesn't reach producer prompts; Call 2 violates spec §5.4 P11 architecturally". Iter 3 (C2+C3 data routing fix) closed the gap.

**Pattern:** When adding new producer prompt rules (P-rules), the rules are unenforceable if the data they reference isn't in the producer's prompt input. Plan templates that add rules without auditing producer's prompt input data leave rules half-broken. Producer behavior is emergent from BOTH (a) prompt rules wording AND (b) prompt input data — modifying one without the other creates broken intermediate state.

**Why:** Producer can only cite what it sees. P1 anchor citation discipline is unenforceable if producer's prompt doesn't include the anchor data. P11 Call 2 cross-validation against `market_data_prev` + `synthesized` + `FRED` is unenforceable if `build_market_context` doesn't emit those domains. The rules become aspirational, not operational. This is Lesson #2 (sanity-check production data shape) + Lesson #22 (sanity check is brainstorm continuation) + Lesson #29 (cross-module sweep) at the prompt-architecture level: each P-rule has a data dependency contract that must be empirically verified against the producer's actual prompt input.

**How to apply:**
- Before writing P-rules, enumerate required data sources per rule. For each rule, answer: "What field(s) in producer's prompt input does this rule reference?"
- Audit current `build_*_context` functions (the prompt assemblers): list what they emit by domain (market_data / market_data_prev / synthesized / FRED / anchor_pack / etc.).
- Cross-product check: for each P-rule × required data, mark "in" or "missing". Missing entries = broken rules.
- C0 audit pattern (514 LOC empirical gap matrix): pre-implementation review with empirical evidence (run producer once, capture actual prompt, check what fields are present). Lesson #2 sanity-check at the prompt-architecture level.
- Don't iterate P-rule wording when the bottleneck is data exposure. After 1-2 iter cycles surface that data gaps are the issue, pause and audit — don't keep tweaking words.

**Reference:** Batch 5 D1 Task 6 A/B regression iter 1 (commit `2e34cc8` P1 wording fix) + iter 2 (commits `5eb28eb` C2+C3 data routing) + C0 audit `tmp/c0_audit_gap_matrix.md`. Distinct from Lesson #29 (cross-module Lesson 21 sweep) — that's about DRY / silent-swallow patterns recurring across modules; this is about prompt-rule × prompt-input-data coupling at the architectural layer.

---

### 2026-04-29 — code — Test substring rigidity should reflect semantic equivalence (Lesson #44)

**Trigger:** Batch 5 D1 Task 6 A/B regression iter 3. After C2+C3 data routing fix landed, L5-002/003/005 ground-truth tests STILL failed despite producer narrative being substantively correct. Empirical investigation: producer cited `market_data_prev.<TICKER>.last` (i.e., "yesterday's last trade price") instead of `market_data.<TICKER>.prev_close` (i.e., "yesterday's regular close"). These are **semantically equivalent** (same logical "yesterday" anchor) but exact substring different. Test framework was substring-matching the spec-prescribed string verbatim, so producer's natural variation in citation paths was penalized despite correctness.

**Pattern:** Substring-based test matching prescribes form (exact strings) instead of semantics (logical anchor). When a logical anchor has multiple semantically-equivalent surface representations (e.g., `market_data_prev.<T>.last` vs `market_data.<T>.prev_close` both denote "yesterday's price"), substring matching forces producer to one specific surface form — but producer's natural variation in citations may legitimately use any equivalent form. Penalizing the variation is testing the wrong thing.

**Why:** This is Lesson #14 anti-tautology spirit at substring-matching level: tests should evaluate substance (does the narrative cite a valid anchor?) not surface (does the narrative cite the SPECIFIC string the spec prescribed?). When multiple paths are semantically equivalent, all should pass. If the test is rigidly tied to one surface form, the test conflates "right answer" with "spec author's preferred phrasing", which is a false-correctness signal.

**How to apply:**
- For ground-truth tests with substring matching: replace single-string expectations with **synonym groups** — each "logical anchor" lists its alternative substring representations; test passes if ANY group member matches.
- Schema convention: `must_cite_anchors_min1_groups: [[group1_alt1, group1_alt2], [group2_alt1, group2_alt2, group2_alt3]]` — one group per logical anchor; min1 = at least one alternative per group must appear.
- Curate synonym groups based on producer's natural variation observed in early A/B runs — don't speculate ahead, observe and codify.
- For semantic-equivalence detection: when adding a new logical anchor to a substring fixture, immediately ask "what other surface forms could producer legitimately use?" and add them up-front.
- Avoid rigid single-string expectations for free-form narrative tests. Reserve rigid matching for highly-structured fields (JSON keys, exit codes, etc.) where surface IS the contract.

**Reference:** Batch 5 D1 Task 6 iter 4 (commit `eb9e3f7`). Implemented in `tests/_l5_ground_truth.json` `must_cite_anchors_min1_groups` field — 5 incidents × 2-4 synonym groups each. Distinct from Lesson #14 (anti-tautology in test design) — that's the philosophical principle; this is the concrete substring-vs-synonym implementation pattern when narrative tests are required.

---

### 2026-04-29 — process — A/B regression iteration is exploration, not validation (Lesson #45)

**Trigger:** Batch 5 D1 Task 6 A/B regression went **4 iteration cycles** for first deployment, each surfacing new root cause patterns. Iter 1 (P-rule wording bug) → iter 2 (data assembly gap from `build_market_context`) → iter 3 (architectural P11 violation closed by C2+C3 routing) → iter 4 (producer omission of portfolio tickers, fixed by P16 INVIOLATE rule). At no point did I expect "iter 1 will pass cleanly" — but I also didn't budget for 4 cycles. Reality: each cycle revealed deeper coupling not visible until the prior cycle's fix exposed it.

**Pattern:** A/B regression on a complex producer change is **exploration territory, not validation**. First run reveals surface symptoms (typos, prompt ambiguity); subsequent runs uncover deeper coupling (data assembly, architectural gaps, producer behaviors). Each fix has non-zero probability of exposing a previously-hidden issue. Treating A/B as "single-shot validation gate" → user surprised by 2nd, 3rd, 4th iter.

**Why:** Producer behavior is emergent across many P-rules + input data + downstream consumer expectations. Static analysis (spec stress-tests, even with reviewer cycles per Lesson #42) catches first-order issues, but emergent issues only show under real LLM execution against real data. Dynamic exploration (A/B run) reveals the coupling. Plus: each fix introduces new edge cases (cousin of Lesson #42 — but at producer level, not validator level).

**How to apply:**
- **Plan A/B as iteration cycle, not validation gate.** Each iter has implicit "expected to fail" hypothesis until proven otherwise. Track surface symptom → root cause → fix → next iter.
- Budget for 3-5 iter cycles for first deployment of a complex producer change. Estimate $5-10 LLM cost per iter (smoke + full 7-day run). For Batch 5 D1: actual was 4 iters at ~$10-15 each = $40-60 just for A/B (excluding extractor token-budget debug, judge runs, etc.).
- Each iter, before fixing, **diagnose the root cause empirically** before tweaking. Lesson #43 C0 audit pattern applies — when P-rule wording iter doesn't fix it, audit data exposure before iterating prompt wording further.
- Operator caveat: communicate A/B as "iteration cycle, expect 3-5 cycles" to user. Avoids surprise at iter 2/3/4.
- A/B "passing" criterion is met when 2+ consecutive iters show clean L5 + Layer 3 judge + operator review. Single-iter pass should be considered tentative, not done.

**Reference:** Batch 5 D1 Task 6 A/B 4-iter exploration. Iter 1 (P1 wording) + iter 2 (`2e34cc8`) + iter 3 (`5eb28eb` data routing) + iter 4 (`eb9e3f7` P16 + L5 softening). Logs in `tests/ab_results/`. Total LLM cost across iters ≈ $40-60. Lesson surfaced at end of iter 4 retrospect: I budgeted 1-2 iters initially; reality 4. Distinct from Lesson #42 (reviewer cycles are adversarial discovery) — that's about static review of a specific design artifact; this is about dynamic A/B regression of producer behavior emerging from prompt × data × consumer interaction.

---

### 2026-04-29 — process — Atomic landing requires path-based extraction when branch has mixed scope (Lesson #46)

**Trigger:** Batch 5 D1 Task 7 Group A atomic landing on main. The `batch5-d1-wip` branch had **3 different scopes co-mingled**: Phase 0 prep work (anchor_pack + extractor + validator + fixture matrix; future Group B), Group A producer changes (build_prompt P1-P16 + dual-handler), and Phase 0 testing/iteration artifacts. Task 7 needed to land Group A as ONE atomic commit on main (per Lesson #6 — interdependent producer + dual-handler must ship together to avoid broken intermediate state) — but couldn't simply merge the whole branch (too much Group B + Phase 0 code mixed in). `pipeline/data_io.py` specifically had Group A (dual-handler from commit `59cbdcc`) co-mingled with Group B (build_anchor_pack + 4 path_for kinds from prior commits) in the SAME file.

**Pattern:** When a feature branch has multiple landing groups co-mingled, atomic squash to main requires **3-tier extraction strategy**:
1. **Path-based git checkout** for files exclusively touched by one group (pure-A: build_prompt.py, build_signal_prompt.py, regenerate_analysis.py, x_writeback.py, tests, docs)
2. **Cherry-pick** for shared-file commits when a single commit isolates the change scope (data_io.py: cherry-pick `59cbdcc` only — that one commit was clean Group A)
3. **Manual surgery** only as last resort, when commits genuinely mix scopes within a single file. Avoid this when possible.

**Why:** Lesson #6 atomic landing intent: interdependent changes ship together, non-interdependent changes ship separately. Path-based extraction maintains atomic-commit integrity (Group A = one main commit) without polluting downstream landing groups (Group B's build_anchor_pack stays on staging branch until Task 8). Manual surgery within shared files risks accidentally pulling in scope or breaking diff readability.

**How to apply:**
- **Pre-landing audit**: identify which files are pure-A vs shared. For shared files, identify commits — is there a single commit that isolates the scope? If yes → cherry-pick. If no → manual surgery (rare; flag as design debt — earlier commit boundaries should have been more atomic).
- **Verification post-extraction**:
  - `git diff --name-only main..staging-branch` should NOT include downstream group files (e.g., no `build_anchor_pack` reference if Group A only)
  - Test suite passes on staging-branch → main
  - Audit-clean gate (pre-existing pattern per Lesson #28)
- **Staging branch convention**: create short-lived `group-a-staging` branch, do extraction there, fast-forward merge to main, delete after. Keeps `batch5-d1-wip` (long-lived) clean for Group B/C/D iteration.
- **Document in commit message**: Group A atomic commit body lists the files extracted, the cherry-pick (`Cherry-picked: 59cbdcc`), and the explicitly-excluded scopes (Group B build_anchor_pack + path_for kinds excluded).

**Reference:** Batch 5 D1 Task 7 Phase 2 (commit `4b16d2d` on main). Path-based: 9 files checked out from staging. Cherry-pick: data_io.py `59cbdcc` only. Manual surgery: 0 (avoided). Final: 10 files / +2214 LOC / 53 new tests. Staging branch `group-a-staging` deleted post-merge. Distinct from Lesson #6 (atomic landing for interdependent changes) — that's the WHEN principle; this is the HOW mechanic when branch has mixed scope.

---
### 2026-04-29 — process — Audit-driven bug discovery during recovery surfaces latent pre-existing issues (Lesson #47)

**Trigger:** Batch 5 D1 Group B Task 8 Session 12. Q4 audit gate (per Lesson #28 audit-clean methodology) was a pre-Stage-1 prerequisite. Audit reported gaps (4/27+4/28 missing llm_daily/signal_events) — root-cause investigation: 4/27 cron preflight failed (data file missing at 13:30 PT) → 4/28 cron audit-gate-failed (refused to proceed because 4/27 unfixed). Recovery plan: backfill fred + regenerate 4/27 + 4/28 → re-audit. Recovery DID succeed at file-presence level (audit went clean), BUT the regenerate flow exercised x_writeback's actual code path → exposed that EVERY writeback since 2026-04-26 had been silently failing with "All N events invalid; preserving prior data" exit 4. Root cause: commit `d23d985` (4/26 02:35 PT, "F-017 hardening") added `created_at` + `market_context` to REQUIRED_FIELDS as "defense-in-depth" — but `validate_event` ran in Phase 2 BEFORE `enrich_event` in Phase 4 set those fields. 3-day latent bug masked by file-presence audit (which doesn't check DB writeback success). Without recovery work, would have stayed latent until Group B Stage 2 production hit it for the FIRST time.

**Pattern:** Recovery operations exercise downstream code paths that fresh data doesn't. When you do audit-driven recovery during planned work:
- File-presence audit answers "does the file exist?" — NOT "is the file content correct?"
- Recovery (regenerate / backfill / re-import) re-runs code that may have silent regressions
- Latent bugs from prior commits surface during these re-runs
- The bug is NOT new — it's been there. The recovery just made it observable.

This converts recovery from "annoying side-track" into "valuable diagnostic step": treat surfaced bugs as findings to fix, not as blockers to dismiss.

**Why:** This is Lesson #2 (sanity-check production data shape) at the runtime level, plus Lesson #5 (fail-loud) from the OBSERVER's side: pre-existing bugs were fail-loud (exit 4 + log warning) but no one was watching the right log. Audit-driven recovery automatically watches. Plus Lesson #28 audit-clean gate methodology — the gate isn't just clean-or-not, it's an opportunity to surface latent issues during regular hygiene.

**How to apply:**
- **Don't dismiss surfaced bugs as "orthogonal — fix later"** when doing recovery. They may block downstream work that depends on the same code path.
- **Triage immediately**: is this a real bug? File issue / Plan Amendment / fix in line with current work? Escalate as needed.
- **Pre-Group-B fixes pattern**: when bug is blocker for upcoming work AND scope-disjoint with current work, land as separate atomic on main BEFORE main work proceeds (Session 12 Stages 0 + 0a are this pattern: 2 commits on main fixing F-017 phase ordering, before Stage 1 of Group B starts on staging branch).
- **Audit gates have hidden value**: design them to surface as much as possible. File-presence is minimum — also consider sample-DB-row-correctness, schema-version checks, sentinel-value detection (e.g., "if any signal_events row has NULL validation_verdict post-Stage-2-landing, alert").
- **Follow the bug to its commit**: `git log --oneline -p -S "<token>"` finds the commit that introduced the regression. Useful for understanding scope + writing the fix commit message with proper attribution.

**Reference:** Batch 5 D1 Session 12 Stage 0 fix (commit `345dc97` on main). Bug introduced 2026-04-26 02:35 PT (commit `d23d985`); detected 2026-04-29 ~12:00 PT during Q4 audit recovery; 3 days latent. 7 new tests + Stage 0a fix iteration (commit `b7f7100`) for code-quality minors. Distinct from Lesson #28 (audit-clean gate methodology) — that's the discipline; this is the structural feature that recovery work exposes latent bugs.

---

### 2026-04-29 — design — When reordering function role in pipeline, audit ALL responsibilities not just the headline one (Lesson #48)

**Trigger:** Batch 5 D1 Session 12 Stage 0 implementation. Spec said "reorder phases so enrich runs BEFORE validate" (to fix F-017 phase ordering bug — `created_at` + `market_context` REQUIRED but enrich-set). Implementer started literal reorder but hit a problem: `validate_event`'s F-018 enum check (line 134-144) iterates `for item in val` over `catalyst_type` etc. assuming `val` is a list. After enrich runs first, `enrich_event` ALSO serializes JSON_ARRAY_FIELDS to JSON-strings (line 272-283) — meaning by validate-time the field is a JSON string `'["earnings"]'`, and `for item in val` iterates over CHARACTERS, each failing the enum check. Literal reorder = correctness regression on a different invariant.

The implementer's fix per Lesson #24 Adaptation Rights: split `enrich_event` into `_enrich_event_metadata` (sets created_at + market_context + ticker-derived fields, but does NOT serialize arrays) + `_serialize_array_fields` (serializes JSON_ARRAY_FIELDS only). Public API of `enrich_event` preserved (still calls both helpers in sequence). Phase order: load → schema_dispatch → setup_loads → enrich-metadata → validate → empty-protection → serialize-arrays → write. This split was driven by the empirical breakage, not by initial spec design.

**Pattern:** When a function has MULTIPLE responsibilities + the spec says "reorder its position in the pipeline":
- Headline responsibility motivates the reorder (e.g., F-017 wanted enrich BEFORE validate so validate sees enriched fields)
- Secondary responsibilities may have their own invariants that depend on the OLD position (e.g., F-018 enum check assumed validate sees raw lists, which only holds if validate runs BEFORE the JSON-serialize step)
- Literal reorder breaks secondary invariants silently (F-018 enum check still runs but iterates over wrong types)
- Solution: function-split — extract each responsibility into its own helper, place each helper at its correct position in the pipeline, preserve public API for backward compatibility

**Why:** This is the Single Responsibility Principle in reverse — when a function ALREADY violates SRP (multiple responsibilities), changing its position in the pipeline forces the SRP refactor. The spec author may have been thinking about responsibility A; the reviewer/implementer must audit responsibilities B/C/D too. This is also Lesson #29 (cross-module integrity sweep) at the function-internals level: don't just ask "does the function still work in the new position" — ask "do all CONSUMERS of the function's outputs still work given the new position".

**How to apply:**
- **Pre-reorder audit**: list ALL responsibilities of the function. For each, ask: "Does the new position break any consumer's invariant?"
- **Run existing tests on a literal-reorder prototype** BEFORE adopting the literal reorder. Failing tests reveal secondary-invariant breakage.
- **Function-split when split is forced**: don't try to make the multi-responsibility function "work in both positions" — that's accidental complexity. Split + place each helper correctly.
- **Preserve public API as a thin wrapper**: external callers shouldn't have to update. Internal pipeline calls helpers directly.
- **Document the rationale** in helper docstrings + commit message (per Lesson #5 fail-loud at the documentation level — if a future maintainer tries to merge them back, they should see WHY they're separate).
- **Test mutation-thinking**: write a test for each responsibility's invariant in its position, so a future regression reveals which invariant broke.

**Reference:** Batch 5 D1 Session 12 Stage 0 (commit `345dc97`) `pipeline/x_writeback.py`. `enrich_event` had 2 responsibilities: set metadata (created_at / market_context / source_category / ticker-derived fields) + serialize JSON_ARRAY_FIELDS. Split into `_enrich_event_metadata` + `_serialize_array_fields`. Public API `enrich_event(event, config, holdings, analyzer_data, market_context) -> dict` preserved; calls both helpers in sequence. 7 new tests anti-tautology Lesson #14 covering each invariant + Phase ordering. Distinct from Lesson #6 atomic landing (interdependent changes ship together) — that's the WHEN principle for shipping; this is the HOW principle for refactoring multi-responsibility functions when their position in the pipeline changes.

---

### 2026-04-29 — process — Audit-clean gate strictness varies by commit type (code-only vs data-dependent) (Lesson #49)

**Trigger:** Batch 5 D1 Session 12. Production cron at 2026-04-29 13:30 PT failed during Call 1 with claude -p auth expired ("Not logged in · Please run /login" in raw output) — spec §15 #5 manifestation. Result: 4/29 data files missing (data/fred-2026-04-29.json + data/analysis/llm_daily_2026-04-29.json + data/analysis/signal_events_2026-04-29.json) → audit reported critical_gaps. Strict reading of Lesson #28 audit-clean gate methodology says "every commit on staging branch goes through audit-clean gate" — would have blocked Stages 4 / 6 / 7 / 9 (all happening AFTER the cron failure surfaced). But: those stages are CODE-ONLY (no data writes; gitignore changes, test additions, doc updates, code refactors of validator.py/extractor.py). Their correctness doesn't depend on 4/29 data being present. Pragmatic resolution: ack the cron failure with note documenting auth issue + document gap as environmental + proceed with code-only commits.

**Pattern:** Lesson #28 audit-clean gate methodology has been applied as "every commit must have audit clean." But that's TOO strict — it conflates two different invariants:
- (a) **Data integrity preservation**: don't ship code that touches data while data has known gaps (could compound the issue)
- (b) **Code-only correctness**: commits that don't touch data can land regardless of data integrity status

Differentiating:
- **STRICT audit-clean required** for: schema migrations (write to DB), fetch / regenerate / backfill ops (write to data/), any commit that writes to `data/` or `x.db`, anything that depends on a specific date's data being present
- **ACK-with-note OK** for: gitignore changes, test file additions, doc updates, code refactors that don't touch data, CI/lint changes, commits to scripts that don't run by default

The ack-with-note pattern: document what the gap is + why it's environmental (vs commit-causal) + when/how it'll be closed (e.g., "user re-auth needed; spec §15 #5 known followup"). Future-self can disambiguate "this commit ack'd a gap because environmental" from "this commit caused a gap" via git blame on the audit_data ack timestamps.

**Why:** Lesson #28's intent was "don't ship code that breaks data integrity in undetected ways." That's a real invariant. But it doesn't mean "don't ship ANY code while data has known issues." Pragmatic operational continuity matters: if a 4-day cron fails because of auth expiry, work shouldn't stop on every other code change for 4 days. Lesson #28 strict reading creates audit-clean gate deadlock when the gap is environmental + the gate-enforcer is humans who can also do other work.

This is also Lesson #15 file-based state semantics: the cron_failures.json is forensic / audit-trail; it doesn't gate code commits. Audit-clean is a GATE, not a STATUS.

**How to apply:**
- **Triage the gap before committing**: is it commit-causal (code change introduces gap) or environmental (auth, network, hardware, external service)?
  - Commit-causal → STRICT block + fix + verify clean before commit
  - Environmental → ack-with-note + document in commit message + proceed for code-only commits + STRICT block for data-touching commits
- **Commit-message audit-state note**: when ack-with-note pattern, include in commit message the known-gap state + the environmental reason + the planned closure path. Example: "Audit state note: 2026-04-29 cron failed with claude -p auth expired (spec §15 #5); 4/29 gap will persist until operator re-authenticates + next cron writes 4/29 outputs. Failure timestamp ack'd to keep audit-state coherent. Orthogonal to <commit-scope> (pure code-only change, no data dependency)."
- **Don't hide the gap**: ack but document. Audit clean post-ack is FALSE-clean for the operator; the note in commit message preserves the truth.
- **Use commit type as STRICT vs ACK heuristic**: `git diff --name-only HEAD~1 HEAD | grep -E 'data/|x\.db'` non-empty → STRICT; empty → ACK-with-note OK.
- **Track environmental gap closure**: when auth restored / hardware fixed / network restored, close the gap (re-run failed cron / backfill missing dates) + remove ack note in next session-log entry.

**Reference:** Batch 5 D1 Session 12 Stages 4 / 6 / 7 / 9 (commits `f4c53ba`, `77f25a6`, `efb34e5`, `3a2f930`). All 4 are code-only changes (test/doc/lint/script additions); none write to `data/` or `x.db`. cron failure 2026-04-29T20:30:02 ack'd with note in Stage 4 commit message; gap remained until end of session (user re-auth pending). Distinct from Lesson #28 (audit-clean gate methodology) — Lesson #28 says WHAT to gate; this Lesson refines WHEN strict vs flexible. Distinct from Lesson #5 (fail-loud) — Lesson #5 says don't silence failures; this Lesson says document + acknowledge per environmental cause without blocking unrelated work.

---

### 2026-04-29 — code/operational — Recovery scripts must enforce producer schema version explicitly (Lesson #51)

**Trigger:** Batch 5 D1 iter 5 Session 13. 4/29 first attempted v2 D1 production catch was actually v1-vs-v2 mismatch — operator's manual `python3 pipeline/regenerate_analysis.py --date 2026-04-29` silently ran v1 producer (no P1-P16) because operator's shell didn't have `BATCH5_USE_V2_PROMPTS=1` exported. regenerate_analysis.py's docstring (Stage 7 of Session 12) noted "BATCH5_USE_V2_PROMPTS=1 set in the parent env, subprocess.run inherits the env automatically" — but the docstring assumed parent env has it set. Cron path (`pipeline/run_daily_analysis.sh:38`) sets `export BATCH5_USE_V2_PROMPTS=1`, so cron is fine; manual operator workflow has the footgun.

**Pattern:** Recovery / re-execution scripts that depend on producer schema version (or any feature-flag env var) must enforce the version explicitly via:
- CLI flag (`--use-v2-prompts {1,0,auto}`)
- Default to "auto" mode that checks env first, falls back to current-stable schema if unset
- Emit WARNING when defaulting silently (operator visibility per Lesson #5 fail-loud)
- Log the final mode at startup (operator can verify which mode is active)

**Why:** Silent fallback to legacy mode when caller's environment is incomplete creates false-positive "production catch" signals. v1 producer through v2 D1 gate naturally fails (v1 has no P1-P16) — looks like a v2 producer bug, but is actually v1 producer mis-routed. Wastes investigation cycles + misleads about production state.

**How to apply:**
- Any script that subprocess to producer/consumer with feature-flag env vars: add explicit CLI flag for the mode
- Default behavior should pick the current-stable mode (not silent legacy fallback)
- WARNING when env unset + defaulting (so operator sees the auto-default decision)
- INFO log of final mode at startup
- Update docstring to specify "default behavior" not just "inherits env"

**Reference:** Batch 5 D1 iter 5 F4 fix (commit `98c2a73`) — `pipeline/regenerate_analysis.py` adds `--use-v2-prompts` CLI flag + `_apply_v2_prompts_mode()` env mutation + WARNING. Empirically demonstrated by F8 verification run with `unset BATCH5_USE_V2_PROMPTS` triggering WARNING + defaulting to v2. Distinct from Lesson #5 (fail-loud) — that's about errors; this is about feature-flag silent fallback.

---

### 2026-04-29 — process — Lesson #40 self-stress-test drift recurs even after explicit invocation (Lesson #52)

**Trigger:** Batch 5 D1 iter 5 Session 13 4/29 evening investigation chain. Orchestrator (me) declared analysis "thorough" or "robust" at three separate points; user pushed back THREE times ("现在这个查得是否足够 thorough" / "现在的 action 是否考虑十分周全或是 robust 了" / "这样修得是否足够完善"). Each pushback triggered re-audit + new findings:
1. First pushback (after initial 4/29 D1 catch claim): orchestrator hadn't even read the producer prompt; re-audit revealed v1 vs v2 mismatch (entire investigation premise was wrong)
2. Second pushback (after orchestrator's PA matrix proposal): orchestrator hadn't dispatched independent reviewer; pushback triggered reviewer dispatch; reviewer found 12 findings + 4 NEW PAs orchestrator missed entirely
3. Third pushback (after reviewer findings + fix plan): orchestrator's deferred-vs-fix scope decisions weren't justified empirically; pushback triggered re-evaluation with empirical evidence; smaller defer scope adopted

**Pattern:** Lesson #40 self-stress-test drift is more pernicious than the original lesson captured — it RECURS even when the orchestrator EXPLICITLY invokes Lesson #40 awareness. Pattern: "I think I've been thorough" claim is itself the suspicious signal. Mitigation requires:
- Dispatch independent reviewer EARLY (not as last resort after self-confidence built up)
- Treat declared-thoroughness as triggering automatic re-audit
- User pushback IS the de-facto Lesson #40 invocation; respond with action (dispatch reviewer / re-audit) not assurance ("yes I'll be more thorough")

**Why:** The author's mental model creates internal coherence even when external reality differs. Self-review reads what was intended (memory of design intent), not what was written or what's actually true. Independent reviewer brings empirical fresh-eyes verification (running Python against real data, grep'ing prompts, etc.) that cannot be replicated by self-reflection.

**How to apply:**
- For high-stakes investigation work (multi-hour debug, root-cause analysis, fix planning): dispatch independent reviewer subagent EARLY in the process, not after self-confident analysis
- Heuristic: if orchestrator has claimed "thorough" or "comprehensive" at any point, that's the trigger — dispatch reviewer NOW, not later
- Reviewer prompt should explicitly say "find what I missed" not "verify my analysis" (per Lesson #40 cycle 1 reviewer formulation)
- Budget reviewer cycles into investigation timeline upfront — assume orchestrator will need 1-3 reviewer cycles for any non-trivial investigation
- User pushback patterns ("是否足够 thorough" / "robust" / "完善") are operationally equivalent to Lesson #40 invocation — respond with action

**Reference:** Batch 5 D1 iter 5 Session 13 investigation chain. Three user pushbacks led to: v1 vs v2 mismatch discovery (after pushback 1), reviewer cycle 1 finding 12 + 4 NEW PAs (after pushback 2), defer-scope re-evaluation (after pushback 3). Independent reviewer dispatched only after pushback 2 — should have been first action per this lesson. Distinct from Lesson #40 (self-stress-test drift in design work) — that's the original; this is the recursion pattern.

---

### 2026-04-29 — process — PA framing systematically under-counts sister manifestations (Lesson #53)

**Trigger:** Batch 5 D1 iter 5 Session 13. Orchestrator framed 9 PAs (PA-1 through PA-9) based on observed FAILs/INDETs in 4/29 v2 production output. Reviewer cycle 1 found:
- **PA-1**: orchestrator framed as 1 case (C126 PLTR `synthesized.day_pct_change`); reviewer found 7+ sister cases where extractor CORRECTLY omitted baseline but validator hard-INDETs (DOMINANT manifestation is validator-side, not extractor)
- **PA-2**: orchestrator misattributed to "P3 not propagated" producer/spec issue; producer DID follow P3 — actual issue is extractor pattern-recognition gap
- **PA-5**: orchestrator framed as "bp not in extractor unit vocab"; actual root cause is same as PA-1 (validator's "all percent claims = recompute" assumption)
- **PA-7**: orchestrator framed as "tolerance issue"; actual cause is data-pipeline race (PA-11 architectural reframing)
- **PA-9**: orchestrator framed as "anchor pack data gap"; actual cause is producer prompt fabrication (PA-10 reframing)

5 of 9 PAs were materially misattributed or under-counted by orchestrator's first-pass framing.

**Pattern:** When categorizing FAIL/INDET findings into PA buckets, orchestrator tends to:
- Frame PA from FIRST observed instance — misses sister cases that share root cause
- Attribute to obvious surface layer (e.g., "extractor classified wrong") — misses underlying data-pipeline race or validator assumption
- Treat each FAIL as independent — misses that 5 cushion FAILs all share single root cause (PA-3)

Reviewer with fresh eyes runs systematic sweep across ALL findings + checks attribution against code. Catches sister manifestations + reframes to actual root cause layer.

**Why:** First-pass PA framing is anchored on the first observed example. Sister manifestations require systematic sweep (grep all FAILs for similar pattern; trace each through full code path). Self-review tends to validate first framing rather than rebuild from scratch.

**How to apply:**
- After initial PA framing, systematically sweep ALL findings (not just the marquee ones) for sister manifestations
- For each PA, ask: "what other observed findings could share this root cause?" Run grep across validation report.
- For each PA's attributed layer, verify by reading the code path (not just inferring from FAIL message)
- Reviewer cycle 1 must explicitly check PA attributions + sister manifestation enumeration
- "1 case found" is suspicious; expect 2-10 sister cases for any given root cause
- Reviewer prompt: "for each PA, verify attribution and find sister cases; reframe if attribution is wrong"

**Reference:** Batch 5 D1 iter 5 Session 13 cycle 1 reviewer findings (in `tasks/a9f1a60dd3fcf4b9c.output`). Verified by F3 fix needing to handle 7+ sister cases (synthesized.day_pct_change + fred.delta + rate-typed fred.latest) not just C126 PLTR alone. Distinct from Lesson #14 (anti-tautology in test design) — that's about test specificity; this is about PA categorization completeness.

**Extension — Empirical validation findings (Bronze Tier DI episode, 2026-05-01):** When an empirical validation phase (not just PA categorization) surfaces a spec gap, sister manifestations arise from the same root cause (insufficient sample diversity at spec-authoring time). T12 empirical validation phase found Issue A (4 missing schema columns — spec authored from ONE sample verdict, a simple PASS that never triggered P17/percent code paths). Structured deep investigation (Phase A: field inventory from 10 production files; Phase B: semantics for each missing field; Phase C: architecture recommendation) then surfaced Issue B (dedup asymmetry: file walker emits union rows, SQL does not → `--call union` returns 608 vs 0 rows) and Issue C (test breakage: auto-detect picked production SQL backend, bypassing fixture isolation). Hotfixing Issue A alone would have left Issues B + C silently broken. Mitigation: when empirical validation surfaces a spec gap, initiate Phase A/B/C structured investigation before writing any hotfix — the gap almost always has sister manifestations at adjacent layers.

---

### 2026-04-29 — code — Producer prompt fabrication is distinct class from LLM hallucination (Lesson #54)

**Trigger:** Batch 5 D1 iter 5 Session 13 reviewer cycle 1 PA-10 finding. Investigation initially attributed 8+ INDETs to "producer hallucination" — producer cited `(per holdings.structured_notes[1].barriers.<TICKER>)` paths that don't exist in `holdings.json`. Reviewer empirically traced to `pipeline/build_prompt.py:227`: `barrier_pct = coupon.get("barrier_pct", 0.75)` defaults to 0.75 for ALL notes with starting_values, EVEN when `holdings.json:notes[1].barriers = None`. Producer prompt fabricated barrier values via `barrier = sv * 0.75` then told LLM to cite `holdings.structured_notes[1].barriers.<TICKER>` — path producer prompt itself synthesized but doesn't exist in actual holdings.

Producer was faithfully following the prompt's instructions. The fabrication was in the PROMPT CODE (deterministic synthesis), not in LLM output (stochastic).

**Pattern:** Two distinct failure classes share surface symptom ("LLM cited wrong field"):
- **Producer hallucination**: LLM invents a number or field reference not present in input data. Fix layer: prompt design (P-rules) + producer iteration cycle (A/B regression)
- **Producer prompt fabrication**: prompt CODE synthesizes data and instructs LLM to cite synthesized values via paths the data doesn't have. Fix layer: prompt-construction code (`build_prompt.py` etc.)

Misattributing fabrication as hallucination wastes producer iter cycles trying to "fix the LLM" when the bug is in the deterministic prompt assembly code.

**Why:** When debugging LLM output, default mental model is "LLM is unreliable; refine prompt rules". But prompt code can also be wrong — synthesizing data the source doesn't provide, defaulting to fabricated values, telling LLM to cite paths that don't exist. This is a CODE bug in the prompt assembler, not a prompt design issue.

**How to apply:**
- When LLM cites a wrong field/value: BEFORE attributing to hallucination, grep the prompt-construction code for that field/path
- If prompt code constructs the cited path: fabrication. Fix in code. Producer iteration not needed.
- If prompt code does NOT construct the cited path (LLM came up with it independently): hallucination. Fix in prompt design + producer iter cycle.
- Audit pattern: for each "wrong citation" finding, trace the cited path back to its source (prompt code vs LLM-generated)
- Diagnostic step in PA categorization: "is the cited path constructed by prompt code or invented by LLM?"

**Reference:** Batch 5 D1 iter 5 Session 13 PA-10 fix (commit `98c2a73`). `pipeline/build_prompt.py:225-279` (build_portfolio_section) — F2 fix conditionally skip barrier table when `note["barriers"] is None`; use `note["barriers"]` actual values when present (don't synthesize via `sv*0.75` even when actual values are present). Distinct from Lesson #43 (producer prompt rules + data assembly are coupled) — that's about prompt RULES referencing data the prompt input doesn't include; this is about prompt CODE fabricating data the source doesn't have.

---

### 2026-04-29 — process — D1 validator HALT can be "expected halt" state when all FAILs trace to deferred-and-documented PAs (Lesson #55)

**Trigger:** Batch 5 D1 iter 5 Session 13 F8 verification. After applying all 6 iter 5 fix commits, re-ran regenerate on 4/29 — validator STILL HALTed exit 8 with 6 critical FAILs. Initial alarm: "did our fixes not work?" Investigation: ALL 6 critical FAILs trace to deferred PA-3 (5 cushion convention) + PA-11 (1 tweet eng snapshot drift) — both documented in `docs/future/2026-04-29-d1-iter5-deferred.md` as iter 6 scope.

Validator HALT was "expected halt due to deferred-and-documented PAs". Iter 5 fixes worked AS DESIGNED — they eliminated all FAILs in iter 5 scope; remaining FAILs are by-design pending iter 6 closure.

**Pattern:** D1 validator HALT exit 8 (and similar gate halts) come in two operational classes:
- **Surprise HALT**: Unexpected FAIL. Requires investigation. Could be producer hallucination, validator bug, anchor pack drift, etc.
- **Expected HALT**: All FAILs trace to deferred-and-documented PAs in carry-forward catalog. No investigation needed (already analyzed); requires iter cycle to close.

Operationally these need different responses:
- Surprise → drop everything + investigate
- Expected → continue planned work; iter cycle closes when scheduled

**Why:** Without distinguishing, every chronic HALT triggers re-investigation of already-known issues — wastes operator time + creates "boy who cried wolf" alert fatigue. With distinction, deferred-PA HALTs are routine "yes still halting; iter cycle scheduled".

**How to apply:**
- For each chronic HALT, cross-reference FAIL claim_ids + reasons against deferred-PA catalog (`docs/future/...-deferred.md`)
- If ALL FAILs covered by deferred catalog → mark as "expected HALT"; document in operational notes (cron stdout WARNING / commit message / session log)
- If ANY FAIL not covered → "surprise HALT"; investigate; if root cause maps to existing PA, add to deferred catalog with new evidence; if novel, file new PA + investigate
- Audit-clean gate behavior: expected HALT can use `--set-baseline` to skip the chronic gap (per Lesson #49 environmental ack-with-note); surprise HALT requires real fix
- Operator runbook: "when seeing HALT exit 8, first cross-reference deferred-PA catalog; if covered, no action other than waiting for iter cycle"

**Reference:** Batch 5 D1 iter 5 Session 13 F8 verification + closure. v2 iter5 produced 6 critical FAILs all traced to deferred PA-3 + PA-11 (documented in `docs/future/2026-04-29-d1-iter5-deferred.md`). Audit baseline set to 2026-04-30 to allow iter 6 work to proceed (per Lesson #49 environmental gap). Distinct from Lesson #28 (audit-clean gate methodology) — that's about audit gate enforcement; Lesson #49 — that's about strictness varying by commit type; this Lesson distinguishes operational classes of HALTs.

---

### 2026-04-30 — code — Spec dispatch eligibility lists must derive from / cross-reference critical_section list (Lesson #56)

**Trigger:** Batch 5 D1 iter 6 Task 12 A/B regression iter 2. iter 6 producer + extractor + validator chain ran cleanly on 4/29 producer output, but 6 of 15 FAILs were `portfolio_impact[*].barrier_note` source_span — NOT in spec §19.1's P17 dispatch eligible_spans list. Spec §19.1 listed `portfolio_impact[*].reasoning, key_risks[*], opportunities[*]` but omitted barrier_note. However, spec §5.3 critical_section list (line 369) explicitly INCLUDES `portfolio_impact[*].barrier_note` — so barrier_note IS critical (counts toward halt threshold). The dispatch-eligibility list and critical-section list drifted out of sync in spec drafting. Empirical regression caught it: 6 cushion-class claims (the C055/C056/C097/C119/C121/C136 family) all live in barrier_note; without dispatch eligibility, validator falls through to standard percent path which uses above-barrier formula → FAIL.

**Pattern:** When a spec defines a NEW dispatch / handler / processor that operates on a subset of source_spans / fields / message types, the eligibility list MUST be derived from (or explicitly cross-referenced against) the existing canonical list of "things this concern touches". Otherwise spec author may transcribe a partial subset by hand and silently drop a cell.

**Why:** Lesson #18 INVIOLATE classification + Lesson #43 prompt × data coupling cousin: rule eligibility lists are STRUCTURAL claims about what the rule applies to. Drift between rule-eligibility-list and underlying-canonical-list is structural drift — silent and easy to miss in spec self-review (Lesson #40 + #52). Empirical regression (real prod data flowing through chain) is what catches it because there's no test fixture for "the eligibility list is exhaustive against the canonical list".

**How to apply:**
- When drafting a new dispatch / handler eligibility list, include a comment / cross-reference to the canonical source-of-truth list (e.g., "eligible spans = critical_section ∩ {types where dispatch makes semantic sense}")
- In spec self-review, explicitly check: did I enumerate the eligibility list against the canonical list? Or did I write down the cells I happened to remember?
- Add an anti-tautology test (Lesson #14): for each entry in canonical list, assert dispatch is invoked (or explicitly declared not-eligible with reason)
- For convention-aware dispatches (P17 + future P-classes), structure eligibility as "all critical sections containing relevant data fields" not "list of specific section names from spec author's head"
- Plan-stage cycle-1 reviewer should verify dispatch-eligibility ↔ canonical-list mapping

**Reference:** Batch 5 D1 iter 6 Task 12 cycle-2 fix (commit `5530a13` on `group-d1-iter6-staging`, atomic squashed to main as `53ee5e3`). barrier_note added to P17 eligible_spans after empirical A/B regression revealed the gap. Spec §19.1 listed 3 source_span patterns; spec §5.3 critical_section list contains 4 portfolio_impact patterns including barrier_note. Drift between the two was a transcription oversight in §19.1. Distinct from Lesson #43 (prompt rule × data exposure coupling) — that's about producer's prompt INPUT not exposing data the rule needs; this is about RULE'S internal eligibility list omitting a cell from the structural domain.

---

### 2026-04-30 — code — Sonnet structured-extraction latency requires generous per-call timeouts (Lesson #57)

**Trigger:** Batch 5 D1 iter 6 Task 12 A/B regression. Extractor section calls timed out 3 retries × 300s = 900s wasted before all-3-attempts-exhausted error. Investigation: the extractor's _call_sonnet sets `SECTION_TIMEOUT_S=300` (5 min per attempt). Direct `claude -p sonnet` invocation with the actual production prompt (141K chars / 35K tokens, structured extraction task) completes in **390 seconds** (6.5 min). The 300s timeout was insufficient. Earlier iter 1-5 runs reportedly took "very long" wall-clock; we got lucky earlier when sections happened to complete within 300s.

**Pattern:** Sonnet 4.6 latency for STRUCTURED EXTRACTION tasks (instructions + JSON schema + 30K+ token context + multi-claim output) is fundamentally several minutes per call. Different from simple Q&A latency (which is sub-10s). Production timeouts must reflect this:
- Simple "reply with answer" Sonnet calls: 10-30s typical
- Structured extraction with detailed schema + 20K+ token prompt: 5-10 min typical
- Section-by-section pipelines may take 30-90 min total wall-clock

**Why:** Sonnet generates structured JSON output token-by-token; complex schemas force longer reasoning chains; large input contexts increase per-token thinking time. The 300s default was set without empirical measurement against production prompt sizes. Tight timeouts cause spurious "all retries exhausted" errors that look like Sonnet API failure but are actually user-side timeout misconfiguration.

**How to apply:**
- For LLM extractor / classifier / structured-output pipelines, set per-call timeout to **3-5×** the empirically-measured P95 completion time (NOT 1× — that gives 50% spurious-timeout rate at production variance)
- Initial timeout setting should come from EMPIRICAL measurement on production-shape prompt, not "round number that feels generous"
- Document the source for the timeout value in code comment ("empirical: production tldr extraction takes ~390s; 900s = 2.3× margin")
- When Sonnet "times out" on production calls, FIRST check timeout vs empirical latency before assuming API issue
- For Claude Code (`claude -p`) wrapper specifically: per-section timeout 600-900s is the appropriate range for extractor-style tasks; full-pipeline runs may take 30-90 min wall-clock

**Reference:** Batch 5 D1 iter 6 Task 12 cycle-1 fix (commit `50c5e47` on `group-d1-iter6-staging`, atomic squashed to main as `53ee5e3`). `pipeline/llm_integrity/extractor.py:49` `SECTION_TIMEOUT_S` raised from 300 to 900. Distinct from Lesson #45 (A/B regression iteration is exploration) — that's about cycles needed for producer learning; this is about per-call timeout magnitude. Distinct from Lesson #51 (recovery scripts must enforce schema version) — that's about feature flag enforcement; this is about LLM call timeout calibration.

---

### 2026-04-30 — code — Section-class latency variance: L#57's 390s figure is tldr-specific, not universal (Lesson #58)

**Trigger:** Batch 5 D1 Task 9 Phase 1 smoke (4/22 retroactive validation, dry-run). Cycle-2 reviewer projected 24h wall-clock for 5-date Group C scope based on Lesson #57's "390s/section" empirical figure (taken from iter 6 Task 12 A/B regression on tldr extraction). Phase 1 actual: 50 min for 44 sections = ~68s/section average. Cycle-2's 24h figure was 5× too high. **Lesson #57's per-call latency is NOT a universal section figure.**

**Pattern:** Sonnet structured-extraction latency varies 4-6× across section classes:
- **tldr extraction** (large prompt + complex schema + dense narrative): 300-400s typical — this is what L#57 measured
- **portfolio_impact[*].reasoning** (per-position narrative, 100-300 word): 60-90s typical
- **key_risks[*] / opportunities[*]** (single-bullet text, 50-150 word): 40-80s typical
- **signal_events[*].reasoning** (event narrative, 80-200 word): 60-120s typical
- **meta_observations[*]** (cross-cutting summary): 90-180s typical

For multi-section pipelines, calibrate budget against section-class mix, not single-section worst case.

**Why:** Section size + schema complexity + claim density per section all drive Sonnet latency. tldr is the worst case (multi-paragraph narrative, mixed claim types, anchor-citation density). Per-position sections are simpler. A reviewer applying L#57 verbatim across all section types overestimates by 4-6×.

**How to apply:**
- Cycle-2 cost-guard reviews: don't multiply L#57's 390s by total section count. Break down by section class (tldr × 1, portfolio_impact × N, key_risks × M, etc.) and apply class-specific latency.
- For new pipelines, run an isolated single-section smoke per class to calibrate before committing budget.
- L#57 itself stands (worst-case timeout configuration `SECTION_TIMEOUT_S=900`); L#58 refines its application to budget calculation.
- Without observed per-section data, assume 60-90s for non-tldr sections and 300-400s for tldr.
- Update L#57's "How to apply" cross-reference: "for budget projections, see L#58 (section-class breakdown); 390s is timeout-config baseline, not per-section budget multiplier."

**Reference:** Batch 5 D1 Task 9 Phase 1 smoke 2026-04-30 18:36:28 commit `fdd5389`. 44 sections completed in 50 min → 68s/section average. Cycle-2 reviewer's 24h budget projection (390s × 44 + 148 sections × 5 dates) was 5× too high. Distinct from Lesson #57 (which sets per-call timeout) — this is the budget-derivation refinement.

---

### 2026-04-30 — process — Plausible-feeling assumptions need empirical verification at amendment time (Lesson #59)

**Trigger:** Batch 5 D1 Task 9 Plan Amendment 1 cycle-2 review. Cycle-1 self-stress-test produced 12 findings. Cycle-2 independent reviewer (Opus, adversarial Lesson #40 framing) caught 4 CRITICAL bugs cycle-1 missed. **All 4 traced to plausible-feeling empirical assumptions that single-line bash verification would have falsified in seconds:**

1. 4/28 schema flavor: cycle-1 marked "(not yet inspected)" → assumed v1 → reality v2 (`json.load(open('data/analysis/llm_daily_2026-04-28.json'))['_metadata']['schema_version']` returns 2)
2. HTML cut-paste assumption: cycle-1 inherited spec §750 strikethrough mechanism → reality `llm_daily['tldr'] in open(html).read() → False` (HTML hand-curated, not LLM-cut-paste)
3. CRON_DISPATCHED_SCRIPTS anti-tautology: cycle-1 added `scripts/retroactive_validate.py` → reality the same Task 10 cycle-2 mistake repeated; should self-ask "is this script actually cron-invoked?"
4. Cost guard: cycle-1 estimated "9 sections/date × 5 dates × 7 min" → reality 225 sections via `_iter_source_spans` walk; 5× underestimate

**Pattern:** When drafting plan/spec amendments that reference empirical state (file shapes, code structure, latency, costs), self-stress-test rounds tend to **inherit the author's mental model** rather than re-verify. Independent adversarial reviewers CHECK the assumptions empirically. Sister to Lesson #56 (dispatch eligibility ↔ canonical-list drift) — both are "structural drift between assumed and actual state"; #56 applies to dispatch rules, #59 applies to amendment empirical claims.

**Why:** Cycle-1 self-stress-tests rely on the author re-reading their own work; the author's mental model creates internal coherence that doesn't catch empirical drift. Lesson #40 (independent reviewer catches what self-stress-test misses) applies to design-level review; #59 specializes it to **empirical claims** in amendments — claims that ARE verifiable in seconds but require the author to break out of their assumption frame.

**How to apply:**
- For each empirical claim in a plan/spec amendment ("file X has shape Y", "function Z exists", "cost is N", "section count is M"), include the verification command that produced it. If unverified, mark `(not yet inspected — TODO before commit)`.
- Cycle-1 self-stress-test checklist: explicitly "for each empirical claim, run the verification one-liner; capture output." Don't accept "(not yet inspected)" cells.
- Cycle-2 independent reviewer should spot-check empirical claims by running verifications fresh (don't trust author's reported observation).
- Common empirical claims worth spot-checking: file existence (`ls -la`), schema version (`json.load(...)._metadata.schema_version`), function signatures (`grep "def funcname"`), cost projections (multiply observed-per-unit × N), HTML structure (`grep '<header>' file.html`).
- Time cost: ~5-30s per claim. Catches CRITICAL bugs that would otherwise need cycle-2 to find.

**Reference:** Batch 5 D1 Task 9 Plan Amendment 1 cycle-2 review 2026-04-30 (commit `fdd5389`). Cycle-1 missed 4 CRITICAL findings; cycle-2 reviewer empirically verified each in seconds. Sister to Lesson #56 (dispatch eligibility list drift). Distinct from Lesson #2 (sanity-check before SPEC) — Lesson #2 is design-time pre-spec; #59 is amendment-time (when spec/plan already drafted, before commit).

---

### 2026-04-30 — code — Sequential-Call pipelines that overwrite same disk artifact serve primary use case but break secondary (Lesson #60)

**Trigger:** Batch 5 D1 Task 9 Phase 1 cycle-3 (post-smoke discovery). `_run_date()` calls extractor + validator subprocesses for Call 1 (llm_daily) AND Call 2 (signal_events) sequentially. Both Calls' validator subprocesses write to the same `validation_report_<date>.json` path. Call 2 OVERWRITES Call 1. Combined verdicts (214 / 8 critical FAIL) exist only in retroactive_validate.py's in-memory `all_verdicts` list during the run. Post-run on disk: only Call 2's 91 verdicts.

For the **primary use case** (daily cron writeback to x.db), this is FINE — `x_writeback.py` Phase 0 only consumes Call 2's verdicts. Sequential overwrite is the correct semantic.

For the **secondary use case** (retroactive annotation needing both Calls' verdicts merged), this BREAKS — annotation post-run cannot reconstruct Call 1's verdicts. Re-extraction (~$30-50 + 50min) is required.

**Pattern:** "Rebut-handed pipelines" — same I/O contract serves primary use case correctly and breaks secondary use case silently. Discovered only when secondary use case's post-run requirements are actually exercised.

**Why:** Pipeline I/O contracts are designed for the primary (high-frequency, cron-driven) use case. Secondary use cases (low-frequency operator-driven retroactive review, debugging, audit, replay) inherit the same contract by virtue of using the same modules. The artifact-overwrite pattern serves cron because each day's data is independent and only the LAST Call's output matters. It breaks retroactive because retroactive needs to merge multiple Calls' outputs across the same date.

**How to apply:**
- When designing a NEW use case that consumes pipeline outputs (retroactive, audit, debug, replay), explicitly trace the I/O contract: what artifacts are produced; what gets overwritten; what's needed by the new use case.
- If primary use case overwrites between sequential Calls, secondary use cases must either (a) capture intermediate state in-memory (fragile across reruns), (b) save Call-N-specific paths separately (refactor), OR (c) re-run the pipeline (cost duplication).
- Surface this as a design question during secondary-use-case design, not after running the pipeline.
- For `retroactive_validate.py` specifically: refactor to save per-Call validation_reports + per-Call claims to distinct paths; primary use case unaffected (Call 2's path stays canonical for x_writeback).
- When inheriting a pipeline for a new use case, ask: "what intermediate state does this pipeline overwrite that I might need?"

**Reference:** Batch 5 D1 Task 9 Phase 1 cycle-3 discovery 2026-04-30 (commit `fdd5389`). `_run_date()` invokes `_run_artifact_pipeline` for Call 1 + Call 2 sequentially; both write `validation_report_<date>.json` and `claims_<date>.json`. Phase 2 deferred per user decision (option D) includes refactor to per-Call paths + `--annotate-only` flag. Distinct from Lesson #29 (cross-module pattern sweep) — that's about consistency within primary; this is primary-vs-secondary I/O contract divergence.

---

### 2026-04-30 — code — BASH `if ! cmd; then; _RC=$?` always captures 0; adversarial review must EXECUTE failure path (Lesson #61)

**Trigger:** Batch 5 D1 Task 10 cycle-2 implementation review. Cycle-2 amendment C2-2 mandated replacing naked `|| true` in `run_daily_analysis.sh` Step 0.5 with explicit `if ! cmd; then` cron_failures.json bridge to satisfy Lesson #5 + Lesson #31 (failure logger never silently silent). Implementer wrote pattern verbatim:
```bash
if ! python3 scripts/verify_fact_future.py >> "$LOG_FILE" 2>&1; then
    _RC=$?
    log "WARNING: verify_fact_future exited $_RC ..."
```

Cycle-2 IMPLEMENTATION reviewer empirically reproduced: `bash -c '! return 5; _RC=$?; echo $_RC'` → **`0`** (not 5). Bash's `!` pipeline negation maps the failed-command exit code to 0 BEFORE the `then` body evaluates. `$?` after the `then` reads the negated value, NOT the original.

The entire C2-2 fix (and Lessons #5 + #31 satisfaction) was **silently broken**: cron_failures.json would record `'exit_code': 0` regardless of the real failure code. Operator notify subtitle would say "exit 0" — defeating the purpose. The pattern WAS in place; the COVERAGE was broken.

**Pattern:** Adversarial review of pattern-presence ("does this code use the cron_failures.json bridge?") is insufficient when the pattern itself has subtle correctness gaps. **Adversarial review must EXECUTE the failure path** — actually trigger the error, observe the captured value. Pattern-presence review catches "did you use the right shape" but misses "does the shape actually work."

**Why:** BASH semantics for `! cmd` + `$?` are non-obvious. Pattern review reading the code says "yes, the bridge is wired up." Empirical review running the failure path says "the captured exit code is wrong." The same shape (`if ! cmd; then; $?`) appears correct because the AUTHOR's mental model treats `$?` as "the original exit code". Bash treats it as "the result-after-negation". Without execution, the gap is invisible.

**How to apply:**
- For cycle-2 implementation reviewers: when reviewing failure-handling code paths, design a SYNTHETIC failure (insert `sys.exit(5)`; mock command return; replace command with `false`) and run the path. Observe the captured value.
- BASH-specific: use `set +e; cmd; _RC=$?; set -e` pattern for capturing original exit codes; AVOID `if ! cmd; then; _RC=$?` (always 0).
- For any "failure-logger" / "failure-bridge" / "non-halting-failure" code, the implementation review MUST execute the failure path empirically. "I read the code; pattern matches" is INSUFFICIENT verification.
- Add anti-tautology test cells (Lesson #14) that synthetically fail and assert the captured exit code matches the original.
- Common BASH gotchas worth knowing: `! cmd; $?` (always 0), `set -e` and function returns (function failure is suppressed by `||` chain), subshell-based `$?` capture, pipe failures (`set -o pipefail`).

**Reference:** Batch 5 D1 Task 10 cycle-2 implementation review 2026-04-30 (commit `c4a7e64` on `task-10-staging`, atomic squashed to main as `acb1bef`). Reviewer ran `bash -c '! return 5; _RC=$?; echo $_RC'` → 0; fix was `set +e; cmd; _RC=$?; set -e` matching pattern at lines 261/304/374/391 in same file. Distinct from Lesson #5 (fail-loud — about exit semantics) and Lesson #31 (failure logger independence — about logger architecture). #61 is about REVIEW METHOD: pattern-presence inspection is insufficient for failure-handling code.

---

### 2026-04-30 — process — Empirical-claim drift recurs at NEW empirical-claims tables introduced to fix prior reviewer findings (Lesson #62)

**Trigger:** Group F Batch 5 cycle-3 + cycle-4 reviewer findings. Stage 2 fix for cycle-2 CRITICAL-3 (migration scope) introduced a NEW per-date empirical-claims table in spec §20.5. Stage 2 author tagged the table "verified empirically 2026-04-30" — but the verification was 50% incomplete: filesystem checks for source artifacts (llm_daily / signal_events) were done; checks for the validation_report (the union FILE the migration table claimed to "copy from") were NOT done. Cycle-3 reviewer caught: 4/22 union has 0 verdicts (Phase 1 dry-run only); 4/27 union does NOT exist (cron never ran). Cycle-4 reviewer caught a 47% drift rate across plan empirical claims. Cycle-5 reviewer caught CRITICAL-1 (`scripts/query_validation.py` missing sys.path setup) escaping 4 prior cycles because all 8 unit tests imported `_main_impl` directly under pytest's auto-configured sys.path.

**Pattern:** Every time a spec/plan amendment introduces a NEW empirical-claims table or NEW operator-facing surface, the author runs an INCOMPLETE verification — only the columns that came naturally to mind. Sister columns (e.g., "does the union file ACTUALLY contain Call 2 verdicts?", "does the script work via direct CLI invocation?") are NOT verified. The "verified empirically" tag is itself the warning signal — Lesson #59 anti-pattern recurring at finer granularity.

**Why:** Author has a mental model of WHICH empirical claims matter (the ones in scope for the current finding). Sister claims fall into the same blind spot that caused the original finding — they're cousin failures of the same conceptual gap. Cycle-N reviewer catches the original finding; cycle-N+1 reviewer catches the sister cases the cycle-N fix introduced. This recurses.

**How to apply:**
- For EVERY empirical-claims TABLE introduced in a spec/plan amendment (per-row × per-column), enumerate the verification command for EVERY cell. Run them ALL. "Verified empirically" tag must enumerate which claims were verified.
- For EVERY new operator-facing surface (CLI, script, integration point), test via OPERATOR-EQUIVALENT invocation pattern — NOT via `from x import _main_impl` direct call. Subprocess invocation reveals missing-preamble bugs.
- Cycle-N+1 reviewer checklist: explicitly verify the NEW claims/surfaces introduced in cycle-N fix. Treat "fix that introduced new claims" as a higher-risk change than "fix that touched existing claims."
- Pre-commit check: "for each empirical claim in the new table or new script, what exact one-liner / subprocess.run would falsify it? Did I run it?" If any answer is "didn't run" or "ran but only partially" — INCOMPLETE; HALT-and-flag.

**Reference:** Batch 5 Group F cycle-3 review (commit `dc7cdc3` Stage 3 spec fix; tasks/group-f-cycle3-spec-review.md). Cycle-4 review (commit `a7c3c4f` + `745ba0b` Stages 4+5; tasks/group-f-cycle4-spec-plan-review.md — 22 findings at 45% drift rate). Cycle-5 review (commit `9bf0aa1` Stage 6; tasks/group-f-cycle5-impl-review.md — CRITICAL-1 query_validation.py CLI bootstrap missing). Distinct from Lesson #59 (plausible-feeling assumptions in ORIGINAL spec drafting) — #62 is the recursion pattern at fix-introduces-new-claims layer. Distinct from Lesson #40 (self-stress-test drift) — #62 is about author-after-reviewer-fix incomplete verification, not author-during-original-drafting drift.

---

### 2026-04-30 — process — Operator-only scripts need OPERATOR-EQUIVALENT subprocess test pattern (Lesson #63)

**Trigger:** Group F Batch 5 cycle-5 review CRITICAL-1. `scripts/query_validation.py` was missing the `PROJECT_ROOT = Path(__file__).resolve().parent.parent; sys.path.insert(0, str(PROJECT_ROOT))` boilerplate that sister operator-only scripts (`annotate_briefing.py` + `migrate_validation_reports_per_call.py`) had. Direct CLI invocation crashed: `python3 scripts/query_validation.py --help` → `ModuleNotFoundError: No module named 'pipeline'` exit 1. The 8 unit-test cells in `tests/test_query_validation.py` all imported `_main_impl` directly:
```python
from scripts.query_validation import _main_impl
_main_impl(...)
```
This bypasses both the `if __name__ == '__main__'` guard AND benefits from pytest's auto-configured `sys.path` (which already has the project root). Tests passed; operator-equivalent CLI invocation crashed.

**Pattern:** Operator-only scripts (per spec §20.9 NOT in `CRON_DISPATCHED_SCRIPTS`) need a SISTER test pattern that EXECUTES `python3 scripts/X.py --help` via `subprocess.run(...)` with `cwd=/tmp` and PYTHONPATH NOT set. This mirrors `tests/test_cron_environment.py:test_cron_equivalent_imports` (which verifies cron-dispatched scripts work under cron-equivalent invocation) but inverted: operator-equivalent invocation has NO project root in sys.path by default; script MUST self-bootstrap.

**Why:** Test infrastructure (pytest auto-configured sys.path) and operator infrastructure (operator's shell with `python3 scripts/...`) are different environments. Anti-tautology test design (Lesson #14) requires testing the production environment, not the test environment. Direct `from scripts.X import _main_impl` is the test-environment shortcut; operator-equivalent invocation is the production behavior.

The CRON_DISPATCHED_SCRIPTS test (`test_cron_environment.py`) already enforces this for cron-dispatched scripts. Operator-only scripts are explicitly excluded from that list per Lesson #59 anti-tautology corrective (don't add operator-only scripts to a cron-coverage test). But they need their OWN sister coverage.

**How to apply:**
- For every NEW operator-only script (CLI), add a subprocess-form CLI test: `subprocess.run(["python3", str(script_path), "--help"], cwd="/tmp")` → assert exit 0 AND no `ModuleNotFoundError` / `ImportError` in stderr.
- The test file is `tests/test_operator_scripts_cli.py` (new convention as of Group F). Each operator-only script gets ≥1 cell verifying the operator-equivalent invocation.
- Argparse boundary cells (no required args; mutually-exclusive groups required) verify the script imports successfully BEFORE argparse-validation reaches its boundary — distinguishes import-failure (exit 1) from argparse-validation (exit 2).
- For operator-only Python modules consumed by operator scripts: focus tests on the script entry point, not internal helpers. The script entry contract is what operators rely on.

**Reference:** Batch 5 Group F cycle-5 review CRITICAL-1 (commit `9bf0aa1` Stage 6 fix; tasks/group-f-cycle5-impl-review.md). NEW test file `tests/test_operator_scripts_cli.py` (5 cells covering `query_validation.py` + `annotate_briefing.py` + `migrate_validation_reports_per_call.py`). Distinct from Lesson #14 (anti-tautology in test design) — #63 is the specific test-pattern for operator-equivalent invocation. Distinct from Lesson #26 (cron-environment maintenance via CRON_DISPATCHED_SCRIPTS) — #63 is the inverse pattern for non-cron operator scripts. Sister to Lesson #59 (empirical verification at amendment time) — #63 specializes #59 to the test-coverage layer.

---

### 2026-05-01 — spec/validation — Schema authored from modal sample misses code paths that only fire on non-modal cases; plan must include empirical validation phase (Lesson #64)

**Trigger:** Bronze Tier Ingest T12 empirical validation phase (2026-05-01). Spec author (Session 18) designed the `validation_history` schema by inspecting ONE sample verdict: `validation_report_2026-04-28_call2.json` entry C002, a simple PASS for a fact_now dollars claim. This sample never triggered P17 dispatch, never reached the standard percent comparison formula, and never emitted `baseline_anchor_field`, `baseline_value`, `actual_pct`, or `dispatch_path`. So the spec schema omitted all four. T12 — an explicitly-planned empirical validation phase (Phase 5 of the Bronze Tier plan) — ran `bronze_backfill --all` against all 10 production validation_report files (1959 verdicts) and revealed the 4 missing columns at 5.3% / 2.1% frequency. Without T12, the branch would have squashed to main with a permanently incomplete schema — losing the primary numeric drift signal (`actual_pct`) and the dispatch audit trail (`dispatch_path`) for all structured-note cushion/autocall claims.

**Pattern:** Two separate failure modes combined here:

1. **Sample-diversity failure (spec time):** Spec schema was authored by inspecting the modal case (a simple PASS for a dollars claim). Code paths that only fire on FAIL / INDETERMINATE / percent-class / P17-dispatch / non-P17-percent were never represented in the sample. Modal samples systematically under-represent rare-but-INVIOLATE code paths.

2. **Plan structure rescue:** A planned empirical validation phase placed explicitly in the plan as a required step (not an optional spot-check) ran the full chain against all available production data BEFORE squashing to main. This single step caught all four issues that spec self-review, multi-cycle reviewer passes, and unit tests had entirely missed — because those review forms all depend on the reviewer knowing which code paths exist, and the gap was invisible unless you ran against production data at sufficient diversity.

**Why:** Spec self-review + independent reviewer cycles catch issues the reviewer can imagine or trace from the spec text. Production data inspection at full diversity catches issues that only manifest when rarely-triggered code paths emit output. The gap between "what the spec author saw when drafting" and "what production data actually emits" is bridged only by running against production data — not by reading the spec or the code.

For schema specs specifically: every field in the eventual output schema has a code path that emits it; if you don't inspect production data covering EVERY code path, you build an incomplete schema. The completeness of your schema mirrors the diversity of your sample.

**How to apply:**

- **At spec-authoring time:** Before locking any schema or data-contract spec, sample production data covering ALL relevant code paths. Enumerate code paths explicitly (e.g., for a validator: PASS / FAIL / INDETERMINATE / P17-dispatch / standard-percent / already-percent / non-percent) and verify the sample includes at least one instance of each. "One production file" is insufficient; inspect a population covering edge paths.
- **At plan-writing time:** For any task that ingests or transforms production data, include an explicit **empirical validation phase** in the plan — a required step that runs the new code against the full available production dataset BEFORE the squash-to-main commit. This step is not the same as unit tests (which use fixtures) or reviewer cycles (which read spec/code). It is the only step that catches code-path-coverage gaps in the schema.
- **Sample diversity checklist for schema specs:** before treating a schema as complete, ask "does my sample include: (a) all verdict types (PASS/FAIL/INDETERMINATE); (b) all dispatch paths that add fields; (c) all claim types (fact_now/fact_future/judgment/meta); (d) all unit classes (dollars/percent/count/already-percent); (e) all source_span categories"? If ANY row in the checklist is "not seen in sample," the schema is provisional.
- **Empirical validation phase outputs:** the phase should produce a structured inventory (Phase A: field × frequency across N production files) and semantics analysis (Phase B: when/why each field is emitted). These are the evidence that the schema is complete.

**Reference:** Bronze Tier Ingest plan `docs/plans/2026-05-01-bronze-tier-ingest.md` (T12 Phase 5 empirical validation). DI findings doc `docs/plans/2026-05-01-bronze-tier-DI-findings.md` (Phase B: 4-field semantics inventory + Phase C: architecture recommendation). Fix commits: `cd35afb` (Phase D: 4 missing columns), `4e17e53` (Phase D follow-up: `_query_via_sql` reads the 4 new columns). Distinct from Lesson #2 (sanity-check production data shape before writing spec) — Lesson #2 is about verifying container/field shapes before spec DRAFTING; this lesson is about sample DIVERSITY covering all code paths. Distinct from Lesson #20 (production-smoke-check after every critical change) — Lesson #20 is post-commit smoke per change; this is a pre-squash full-dataset validation phase baked into the plan structure. Distinct from Lesson #59 (plausible-feeling assumptions need empirical verification) — Lesson #59 is about specific claims in amendments; this is about code-path-coverage completeness for schema specs.

---

### 2026-05-01 — process — Lessons-learned catalog as systematic pre-execution plan audit gate (Lesson #65)

**Trigger:** Bronze Tier Ingest plan lessons-learned audit (2026-05-01, before any T1 code shipped). The plan called for a pre-execution pass cross-checking every task against `docs/lessons-learned.md`. This audit caught 1 CRITICAL finding (Lesson #63: `bronze_backfill` was incorrectly placed in `CRON_DISPATCHED_SCRIPTS` in T10a — `bronze_backfill` is an operator-only script per spec §20.9, NOT cron-dispatched; adding it would add a false cron-coverage assertion that `bronze_backfill` would be tested under cron-equivalent invocation when it should be tested under operator-equivalent invocation per Lesson #63's inverse-pattern) plus 3 IMPORTANT fixes, ALL BEFORE any code shipped. Without the audit, these would have shipped silently and been caught later (at review time or in production), requiring follow-up commits.

**Pattern:** `docs/lessons-learned.md` is the project's institutional memory of recurring anti-patterns. Plans are drafted by authors who know the current task but may not have all 60+ patterns actively in mind. Cross-checking each plan task against the full catalog at plan-execution time — before writing any code — is a systematic way to catch plan-level violations of previously-learned anti-patterns. The value is asymmetric: the audit takes ~15 minutes; each violation caught saves a mid-execution review cycle (~30-60 min each).

This is different from "review the plan for quality" (Lesson #42 reviewer cycles, which catch design defects) — the reviewer is checking whether the plan is internally correct and well-specified. A lessons-learned audit checks whether the plan VIOLATES patterns the project has learned through prior incidents. These are orthogonal: a plan can be perfectly well-specified AND violate a prior lesson.

**Why:** Plans are drafted with task scope in view, not catalog scope. A planner drafting T10a (adding `bronze_backfill` to CRON_DISPATCHED_SCRIPTS) is thinking about test coverage, not about Lesson #63's distinction between operator-only and cron-dispatched scripts. Only reading Lesson #63 at draft time would flag it. Without a systematic audit, the planner must rely on actively recalling all 60+ patterns for every task — an unreliable cognitive load.

As the catalog grows, the value of systematic auditing grows: a 10-lesson catalog has low miss-rate per-planner; a 65-lesson catalog has high miss-rate per-planner, but systematic cross-check amortizes over all tasks.

**How to apply:**

- **Every plan execution session, before T1 code:** dedicate ~15 minutes to a lessons-learned catalog audit. For each plan task, read the task's scope and cross-check against lessons categorized as `process` and `code`. Focus especially on any task that:
  - Adds a new script (→ Lesson #63: operator-only vs cron-dispatched; Lesson #26: CRON_DISPATCHED_SCRIPTS completeness)
  - Modifies a schema (→ Lesson #64: sample diversity for schema specs; Lesson #2: sanity-check data shape)
  - Adds tests (→ Lesson #14: anti-tautology; Lesson #36: subprocess env sanitization; Lesson #63: operator-equivalent invocation)
  - Adds a new dispatch or eligibility list (→ Lesson #56: eligibility ↔ canonical-list cross-reference)
  - Modifies error handling (→ Lesson #5: fail-loud; Lesson #31: failure logger independence; Lesson #61: BASH if ! cmd)
- **Capture audit findings as a plan amendment** before implementation begins. "Caught by lessons-learned audit" is the finding provenance — easier to track than "found during T3 review."
- **Update this pattern in writing-plans skill template:** explicitly include "Run lessons-learned audit against full catalog before T1 code" as a pre-implementation step with ~15-minute time budget.
- **Don't rely on passive recall:** the whole point is systematic cross-check, not trusting that planners remember all 65+ patterns. Read the catalog; don't query memory.

**Reference:** Bronze Tier Ingest plan execution audit (2026-05-01, pre-T10 code). CRITICAL finding: `bronze_backfill` in `CRON_DISPATCHED_SCRIPTS` → caught by Lesson #63 cross-check. 3 IMPORTANT findings caught in same pass. All 4 pre-coded fixes saved mid-execution review cycles. Distinct from Lesson #40 (self-stress-test drifts — that's about design review catching your own blind spots) and Lesson #42 (reviewer cycles are adversarial discovery — that's about design correctness review). This lesson is specifically about the lessons-learned CATALOG as a systematic checklist for plan compliance with prior anti-patterns, not general design quality.

---

### 2026-05-04 — code — Fail-loud predicate must encode the precondition that "loud" is anomalous (Lesson #66)

**Trigger:** 5/4 retro of missed routines surfaced **432 unacknowledged cron failures** in `cron_failures.json`, all from `x_writeback.py` Phase 0 — all about per-Call `validation_report_2026-04-26_call2.json` absent, falling back to union path. 4/26 is a **Sunday**. The code path was added under Lesson #5 fail-loud doctrine, intended to alert when *cron* failed to produce per-Call output. But the predicate (`if union_path.exists()`) does not encode "we expected cron output." On non-cron-days (Sat/Sun) cron never ran, so the per-Call file is *expected* to be absent — yet the WARN fires anyway. Session 18 bronze tier development invoked `x_writeback --date 2026-04-26` ~432 times during testing, producing the flood.

**Pattern:** When applying Lesson #5 fail-loud, the WARN/ERROR predicate must encode the *precondition under which loud is anomalous*, not just "the unexpected branch was taken." A weaker predicate fires for both legitimate fallback (operator backfill on a non-cron-day) AND genuine cron-sequencing breakage — operator can't tell them apart, so they ack-all and the signal becomes noise.

**Why:** Fail-loud has two failure modes: (a) silent on real problems (Lesson #5 origin), (b) loud on expected cases. Both destroy the signal. (b) is more insidious because the warning *is firing* — it looks healthy from inside the codebase, but operators learn to ignore it (alarm fatigue). The ratio that matters: `legitimate_warns / total_warns`. If operator-backfill scenarios push that ratio below ~50%, every warn loses authority. The code-author's mental model is "this branch is unusual" — but "unusual" must be qualified by *for whom*. Cron's "unusual" ≠ operator backfill's "unusual."

**How to apply:**

- **Every WARN/ERROR predicate review:** explicitly answer "is this branch anomalous for ALL callers, or only for caller X?" Examples of caller-class qualifiers:
  - **Cron-day eligibility** (this incident): gate by `trading_date.weekday() < 5` so only Mon–Fri produce a WARN. Sat/Sun fallback is by-design.
  - **Caller flag** (cleaner, deferred per DEF-3): pass `--invoked-by={cron,operator}` and only warn when `cron`. Requires CLI plumbing.
  - **Holiday calendar** (deferred per DEF-1): integrate market calendar (NYSE holidays). Gating Mon–Fri alone admits ~10 false positives/year.
- **When auditing a WARN site, run two thought experiments:**
  1. Cron sequence breaks (bullets the per-Call producer) → does WARN fire? Must be YES.
  2. Operator runs the script for a non-cron-day → does WARN fire? Must be NO.
  - If thought experiment (2) fires WARN, predicate is too weak.
- **In tests, add a "Sunday/Saturday silent" cell** alongside the existing fallback cell. Mutation-think: an off-by-one (`<= 5` vs `< 5`) would still warn on Saturday — test BOTH weekend days.
- **Don't fix by ack'ing the noise** — that conditions the ops loop to ignore future legitimate WARNs. Fix the predicate.

**Reference:** `docs/future/2026-05-04-cron-warn-noise.md` (full root cause + DEF-1/2/3 deferred items). Code: `pipeline/x_writeback.py:_phase0_load_validation_report` weekday gate. Test: `tests/test_x_writeback_per_call.py::test_phase0_no_warn_on_weekend_fallback`. Distinct from Lesson #5 (silent fallback is forbidden — origin doctrine; this lesson is about loud-on-expected, the inverse failure mode). Distinct from Lesson #56 (eligibility ↔ canonical-list cross-reference — that's about list-shape drift; this lesson is about predicate-precondition drift).

---

### 2026-05-05 — spec/code — Two recurring spec-drafting traps: JSON key ≠ section enum value, and SQL UNIQUE NULL semantics require COALESCE on every nullable column (Lesson #67)

**Trigger:** Group E spec amendment batch (2026-05-05). Two amendments surfaced during plan-to-code reconciliation that are recurring but not yet captured.

**Pattern 1 — JSON key name ≠ cited_in_section value (Amendment H):**

Plan T4 wrote `("portfolio_impact", "reasoning", "portfolio_impact")` in the sections iteration list, using `"portfolio_impact"` as the `cited_in_section` value. But `cited_in_section` must be the semantic classification of the citation's location within the LLM output — which is `"reasoning"` (the sub-field consumed from each `portfolio_impact[i]` dict). The top-level JSON key (`portfolio_impact`) is the **iterator key**; the section-enum value represents **what the LLM is doing in that location**. Conflating the iterator key with the section name is a natural mistake when writing the extraction loop from memory rather than from the schema.

How to avoid:
- When writing section iteration tuples, always cross-check the third element against the `cited_in_section` CHECK constraint in the SQL schema.
- The invariant: `cited_in_section` is always chosen from the schema's CHECK enum, never from the LLM JSON's own key names.
- Reviewer checklist: "Does this section_name match the SQL CHECK constraint? Or is it a key name?"

**Pattern 2 — SQL UNIQUE INDEX with multiple nullable columns: COALESCE all of them (Amendment D):**

The initial spec had `UNIQUE(tweet_id, cited_in_date, cited_in_call, cited_in_section, cited_in_ref)`. Both `tweet_id` AND `cited_in_ref` can be NULL. SQL's NULL equality semantics (`NULL != NULL`) defeat uniqueness for ANY column where NULL appears — so even after applying `COALESCE(tweet_id, '_self')`, a second NULL in `cited_in_ref` still allows duplicates for self-attributed rows.

The rule: in a UNIQUE INDEX with multiple nullable columns, apply `COALESCE(<col>, '<sentinel>')` to **every nullable column** — not just the one you're currently thinking about. A single missed nullable column silently breaks duplicate prevention for the entire index class where that column is NULL.

How to avoid:
- When writing a UNIQUE INDEX or UNIQUE constraint: explicitly audit "which columns can be NULL?" and apply COALESCE to all of them.
- The sentinel values should be distinct from any real value (e.g., `'_self'`, `'_noref'`).
- Reviewer checklist item: "Count the nullable columns in this UNIQUE index. Count the COALESCEs. Are they equal?"

**Reference:** Spec amendment batch Group E (2026-05-05). Amendment H: `docs/specs/2026-05-05-x-fetch-optimization-design.md` §8.2 / plan `_methods2_3` sections list. Amendment D: spec §7.1 `cited_tweets` UNIQUE INDEX / migration SQL `2026-05-05_x_eval_schema.sql`. Distinct from Lesson #56 (eligibility list ↔ dispatch eligibility drift — that's about list membership; this is about column-name vs enum-value naming and SQL NULL semantics).

---

### 2026-05-06 — process — Self-review claim "ran command" must EMBED the command + output, not narrate that it ran (Lesson #68)

**Trigger:** iter 7 plan v0.2 changelog explicitly stated "every empirical claim in v0.2 amendment was verified via grep/sed pre-commit; placeholder check via `grep -nE 'TBD|TODO|pass$|FIXME|...'` ran post-edit (zero results required)". Cycle-3 reviewer ran the SAME claim's grep against the FINAL v0.2 file → found a `pass` placeholder at line 593 with trailing comment (`pass  # Detailed in step 4 once existing test fixture pattern is identified`). The author's grep regex `pass$` did not match `pass # comment` due to trailing characters — the regex was wrong AND the author had not actually executed the regex they claimed to have run. Cycle-3 reviewer's exact characterization: "the blind spot moved up one meta-level rather than being eliminated."

**Pattern:** Author writes "verified via grep" / "ran command pre-commit" / "tested empirically" as a self-attestation. Reviewer takes this at face value. But the claim itself is unverified — there is no evidence the command was actually run, and no record of its actual output. The claim becomes performative shielding rather than empirical defense. This recurs even when the author explicitly invokes Lesson #59 / #62 awareness, because the awareness is at the wrong layer: the author thinks "I'm being careful about empirical claims" while still failing to run the empirical command on the final artifact.

**Why:** Self-attestation has the same failure mode as Lesson #40 self-stress-test drift, just at a different scope. The author's mental model says "I am about to run this command; therefore I am being empirical" — but the gap between "intend to run" and "actually run on final file" is where the drift accumulates. Especially under context fatigue at the end of a long edit session, the author's belief that they ran the check substitutes for actually running it.

This is also a Lesson #62 recursion: cycle-2 fix introduced new empirical claim (the placeholder grep claim itself) that was unverified at fix-amendment time.

**How to apply:**

- Replace narrative attestation ("I ran grep") with EMBEDDED command + output in the document itself. The command appears as text in the spec/plan/changelog; the next reviewer can copy-paste and verify identical output. No interpretation gap.
- **Anti-pattern**: "Empirical placeholder grep ran post-edit; zero results." (no command, no output)
- **Pattern**: "Empirical placeholder grep — `grep -nE 'pass$|TBD|FIXME' file.md` → 0 lines (verified 2026-05-06)." (commands embedded; output cited verbatim)
- For commands with non-trivial output, embed a representative excerpt + the verification command alongside.
- Pre-commit checklist for any "I verified X" claim: rewrite as "I ran command Y and got output Z." If you cannot produce Y + Z, you did not actually verify X — fix this before claiming.
- For grep-style placeholder checks specifically: regex must match the actual content shape, not what the author wishes the content to look like. Test the regex against known-positive AND known-negative cases before relying on it. (`pass$` rejects `pass # comment`; use `^\s*pass(\s*#.*)?$` to capture both.)
- Reviewer obligation: when reading "I verified X", do NOT trust the claim. Run the verification command yourself; if the document does not provide one, that is itself a finding (Lesson #59).

**Reference:** Iter 7 plan cycle-3 review 2026-05-05 → CRIT-NEW-1 (commit `9bf0aa1` follow-up). Plan v0.2 changelog claim "verified via grep" was performative; v0.3 fix replaced narrative with EMBEDDED grep commands inline at every empirical claim site. Distinct from Lesson #40 (self-stress-test drift in design work — that's about the author's review of their own design); distinct from Lesson #59 (plausible-feeling assumptions need empirical verification — that's about checking specific empirical claims). Lesson #68 specializes both: the SELF-CLAIM "I verified" itself is the unverified empirical assertion, recursively.

---

### 2026-05-06 — code — When wrapping new dispatch entry point around existing batch processor, audit ALL caller paths to confirm the new dispatch is actually reached (Lesson #69)

**Trigger:** Iter 7 T8 added new top-level `validate_claim` (singular) function that dispatches v3 catalog enforcement vs v2 legacy. All iter 7 unit tests called `validate_claim` directly and passed. Per-task code review approved T8. Final cycle-2 reviewer (broad-scope read across all 18 commits) caught: production cron entry `validator.main()` calls `validate_claims` (plural batch — distinct function, lines 580+), which loops claims through `_validate_fact_now` directly and **never reaches the new `validate_claim` singular**. Iter 7's headline catalog enforcement was effectively dead code in production cron path. Producer prompt v3 + ANCHOR CATALOG injection would ship live, but the validator side promised by spec §6.4.2 + P18 INVIOLATE would NEVER fire. Fix `8c85eba` rewired `validate_claims` to dispatch each claim through `validate_claim`, plumbed `claims_metadata` from `_main_impl`, cached catalog once per batch.

**Pattern:** When the implementation pattern is "add new top-level function alongside existing function" rather than "rewire existing function to use new logic":

- The new function gets unit-tested directly → tests pass
- Per-task code review sees the new function in isolation → looks correct
- The OLD function continues to be called by production callers → bypasses the new logic entirely
- The new logic is silently dead code in the production path

This is structurally distinct from Lesson #48 (audit ALL responsibilities when reordering function role) — that's about preserving secondary invariants when moving an existing function. Lesson #69 is about confirming that NEW top-level entry points are actually CONNECTED to the call graph. The bug is in what's NOT in the diff (the missing rewire of the batch caller).

Sister to Lesson #56 (dispatch eligibility ↔ canonical-list cross-reference): both are about list-shape / call-graph drift between intended scope and actual coverage. Lesson #56 is internal to a single function's dispatch table; Lesson #69 is across the public API surface (singular vs plural entry points).

**Why:** Per-task reviews scope to single commits; they cannot see "this commit added function X but did not rewire function Y to use X". Unit tests that call X directly cannot catch "production calls Y instead of X". Only a broad-scope final reviewer reading the full diff alongside understanding the call graph can catch this class. The bug exploits the gap between "what the new code does" (visible in diff) and "what calls the new code" (requires external knowledge of caller paths).

The implementer in this case explicitly flagged the gap in their report ("Existing `validate_claims` (plural batch loop) unchanged: still calls `_validate_fact_now` directly. The new `validate_claim` (singular) is a fresh top-level entry-point per spec §6.4.2; future iter (T9+) may rewire `validate_claims` to dispatch via per-claim `validate_claim`.") — but the per-task reviewer did not escalate it to "the rewire IS the iter 7 deliverable, not future iter work" because they trusted the implementer's framing. The final reviewer caught it by reading the spec contract alongside the production call graph.

**How to apply:**

- When a task adds a NEW top-level function/entry point that is supposed to replace or supplement an existing path, the task is NOT complete until at least one production caller actually invokes the new function. "Future iter may rewire" is a Lesson #69 trigger; question whether the rewire is in scope.
- Task review checklist: "Does this commit's new function get called by ANY production caller? If not, where is the rewire? If the rewire is in a later task, what guarantees the integration test catches the disconnection?"
- Test-design checklist: when adding a new function under test, also add an integration test that exercises the function via the production-equivalent invocation path (subprocess CLI, batch caller, etc.). Direct-call unit tests are insufficient — they cannot catch dead-code-in-production-path failure mode.
- Final-reviewer mandate (per Lesson #42 cycle-2 + spec §12.2 gate 5): always trace the spec's deliverable contract through to a production-equivalent invocation. If the spec says "X is enforced", verify X is actually reached from a production call site. Spec §6.4.2 in iter 7 said "validator dispatches by producer_prompt_version" — final reviewer's job is to verify the dispatch is reached from the cron entry point, not just from unit tests.
- Sister-class enforcement: if the new function has a singular vs plural / batch vs single counterpart pair, the rewire of the existing caller is REQUIRED in the same atomic landing. Lesson #46 atomic landing principle applies.

**Reference:** Iter 7 final reviewer report 2026-05-06 → CRIT-1 (`validate_claims` plural batch bypassed `validate_claim` singular's v3 dispatch). Fix at commit `8c85eba`: rewire + 4 regression tests including end-to-end subprocess CLI test (`python3 -m pipeline.llm_integrity.validator` with v3-stamped illegal anchor → exit 8). Distinct from Lesson #48 (reorder existing function — preserve secondary invariants) and Lesson #56 (dispatch eligibility list drift inside one function). Sister to Lesson #14 anti-tautology — the gap between unit-test scope and production-path scope is exactly where tautological "tests pass therefore feature works" reasoning fails.

---

### 2026-05-06 — process — Multi-cycle review convergence is ~4 cycles for non-trivial spec/plan (Lesson #70)

**Trigger:** Briefing implementation 2-spec sequence (`docs/specs/2026-05-06-briefing-implementation-spec.md` + `docs/plans/2026-05-06-briefing-implementation.md`). Cycle pattern observed:

| Artifact | Cycle | Findings | Output |
|----------|-------|----------|--------|
| spec v0.1 | cycle-2 (dual reviewer) | 8 CRIT + 9 IMP | spec v0.2 |
| plan v0.1 | cycle-3 (dual reviewer) | 10 CRIT + 24 IMP | plan v0.2 |
| plan v0.2 | cycle-4 (single reviewer) | 8 CRIT + 7 IMP (all v0.2-fix-introduced) | plan v0.3 |

Total findings caught across cycles: **26 CRIT + 40 IMP = 66 issues** before any code shipped. All 8 cycle-4 CRITs were directly traceable to v0.2 fixes for cycle-3 findings — i.e., each cycle's fix introduced ~50-60% drift rate at NEW empirical claims. Only cycle-N+1 catches cycle-N's drift.

iter 7 spec went through 4 review cycles (per its v0.3 revision history). This briefing plan also needed 4 cycles (3 + 4 above). Both projects converged at cycle ~4-5: cycle-N+1 finding count ≈ 0.6× cycle-N count → at cycle-5, 1-3 findings expected; cycle-6, ~0-1.

**Pattern:** Non-trivial spec/plan (≥1500 lines, ≥15 atomic landing groups, multi-module integration) requires roughly 4 reviewer cycles to converge. The shape:

- Cycle-1 (initial): structural / scope issues (handled in brainstorming, not formal review)
- Cycle-2 (post-spec-write): catches spec internal consistency + spec-vs-production-shape drift (Lesson #2 / #59 violations from spec author)
- Cycle-3 (post-plan-write): catches plan-implementability + spec-plan alignment + plan empirical drift
- Cycle-4 (post-plan-fix): catches v0.2 fix-introduced drift (Lesson #62 + #67 in fresh empirical surfaces)
- Cycle-5 (focused on cycle-4 fixes): residual; usually 0-3 findings; recommended to be focused-scope not thorough

Single-cycle "ship-it" mentality is anti-pattern at this complexity. Skipping cycles → drift accumulates → discovered post-implementation at higher cost (production HALT, rollback, bug regen).

**Why:** Each fix introduces NEW empirical claims (file paths, line numbers, function signatures, formula values). Per Lesson #62, drift recurs at NEW claims. The author who just wrote the fix has the highest blind spot for the fix's empirical correctness — Lesson #40 self-stress-test drift at fix scope. Only a fresh-context reviewer can re-verify cleanly.

The 4-cycle convergence isn't because reviewers get smarter; it's because the rate of NEW-claim introduction halves each cycle (cycle-2 fix introduces ~150 lines of new claims; cycle-3 fix introduces ~80; cycle-4 fix introduces ~30; cycle-5 ~10). Eventually new-claim surface area falls below detection threshold.

**How to apply:**

- For non-trivial spec/plan (heuristic: >1500 lines, >15 tasks, multi-module): explicitly **budget 4 cycles + 4 commits + 4 reviewer dispatches** in the planning estimate. Don't expect "one good review and ship".
- Time/cost: each cycle is ~1.5-3h reviewer dispatch + 2-6h author rework. Total review overhead 14-36h for a complex spec/plan, often equal to original spec/plan write effort. This is a feature, not waste — caught early at 1× cost vs caught in production at 5-10× cost.
- Cycle-N+1 should reuse the cycle-N reviewer prompt with one addition: **"audit cycle-N's NEW empirical claims specifically"** (the high-drift surface).
- Cycle-5+ may shift from thorough to focused-scope (only the cycle-N fixes). Per cycle-4 reviewer's own recommendation in this lesson's triggering case, focused-scope spot-check is higher signal-density than perpetual thorough cycles.
- Convergence signal: cycle-N findings ≤ 3 + 0 CRIT-V2 (no fix introduced new bugs) → safe to dispatch implementer. Until then, keep cycling.
- Anti-pattern: "cycle-3 caught 10 CRIT, we fixed them, ship now" → cycle-4 catches 6 of those fixes. Always do cycle-N+1 before implementer dispatch.

**Reference:** Briefing-impl plan cycle history 2026-05-06 (commits `48199e2` spec v0.1 / `94e947a` spec v0.2 / `dd153af` plan v0.1 / `a85c9b9` plan v0.2 / `722aa8f` plan v0.3 + this lesson). Iter 7 spec history `docs/specs/2026-05-05-iter7-anchor-pack-canonical-design.md` v0.1→v0.3 (3 review cycles + 1 cycle-4 spot-check) confirmed same pattern. Distinct from Lesson #42 (reviewer cycles as adversarial discovery — that's qualitative); Lesson #70 is quantitative (~4 cycles is the empirical convergence point).

---

### 2026-05-06 — process — Fix-time empirical verification mandatory (Lesson #71)

**Trigger:** Briefing implementation plan v0.2 (`docs/plans/2026-05-06-briefing-implementation.md` post cycle-3 dual reviewer audit). Plan v0.2 fixed 10 cycle-3 CRITICAL findings; cycle-4 reviewer caught **8 of those fixes themselves were CRITICAL bugs**:

| v0.2 fix | What v0.2 wrote | What was actually true | Cycle-4 finding |
|----------|-----------------|------------------------|-----------------|
| T9 (`_resolve_anchor` location) | Modified anchor_catalog.py | Function lives at validator.py:191 | CRIT-V2-2: AttributeError at runtime |
| T9 (`is_legal_path` signature) | Rewrote to 2-arg | Actual is 3-arg (preserved by 6+ callsites) | CRIT-V2-3: TypeError |
| T13 (path_glob regex) | `r"^([^\[]+)(\[\d+\])?$"` | Glob `[*]` not in regex; doesn't tokenize | CRIT-V2-1: 22 DERIVED_PATHS all FAIL |
| T6 (config shape) | Added flat list `INDICES: [...]` | Existing groups are dict-of-dicts | CRIT-V2-4: schema mismatch, loader rejects |
| T7 (config block) | Added top-level ANCHOR_CONIDS to JSON | `_load_watch_conid_map` reads only ["mapping"] | CRIT-V2-5: silent no-op |
| T2.5 (P17 example) | NVDA $209.26 → cushion 57.85% | Real NVDA $198.543 → 49.77% | CRIT-V2-6: fabricated example, Lesson #59 |
| T2.6 (rebuild flag) | Used `--rebuild-anchor-pack` flag | Flag doesn't exist; build is skip-if-exists | CRIT-V2-7: silent no-op for 6 existing files |
| T2.6 (date list) | Listed 12 dates including weekends | Trading days 4/22-5/05 = 10 | CRIT-V2-8: weekend crashes + missing dates |

Drift rate: **8 of 10 cycle-3 fixes** were empirically wrong = 80% drift rate at v0.2 fix-time. v0.2 author wrote fixes from intent ("X is at file Y / signature Z / value W") without running grep / verifying against actual code. Plan v0.3 fixed all 8 by enforcing **empirical verification BEFORE writing the fix code**: every claim grep'd / live-tested / executed before commit. Result: v0.3 commit included verification output for every changed claim.

**Pattern:** When responding to a reviewer finding, the natural cognitive flow is:

1. Read finding → understand intent
2. Devise fix → write code
3. Commit → move to next finding

The gap is between step 1 and step 2: the author has a *mental model* of the fix that may or may not match the actual code reality. Without empirical verification at step 2, the fix introduces new empirical claims (file paths, signatures, values, flag names) that the author *believes* are correct but never actually verified.

This is Lesson #62 (empirical-claim drift recurs at NEW claims) + Lesson #59 (plausible-feeling assumptions need empirical verification at amendment time) + Lesson #68 (self-claim "ran command" must EMBED command + output) — all three converge specifically on the **reviewer-fix moment** because:

- The author just learned about the issue from the reviewer (high uncertainty)
- The author's instinct is to fix quickly to move on (cognitive haste)
- The fix touches code/files the author may not have seen recently (high drift surface)
- The reviewer's finding itself is correct, lending false confidence to the fix ("if the diagnosis is right, the cure must be right")

**Why:** Reviewer-fix is the highest-drift moment in any spec/plan/code lifecycle. Forecasting the cycle-N+1 reviewer findings, ~50-80% will be at fix sites from cycle-N. This is the dominant remaining defect surface after cycle-3+. Eliminating fix-time drift collapses cycle counts (Lesson #70 convergence accelerates).

**How to apply:**

- **Before writing fix code, run the empirical command(s) that would validate the fix is on the right thing.** Examples:
  - Reviewer says "function X is in module Y" → `grep -n "def X" pipeline/Y.py` BEFORE editing imports
  - Reviewer says "config has shape Z" → `python3 -c "import json; print(json.load(open('config/...')))"` BEFORE writing schema
  - Reviewer says "value should be V" → compute V from actual production data BEFORE embedding in test/prompt
  - Reviewer says "flag --F exists" → `grep -n "add_argument.*F" script.py` BEFORE invoking it
- **Commit message must EMBED verification command + output** (per Lesson #68). Anti-pattern: "Fixed per cycle-N finding." Pattern: "Fixed per cycle-N finding. Verified: `grep -n 'def _resolve_anchor' pipeline/llm_integrity/*.py` returns `validator.py:191`."
- **Plan/spec amendment text must list empirical verifications inline with the fix description.** v0.3 of this plan has a "Empirical re-verifications" section in the revision history listing every claim verified at amendment time. Reviewer can re-run.
- **Self-attestation alone is insufficient** (per Lesson #68). "I verified" without command+output = unverified.
- **Author's mental model must be calibrated against actual code** before any fix. Rule: read 3 lines of context around any line cited in the finding before writing the fix.
- **Reviewer obligation**: when reading a fix-amendment, run the empirical command yourself if author didn't embed one. If author claims "fixed `_resolve_anchor` location", grep and verify.
- This lesson recursively applies to itself: the author writing this lesson should embed examples that have been empirically verified (which the v0.3 commit message did).

**Anti-pattern recognition:**
- "I'll fix these N findings quickly" → high drift risk; slow down to verify each
- "The fix is obvious" → fixes are obvious only when the author hasn't checked actual code
- "Reviewer's diagnosis was clear" → diagnosis correctness ≠ fix correctness
- "I'm under time pressure" → time pressure is exactly when drift compounds; explicit empirical verification is the brake

**How NOT to apply:**
- Don't verify EVERY line of every commit empirically — only the NEW claims introduced by the fix. (Existing code paths are already proven by upstream tests.)
- Don't make this lesson into a process that prevents shipping — verification is fast (seconds per grep); the cost is mental discipline, not time.

**Reference:** Briefing-impl plan cycle-3→v0.2→cycle-4→v0.3 (commits `a85c9b9` v0.2 / `722aa8f` v0.3). Detailed CRIT-V2 trace in v0.3 revision history. Specifically:
- v0.2 author skipped empirical verification → 8 CRIT-V2 introduced
- v0.3 author enforced empirical verification → 8 CRIT-V2 caught + fixed; cycle-5 expected drift rate <30%

Distinct from Lesson #62 (empirical-claim drift recurs — general principle); Lesson #71 specializes to the **fix-amendment moment** where the drift rate is highest. Distinct from Lesson #59 (plausible-feeling assumptions — about original spec/plan author's blind spots); Lesson #71 is about the SECOND author (the fixer) introducing new blind spots. Distinct from Lesson #68 (self-claim "ran command" — about the format of attestation); Lesson #71 is about the CONTENT of the verification (must run BEFORE fix code, not after-the-fact narrative).

---

### 2026-05-06 — process — Per-task 2-stage review catches 3-4× more issues than whole-batch review (Lesson #72)

**Trigger:** Briefing-impl Group A (Session 23). 14 tasks via subagent-driven-development. Reviewer discipline degraded across the group: 5 tasks proper 2-stage → 6 tasks combined spec+code in 1 reviewer → 6 tasks zero per-task review (only whole-Group-A reviewer at end). User-mandated remediation dispatched 14 spec + 14 code quality reviewers in 6 parallel waves.

**Pattern:** Whole-Group-A reviewer caught 5 Important. Per-task 2-stage remediation caught **1 Critical + 19 Important + ~28 Minor** that whole-batch missed. Whole-batch covered ~25% of real issues. Whole-batch and per-task have complementary blind spots — whole-batch sees cross-task / architectural drift; per-task sees test design, edge cases, drift surfaces, anti-tautology. Combined spec+code in 1 reviewer dispatch produces ~25% catch rate vs 75-100% with separate dispatches (cognitive split).

**How to apply:**
- Every task in subagent-driven-development gets BOTH spec compliance reviewer AND code quality reviewer as **SEPARATE FRESH subagent dispatches**. Combined is forbidden.
- "Trivial" tasks (config additions, fixture regen) get 2-stage too. Group A T6 (config-only) + T10 (fixture regen) seemed too small to review; per-task review caught a real `_tokenize_path` leading-dot regression risk in T6 + 5 stale-value drifts in T10. Trivial tasks have non-trivial drift surfaces.
- Whole-batch / final reviewer is **supplementary, not substitutive**. Always run it at the end (catches cross-task interaction like T2.5 producer + T2.5 validator chain drift), but never use it as a substitute for per-task.
- Track tasks-complete : reviews-complete ratio explicitly. If it drifts (e.g., 14 complete but only 8 reviewed), system is broken; remediate immediately.
- Cost: 2 reviewers × N tasks ≈ $25-35 per group; cost of 1 production HALT is 10-50× more. The "save time" temptation is the trap.

**Reference:** Briefing-impl Group A (Session 23). Whole-Group-A reviewer + per-task remediation (14 spec + 14 code quality in 6 waves) — see Batch 1 commit `20b7895` for the substantive findings closed (chain-alignment test rewrite, IBKR_ALIAS programmatic derivation, IbkrFieldCode Enum migration, etc.). Distinct from Lesson #1 (review existing per se) — #72 is about the review pattern (per-task 2-stage separate dispatches). Distinct from Lesson #42 (cycles as adversarial discovery — iteration count) — #72 is per-task discipline within one iteration.

---

### 2026-05-06 — validation — Test must EXERCISE production code, not SIMULATE it inline (Lesson #73)

**Trigger:** Briefing-impl Group A T2.5 chain extension (Session 23). Combined-reviewer save caught that producer-only T2.5 in isolation would cause day-1 HALT exit 8 (validator drop_required still spot-denom while producer narrative had migrated to canonical barrier-denom). Implementer wrote `tests/test_p17_chain_alignment.py` with 3 cells claiming to be the regression guard for this exact drift. Per-task code quality reviewer (Session 23 remediation) caught: the 3 cells **re-implemented validator arithmetic INLINE** rather than calling `validator._validate_fact_now()`. If `validator.py:849` silently reverted to `/anchor_num` tomorrow, all 3 tests would still PASS — they don't import or call validator code, only verify the test's own inline math against canonical SSOT. The regression-guard test was self-defeating.

**Pattern:** Author-instinct for "rigorous" test:
```python
def test_X():
    expected = (a - b) / b * 100   # re-implement production formula INLINE
    actual = (a - b) / b * 100     # ALSO re-implement INLINE (claims to "simulate" production)
    assert actual == expected      # tautology against test's own inline math
```

If production silently reverts to `(a - b) / a * 100`, **the test still passes** because production code never enters the picture. The test's `actual` is computed by the test, not by production. Both sides share the test's mental model of the formula; they break together when production breaks; they pass together when production passes; they pass together when production silently breaks because the test's inline copy doesn't break.

**Why:** This pattern is super common because:
- Writing `expected = formula(...)` feels rigorous (it IS the same math)
- Author thinks "I'm verifying chain-alignment by computing both sides + asserting equality"
- Reality: both sides are computed by test's own math; production code never enters
- Looks clean to spec compliance review (test exists, asserts non-trivial value)
- Looks clean to whole-batch review (suite passes, no regressions surface)
- Only catchable by per-test deep-read asking: "does this test actually call the production code path it claims to guard?"

Distinct from Lesson #14 (anti-tautology) which is about assertion strength (`assert result is not None` vs exact value). Here the assertion IS strong (exact value) but the **test doesn't exercise the production code path**. Lesson #14 is "assert X is the right value"; Lesson #73 is "make sure the X you're asserting against came from production, not from your inline simulation".

**How to apply:**
- Test must import + call the actual production function being tested. Not re-implement its formula inline. Not "simulate" its arithmetic.
- `expected` value is **externally derived hardcoded constant** (verified empirically once, embedded as magic number with comment showing derivation) — NOT computed inside the test by re-applying the formula.
- Pattern:
  ```python
  # CORRECT — production code exercised; expected is external hardcoded
  def test_p17_validator_drop_required_canonical():
      # PLTR 5/4: spot=146.07, barrier=118.41
      # Canonical = (146.07 - 118.41)/118.41 * 100 = 23.36 (verified externally)
      result = validator._validate_fact_now(claim={...}, anchor_pack={...})
      assert abs(result["actual_pct"] - 23.36) < 0.01
  ```
- Anti-pattern markers in code review:
  - Test computes `expected = <formula re-implementation>` and asserts production output equals expected → test re-implements production
  - Test name says "validator chain" / "integration" / "regression guard" but doesn't import the module under test → simulation, not exercise
  - Test docstring says "verify X matches Y" where X and Y are both computed by the test → tautology
- Layered defense: anti-regression cell asserts production output ALSO doesn't equal a known-wrong value (canonical AND `abs(result - <wrong-denom>) > 1.0`). Forces both directions of bound.
- Reviewer obligation: when reading any test claiming to be a regression guard, grep the test body for `import <module-under-test>` + `<module>.<function>(...)` calls. If absent, test is simulating not exercising.

**Anti-pattern recognition:**
- "I'll compute expected from the formula to be rigorous" → re-implementation, not verification
- "The test verifies the math is right" → math being right ≠ production code being right
- "Both sides match so the chain is aligned" → both sides match because the test computes both
- "I added a chain-alignment regression test" → did the test actually call the chain components, or just simulate them?

**How NOT to apply:**
- Pure-math utility tests (e.g., `test_addition`) legitimately compute expected inline — there's no "production code path" to exercise beyond `+`. Lesson #73 applies when there IS a production code path the test claims to guard.
- Lesson #73 doesn't require avoiding all parametric test setup — using a well-tested helper to construct an `expected` from spec-mandated math is fine, as long as the production code path being tested is actually exercised.

**Reference:** Briefing-impl Group A T2.5 chain (Session 23). Original broken `tests/test_p17_chain_alignment.py` (tag `briefing-impl-group-a-pre-squash` → commit `f9815f5` in 19-commit chain) re-implemented validator arithmetic inline; rewritten in Batch 1 commit `20b7895` to call real `_validate_fact_now()` with constructed claim + anchor_pack and assert against externally-derived canonical 23.36 / 49.77 with anti-iter-7-wrong-denom guards.

Distinct from Lesson #14 (anti-tautology) — #14 is assertion strength (`is not None` vs exact value); #73 is which CODE the test exercises (production vs inline simulation). The two stack: a test can have both strong assertion AND simulate-not-exercise (the T2.5 case). Distinct from Lesson #56 (dispatch eligibility from canonical list) — #56 is about production SSOT; #73 is about test design.

---

### 2026-05-06 — validation — Unit-layer success can hide integration-layer failure (Lesson #74)

**Trigger:** Briefing-impl Group B T17 unanchored handler + T18 parser integration (Session 24). T17 unit tests called `unanchored.handle(node, ...)` directly and asserted the returned string contained `<!-- briefing-renderer audit: ... -->` — passed cleanly, exercising production code (Lesson #73 satisfied). T18 parser tests verified `_replace_tag_with_text` preserves tail correctly. T21 E2E test asserted `"$132.563" in rendered` — passed. **All 173 per-task tests passed; no per-task reviewer flagged a defect.** Whole-batch reviewer ran ad-hoc end-to-end: rendered template containing `<unanchored>` → output contained `&lt;!-- briefing-renderer audit: ... --&gt;` (HTML-escaped visible text, NOT a real comment). Root cause: `_replace_tag_with_text` calls `parent.text = literal + comment_string`; lxml's text setter HTML-escapes `<` and `>` by design. Handler returned correct string in isolation; integration-layer transform broke the contract. Audit-trail infrastructure (Group D D1→HTML validator C1 verifier) was about to ship as a no-op AND the briefing output had visible escaped-comment artifact.

**Pattern:** Test pyramid blind spot.
- Unit test: "handler returns expected string" — passes.
- Module test: "lxml replaces tag with text correctly" — passes.
- Integration test: "rendered HTML has the structural property the handler intended (a real `<!--` comment, not escaped text)" — **never written**.

The unit + module tests both exercise production. Both pass. Both are correct in their stated scope. The bug lives in the *contract between* the two layers: handler-string-output → lxml-text-setter → final-HTML-bytes. Neither test layer's scope covers the cross-layer transform.

**Why:** Common because:
- Unit tests are cheap to write per handler (T17 had 32 test cells).
- Integration tests feel redundant after units pass.
- The transform layer (lxml.text setter) is library code, "obviously correct."
- Multi-task implementers each focus on their task's surface; "integration is someone else's task."
- Per-task review verifies "task does what spec says" — task A's spec ("return audit string") and task B's spec ("replace tag with text") were both met.

Per Lesson #72 corollary: whole-batch review IS the integration test for cross-task contracts. Don't treat it as supplementary inspection — it is a load-bearing review layer with its own failure modes. Per Lesson #73 corollary: a test can EXERCISE production (no simulation, no mocks) and still miss integration-layer transforms outside its scope.

**How to apply:**
- For every cross-module data flow (handler-output → parser-mutation, validator-claim → JSONL-emission, anchor_pack-build → renderer-resolve), write at least one integration test that asserts the END-TO-END semantic property, not just per-stage transit.
- For HTML/text/byte transforms specifically: don't assume library escape behavior matches your intent — assert the rendered bytes contain the structural marker (e.g., raw `<!--` AND not `&lt;!--`).
- For audit/observability infrastructure: the test that proves the audit is consumable downstream is the one that runs the full pipeline and parses the audit out of the final output. If the audit is supposed to be a real HTML comment, assert it parses as an HTML comment (not just that the string `<!--` appears somewhere).
- When per-task reviews all pass but the work spans multiple modules, BUDGET TIME for whole-batch review specifically targeting cross-layer contracts. Whole-batch is not "polish" — it's a distinct review layer with its own ROI.

**Reference:** Briefing-impl Group B C1 finding (Session 24). Per-task review for T17 + T18 + T21 all PASS; whole-batch reviewer caught CRITICAL: rendered HTML had `&lt;!-- briefing-renderer audit: ... --&gt;` (escaped text) instead of a real HTML comment. Fix: handler attaches `lxml.etree.Comment` node as sibling via `node.addnext()` BEFORE returning literal text; parser's tag-replacement preserves the Comment as sibling. New E2E regression test asserts raw `<!--` present AND `&lt;!--` absent in rendered output. Group B atomic squash `7bed7da`.

**Anti-pattern recognition:**
- "Each task's tests pass; we're done with that task" — the task's tests cover the task's surface, not cross-task contracts
- "The transform layer is library code, no need to test" — library behavior + your contract = something neither party tested in isolation
- "Whole-batch review is supplementary" — for unit-level success but integration-level failure, whole-batch IS the only catching layer
- "Integration test would be redundant" — until the integration breaks; redundancy is feature for cross-layer contracts

**How NOT to apply:**
- Don't mandate integration tests for every internal transform. Only cross-module data flows where the consumer's contract differs from the producer's contract.
- Don't blow up the integration suite with N×M cells. One per cross-layer contract is enough.

Distinct from Lesson #72 (review pattern: per-task vs whole-batch) — #72 is about WHO reviews; #74 is about WHAT scope a test covers. The two stack: per-task tests + per-task reviews can ALL pass while the cross-task integration is broken. Whole-batch review (#72) catches what #74 warns about. Distinct from Lesson #73 (test must EXERCISE production) — #73 is about whether the test calls production code at all; #74 is about whether the test's scope covers the cross-layer contract even when production IS exercised. Distinct from Lesson #14 (anti-tautology) — #14 is assertion strength; #74 is which boundary the assertion is taken at.

---

### 2026-05-06 — validation — Cross-task contract test must traverse the FULL production pathway, not bypass middle stages (Lesson #75)

**Trigger:** Briefing-impl Group C T24 (Session 25) implementer wrote `test_lesson_74_audit_comment_round_trip_through_group_b` to satisfy Lesson #74's cross-task contract requirement for the Group B → T24 audit-comment data flow. Test invoked `pipeline.briefing_renderer.handlers.unanchored.handle()` (source endpoint) → built synthetic HTML inline → parsed via `pipeline.llm_integrity.briefing_validator._scan_unanchored` (sink endpoint). Per-task review PASS (test EXERCISES production at both endpoints + uses real handler); spec compliance PASS. Group C **whole-batch reviewer** caught: the test bypasses `pipeline.briefing_renderer.parser._replace_tag_with_text` — Group B's actual middle-stage tag-replacement function. Production pathway is `unanchored.handle()` → `parser._replace_tag_with_text()` → final HTML bytes → validator's `_scan_unanchored`; the test only calls steps 1 + 4. The very test designed to catch parser-emit drift (per Lesson #74 — recall: the Session 24 CRITICAL was lxml's text-setter HTML-escaping `<`/`>` inside `_replace_tag_with_text`) bypasses the parser. Defect dormant because Group B's parser fix `addnext(comment)` happened to produce stable Comment node placement across the bypassed path; future parser refactors silently break the contract without test catching. Whole-batch flagged as Minor (deferred to v0.5) since current production output IS correct — but the contract test is structurally weak.

**Pattern:** Lesson #74's "cross-task contract test" requirement is necessary but not sufficient. The test must traverse the FULL production code path between source + sink, not just synthesize the output the middle stages WOULD produce. If the middle stages have transform contracts (lxml escape behavior, byte encoding, HTML tree mutation, comment-node placement), bypassing them creates a contract test that proves only "endpoints can speak the same language in isolation" — which doesn't prevent middle-stage corruption. The test passes today because the synthetic HTML happens to match what the parser produces; a future parser change that breaks the cross-task contract will pass the bypass-test silently.

**Why:** Common because:
- Synthesizing the intermediate output is faster than threading through the real parser/handler chain (no HTML tree setup boilerplate).
- The middle stage "looks like a string concatenation" or "looks like simple wrapping" — feels safe to inline.
- Per-task review verifies "test exercises production endpoints" (Lesson #73) — both source and sink ARE production code, just not the middle.
- Whole-batch reviewer's job is specifically to compare test pathways against production pathways end-to-end.

**How to apply:**
- For every Lesson #74 cross-task contract test, audit during whole-batch review: "does this test traverse the full production code path between source + sink, or does it shortcut?"
- If shortcut: replace inline string-construction with calls to actual production middle helpers (e.g., `parser._replace_tag_with_text(node, rendered)` instead of inline `parent.text + literal + ...`).
- If the production path involves multiple stages (handler → parser → output → consumer), the contract test must invoke ALL of them — not just first + last.
- Flag in the test docstring which production helpers it exercises so future readers can verify the chain on sight.
- Whole-batch reviewer specifically checks `Lesson_74` test integrity — per-task review can't because the test scope is per-task.

**Anti-pattern recognition:**
- "I'll synthesize the HTML the parser would produce" — if you can synthesize it manually, you're encoding YOUR mental model of the parser's behavior, not the parser's actual behavior. Future parser drift escapes.
- "The handler's output is well-defined; the parser just inserts it" — until the parser does HTML-escape (Session 24 CRITICAL) or some other transform.
- "Testing the source + sink is sufficient for cross-task contract" — only if you also exercise the middle pathway. Skip the middle, skip half the contract.
- "The middle stage is library code or trivial wrapping" — Session 24 demonstrated lxml's text setter (library code) HTML-escapes in a way that broke the contract.

**Reference:** Briefing-impl Group C whole-batch reviewer (Session 25). `test_lesson_74_audit_comment_round_trip_through_group_b` at `tests/test_briefing_renderer/test_briefing_validator.py` + `_make_unanchored_html` helper both reimplement parser tail logic inline (helpers DO `+ tail`; the dedicated Lesson #74 test does not even include tail). Defect dormant — current production correct — flagged as Minor for v0.5 (replace inline with `pipeline.briefing_renderer.parser._replace_tag_with_text(node, rendered)`).

**How NOT to apply:**
- Don't mandate full-pathway testing for every test. Only Lesson #74 cross-task contract tests.
- Don't blow up test runtime — the full pathway is one extra function call, not a 10-stage pipeline reconstruction.
- Don't insist on "real I/O" — synthesizing input HTML is fine; what matters is exercising the middle production helpers, not the I/O surface.

Distinct from Lesson #74 (cross-task contract scope) — #74 says "write a contract test for cross-layer transforms"; #75 says "the test must invoke the production middle helpers, not bypass them". #74 is the requirement; #75 is the implementation discipline. Distinct from Lesson #73 (test EXERCISES production not simulates) — #73 is about whether endpoints are real; #75 is about whether the path between endpoints is real. The two stack: #73 requires real endpoints, #75 requires real middle. A test can pass #73 (real endpoints) and fail #75 (synthetic middle).

---

### 2026-05-06 — code/process — Empirical bounds verification must cover production data shape (incl. staleness/lag), not only canonical fresh-data shape (Lesson #76)

**Trigger:** Briefing-impl Group C T22 (Session 25) implementer received plan literal `proxy_multiplier=1.05, tolerance_pct=8.0` for Brent ≈ WTI sanity bound (FRED `DCOILWTICO` proxy). L2 land-blocking gate required empirical verification before commit. **First verification used 4 same-day pairs**: each date X's `data/analysis/anchor_pack_X.json` `fred.DCOILWTICO.latest` vs date X's actual Brent close (web-sourced). Observed multipliers 1.026-1.068 across 4 dates 4/29-5/4 — plan literal 1.05 looked roughly compatible at boundaries, ~5% deviation max. Implementer initially BLOCKED with this 4-observation evidence. **Controller authorized expansion** per spec §8.3 "failed entry → adjust" clause. Implementer expanded to 4 same-day + **4 FRED-stale = 8 observations**. FRED-stale = production reality: `DCOILWTICO` publishes with 1-3 day lag, so on 5/4 the anchor_pack actually reads 4/27's WTI close = $99.89, while briefing literal references 5/4's actual Brent close = $114.40 → observed multiplier 1.145 (not 1.026). FRED-stale regime spans 1.083-1.182 — much wider than same-day. Final amended values `multiplier=1.10 + tolerance_pct=10.5` cover all 8 observations with max deviation 7.42% (4/29 stale) + 3% buffer. Plan literal 1.05/8% would have FAIL'd 4/4 FRED-stale dates — i.e., FAIL'd every Monday after a weekend bridges to Friday's stale FRED close. C1 verifier would have produced false-positive FAIL on every legitimate Brent claim in production.

**Pattern:** Empirical bounds verification with canonical "fresh data" assumptions misses production reality. When the production data source has known staleness/lag/missingness/granularity properties, the empirical bound test must include those regimes. A bound that PASSES on freshly-fetched data but FAILS on production-stale data is operationally a no-op (fires correctly only when no lag) or worse (false-positive every cycle when lag bridges).

**Why:** Common because:
- Plan/spec authors have a mental model of "today's data for today's claim" — clean, single-regime.
- Verification scripts are easiest to write against canonical fresh data (just read `anchor_pack_<today>.json` + look up `<today>'s` actual close).
- Production data sources' lag/staleness properties are operationally known but not captured in the spec literal — they live in CLAUDE.md's Standard Daily Workflow narrative ("FRED 1-day lag") or the operator's mental model.
- Same-day verification "looks comprehensive" — 4 dates is plausibly thorough — until you realize the 4 dates all have the same input regime.
- Bound verification at land time is easy to declare "done" after one regime passes; expansion to multi-regime requires recognizing the regime exists.

**How to apply:**
- When designing empirical verification for a sanity bound, threshold, or numerical contract:
  1. Enumerate the production data sources' real properties: publishing lag, refresh cadence, missingness modes, granularity, weekend/holiday gaps, market hours alignment, etc.
  2. For each property that affects the bound's input distribution, construct a verification scenario that surfaces the regime (e.g., FRED-stale = read X-day-old FRED value; market-closed = no AH/PM data; missing-series = ANCHOR_CONIDS gap).
  3. Verification matrix needs MULTIPLE regimes: optimistic (fresh data), realistic (typical lag), worst-case (max-lag, missing series, weekend bridge, etc.).
  4. Document the regime explicitly in the bound's audit trail — module docstring table with column headers `Regime / Date / Input / Actual / Observed`.
- When fixing reviewer findings on a bound: re-verify against ALL regimes, not just the regime the original test happened to use. Don't assume single-regime fix transfers.
- Implementer-side discovery is the safety net — T22 implementer noticed `WTI=$99.89` repeating across 5/1 + 5/4 anchor_packs and recognized FRED publishing lag immediately, prompting regime expansion. Train the discovery instinct: "if production reads from a series with known lag, the bound test must reflect that".

**Anti-pattern recognition:**
- "I'll use today's FRED close for today's bound" — production fetches FRED daily but FRED publishes with 1-3 day lag; "today's anchor_pack" contains "yesterday's or earlier" FRED data.
- "5% multiplier was the plan literal so it must be right" — plan literals encode the AUTHOR's mental model of data freshness; production reality may differ. L2 gate exists exactly to catch this.
- "The same-day verification passes, ship it" — Mondays will fail when weekend bridges Friday's close.
- "I'll widen tolerance to absorb the worst case" — possible but wasteful. Better to set multiplier at the regime midpoint + tolerance covers natural variance, not absorb known-systematic offset.

**Reference:** T22 sanity_bounds.py (Session 25 Group C atomic squash `e03ba07`). Plan T22 literal 1.05/8% FAILED L2 empirical gate. Implementer expanded verification from 4 same-day to 4 same-day + 4 FRED-stale = 8 observations. Amended to 1.10/10.5%. 8-observation table documented in module docstring with both regimes labeled explicitly + invitation to re-verify when oil regime shifts. Plan v0.5 amendment item: T22 plan snippet should reflect amended values + regime methodology.

**How NOT to apply:**
- Don't enumerate every conceivable regime — focus on regimes the production pipeline actually exhibits (FRED 1-3d lag is real; "what if WTI series goes negative" is theoretical).
- Don't multiply test cells without bound — 8 observations covering 2 regimes × 4 dates is enough; no need for 80.
- Don't insist on multi-regime for bounds that operate on fresh-only data (e.g., live IBKR snapshot vs same-second user input — single regime).

Distinct from Lesson #71 (fix-time empirical verification mandatory) — #71 is "verify before commit"; #76 is "verify with production-realistic data shape, not idealized". The two stack: #71 says verify; #76 says what to verify against. Distinct from Lesson #62 (empirical-claim drift recurs at NEW empirical-claims tables) — #62 is about drift recurrence at fix time; #76 is about regime coverage at design time. Lesson #76 prevents creating a new empirical-claims table that's right at write time but wrong at production time.

---

### 2026-05-07 — spec/process — Cross-section spec drift creates producer-consumer integration gap invisible until consumer's whole-batch (Lesson #77)

**Trigger:** Briefing-impl Group D whole-batch reviewer (Session 26) caught CRITICAL: T25 (`scripts/validate_briefing.py`, landed Group C Session 25 atomic squash `e03ba07`) implemented spec §8.8 (CLI: `--output table | jsonl` to stdout) literally and **never wrote spec §8.7's mandated file** `data/analysis/briefing_validation_<date>_<type>.json`. T30 (`scripts/annotate_briefing.py`, landed Group D Session 26) reads §8.7 file as the brief-validate gate input. Production result: file never exists → T30's gate falls through to "legacy date" graceful pass → **the spec-1 brief-validate safety mechanism is silently bypassed in production** (zero `briefing_validation_*.json` files on disk despite multiple Group C land + 5 production briefings rendered). The 17 T30 coupling tests all PASSED because they used a `_write_brief_validate(tmp_path, ...)` synthesis helper instead of running the real T25 CLI — Lesson #75 violation at producer-consumer scope. Per-task review for T25 (Group C) PASSed because §8.8 was implemented exactly. Per-task review for T30 (Group D) PASSed because gate logic was correct given the synthesized fixture. Whole-batch for Group C PASSed because no consumer existed to integrate against. Only Group D's whole-batch reviewer caught it via end-to-end production traversal.

**Pattern:** Spec sections that describe the same artifact from different angles must explicitly cross-reference, or implementer will follow only one section. Common spec-organization shape:

- §8.7 — declarative: "Output file: `data/analysis/briefing_validation_<date>_<type>.json` shape: {_metadata, verdicts, summary}"
- §8.8 — procedural: "CLI flags: `--output table | jsonl`; default output: stdout table"

When §8.8 doesn't say "ALSO writes §8.7 file" and §8.7 doesn't say "produced by §8.8 CLI", a literal-reading implementer can satisfy §8.8 without writing the §8.7 file. Per-task review can't catch it (each section is self-consistent). Producer's whole-batch can't catch it (no consumer exists yet). Only consumer's whole-batch — IF the contract test exercises the real producer (Lesson #75) — catches the gap.

**Why:** Common because:
- Spec authors split concepts by abstraction level (declarative vs procedural) without enforcing cross-section linkage.
- Implementer of producer task focuses on the section directly mentioned in their plan task (e.g., plan T25 cited §8.8 CLI, not §8.7 file).
- Per-task review verifies "task does what spec says"; spec literally says §8.8 → CLI → stdout. No file-write check fires.
- Consumer task's tests synthesize the producer's output (Lesson #75 violation) because it's faster than running the real producer in a test fixture. Coupling tests pass; integration is untested.
- Producer's atomic squash lands without a real consumer. Whole-batch reviewer can verify within-group contracts but no cross-group consumer to read the artifact.
- The bug only surfaces when the consumer ships AND someone runs the consumer's whole-batch with real production data.

**How to apply:**
- **Spec authoring discipline**: when an artifact is described in two spec sections (declarative + procedural), explicitly cross-reference. E.g., §8.8 CLI section must include "(writes §8.7 file by default)"; §8.7 must include "(produced by §8.8 CLI invocation)". Treat cross-section linkage as part of spec correctness review.
- **Per-task spec compliance review**: when reviewing a task that touches an artifact described in multiple spec sections, verify ALL referenced sections, not just the one the plan task cites. Open the spec at every section the task's artifact appears in.
- **Producer-consumer chains spanning atomic-squash boundaries**: consumer's whole-batch reviewer must invoke real producer CLI to produce artifact, NOT synthesize the artifact's shape via fixture helper. This is Lesson #75 generalized to producer-consumer scope. Synthesis-only fixtures hide the producer-side contract gap.
- **Spec author's mental cross-reference test**: read §8.7 (file output) without §8.8; would a fresh implementer know HOW the file gets written? If no, §8.7 is incomplete. Read §8.8 (CLI) without §8.7; would a fresh implementer know WHAT the CLI must produce? If no, §8.8 is incomplete.
- **Plan task author's cross-reference**: when assigning a plan task that implements an artifact spec, list ALL spec sections the task must satisfy. Plan T25 cited "§8.8 CLI" but should have said "§8.8 CLI + §8.7 file output (file must be byte-identical to consumer §X.Y reads)". Plan-level cross-reference would have surfaced the contract early.
- **Consumer's coupling tests must not synthesize producer output**: if T30 needs a `briefing_validation_<date>_<type>.json` fixture, the test should run T25 CLI to produce it (subprocess.run pattern) rather than write the JSON inline. The synthesis pattern hides the producer's contract gap. Even if synthesis tests are kept for rapid edge-case coverage, ≥2 real-subprocess cells must exist.

**Anti-pattern recognition:**
- "I'll synthesize the JSON the producer would write" — encodes YOUR mental model of the producer's output, not the producer's actual behavior. Future producer drift (or producer never implementing the file write) escapes.
- "Per-task review PASSed for both T25 and T30 individually" — they each satisfied their own spec section. Cross-section linkage was the gap. Per-task scope can't catch it.
- "Producer's whole-batch covered everything" — for cross-group integration, producer's whole-batch is incomplete by design (no consumer to integrate against). Consumer's whole-batch is the load-bearing review.
- "Spec §X.Y says output file path; §X.Z says CLI uses stdout" — if no explicit cross-reference, treat as drift candidate. Either author cross-ref or expect implementer to follow only one.

**How NOT to apply:**
- Don't mandate cross-references for unrelated spec sections (§5.3 fmt mode and §8.7 validator output have nothing to do with each other).
- Don't refuse all synthesis fixtures — they're valid for rapid edge-case coverage. Just require ≥2 real-subprocess cells per producer-consumer contract.
- Don't make spec authors write redundant prose; cross-references can be inline (a single phrase "(produced by §X.Y CLI)") not separate paragraphs.
- For producer-consumer chains within the same group / same atomic squash: regular whole-batch suffices because both sides exist. The cross-group case is what triggers Lesson #77.

**Reference:** Briefing-impl Group D whole-batch reviewer (Session 26). Critical finding: T25 → T30 contract gap silently bypassed in production. Closure: atomic squash commit `c851db6` includes T25 default file output (`scripts/validate_briefing.py` writes `data/analysis/briefing_validation_<date>_<type>.json` by default; `--no-file-output` flag for stdout-only mode) + 2 real-subprocess T30 coupling cells (`test_real_subprocess_t25_produces_file_then_t30_passes_gate` happy path + `test_real_subprocess_t25_fail_case_blocks_t30_gate` FAIL case via deliberate `<h2>` removal).

Distinct from Lesson #67 (JSON key vs section enum value drift in code) — #67 is spec-vs-code drift; #77 is spec-INTERNAL drift between sections. Distinct from Lesson #75 (middle helper bypass within same task) — #75 is bypass within a single test's pathway; #77 is bypass spanning atomic-squash boundaries (producer landed in one squash, consumer in another). Distinct from Lesson #74 (cross-task contract test scope) — #74 mandates writing the contract test; #77 is about WHEN the contract gap can be caught (only at consumer's whole-batch when producer-consumer span groups). The four stack: #67 + #74 + #75 + #77. A spec can be drift-free (#67 OK), tests can exist (#74 OK), tests can call production endpoints (#73 OK), tests can traverse middle helpers within a task (#75 OK), AND the producer-consumer contract can still silently fail because the consumer test synthesizes the producer's output (#77).

---


### 2026-05-07 — validation — Cross-feed value drift between data providers means reconstruction requires source-of-truth lock (Lesson #78)

**Trigger:** Briefing-impl T41 cycle 1 prep (Session 28). Operator reverse-templatifying 5/4 daily briefing for A/B regression discovered that running `backfill_market_data.py --date 2026-05-04 --source ibkr --force` (with gateway authed) returned PLTR.US.last = **146.6**, while main repo's publish-time Longbridge `data/2026-05-04.json` had PLTR.US.last = **146.07** — a 0.36% spread on the same trading-day regular-session close. Both feeds returned ostensibly the same metric ("regular session close, no after-hours") but disagreed on the actual value. Root cause: Longbridge reports Nasdaq's official 16:00:00 closing-auction print (single price-discovery event); IBKR's `aggregate_minute_bars` over `outsideRth=true` history endpoint takes the last 1-min bar before 16:00 (pre-auction continuous trading on consolidated tape). For high-volatility names around catalysts (PLTR was hours away from Q1 earnings), the closing auction often re-prices ~0.3-0.5% off the pre-auction continuous level — selling pressure at close pushed the auction print to 146.07 from the ~146.6 trading level moments before. Both values are real; they describe different price-discovery mechanics.

**Pattern:** When reconstructing historical state for A/B regression, iterative validation, or any "what did the artifact see at publish time" workflow, **the data file used at publish-time is the source-of-truth — refetched data even from the same date introduces feed-source value drift** that masquerades as renderer / processor / pipeline bugs. The drift creates spurious diffs in comparators that aren't real spec or code bugs, polluting the signal-to-noise ratio of the regression cycle.

**Why:** Different data feeds for the same underlying instrument can legitimately return different values for the same labeled metric, due to:
- Different aggregation mechanics (closing-auction print vs last-bar-of-continuous-trading vs VWAP)
- Different consolidated-tape vs single-exchange feeds
- Different timing windows around auction events
- Different inclusion/exclusion of late prints, dark-pool prints, or after-auction crossing trades

These differences are often invisible at the label level (both feeds say "close" or "last") but visible in the values. A pipeline that worked correctly against feed A's "close" can produce diff against feed B's "close" — not because the pipeline broke, but because the feed switched. Refetching for "convenience" silently flips the source feed and produces false-bug signal.

**How to apply:**
- For A/B regression cycles: always reconstruct the anchor_pack / processed state from the EXACT publish-time `data/<date>.json` source file. Never refetch via `backfill_market_data.py` / `fetch_market_data.py` / IBKR snapshot to "freshen" the data. If publish-time file is missing, the cycle date is fundamentally not reconstructible — pick a different date.
- For ANY downstream pipeline depending on a specific feed for a specific metric: lock the feed identity in your data-source-priority documentation. Don't substitute "close from Longbridge" with "close from IBKR" silently — they're not the same thing for high-volatility names around catalysts.
- For A/B regression methodology spec: explicitly document which feed-source the cycle locks against. spec §10.5 already uses Longbridge publish-time `data/<date>.json` (correctly); this lesson formalizes WHY refetching breaks the cycle.
- For backfill design: backfill is designed to FILL MISSING data when no publish-time file exists. It is NOT designed to refresh existing publish-time data — refresh would introduce cross-feed drift as a feature, not a bug. Document this scope distinction in `scripts/backfill_market_data.py` docstring and `docs/sop/`.
- For "if IBKR is up, isn't the backfill perfect?" intuition: IBKR provides high-quality reconstruction for AH/PM bars and OHLC ranges, but its `last` field for the regular session close ≠ the Longbridge auction print. "Perfect" depends on which feed's semantics you're targeting. For A/B regression against a Longbridge-authored briefing, IBKR is the wrong source even when authoritative for its own purposes.

**Reference:** Briefing-impl T41 cycle 1 prep (Session 28). Empirical demonstration: backfill via IBKR returned PLTR=146.6 / AAPL=276.65 / NVDA=198.48 vs publish-time Longbridge PLTR=146.07 / AAPL=276.873 / NVDA=198.543. AAPL/NVDA spreads (~0.08% / 0.03%) are at noise floor; PLTR's 0.36% reflects genuine auction-vs-continuous-trading mechanics around earnings catalyst. Resolution: worktree's `data/2026-05-04.json` restored from main repo's publish-time copy before `build_anchor_pack.py --date 2026-05-04` regen. T41 cycle 1 will use the restored publish-time data; cross-feed difference becomes a real plan v0.5 finding rather than a spurious renderer bug.

Distinct from Lesson #62 (fixture aging at NEW empirical claims — about schema-shape change over time). Distinct from Lesson #41 (string-vs-float production heterogeneity within a feed). Lesson #78 is value-level drift across feeds for the same date/metric label. Distinct from Lesson #5 (silent fallback forbidden) — refetching isn't a fallback, it's an explicit choice the operator/pipeline can make; the lesson is about WHEN to make it (only for missing data, never for refresh).

### 2026-05-07 — validation — Per-worktree state divergence: derived golden snapshots fail in one worktree and pass in another for shared, non-checked-in source state (Lesson #79)

**Trigger:** Briefing-impl T42 atomic squash + main merge (Session 29 Phase 4). On staging branch worktree, `pytest tests/test_anchor_catalog_golden.py` returned **1 FAIL** (`[2026-05-04]` only); cycle-1 retro Phase 1-3 closure scoped v0.5 deferral to that single date. Post-merge on main worktree (separate path), the same command returned **3 FAIL** (`[2026-04-29 + 2026-05-01 + 2026-05-04]`). Both worktrees were on the same commit SHA `984599b`; both had freshly regenerated `data/analysis/anchor_pack_<date>.json` files via `build_anchor_pack.py`. Root cause: `data/x.db` is continuously updated by tier-1/tier-2 X fetchers (cron) and IS NOT checked into git (gitignored). The `account_aggregates` block surfaced into the anchor catalog via spec 1 Group A's portfolio_aggregates derivation chain reads ticker-mention counts from `x.db` indirectly through the fetch-state lineage; different `x.db` snapshots at regen time produced different aggregate values → different anchor catalog → different golden-snapshot match outcome. Staging's earlier regen (Session 28) had a `x.db` snapshot that coincidentally matched the 4/29 + 5/1 golden fixtures; main's later regen (Session 29 Phase 4) had a slightly newer `x.db` that diverged. The `[2026-05-04]` failure was the only one stable across both worktrees because that date's catalog had a fundamental shape change (158KB post-Group-A vs 144KB pre-Group-A on disk).

**Pattern:** Tests asserting golden-snapshot equivalence against derived data computed from non-versioned, mutating source state can pass on one worktree and fail on another *for the same commit SHA*. The failure depends on a side input (here `data/x.db`) that varies across worktrees because cron continuously updates it in only one. The PR-author's worktree is "clean"; the merger's worktree fails the same test. This produces a confusing signal: closing the staging-FAIL set "should" close the test failures on main, but additional failures surface that weren't visible during staging review.

**Why:** Git tracks committed state, not derived state. When a golden snapshot is conceptually "what the production pipeline produces against publish-time inputs," the test contract assumes inputs are stable across worktrees. If any input is sourced from a non-checked-in mutating file (cron-fed DB, environment-derived config, OS time), the contract is silently broken. The test is sound; the input lock is not. Per-worktree divergence is the visible symptom of input non-determinism.

The closing scope at staging is therefore a **lower bound** on what merge will actually require: staging shows the `min(failures across worktrees)`. Worktree state differences cause additional failures to surface only at merge time when the merger's worktree has a different snapshot of the non-versioned input.

**How to apply:**
- For derived golden-snapshot tests: explicitly enumerate every input that contributes to the snapshot. If any input is non-versioned (DB file, cache file, env var, system clock), document it AT TEST AUTHORING TIME. Either (a) lock the input into a checked-in fixture, or (b) document the regen workflow including input snapshot capture.
- When closing a staging-FAIL set before atomic squash: anticipate that merge-target worktree may have a different snapshot of any non-versioned input. **Do not scope v0.5 deferral to the staging-visible failure list alone.** Re-run the test suite on the merge-target worktree post-merge BEFORE writing the cycle/session retro; widen deferral scope if needed.
- For institutional fix: golden-snapshot regen workflow must include a step to regenerate ALL test dates whose anchor_packs derive from the mutating input — not just the date that visibly failed. v0.5-001 (commit `87ad457`, batch 1) closed the visible 3-date failure by regenerating all three goldens in lockstep against the current `data/x.db`; the same workflow applies for any future per-worktree divergence finding.
- For SOP scope: `docs/sop/spec-amendment-fixture-refresh.md` covers `tests/fixtures/briefing_renderer/anchor_packs/` (versioned fixtures). Per-worktree state divergence affects `tests/golden/anchor_catalog_<date>.json` instead. SOP `docs/sop/historical-anchor-pack-regen.md` (v0.5-015 closed batch 3, 2026-05-07) covers gitignored production `data/analysis/anchor_pack_<date>.json` regen and explicitly calls out non-versioned input dependencies + per-worktree workspace operation conventions as regen-trigger and DO-NOT-commit conditions.
- For PR review: when a staging-FAIL list is presented for merge approval, ask "what's the minimum FAIL set the merger will see post-merge?" If any test reads from a non-versioned input, the staging FAIL list is a lower bound, not the actual scope.

**Reference:** Briefing-impl T42 atomic squash + main merge (Session 29 Phase 4, commit `984599b`). Staging worktree: 1 FAIL; main worktree post-merge: 3 FAIL. Cycle-1 retro `docs/plans/AB-cycles/cycle-1-2026-05-04-daily.md` originally deferred only `[2026-05-04]`; main-worktree pytest expanded scope to all 3 dates. Closure: v0.5-001 (batch 1, commit `87ad457`) regenerated `tests/golden/anchor_catalog_{2026-04-29, 2026-05-01, 2026-05-04}.json` against current `data/x.db` snapshot in main worktree; tests 2129/3 → 2132/0. Distinct from Lesson #62 (empirical-claim drift recurs at NEW empirical-claims tables — that's about schema-shape change at fix time within a single author's workflow). Distinct from Lesson #78 (cross-feed value drift between data providers for the SAME labeled metric — that's about provider mechanics). Lesson #79 is per-worktree state divergence for the SAME provider's data when the source snapshot file is non-versioned and varies across worktrees. Distinct from Lesson #56 (dispatch eligibility ↔ canonical-list cross-reference drift) — that's about list-shape internal inconsistency; Lesson #79 is about input-snapshot non-determinism producing per-worktree test outcome divergence.

### 2026-05-08 — process — Plan-stage premise sanity-check must reconstruct squash timeline; pre-squash tags create a current-vs-historical timing illusion (Lesson #80)

**Trigger:** v0.5-059 (Session 32, batch 11, 2026-05-08). Plan entry framed Longbridge CLI as silently dropping 5 INDICES based on observation that `data/2026-05-04.json` and `data/2026-05-07.json` had `_metadata.symbols_expected=45 / symbols_succeeded=45 / symbols_failed=[]` while current `config/market_symbols.json` had `expected_count=50 + INDICES`. Plan author's mental model: "config says 50 should be fetched; data says 45 fetched with no failures recorded → Longbridge silently dropped 5." Premise looked compelling and would have triggered a STRICT-tier implementer + 2 reviewers dispatch (~$60-100 LLM) to "fix" code that wasn't broken. Batch 11 controller-direct Phase 1 empirical reproduce (`longbridge quote .SPX.US --format json` + 50-symbol batch) returned all 5 indices cleanly, falsifying the premise. Root cause was config-historical: `dfe4459 T6 add 5 Longbridge index symbols` was a pre-squash branch tag (2026-05-06 17:02 PT), but the disk diff to `config/market_symbols.json` only landed in main via atomic squash `984599b` (2026-05-07 20:14 PT) — AFTER both 5/4 (13:15 PT) and 5/7 (13:15 PT) cron fetches. Data files were correct for fetch-time config (expected=45, no INDICES). `git log -- config/market_symbols.json` shows ONLY 2 commits (`f0906ef` initial + `984599b` squash); the `dfe4459` tag never appears in main's view of the config file's history.

**Pattern:** When current-state config (post-squash) is read as the canonical reference AND historical data files (pre-squash) are read as current evidence of upstream behavior, the implicit assumption is that config-and-code shipped to main on the date the feature-branch tag describes. Atomic-squash discipline (Lesson #6) breaks this assumption: pre-squash tags describe what WAS DONE on a feature branch; the disk-on-main diff lands at the squash commit, not the tag. Cron jobs running on main between feature-branch tag dates and squash dates use the OLD on-disk state. A plan author looking at "current config 50 / historical 5/7 data 45" without checking `git log -- <changed-file>` will see a fake silent-drop and propose a fix for non-existent code path.

This pattern is sister to Lesson #3 (self-confirming closed loops) — except here the loop spans CODE × DATA × TIME: current code state + historical data state both look authoritative; they confirm a wrong premise via timeline mismatch. And sister to Lesson #2 (sanity-check production data SHAPE against real files) — except #2 is about data SHAPE, #80 is about the data's TEMPORAL alignment with code. The two together close the gap: #2 verifies the JSON shape claims, #80 verifies the WHEN claims.

**Why:** Atomic-squash discipline (Lesson #6) preserves a clean main commit history but loses fine-grained per-tag timestamps from the feature branch in the main view. Squash-message authors describe WHAT was done across the feature; the DATE on the merge commit is when changes actually landed on main, not the dates of the pre-squash tags. The cron-driven data pipeline runs on main's HEAD at fire time — it has no knowledge of in-progress feature-branch state. Any "production silent-drop" claim about a configurable behavior depends on alignment between the config in main at fetch time and the config the plan author is reading now.

**How to apply:**

- For any plan-entry claim of the form "behavior X started/should-have-started at date Y": run `git log --format="%h %ai %s" -- <relevant-file>` and verify the actual disk-diff-to-main date against the claimed cause-effect timeline. Pre-squash branch tags are NOT diff-on-main events.
- For premise of the form "current config has X, but historical data lacks X, therefore production code has bug": ALWAYS reconstruct the squash timeline FIRST. If the config diff to main post-dates the historical data fetch, premise is FALSIFIED — historical data is correct for fetch-time config, no production bug. Halt the plan-entry escalation; rewrite as NOT-A-BUG closure.
- For plan-author SOP: every "production silent-skip" / "silent-drop" claim about a configurable behavior should include a 1-line empirical verification step in the plan entry itself. Example: "Verify Longbridge does/doesn't silently drop indices: `longbridge quote .SPX.US --format json`". This is the controller-direct Phase 1 step that would have falsified v0.5-059's premise BEFORE STRICT-tier dispatch.
- For controller-direct routing: a plan entry whose premise rests on "current state + historical state interaction" should be Phase-1-investigated by controller before subagent dispatch. Phase 1 evidence is small (~5-8 tool calls); Lesson #80 says do it cheaply BEFORE paying STRICT-tier ~$60-100.

**Reference:** v0.5-059 (Session 32, batch 11, 2026-05-08, plan doc `docs/plans/2026-05-07-v0.5-amendment-batch.md`). Pre-squash tag `dfe4459` 2026-05-06 17:02 PT vs main-squash `984599b` 2026-05-07 20:14 PT. Distinct from Lesson #2 (data SHAPE sanity-check; #80 is data TEMPORAL alignment with code). Distinct from Lesson #3 (closed-loop blindness within a single dimension; #80 is closed-loop across CODE × DATA × TIME). Distinct from Lesson #6 (atomic squash discipline as positive practice; #80 is the SUBTLE TIMING TAX of #6 that requires plan-author awareness). Distinct from Lesson #79 (per-worktree state divergence at the SAME commit SHA; #80 is divergence ACROSS commit SHAs in the time window between pre-squash tag and squash-to-main). The institutional response (defense-in-depth fail-loud guard for the genuine `len(quotes) != expected AND symbols_failed=[]` discrepancy class) tracked as v0.5-061 in the same plan doc.

