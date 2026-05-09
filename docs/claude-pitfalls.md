# Claude Pitfalls — ClaimCheck

Distilled from `docs/lessons-learned.md` (1957 lines, source: a different financial-news project). This is the project-specific shortlist — the 16 lessons most likely to bite us in a 2-person Chrome-extension hackathon with parallel work.

**Read this before editing the spec, the plan, or any code.** Cross-reference back during code review.

The lessons reference *phases* (kickoff, midpoint sync, integration, smoke test, cut decision, final sync, demo dry run) — see spec §10.6. The team sequences and times those phases in person.

---

## SPEC / DESIGN

### 1. Lock the JSON schema with a REAL API call before splitting work
Before Person 1 and Person 2 go parallel, validate the agreed JSON schema by calling the real Claude API with a test case. Don't trust schema agreement until the API actually produces it.

**Why:** Spec says "fields X, Y, Z"; deep into the build, the API may hallucinate field W or omit Y. Schema drift = hours of integration panic.

**Apply to ClaimCheck:** The kickoff schema-lock should include a **real API call smoke test** — not just a schema review. Person 2 runs the prompt against a sample tweet, Person 1 watches the output shape land. Gaps found here cost minutes; gaps found right before the demo cost the demo.

---

### 2. Spec placeholders (TBD, "tune later") must be marked and walked
If the spec has any TBD value (max claims, max sources, timeout, model choice), mark explicitly and decide before implementation. Default assumption: the placeholder ships unresolved.

**Why:** Person 2 codes `max_claims=5` thinking "we'll tune later"; demo time, the post has 200 potential claims and the formatter looks broken.

**Apply to ClaimCheck:** Spec audit during kickoff: scan for any TBD or implicit number (token budgets, max sources per claim, timeouts, retry counts). For each: hard-code a defensible default now, or get an explicit decision. The day doesn't support tuning.

---

### 3. "No verdict" design constraint must be a validation gate, not just prose
The spec says ClaimCheck refuses verdict labels (partisan-lean, "extreme content"). This is a design pillar — it must be enforced *in code*, not just "described in the prompt."

**Why:** Late in the build, the LLM may slip and add a `verdict` field. If the prompt didn't validate against it, you've got an ambiguity at demo time.

**Apply to ClaimCheck:** Person 2's proxy includes a **validator** that strips or rejects any verdict-shaped field (e.g., `partisan_lean`, `bias_score`, `verdict_label`, `is_extreme`). Test it during the kickoff smoke call by adverse-prompting Claude to try to output a verdict and confirming the validator catches it.

---

## PROCESS / COORDINATION

### 4. The shared fixture file is the contract — treat it like a published API
The JSON schema agreement at kickoff lives in a fixture file (`tools/sample_response.json`) both people reference. After kickoff, changes require both people's sign-off.

**Why:** Person 2 discovers the API can't deliver nested arrays midway; modifies schema unilaterally; Person 1's UI breaks at integration.

**Apply to ClaimCheck:** Treat `schema.md` + `tools/sample_response.json` as frozen after the kickoff schema-lock. If Person 2 finds the API can't deliver the schema, Person 2 adds a **transformation layer** in `proxy/analyze.js` to reshape API output to fit the contract — does NOT change the contract unilaterally. If a real change is needed, both pause and align (small cost).

---

### 5. Sync at midpoint AND before final integration — not just at the end
The day is too tight for "we'll integrate at the end." Force a midpoint sync and a full integration sync. At each, do a brief end-to-end dry run — even if rough.

**Why:** Two halves diverging silently = unintegrable code at integration. Two halves syncing midway = catch the divergence with hours to fix.

**Apply to ClaimCheck:** Schedule a **midpoint sync** between the two parallel-grind legs (Person 2 shares latest real proxy JSON; Person 1 confirms it still renders). Already in the phase plan: integration, real-post smoke test, final fixture/reality sync.

---

### 6. If integration breaks, the working half is frozen
At integration time, the half that's broken goes into damage-control mode only. The other person is read-only — no new features, no rewrites, just support if asked.

**Why:** Person 1 starts "polishing" during integration; integration fails; Person 2 says "wait, there's a better JSON shape." Now it's a 2-person redesign at the worst moment.

**Apply to ClaimCheck:** Agree upfront: "If integration breaks, the broken-layer owner fixes; the other person is read-only unless explicitly asked." Prevents scope creep during panic.

---

## VALIDATION / TESTING

### 7. Smoke test on real X posts BEFORE demo, not at demo
Before the demo, paste 3–5 real X posts (find them live) into the extension. If it breaks now, you have time. If it breaks at demo, you have nothing.

**Why:** Real posts have URLs with weird chars, sarcasm, multi-claim density, links to paywalled sources. Your test fixture probably had clean inputs.

**Apply to ClaimCheck:** Person 1 + Person 2 during real-post smoke test phase: paste 3–5 real posts and capture screenshots of working outputs as demo backups.

