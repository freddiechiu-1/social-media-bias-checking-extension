---
title: ClaimCheck — Mode Feature Design
date: 2026-05-09
status: approved
---

# ClaimCheck — Mode Feature Design

## 1. Overview

Add a mode selector to the ClaimCheck extension popup that lets the user choose how fast/thorough the analysis is. Three modes — **Quick**, **Standard**, **Deep** — vary the LLM model, the max claims extracted, the max sources per claim, and the output token budget. Default mode is **Standard**. The current behavior becomes the opt-in **Deep** mode.

## 2. Motivation

The current product is positioned at the "thorough" end (Opus 4.7, 8 claims, 3 sources/claim, 4096 output tokens, 30–90s latency). For a Chrome extension intended for quick-glance critical thinking, that's heavier than most users want. Users seriously researching a topic will reach for dedicated tools (Claude.ai, lit review, real research). The extension should default to a lighter, faster experience and let power users opt into depth.

Cost is a secondary motivator. Sonnet is roughly 5× cheaper than Opus per token. Flipping the default from Deep (Opus) to Standard (Sonnet, smaller budget) cuts the typical-call cost to roughly 20–30% of current. Useful both for the team's Max-plan quota during dev and for any future hosted-backend version.

## 3. Mode definitions

| | Quick | Standard *(new default)* | Deep |
|---|---|---|---|
| Model | `claude-sonnet-4-6` | `claude-sonnet-4-6` | `claude-opus-4-7` *(current)* |
| Max claims | 2 | 4 | 8 *(current)* |
| Max sources / claim | 1 | 2 | 3 *(current)* |
| `maxTokens` (output) | 1024 | 2048 | 4096 *(current)* |
| Expected latency | 5–15 s | 15–30 s | 30–90 s |

Centralized in `proxy/prompt.js`:

```javascript
export const MODE_CONFIG = {
  quick:    { model: 'claude-sonnet-4-6', maxClaims: 2, maxSources: 1, maxTokens: 1024 },
  standard: { model: 'claude-sonnet-4-6', maxClaims: 4, maxSources: 2, maxTokens: 2048 },
  deep:     { model: 'claude-opus-4-7',   maxClaims: 8, maxSources: 3, maxTokens: 4096 },
};
```

## 4. Prompt parameterization

Only **rule 8 (BUDGET)** of the system prompt varies per mode. Rules 1–7 (no verdicts, route facts to evidence, route opinions to steel-man, anti-false-balance, explicit limits, teaching verification, valid JSON output) are identical across modes. The shape of the JSON output is identical.

Approach: convert the `SYSTEM_PROMPT` string constant to a `buildSystemPrompt(mode)` function. Inside, substitute the `MODE_CONFIG[mode]` budget values into rule 8:

```javascript
export function buildSystemPrompt(mode) {
  const config = MODE_CONFIG[mode] || MODE_CONFIG.standard;
  return `... [rules 1-7 verbatim] ...
8. BUDGET: extract at most ${config.maxClaims} distinct claims. Cite at most ${config.maxSources} sources per claim. If the post has more potential claims, pick the most load-bearing ones.
...`;
}
```

`buildUserPrompt(input)` is unchanged — mode does not affect the user prompt.

The natural cap from `maxTokens` enforces per-section verbosity automatically. Quick mode (1024 output tokens) forces Claude to be terse; Deep (4096) allows fuller synthesis. No additional brevity instructions in the prompt.

## 5. UI

A segmented control of three pill buttons placed above the textarea, in the popup:

```
┌───────────┬──────────────────┬───────────┐
│   Quick   │     Standard     │    Deep   │   ← Standard highlighted by default
└───────────┴──────────────────┴───────────┘
[ textarea: Paste the tweet text… ]
[Analyze]
```

- Selected pill has a dark filled background; unselected pills have a light background with a 1px border. Hover state on unselected pills.
- Tooltips on each pill explain the trade-off:
  - Quick: "~10s. Fewer claims, briefer evidence. Sonnet."
  - Standard: "~20s. Balanced for everyday use. Sonnet."
  - Deep: "~60–90s. Thorough, more sources. Opus reasoning."
