---
title: ClaimCheck — Design Spec
date: 2026-05-09
status: approved (v2 — OAuth/local-proxy architecture)
---

# ClaimCheck — Design Spec

## 1. Overview

ClaimCheck is a Chrome extension that helps users think critically about short social-media posts — primarily tweets/X posts. The user pastes a tweet (or a URL/text from another source) into the extension popup; the extension forwards it to a small local proxy running on the user's machine, which calls Claude with the `web_search` tool via the Claude Agent SDK using the user's Claude Max OAuth credentials. Claude returns a structured analysis: claims extracted and classified, evidence found via web search, the strongest steel-manned disagreement (for opinion claims), an explicit statement of what *couldn't* be verified, and validation strategies the user can apply themselves.

The defining design constraint: **ClaimCheck does not render verdicts.** It exposes patterns and teaches verification; the user does the judging.

## 2. Hackathon context

- **Track:** Governance & Collaboration
- **Timeline:** 8 hours
- **Team:** 2 people, working in parallel — see [§10 Work split](#10-work-split--collaboration)
- **Deliverable:** A working Chrome extension + local proxy demoable on real X posts, run on the team's own machine

## 3. Design philosophy & ethical stance

The track's ethical considerations are explicit warnings against the kind of tool a naive version of this would be: weaponization for manipulation/dissent-suppression, "both-sidesing" reality, opaque recommendations, skewing whose voices get centered.

ClaimCheck answers each of those by design:

| Track concern | ClaimCheck's design response |
|---|---|
| Could be weaponized for manipulation / suppressing dissent | No verdicts. The tool exposes patterns; the user judges. Refuses to label content as "biased," "extreme," or partisan. Enforced both in the prompt AND by a code-level validator that strips any verdict-shaped fields. |
| Whose voices get centered vs. drowned out | No partisan-lean meter, no "opposite article" auto-recommendation. Steel-mans counter-arguments from *thoughtful disagreement*, not from a tribal "other side." |
| Both-sidesing reality | Distinguishes factual claims (route to evidence-check) from opinion claims (route to steel-man). Will not steel-man a factually-wrong claim — it routes to evidence and says so. |
| Privacy in civic participation | Tweet content goes browser → local proxy on user's machine → Anthropic. No third-party servers, no analytics, no telemetry. OAuth tokens never leave the user's machine. |
| Transparency in how recommendations are made | Output includes an explicit "What we couldn't verify" section. Sources are linked. The prompt and the no-verdict validator are inspectable in the repo. |

**Load-bearing rule for the duration of the build:** if a feature looks like a verdict, it's the wrong feature. This is what we'll be judged on more than feature count.

## 4. Target user & jobs-to-be-done

A reader who is **curious + skeptical** — wants to engage critically with what they see online, in a way that strengthens their thinking rather than feeds reactive judgment.

Jobs:

1. *"What is this post actually claiming?"* — separate substance from rhetoric
2. *"Are the cited facts/numbers accurate, or being misused?"* — catch 断章取义 directly
3. *"What's the strongest disagreement I should consider?"* — steel-man, not strawman, not tribal counter
4. *"What can't be checked, and how would I check it?"* — calibrate confidence; learn verification

## 5. Scope

### In scope (v1)

- Popup-based UX: click extension icon → paste tweet URL or text → analyze → render result in popup
- Local Node proxy that authenticates via Claude Max OAuth (Claude Agent SDK) and exposes a single `POST /analyze` endpoint
- Single Claude call per analysis with `web_search` tool enabled
- Structured 6-section output (see [§7](#7-output-structure))
- A code-level no-verdict validator on the proxy side
- Works on tweets and any other pasted text/URL (Reddit, articles, etc., as a free side-effect of paste-based UX)

### Explicitly out of scope (with reasoning)

- **Partisan-lean / left-right meter** — verdict feature; weaponizable; contradicts design philosophy
- **"Is this 偏激" / extreme-content flag** — verdict feature; same
- **Auto-paired "opposite-view article" recommendations** — both-sidesing trap; algorithmic curation of someone's reading list is what the track explicitly flags
- **Multimedia** (images, video, screenshot-tweets) — v1 is text-only
- **Direct API key path / hosted backend** — Max OAuth via local proxy is sufficient for the team's testing and demo
- **Multi-browser support** — Chrome only
- **DOM injection** (per-tweet buttons, viewport detection) — popup-with-paste sidesteps the entire X SPA fight

### Stretch goals (only if core works with time to spare)

- Active-tab auto-fill: when current tab is a tweet permalink, pre-fill the input
- Long-thread support: concatenate replies in the input
- Long-form article support: claim extraction + logical-structure analysis from earlier brainstorming

### Future work (post-hackathon)

- Long-form article and full-thread analysis
- Other browsers (Firefox, Edge)
- Hosted backend (so non-team users don't need local Node + OAuth)
- API-key fallback path for users without Max plan
- Multimedia (image/video understanding)
- A "verification skill builder" feature that turns the validation strategies into reusable lessons

## 6. UX flow

### First-time setup (one-time, on the team's machine)

1. Clone the repo.
2. `cd proxy && npm install`.
3. Authenticate the Claude Agent SDK against the user's Claude Max plan (e.g., `npx claude-code login` or whatever the SDK's OAuth flow is — confirmed at kickoff; see [§10.6](#106-phases)).
4. Load the extension as unpacked from `extension/` in `chrome://extensions`.

### Per-session (every demo / test session)

1. Start the proxy: `cd proxy && npm start`. Runs on `http://localhost:3001`.
2. Click the ClaimCheck icon in Chrome's toolbar.

### Per-analysis

1. Popup opens.
2. Popup contains:
   - A textarea: "Paste a tweet URL or the post text"
   - An "Analyze" button
   - (Stretch) Auto-fills with the active tab's URL if it matches a tweet-permalink pattern
3. On click, the extension's background service worker `POST`s the input to `http://localhost:3001/analyze`.
4. Loading state shown in popup while the proxy processes (typical 15–30 s with `web_search`).
5. Result rendered inline in the popup, organized into the 6 sections in §7. If the user closes the popup mid-analysis, the result is cached on the proxy and re-fetched when they reopen — see [§8](#8-tech-stack).

No DOM injection on X. No content script (or only a trivial one for the optional auto-fill).

## 7. Output structure

Six sections, in order. The popup renders these as labeled cards/blocks. Empty sections still render their header with "—" so the structure is consistent and the absence is visible. Renderer iterates arrays by `.length` (no hardcoded counts) and treats missing/typed-wrong fields as empty rather than crashing.

### Section 1 — TL;DR
One sentence. A neutral restatement of what the post is communicating. No editorializing.

### Section 2 — What it's claiming
Bulleted list of distinct claims, each tagged `[Factual]`, `[Opinion]`, or `[Mixed]`.

### Section 3 — What we found
For each `[Factual]` or `[Mixed]` claim:
- Web-search results, with linked sources
- Claude's read on whether the sources support, contradict, or are mixed-on the claim — phrased descriptively, not as a verdict
- If the post links to a source: a separate "Does the post represent this source accurately?" sub-check (this is the 断章取义 detector)

### Section 4 — Strongest disagreement
For each `[Opinion]` or `[Mixed]` claim:
- A steel-manned counter-argument from a *thoughtful critic* — not "the other tribe says"
- **Important behavior:** if the claim is factually wrong, this section does NOT generate a counter — it says so explicitly and routes the user to §3. This is the anti-false-balance rule.

### Section 5 — What we couldn't verify
Explicit list of limitations. Examples:
- "The cited statistic is from a paywalled study I couldn't access"
- "This requires domain expertise in monetary policy I don't have"
- "Evidence is genuinely mixed; I won't fake a verdict"

This section is the product's most distinctive feature and is non-negotiable. Most "AI fact-checkers" pretend to verdicts they can't justify; ClaimCheck refuses.

### Section 6 — How you'd verify yourself
Validation strategies tailored to the claim types. Examples:
- "Check primary source X (from the linked agency directly, not a press release)"
- "Look for peer-reviewed studies on Y, not just popular-press summaries"
- "Be aware that the most-cited sources here all share editorial ownership"

## 8. Tech stack

### Components

```
┌───────────────────────────┐    POST /analyze     ┌──────────────────────────────┐    Claude API     ┌───────────┐
│  Chrome Extension (MV3)   │ ───────────────────▶ │  Local Node Proxy            │ ───────────────▶ │  Claude   │
│  popup + service worker   │ ◀─────────────────── │  Claude Agent SDK + OAuth    │ ◀─────────────── │ web_search│
└───────────────────────────┘    JSON response     └──────────────────────────────┘   tool result    └───────────┘
```

### Extension

- **Chrome Manifest V3.**
- **Popup:** vanilla HTML + JS (no framework, no build step). Lightweight CSS for the section layout.
- **Background service worker** owns the proxy fetch. The popup `chrome.runtime.sendMessage`s the request to the worker; the worker calls `localhost:3001/analyze`; result is stored in `chrome.storage.session`. This avoids losing results when the popup closes during a 25-second `web_search` call.
- **Manifest `host_permissions`:** `http://localhost:3001/*` only.
- **Defensive JSON parsing** in the renderer: every field type-checked; missing fields render as "—"; unexpected fields are dropped (whitelist of the 6 keys).

### Local proxy

- **Node.js + Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk` or equivalent — exact package confirmed at kickoff).
- **Auth:** Claude Max OAuth via the SDK. No API key. OAuth tokens stored where the SDK stores them (user's home directory); never read or transmitted by the proxy code.
- **Single endpoint:** `POST /analyze` accepting `{ input: string }`, returning the structured JSON from §10.3.
- **CORS:** allow `chrome-extension://*` origins.
- **Result caching:** in-memory, keyed by request hash, ~5 min TTL — enables popup-reopen recovery.
- **No-verdict validator:** before returning to the extension, the proxy strips/rejects any output containing forbidden field names (`partisan_lean`, `bias_score`, `verdict_label`, `is_extreme`, `political_lean`, etc.). Tested at kickoff by adverse-prompting Claude.

### Model & tools

- **Model:** `claude-opus-4-7` (recommended for reasoning quality; can fall back to Sonnet 4.6 if proxy reports rate-limit pressure).
- **Tools enabled:** `web_search`.
- **Defaults (configurable):** `max_claims = 8`, `max_sources_per_claim = 3`, `request_timeout_ms = 60000`, `max_input_chars = 4000`.

### Privacy

- No backend, no analytics, no telemetry.
- All data flows: browser → user's local machine → Anthropic. Nothing else.

## 9. Prompt design

Owned by Person 2. See §10 for the standalone iteration harness.

A single Claude call per analysis. The system prompt encodes the design philosophy:
- No verdicts. No partisan labels. (The proxy's no-verdict validator is the belt-and-suspenders enforcement.)
- Route factually-wrong claims to evidence (do NOT generate a steel-man for them).
- Be explicit about limitations.
- Suggest concrete verification strategies tailored to the claim type.
- Output JSON matching the schema in §10.3.

The user-message content is the pasted tweet text and/or URL. If a URL is provided, the prompt instructs Claude to use `web_search` to fetch it.

For each factual claim, Claude must use `web_search` and surface the actual links. The popup renders those links live; if Claude returns a claim with no `sources[]`, the renderer shows it as an unverified claim.

## 10. Work split & collaboration

This is a 2-person, 8-hour hackathon. The single most important rule: **minimize runtime and merge dependencies between the two people** so they can grind in parallel. The split below has zero runtime dependency until integration.

### 10.1 The seam: Extension vs. Proxy

**Person 1 — "Extension half"**
- `manifest.json`, popup HTML/CSS, popup bootstrapping, background service worker
- Rendering: turning the 6-section JSON into the popup display (loading/error states, the six section blocks, defensive parsing, state reset between submits)
- Optional active-tab auto-fill (stretch)
- Develops entirely against a **local mock proxy** (a 20-line Node script that returns the committed `tools/sample_response.json`). Zero dependency on Person 2's real proxy.

**Person 2 — "Proxy half"**
- Local Node proxy: HTTP server, CORS, `/analyze` endpoint, in-memory result cache
- Claude Agent SDK + OAuth setup (this is the auth-related risk owner)
- System prompt + structured-output schema + no-verdict validator
- Iterating on real tweets via a **standalone CLI harness** (`proxy/test_prompt.js`) that calls the same SDK code path the proxy uses
- Validates: factually-wrong claims route to evidence not steel-man; "What we couldn't verify" actually fires; JSON conforms to schema; no-verdict validator catches adverse prompts

### 10.2 File ownership (no merge conflicts)

```
claim_check/
├── extension/                       Person 1
│   ├── manifest.json
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   ├── popup.js                 (1-line integration: chrome.runtime.sendMessage to bg)
│   │   └── render.js                (defensive JSON → DOM)
│   └── background/
│       └── service_worker.js        (calls localhost:3001/analyze; caches in chrome.storage.session)
├── proxy/                           Person 2
│   ├── package.json
│   ├── server.js                    (HTTP + /analyze + CORS + cache)
│   ├── analyze.js                   (Claude Agent SDK call + prompt + validator)
│   ├── prompt.js                    (system prompt text)
│   ├── validator.js                 (no-verdict gate + schema check)
│   └── test_prompt.js               (standalone CLI harness)
├── tools/
│   ├── mock_proxy.js                Person 1 (returns sample_response.json on /analyze)
│   ├── sample_response.json         BOTH — fixture; FROZEN after kickoff
│   └── sample_tweets.txt            BOTH — demo inputs
├── schema.md                        BOTH — JSON schema contract; FROZEN after kickoff
├── CLAUDE.md
├── docs/
│   ├── claude-pitfalls.md           reference; read before code or spec changes
│   └── superpowers/specs/
│       └── 2026-05-09-claim-check-design.md
└── .gitignore
```

Each file has one owner. The four BOTH/FROZEN files (schema.md, sample_response.json, sample_tweets.txt — and implicitly this spec) are agreed at kickoff and rarely re-edited.

**Fixture-freeze rule:** `schema.md` and `sample_response.json` are frozen after the kickoff schema-lock. If Person 2 finds Claude can't deliver the schema, Person 2 adds a transformation layer in `proxy/analyze.js` to reshape API output to fit the contract — does NOT change the contract unilaterally. Real schema changes require both people to pause and align.

### 10.3 The contract: JSON output schema

The single dependency between halves. Pin it during kickoff before parallel work begins; commit `schema.md` and a sample `tools/sample_response.json` that conforms to it. Person 1 renders against the sample; Person 2 makes the SDK produce it.

Sketch (final detail agreed at kickoff):

```json
{
  "tldr": "string — one neutral sentence",
  "claims": [
    { "id": "c1", "text": "the claim, paraphrased or quoted", "type": "factual | opinion | mixed" }
  ],
  "evidence": [
    {
      "claim_id": "c1",
      "sources": [
        { "url": "...", "title": "...", "summary": "what the source says" }
      ],
      "synthesis": "descriptive read on what the sources say re. the claim — NOT a verdict",
      "linked_source_check": {
        "url": "...",
        "represented_accurately": "yes | no | partial",
        "explanation": "..."
      }
    }
  ],
  "steelman": [
    {
      "claim_id": "c2",
      "counter": "thoughtful disagreement (only if claim isn't factually wrong)",
      "factually_wrong_redirect": "non-null only when claim is factually wrong; routes user to evidence section"
    }
  ],
  "couldnt_verify": ["explicit limitation 1", "..."],
  "how_to_verify": ["validation strategy 1", "..."]
}
```

Allowlist of accepted top-level keys: exactly `tldr`, `claims`, `evidence`, `steelman`, `couldnt_verify`, `how_to_verify`. Anything else is dropped by the renderer and logged for debug.

### 10.4 Integration

The integration step is a single change in `extension/popup/popup.js`: switch from the mock proxy URL (`localhost:9999`, served by `tools/mock_proxy.js`) to the real proxy URL (`localhost:3001`).

Person 1 has been calling the mock proxy returning the fixture all along. Person 2 has been calling `analyze()` from `test_prompt.js`. Integration is hooking them together by changing one URL.

**Frozen-half rule during integration panic:** if integration breaks, the broken-layer owner fixes; the other person is read-only unless explicitly asked. No "let me also change this other thing while we're here."

Integration is the riskiest moment in the build. Budget real time for it.

### 10.5 GitHub flow

The team already has a repo. Use it with the simplest-possible flow:

- Both push to `main`. No PRs. No code review.
- Push small commits frequently — every working unit, not at the end of the day.
- File ownership prevents conflicts; if a conflict happens, the owning person resolves and re-pushes.

The repo is the demo deployment artifact for the team's machine. For non-team users (judges who want to try it themselves) we'd need OAuth + Node + the proxy running — out of scope for v1; flagged in §5 future work.

### 10.6 Phases

The team sequences and times these in person. The phases below define *what* happens, in roughly this order — durations and clock times are decided live.

1. **Kickoff (joint, must finish before parallel work begins).**
   - Confirm Claude Agent SDK + Max OAuth + `web_search` by running a real call (Person 2).
   - Verify CORS + chrome-extension → localhost path works (Person 1 spikes a 10-line popup that fetches a mock localhost).
   - Lock the JSON schema by inspecting real API output vs. the sketch in §10.3; commit `schema.md` and `sample_response.json`.
   - Push initial scaffolds.
   - **Exit criterion:** both halves leave with proven primitives.

2. **Parallel grind, leg 1.** Person 1 builds extension+UI against the mock proxy. Person 2 builds the real proxy + iterates the prompt against real tweets.

3. **Midpoint sync.** Person 2 shares latest real proxy JSON; Person 1 confirms it still renders. No code changes; just visual confirmation. Catches schema drift early.

4. **Parallel grind, leg 2.**

5. **Integration.** Switch popup to real proxy URL. Fix what breaks. Frozen-half rule applies (§10.4).

6. **Real-post smoke test.** Paste 3–5 real X posts (find live). Capture screenshots of working outputs as backups.

7. **Cut decision.** If any of the 6 output sections is broken or unreliable, cut it now. Cut order: `steelman` → `how_to_verify` (NEVER cut `couldnt_verify`, `tldr`, `claims`, or `evidence`).

8. **Final shape sync.** Both people compare the actual proxy JSON against the fixture. Differences = decision (real bug or acceptable variation).

9. **Demo dry run.** Run the primary demo post end-to-end.

If one person finishes their half early: help with prompt iteration, polish rendering, or run more demo tweets.

## 11. Demo plan

Pre-pick **one primary demo post** plus 2 backups. Lead with the primary; backups are for Q&A or fallback if the primary fails live.

**Primary candidate:** a tweet linking to an article it misrepresents (the 断章取义 case). Demo: the tool fetches the article, points out where the post's framing diverges from the source. This is the most distinctive moment and the strongest pitch for the track.

**Backup candidates:**
1. Factual claim with clear web evidence — tool finds primary sources, reports what they actually say, notes any nuance the post elided.
2. Opinion claim with strong steel-man — tool generates a thoughtful disagreement that a viewer might not have considered.

Pre-record screen captures of the primary + both backups working, in case the proxy or `web_search` is slow/fails during judging. Pre-flight checklist before the demo: demo machine has internet access; OAuth tokens are fresh; proxy is running.

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Claude Agent SDK + Max OAuth doesn't work as expected (auth fails, web_search not available, etc.) | Validated at kickoff with a real call. If broken: pivot to claude CLI subprocess or to API-key fallback for the day. This is the single biggest project-killer; that's why it's the first thing in kickoff. |
| LLM hallucinates evidence or sources | Require `web_search` for every factual claim; surface actual links in §3 so judges can click them; explicit §5 "couldn't verify" catches gaps |
| Claude steel-mans a factually-wrong claim → false balance | System prompt explicitly routes factually-wrong claims to §3; the proxy validator enforces the `factually_wrong_redirect` field shape |
| LLM slips a verdict-shaped field | No-verdict validator on the proxy strips/rejects forbidden fields; tested with adverse prompting at kickoff |
| `web_search` slow / fails / hits limits | Loading state shows expected latency ("This may take 20–30 seconds"); on failure, gracefully populate `couldnt_verify` with the failure note rather than erroring |
| LLM outputs extra/missing/wrong-typed fields | Allowlist + defensive parsing in the renderer; structure verification at integration and final sync |
| LLM returns 7 sections or drops one | Renderer iterates only the 6 whitelisted keys; warns in console if extras seen |
| Twitter SPA / DOM extraction is unreliable | Sidestepped: paste-based UX, no DOM injection |
| Popup closes mid-analysis (focus loss = MV3 popup death) | Background service worker owns the fetch; result cached in `chrome.storage.session`; popup re-reads on reopen |
| OAuth tokens expire mid-session | SDK auto-refreshes; if refresh fails, surface in popup ("Re-authenticate via `claude login`"). Test once before integration by leaving the proxy idle for the SDK's token lifetime. |
| Schema drift between halves | Fixture frozen at kickoff; transformation layer in proxy if needed; midpoint sync catches drift early |
| Integration reveals mismatch | Schema locked + fixture committed at kickoff; midpoint sync; frozen-half rule prevents scope creep during fix |
| Proxy not running during demo | Pre-flight checklist before demo; pre-recorded screen captures as backup |
| Demo machine logistics (internet, OAuth, proxy) | Confirm during dry run; backups recorded |
| 8h is tight | Stretch goals are clearly separated; cut order pre-decided (§10.6); core path is small |

## 13. Open TBDs (resolved during build)

- Final styling for the popup — iterate during build
- Exact final JSON schema details — locked at kickoff
- Specific demo example posts — primary chosen at smoke test
- Whether Claude Agent SDK supports OAuth + `web_search` exactly as expected — confirmed at kickoff; pivot path documented in §12
- Exact package name for the SDK and OAuth login command — confirmed at kickoff
- Whether to use Opus 4.7 or Sonnet 4.6 — start with Opus, fall back to Sonnet if Opus is rate-limited