---

### 8. Test the "six fixed sections" structure explicitly — section count is often wrong
The output has exactly 6 sections. Bet that the LLM will try to add a 7th or drop one. Verify `Object.keys(response).length` and the exact key names match.

**Why:** LLM gets creative ("Assumptions" section, "Bias note" section). Renderer that hardcodes 6 layouts breaks.

**Apply to ClaimCheck:** Person 1's renderer either (a) renders only the whitelisted 6 keys and ignores extras, or (b) shows a debug warning if extras appear. Person 2's proxy post-processes to enforce the schema.

---

### 9. Test `web_search` tool invocation — silent failure, latency, rate limits
At kickoff smoke + smoke-test phase, explicitly test `web_search`. How long does a typical analysis take? What happens on rate limit? On no-results?

**Why:** Person 2 codes assuming `web_search` is fast and reliable. In practice it can take 15–30 s, hit rate limits, or return weak results. Demo user pastes; UI freezes; user closes the popup.

**Apply to ClaimCheck:** Document expected latency in the loading state ("This may take 20–30 seconds"). Add a timeout wrapper. Handle web_search-failed cases gracefully — fall back to "couldn't verify" content rather than an error.

---

## CODE / LLM OUTPUT HANDLING

### 10. JSON parsing must validate every field defensively before render
Person 1's renderer must check every field exists and has the expected type before rendering. LLM output is closer to noisy production data than to code.

**Why:** LLM returns `claims: null` or `claims: "string"` instead of array. `claims.forEach(...)` crashes. Demo user sees a console error.

**Apply to ClaimCheck:** Defensive parser in `render.js`:
```js
const claims = Array.isArray(response.claims) ? response.claims : [];
const tldr = typeof response.tldr === 'string' ? response.tldr : '(no summary)';
```
Empty/missing fields render as "—", never crash.

---

### 11. Whitelist accepted output fields — LLM may hallucinate new ones
Person 1's parser accepts only the 6 expected sections. Hallucinated extras get logged (debug) but not rendered.

**Why:** Hallucinated fields look real to future implementers and waste tokens.

**Apply to ClaimCheck:** Explicit allowlist in the renderer. The 6 keys: `tldr`, `claims`, `evidence`, `steelman`, `couldnt_verify`, `how_to_verify`. Anything else is silently dropped.

---

### 12. Arrays may be shorter than "asked for" — don't hardcode counts
Spec says "extract up to 5 claims." Real post has 2. Output array has 2 entries, not 5. UI must use `array.length`, not a constant.

**Apply to ClaimCheck:** Renderer iterates the array as-is; never assumes length.

---

### 13. Reset state between analyses — clear old result on submit
When user submits a new analysis, immediately clear the old result and show loading. Don't leave stale results visible during the API call.

**Why:** Stale UI confuses demo users and obscures whether anything is happening.

**Apply to ClaimCheck:** Person 1's popup `submit` handler: clear result DOM, show spinner, then call the proxy.

---

## SCOPE PRESSURE

### 14. If a section breaks during smoke test, cut it
If during the real-post smoke test `steelman` (for example) outputs garbage, cut it from the demo. Output the working sections + a note: "feature unavailable in v1."

**Why:** Shipping a broken section looks worse than shipping fewer. Honest > broken.

**Apply to ClaimCheck:** Pre-agreed cut order — least-load-bearing section gets cut first. Order: `steelman` → `how_to_verify` → `couldnt_verify` (NEVER cut this — it's the differentiator) → `evidence` (also keep) → `claims` + `tldr` (core).

---

### 15. Demo: one strong example > four mediocre ones
A short demo with one excellent example shown thoroughly beats four shallow ones. Pick the most compelling post (suggested: a tweet that misrepresents a linked article — the 断章取义 case).

**Apply to ClaimCheck:** Designate ONE primary demo post; have 1–2 backups for resilience but lead with the primary. Practice the paste/analyze/explain flow during dry run.

---

### 16. Final shape sync — fixture vs reality
Before the demo, both people compare the actual API output (from a recent real-post analysis) against the fixture. Differences need a decision: real bug or acceptable variation?

**Why:** Small drift (typo'd field, wrong type, missing nullable) doesn't crash unit tests but breaks the live demo.

**Apply to ClaimCheck:** Use a diff tool or eyeball comparison during the final shape sync phase. Document any deltas decided as acceptable; fix any deltas decided as bugs.

---

## CORE PATTERN

Every lesson above traces back to one root: **close the loop between "what the spec says" and "what the system actually does" as early as possible.**

- Spec-only design is a closed loop that breaks at integration.
- Real API call at kickoff = open the loop early.
- Smoke test before demo = open the loop again with fresh inputs.
- Final sync = confirm the loop still holds.

A spec is a hypothesis. The API + LLM is reality. Test the hypothesis early and often.