- Click a pill to switch. Choice persists to `chrome.storage.local.mode`.
- First-install default: `standard`. Stored value missing or invalid: fall back to `standard`.

**UI behavior on popup open** (avoids flash-of-wrong-pill):
- Render the pill markup with `standard` selected by default in the static HTML, so the user sees a consistent state immediately even before async storage settles.
- Asynchronously read `chrome.storage.local.mode`. If a different valid mode is stored, update the highlighted pill in place. If unset/invalid, leave `standard` selected (and don't write back — let the next user click create the entry).
- Use optimistic UI on pill click: highlight the new pill immediately, write to storage, then submit. No revert flow needed since pill selection is local-only and doesn't depend on server confirmation until submit.

## 6. Data flow

```
popup.js
   ├─ on load: read chrome.storage.local.mode (default 'standard'); reflect in UI
   ├─ on pill click: write chrome.storage.local.mode; update UI
   └─ on submit: read mode; chrome.runtime.sendMessage({ type: 'analyze', input, mode })

service_worker.js
   └─ handleAnalyze(input, mode) → fetch http://localhost:3001/analyze
        body: { input, mode }

proxy/server.js
   ├─ parse body
   ├─ validate mode against MODE_CONFIG keys; if invalid/missing → 'standard'
   └─ analyze(input, mode)

proxy/analyze.js
   ├─ const config = MODE_CONFIG[mode]
   ├─ query({ prompt, options: { systemPrompt: buildSystemPrompt(mode), model: config.model, maxTokens: config.maxTokens, allowedTools: ['WebSearch'] } })
   └─ extractFinalText → parseJson → validate → return
```

**Server response shape:** the server includes the `mode` actually used in the response envelope, so the extension can detect a silent fallback. Response body becomes `{ mode: 'standard', data: <validated JSON> }` instead of just the JSON. Service worker forwards `data` to the popup; popup may use `mode` for telemetry/logging or to surface a warning if it differs from the requested mode.

## 7. File changes

- `proxy/prompt.js` — export `MODE_CONFIG`; convert `SYSTEM_PROMPT` constant → `buildSystemPrompt(mode)`. `buildUserPrompt` unchanged.
- `proxy/analyze.js` — signature becomes `analyze(input, mode = 'standard')`. Uses `MODE_CONFIG[mode]` for model + maxTokens. Calls `buildSystemPrompt(mode)` instead of importing the constant.
- `proxy/server.js` —
  - Extract `mode` from POST body. Validate it's a key of `MODE_CONFIG` (import the module). Validation is **case-sensitive**; only lowercase keys (`quick`, `standard`, `deep`) are valid. Any other value (including `null`, `undefined`, non-string, `'STANDARD'`) → fall back to `'standard'` and `console.warn` the rejected value. Pass to `analyze()`.
  - **Wrap response as `{ mode, data }`** where `mode` is the actual mode used (post-validation) and `data` is the validated JSON.
  - **Cache key must include mode**: change from `hash(input)` to `hash(input + ':' + mode)`. Otherwise Quick and Deep on the same input would return each other's stale results.
- `extension/popup/popup.html` — segmented control markup above the existing form.
- `extension/popup/popup.css` — pill styling (selected/unselected/hover states).
- `extension/popup/popup.js` —
  - Maintain mode in a **module-level variable** (single source of truth). Initialize it from `chrome.storage.local.mode` on popup open (default `'standard'` if unset/invalid). Update it synchronously on pill click before persisting to storage and before submit reads it. Submit reads from this variable, NOT from storage (avoids the storage-write-not-flushed race when the user clicks a pill then immediately submits).
  - Reflect the variable in pill highlighting on load and on every click.
  - Include the variable in `chrome.runtime.sendMessage({ type: 'analyze', input, mode })`.
- `extension/background/service_worker.js` —
  - Accept `mode` in incoming `analyze` message; pass through to fetch body.
  - **Unwrap the new `{ mode, data }` response envelope.** The existing shape check `Array.isArray(data.claims)` operates on the unwrapped `data`. Concretely: `const body = await res.json(); const data = body && typeof body === 'object' && 'data' in body ? body.data : body;` — handles both new (`{mode, data}`) and legacy (just JSON) shapes for forward/backward compat. Then validate the unwrapped `data` as before.

## 8. Edge cases & invariants

| Case | Behavior |
|---|---|
| `mode` value missing from POST body | Server defaults to `'standard'` (logged) |
| `mode` value is not a known key | Server defaults to `'standard'` (logged) |
| `chrome.storage.local.mode` unset on first install | Popup defaults to `'standard'`; pill UI reflects it |
| `chrome.storage.local.mode` contains invalid value | Popup falls back to `'standard'`; pill UI reflects it |
| User changes mode during an in-flight analysis | Applies to the NEXT analysis. Current one continues with its original mode. |
| Cached `lastResult` from before this feature shipped (no `mode` in record) | Popup renders it as before. No retroactive mode label. The cache record predates the feature; not worth migrating. |
| Server response is missing the new `mode` field (older proxy version) | Service worker treats `body.mode` as optional. If absent, treats body itself as `data` for backward compat. |
| Same `input` analyzed under different modes | Server cache key is `hash(input + ':' + mode)`, so each mode has an independent cache slot. No stale cross-mode reads. |
| Pill click followed immediately by Submit (storage-write race) | Submit reads mode from an in-memory module-level variable updated synchronously on click, NOT from `chrome.storage.local`. Storage write is fire-and-forget. |

**Invariants preserved across all three modes:**
- All 6 output sections render (`tldr`, `claims`, `evidence`, `steelman`, `couldnt_verify`, `how_to_verify`)
- No-verdict validator is active (forbidden keys stripped recursively)
- Anti-false-balance rule is active (factually-wrong claims route to `factually_wrong_redirect`, never get a fake steelman)
- WebSearch tool is enabled

## 9. Out of scope (deferred)

- **Separate response-length toggle** (independent of mode). Length is bundled into mode for v1. If users want length-without-thoroughness changes (or vice versa), can add later.
- **Extended-thinking toggle** for Deep mode (Anthropic's reasoning-block API). Explicitly NOT enabled in this spec; Deep is Opus + the standard prompt. Reasoning blocks could be added as a separate later feature.
- **Mid-flight mode change** applying to the current request. Architecturally complex (would require cancel + restart). Not worth the cost.

## 10. Empirical validation gates (must pass before locking the demo)

Several spec assumptions are not yet empirically grounded. The implementation plan must include explicit smoke-test gates that verify these before the feature ships in the demo:

- **Sonnet schema reliability.** Run the same prompt against 3–5 real tweets under both Sonnet 4.6 and Opus 4.7. Use a tweet mix that includes: (a) a multi-claim tweet of 250+ characters, (b) a tweet containing a deliberately factually-wrong claim, (c) an opinion-heavy tweet. Confirm Sonnet's output:
  - Parses as JSON without truncation
  - Contains exactly the 6 top-level keys (`tldr`, `claims`, `evidence`, `steelman`, `couldnt_verify`, `how_to_verify`)
  - Passes the no-verdict validator (no `partisan_lean`, `bias_score`, etc.)
  - Honors the anti-false-balance rule (Sonnet should set `factually_wrong_redirect` on the wrong claim, NOT generate a steel-man)
  - **Steelman quality check:** for opinion claims, Sonnet's `counter` text should be substantive (≥ ~30 words, makes a real point), not filler. Compare side-by-side with Opus on the same claim. Acceptance bar: Sonnet's steelman is "credibly thoughtful" even if shorter than Opus's.

  If Sonnet fails any of these reliably, fix options: (a) tighten the system prompt for Sonnet, (b) shift Quick/Standard to Opus and accept the cost, (c) drop the feature.

- **Quick-mode `maxTokens: 1024` truncation.** Run a dense, multi-claim tweet through Quick mode. Confirm the JSON is complete (closing braces present) and all 6 sections render. If output truncates mid-JSON: increase Quick's `maxTokens` to 1536 or 2048, or further reduce `maxClaims`/`maxSources` until output fits.

- **Per-mode latency.** Measure actual end-to-end latency for each mode on real tweets. If reality deviates >50% from the spec's estimates, update the tooltip copy to match.

If any of these fails after iteration, escalate (potentially demo Deep mode only and ship Quick/Standard as future work).

## 11. Open TBDs

None. All decisions captured above; remaining items are validation steps in §10.
