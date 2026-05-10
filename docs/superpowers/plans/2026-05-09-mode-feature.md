# Mode Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Quick/Standard/Deep mode selector to the ClaimCheck extension popup. Each mode varies model (Sonnet vs Opus), max claims, max sources/claim, and output token budget. Standard becomes the new default; current behavior becomes opt-in Deep.

**Architecture:** Mode value flows: `popup (in-memory + chrome.storage.local) → service_worker (sendMessage payload) → proxy server (POST body) → analyze.js (uses MODE_CONFIG) → query() with mode-specific options`. Server response wraps `{ mode, data }` so popup can detect silent fallback. Cache key includes mode to prevent cross-mode staleness.

**Tech Stack:** Existing — Chrome MV3 extension (vanilla HTML/JS), Node.js proxy with Claude Agent SDK. No new deps.

**Reference:**
- Spec: `docs/superpowers/specs/2026-05-09-mode-feature-design.md`
- Pitfalls: `docs/claude-pitfalls.md`
- Existing built code in `proxy/` and `extension/` — DO NOT regress this.

---

## File Structure

```
proxy/
├── prompt.js                MODIFY: export MODE_CONFIG; convert SYSTEM_PROMPT → buildSystemPrompt(mode)
├── analyze.js               MODIFY: signature → analyze(input, mode), uses MODE_CONFIG, calls buildSystemPrompt(mode)
├── server.js                MODIFY: extract+validate mode, wrap response {mode, data}, cache key includes mode
├── validator.js             unchanged
├── validator.test.js        unchanged
├── prompt.test.js           CREATE: TDD test for buildSystemPrompt budget injection (NEW file)
└── test_modes.js            CREATE: Phase 0 smoke harness for Sonnet validation (NEW file, kept after Phase 0 as a regression-test tool)

extension/
├── manifest.json            unchanged
├── popup/
│   ├── popup.html           MODIFY: add segmented-control markup above form
│   ├── popup.css            MODIFY: pill styling
│   ├── popup.js             MODIFY: module-level mode variable, pill handlers, sendMessage payload includes mode
│   └── render.js            unchanged
└── background/
    └── service_worker.js    MODIFY: accept mode in message, pass through, unwrap {mode, data} envelope
```

---

## Phase 0 — Empirical Validation (BEFORE backend implementation)

> ⚠ **Cost & time:** Phase 0 runs ~9 real Claude calls (3 tweets × 3 configs, including Opus baseline). Estimated cost ~$2–3 of Max-plan quota; estimated runtime 5–10 minutes. Confirm before proceeding.

**Why before:** Spec §10 "Empirical validation gates" includes Sonnet reliability and `maxTokens=1024` truncation. If Sonnet fails on our prompt, MODE_CONFIG must change (e.g., shift Quick/Standard to Opus too, or pivot the feature). These results SHAPE the implementation, so they must run first.

**Exit criteria:**
- Sonnet 4.6 produces schema-compliant JSON for 3+ real tweets
- Sonnet honors anti-false-balance on a deliberately wrong claim
- Quick-mode budget (Sonnet + maxTokens=1024 + 2 claims/1 source) produces complete, non-truncated JSON on a dense tweet
- Sonnet's steelman quality is "credibly thoughtful" side-by-side with Opus

If any of these fails, decide and document the pivot before starting Phase 1.

### Task 0.1: Sonnet schema reliability smoke test

**Files:**
- Create: `proxy/test_modes.js`

- [ ] **Step 1: Create the smoke harness**

`proxy/test_modes.js`:

```javascript
// Phase 0 validation harness — runs the same prompt against multiple model + budget configs
// and reports pass/fail for each spec §10 acceptance criterion.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import { validate, FORBIDDEN_KEYS } from './validator.js';

const tweets = {
  multi_claim: 'Breaking: New CDC report shows 80% of seasonal flu hospitalizations last winter were among people who hadn\'t gotten the flu shot.',
  factually_wrong: 'A new study confirms that vaccines cause autism. The data is finally out.',
  opinion: 'The Fed should cut rates immediately. Inflation is dead and unemployment is climbing. Anyone arguing otherwise hasn\'t looked at the data.',
};

const configs = [
  { label: 'Opus baseline',  model: 'claude-opus-4-7',   maxTokens: 4096 },
  { label: 'Sonnet standard', model: 'claude-sonnet-4-6', maxTokens: 2048 },
  { label: 'Sonnet quick',    model: 'claude-sonnet-4-6', maxTokens: 1024 },
];

async function runOne(label, model, maxTokens, input) {
  const events = [];
  const start = Date.now();
  for await (const event of query({
    prompt: buildUserPrompt(input),
    options: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      maxTokens,
      allowedTools: ['WebSearch'],
    }
  })) {
    events.push(event);
  }
  const elapsed = Date.now() - start;
  const result = events.find(e => e.type === 'result');
  let raw = result?.result;
  if (raw?.startsWith('```')) raw = raw.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return { label, elapsed, raw };
}

function check(name, raw) {
  const out = { jsonOk: false, sixKeys: false, validatorOk: false, factuallyWrongRedirected: null, steelmanWords: 0, error: null };
  try {
    const parsed = JSON.parse(raw);
    out.jsonOk = true;
    out.sixKeys = ['tldr','claims','evidence','steelman','couldnt_verify','how_to_verify'].every(k => k in parsed);
    try { validate(parsed); out.validatorOk = true; } catch (e) { out.error = `validator: ${e.message}`; }
    if (Array.isArray(parsed.steelman)) {
      const counters = parsed.steelman.map(s => s?.counter || '').filter(Boolean);
      out.steelmanWords = counters.reduce((acc, c) => acc + c.split(/\s+/).length, 0);
      const redirected = parsed.steelman.find(s => typeof s?.factually_wrong_redirect === 'string' && s.factually_wrong_redirect.length > 0);
      out.factuallyWrongRedirected = !!redirected;
    }
  } catch (e) {
    out.error = `parse: ${e.message}\n  raw start: ${raw?.slice(0, 200)}\n  raw end:   ${raw?.slice(-200)}`;
  }
  return out;
}

(async () => {
  for (const [tweetName, tweet] of Object.entries(tweets)) {
    console.log(`\n========== ${tweetName} ==========`);
    console.log(`tweet: ${tweet.slice(0, 80)}...`);
    for (const cfg of configs) {
      try {
        const { label, elapsed, raw } = await runOne(cfg.label, cfg.model, cfg.maxTokens, tweet);
        const c = check(cfg.label, raw);
        console.log(`\n  [${label}] elapsed=${(elapsed/1000).toFixed(1)}s`);
        console.log(`    json:${c.jsonOk}  6keys:${c.sixKeys}  validator:${c.validatorOk}  steelman_words:${c.steelmanWords}  redirected:${c.factuallyWrongRedirected}`);
        if (c.error) console.log(`    error: ${c.error}`);
      } catch (e) {
        console.log(`  [${cfg.label}] CRASHED: ${e.message}`);
      }
    }
  }
})();
```

- [ ] **Step 2: Run the smoke harness**

```bash
cd /Users/zefan/Claude/claim_check/proxy
node test_modes.js 2>&1 | tee /tmp/cc_modes.log
```

Expected: ~9 calls (3 tweets × 3 configs). Total runtime: 5-10 minutes. Cost via Max plan: ~$2-3.

- [ ] **Step 3: Decision review (joint, document outcome)**

Open `/tmp/cc_modes.log`. For Sonnet rows, confirm for the multi_claim and opinion tweets:
- `json:true` (parsed cleanly)
- `6keys:true` (all 6 top-level keys present)
- `validator:true` (no forbidden fields)
- `steelman_words ≥ 30` for opinion tweet
- `redirected:true` for the factually_wrong tweet

For the Sonnet quick row on multi_claim, additionally confirm `json:true` (no truncation under 1024 tokens).

**If all pass:** proceed with spec MODE_CONFIG values unchanged.

**If any fails:** document the failure, pick a fix path:
- (a) Tighten the prompt for Sonnet (likely small edit to rule 7 or rule 4)
- (b) Shift Quick/Standard model to Opus (cost goes up but reliability unchanged)
- (c) Lower Quick maxClaims/maxSources further (1 claim, no sources for evidence?) until output fits
- (d) Drop the feature

Whatever the decision, EDIT the spec at `docs/superpowers/specs/2026-05-09-mode-feature-design.md` §3 MODE_CONFIG and §10 to reflect the decision before continuing.

- [ ] **Step 4: Commit the harness + log decision**

```bash
cd /Users/zefan/Claude/claim_check
git add proxy/test_modes.js
git commit -m "phase 0: mode-feature validation harness (test_modes.js)"
```

If you also edited the spec in step 3, include that file in the commit.

---

## Phase 1 — Backend (proxy)

### Task 1.1: `proxy/prompt.js` — MODE_CONFIG + buildSystemPrompt(mode), with TDD

**Files:**
- Modify: `proxy/prompt.js`
- Create: `proxy/prompt.test.js`

- [ ] **Step 1: Write failing tests first**

Create `proxy/prompt.test.js`:

```javascript
import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { MODE_CONFIG, buildSystemPrompt, buildUserPrompt } from './prompt.js';

describe('MODE_CONFIG', () => {
  it('exports the three mode keys', () => {
    assert.deepEqual(Object.keys(MODE_CONFIG).sort(), ['deep', 'quick', 'standard']);
  });
  it('quick uses Sonnet and tightest budget', () => {
    assert.equal(MODE_CONFIG.quick.model, 'claude-sonnet-4-6');
    assert.equal(MODE_CONFIG.quick.maxClaims, 2);
    assert.equal(MODE_CONFIG.quick.maxSources, 1);
    assert.equal(MODE_CONFIG.quick.maxTokens, 1024);
  });
  it('standard uses Sonnet with mid budget', () => {
    assert.equal(MODE_CONFIG.standard.model, 'claude-sonnet-4-6');
    assert.equal(MODE_CONFIG.standard.maxClaims, 4);
    assert.equal(MODE_CONFIG.standard.maxSources, 2);
    assert.equal(MODE_CONFIG.standard.maxTokens, 2048);
  });
  it('deep uses Opus with full budget', () => {
    assert.equal(MODE_CONFIG.deep.model, 'claude-opus-4-7');
    assert.equal(MODE_CONFIG.deep.maxClaims, 8);
    assert.equal(MODE_CONFIG.deep.maxSources, 3);
    assert.equal(MODE_CONFIG.deep.maxTokens, 4096);
  });
});

describe('buildSystemPrompt(mode)', () => {
  it('injects quick mode budget into rule 8', () => {
    const p = buildSystemPrompt('quick');
    assert.match(p, /extract at most 2 distinct claims/);
    assert.match(p, /Cite at most 1 sources? per claim/);
  });
  it('injects standard mode budget into rule 8', () => {
    const p = buildSystemPrompt('standard');
    assert.match(p, /extract at most 4 distinct claims/);
    assert.match(p, /Cite at most 2 sources? per claim/);
  });
  it('injects deep mode budget into rule 8', () => {
    const p = buildSystemPrompt('deep');
    assert.match(p, /extract at most 8 distinct claims/);
    assert.match(p, /Cite at most 3 sources? per claim/);
  });
  it('falls back to standard for unknown / falsy mode', () => {
    for (const v of [undefined, null, '', 'STANDARD', 'unknown', 0]) {
      const p = buildSystemPrompt(v);
      assert.match(p, /extract at most 4 distinct claims/, `expected fallback for ${JSON.stringify(v)}`);
    }
  });
  it('preserves rules 1-7 verbatim across modes', () => {
    const q = buildSystemPrompt('quick');
    const s = buildSystemPrompt('standard');
    const d = buildSystemPrompt('deep');
    for (const rule of ['NO VERDICTS', 'ROUTE FACTS TO EVIDENCE', 'ROUTE OPINIONS', 'ANTI-FALSE-BALANCE', 'EXPLICIT LIMITS', 'TEACHING VERIFICATION', 'OUTPUT VALID JSON ONLY']) {
      assert.ok(q.includes(rule), `quick missing ${rule}`);
      assert.ok(s.includes(rule), `standard missing ${rule}`);
      assert.ok(d.includes(rule), `deep missing ${rule}`);
    }
  });
});

describe('buildUserPrompt(input) — unchanged', () => {
  it('embeds the input under POST:', () => {
    const p = buildUserPrompt('hello world');
    assert.match(p, /POST:\s*\nhello world/);
  });
});
```

- [ ] **Step 2: Run tests — see them fail**

```bash
cd /Users/zefan/Claude/claim_check/proxy
npm test
```

Expected: failures (`MODE_CONFIG is not exported`, `buildSystemPrompt is not a function`).

- [ ] **Step 3: Implement `prompt.js`**

Replace the contents of `proxy/prompt.js` with:

```javascript
export const MODE_CONFIG = {
  quick:    { model: 'claude-sonnet-4-6', maxClaims: 2, maxSources: 1, maxTokens: 1024 },
  standard: { model: 'claude-sonnet-4-6', maxClaims: 4, maxSources: 2, maxTokens: 2048 },
  deep:     { model: 'claude-opus-4-7',   maxClaims: 8, maxSources: 3, maxTokens: 4096 },
};

export function buildSystemPrompt(mode) {
  const config = MODE_CONFIG[mode] || MODE_CONFIG.standard;
  return `You are ClaimCheck. You help users think critically about social-media posts (typically tweets/X posts). You DO NOT render verdicts.

Your output is structured JSON, exactly matching this schema:

{
  "tldr": "<one neutral sentence restating what the post communicates>",
  "claims": [
    {
      "id": "c1",
      "text": "<claim, paraphrased or quoted>",
      "type": "factual" | "opinion" | "mixed"
    }
  ],
  "evidence": [
    {
      "claim_id": "c1",
      "sources": [
        { "url": "...", "title": "...", "summary": "<what the source actually says>" }
      ],
      "synthesis": "<descriptive read on what sources say re. the claim — NEVER 'true' or 'false'>",
      "linked_source_check": null | {
        "url": "...",
        "represented_accurately": "yes" | "no" | "partial",
        "explanation": "..."
      }
    }
  ],
  "steelman": [
    {
      "claim_id": "c2",
      "counter": "<thoughtful disagreement from a serious critic — NOT 'what the other tribe says'>",
      "factually_wrong_redirect": null | "<non-null only when claim is factually wrong; in that case, counter is empty string>"
    }
  ],
  "couldnt_verify": ["<explicit limitation>"],
  "how_to_verify": ["<concrete strategy the user can apply>"]
}

RULES (load-bearing):

1. NO VERDICTS. Never include fields like partisan_lean, bias_score, verdict_label, is_extreme, political_lean, or any rating that labels the post itself. Describe; do not judge.
2. ROUTE FACTS TO EVIDENCE. For [factual] or [mixed] claims, use the web_search tool to find actual sources. Include real URLs and titles. Synthesis describes what sources say, NOT whether the claim is true.
3. ROUTE OPINIONS TO STEEL-MAN. For [opinion] or [mixed] claims, write a steel-manned counter from a thoughtful critic. NOT a partisan rebuttal.
4. ANTI-FALSE-BALANCE: If a claim is factually wrong (e.g., contradicts well-established evidence), do NOT generate a steel-man for it. Set "counter" to empty string and "factually_wrong_redirect" to a sentence pointing the user to the evidence section.
5. EXPLICIT LIMITS. Use "couldnt_verify" to be honest about what you couldn't check (paywalls, missing expertise, genuinely mixed evidence). Most fact-checkers fake confidence; you don't.
6. TEACHING VERIFICATION. "how_to_verify" gives the user concrete strategies tailored to the claim types — primary sources, study designs to look for, echo-chamber patterns to watch for.
7. OUTPUT VALID JSON ONLY. No markdown fences, no preamble, no commentary. The first character is "{" and the last is "}".
8. BUDGET: extract at most ${config.maxClaims} distinct claims. Cite at most ${config.maxSources} sources per claim. If the post has more potential claims, pick the most load-bearing ones.

If the input contains a URL, use web_search to fetch it and check whether the post represents it accurately (set linked_source_check accordingly).`;
}

export function buildUserPrompt(input) {
  return `Analyze the following social-media post. Return JSON matching the schema above.

POST:
${input}`;
}
```

- [ ] **Step 4: Run tests — see them pass**

```bash
cd /Users/zefan/Claude/claim_check/proxy
npm test
```

Expected: all tests pass (validator's 5 + new prompt tests).

- [ ] **Step 5: Update `proxy/test_modes.js` to use the new export**

Phase 0's harness imported the old `SYSTEM_PROMPT` constant which no longer exists. Update its import + usage to use `buildSystemPrompt('standard')` so the harness remains usable as a regression-test tool.

In `proxy/test_modes.js`, change:
```javascript
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
```
to:
```javascript
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';
```

And in the `runOne` function, change:
```javascript
options: {
  systemPrompt: SYSTEM_PROMPT,
  model,
  maxTokens,
  allowedTools: ['WebSearch'],
}
```
to:
```javascript
options: {
  systemPrompt: buildSystemPrompt('standard'),
  model,
  maxTokens,
  allowedTools: ['WebSearch'],
}
```

Verify: `node --check proxy/test_modes.js`.

- [ ] **Step 6: Commit**

```bash
cd /Users/zefan/Claude/claim_check
git add proxy/prompt.js proxy/prompt.test.js proxy/test_modes.js
git commit -m "proxy: parameterize prompt with MODE_CONFIG + buildSystemPrompt(mode)"
```

### Task 1.2: `proxy/analyze.js` — accept mode parameter

**Files:**
- Modify: `proxy/analyze.js`

- [ ] **Step 1: Update analyze.js**

Replace the contents of `proxy/analyze.js` with:

```javascript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { MODE_CONFIG, buildSystemPrompt, buildUserPrompt } from './prompt.js';
import { validate } from './validator.js';

const REQUEST_TIMEOUT_MS = 180_000;

export async function analyze(input, mode = 'standard') {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('input must be a non-empty string');
  }
  if (input.length > 4000) {
    input = input.slice(0, 4000);
  }

  let timeoutId;
  return Promise.race([
    runAnalysis(input, mode).finally(() => clearTimeout(timeoutId)),
    new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`analyze timed out after ${REQUEST_TIMEOUT_MS}ms`)),
        REQUEST_TIMEOUT_MS
      );
    }),
  ]);
}

async function runAnalysis(input, mode) {
  const config = MODE_CONFIG[mode] || MODE_CONFIG.standard;
  const prompt = buildUserPrompt(input);

  const events = [];
  for await (const event of query({
    prompt,
    options: {
      systemPrompt: buildSystemPrompt(mode),
      model: config.model,
      maxTokens: config.maxTokens,
      allowedTools: ['WebSearch'],
    }
  })) {
    events.push(event);
  }

  const text = extractFinalText(events);
  const parsed = parseJson(text);
  const clean = validate(parsed);
  return clean;
}

function extractFinalText(events) {
  const resultEvent = events.find(e => e.type === 'result');
  if (resultEvent && typeof resultEvent.result === 'string') {
    return resultEvent.result;
  }
  const assistantTexts = events
    .filter(e => e.type === 'assistant')
    .flatMap(e => (e.message?.content || []).filter(c => c.type === 'text'))
    .map(c => c.text);
  if (assistantTexts.length === 0) {
    throw new Error('No assistant text in SDK events. Inspect events:\n' + JSON.stringify(events.slice(-3), null, 2));
  }
  return assistantTexts[assistantTexts.length - 1];
}

function parseJson(text) {
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  try {
    return JSON.parse(s);
  } catch (err) {
    throw new Error(`Could not parse Claude output as JSON: ${err.message}\n\nRaw output:\n${text.slice(0, 500)}`);
  }
}
```

- [ ] **Step 2: Sanity-check imports**

```bash
cd /Users/zefan/Claude/claim_check/proxy
node --check analyze.js
node -e "import('./analyze.js').then(m => console.log('imports OK:', Object.keys(m)))"
```

Expected: no syntax errors; `imports OK: [ 'analyze' ]`.

- [ ] **Step 3: Cheap unit test (no API call)**

```bash
cd /Users/zefan/Claude/claim_check/proxy
node -e "
import('./analyze.js').then(async ({ analyze }) => {
  try { await analyze(''); console.log('FAIL: did not throw on empty'); }
  catch (e) { console.log('OK throws on empty:', e.message); }
  try { await analyze('x', 'INVALID_MODE'); console.log('FAIL: should have run with fallback to standard, not validated input'); }
  catch (e) {
    if (e.message.includes('input must be a non-empty')) console.log('FAIL: rejected input on invalid mode');
    else console.log('OK reaches SDK call (will fail on auth or similar):', e.message.slice(0, 80));
  }
});
"
```

Expected:
- `OK throws on empty: input must be a non-empty string`
- The second call reaches the SDK because `MODE_CONFIG[invalid]` falls back to standard. It will likely fail with an auth/timeout error since we're not running a full SDK session — that's fine; we're just verifying the input path works.

(If the second call hangs for the full timeout, kill with Ctrl-C — the goal here is just to confirm input validation passes.)

- [ ] **Step 4: Commit**

```bash
cd /Users/zefan/Claude/claim_check
git add proxy/analyze.js
git commit -m "proxy: analyze() takes mode param, threads through to SDK options"
```

### Task 1.3: `proxy/server.js` — accept mode, validate, wrap response, mode-keyed cache

**Files:**
- Modify: `proxy/server.js`

- [ ] **Step 1: Update server.js**

Replace the contents of `proxy/server.js` with:

```javascript
import http from 'node:http';
import crypto from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { analyze } from './analyze.js';
import { MODE_CONFIG } from './prompt.js';

const PORT = 3001;
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // (hash of input+mode) -> { data, mode, completedAt }

function resolveMode(raw) {
  if (typeof raw === 'string' && Object.prototype.hasOwnProperty.call(MODE_CONFIG, raw)) {
    return { mode: raw, fellBack: false };
  }
  if (raw !== undefined) {
    console.warn(`[mode] rejected invalid mode value ${JSON.stringify(raw)} — falling back to 'standard'`);
  }
  return { mode: 'standard', fellBack: raw !== undefined };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/analyze') {
    res.writeHead(404);
    res.end();
    return;
  }

  req.setEncoding('utf8');
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    let parsed;
    try { parsed = JSON.parse(body); }
    catch { return badRequest(res, 'invalid JSON body'); }

    const input = parsed.input;
    if (typeof input !== 'string' || !input.trim()) {
      return badRequest(res, 'input must be a non-empty string');
    }

    const { mode } = resolveMode(parsed.mode);
    const hash = crypto.createHash('sha256').update(`${input}:${mode}`).digest('hex');
    const cached = cache.get(hash);
    if (cached && Date.now() - cached.completedAt < CACHE_TTL_MS) {
      console.log(`[cache hit] ${hash.slice(0, 8)} mode=${mode}`);
      return ok(res, { mode: cached.mode, data: cached.data });
    }

    console.log(`[analyze] ${hash.slice(0, 8)} mode=${mode} ${input.slice(0, 60)}...`);
    try {
      const data = await analyze(input, mode);
      cache.set(hash, { data, mode, completedAt: Date.now() });
      ok(res, { mode, data });
    } catch (err) {
      console.error(`[analyze error] ${err.message}`);
      const isAuth = /auth|oauth|login|unauthor|401|403/i.test(err.message);
      serverError(res, isAuth
        ? `Authentication failed: ${err.message}. Try running 'claude login' again.`
        : err.message);
    }
  });
});

function ok(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
function badRequest(res, msg) {
  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
}
function serverError(res, msg) {
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
}

const STARTUP_TIMEOUT_MS = 30_000;
async function startupCheck() {
  console.log('startup: pinging Claude to verify SDK + OAuth...');
  let timeoutId;
  const ping = (async () => {
    let count = 0;
    for await (const _ of query({
      prompt: 'Reply with the single word: ok',
      options: { model: 'claude-opus-4-7', maxTokens: 16 },
    })) {
      count++;
    }
    return count;
  })();
  try {
    const count = await Promise.race([
      ping.finally(() => clearTimeout(timeoutId)),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`startupCheck timed out after ${STARTUP_TIMEOUT_MS}ms — SDK may be hung`)),
          STARTUP_TIMEOUT_MS
        );
      }),
    ]);
    console.log(`startup: OK (${count} events)`);
  } catch (err) {
    console.error('startup: FAILED —', err.message);
    console.error('Hint: run `claude login` and try again, or check the SDK install.');
    process.exit(1);
  }
}

await startupCheck();

server.listen(PORT, () => {
  console.log(`ClaimCheck proxy listening on http://localhost:${PORT}`);
});
```

Key changes vs current server.js:
- Imports `MODE_CONFIG` from `./prompt.js`
- New `resolveMode(raw)` helper for validation
- Cache key now `hash(input + ':' + mode)`
- Calls `analyze(input, mode)` with mode
- Response shape: `{ mode, data }` for both fresh and cached responses
- Cached entries store `mode` so cached responses include it

- [ ] **Step 2: Syntax check + start the server**

```bash
cd /Users/zefan/Claude/claim_check/proxy
node --check server.js
```

Expected: exit 0.

Stop any running proxy first (`Ctrl-C` in its terminal). Then start fresh:

```bash
npm start
```

Expected: `startup: OK ...` then `ClaimCheck proxy listening on http://localhost:3001`. Leave running.

- [ ] **Step 3: curl smoke test for each mode**

In a separate terminal:

```bash
# quick mode
curl -s -X POST http://localhost:3001/analyze \
  -H "Content-Type: application/json" \
  -d '{"input":"The Fed should cut rates immediately. Inflation is dead.","mode":"quick"}' | head -100

# missing mode → standard
curl -s -X POST http://localhost:3001/analyze \
  -H "Content-Type: application/json" \
  -d '{"input":"Same input, no mode field."}' | head -100

# invalid mode → standard fallback
curl -s -X POST http://localhost:3001/analyze \
  -H "Content-Type: application/json" \
  -d '{"input":"Same input, bad mode.","mode":"INVALID"}' | head -10
```

Expected for each:
- HTTP 200
- Response body shape: `{"mode":"<actual>","data":{...}}`
- For invalid mode call: `mode:"standard"` in response, AND a `[mode] rejected invalid mode value "INVALID"` line in the proxy's terminal log.

- [ ] **Step 4: Verify cache key includes mode**

Run two requests with the same input but different modes and confirm both go through (no false cache hits):

```bash
# First call: quick (will run, cache miss)
curl -s -X POST http://localhost:3001/analyze -H "Content-Type: application/json" \
  -d '{"input":"Test cache key.","mode":"quick"}' >/dev/null

# Same input, different mode: should still run, NOT hit cache
curl -s -X POST http://localhost:3001/analyze -H "Content-Type: application/json" \
  -d '{"input":"Test cache key.","mode":"standard"}' >/dev/null
```

Watch the proxy log: should see `[analyze]` for both, NOT `[cache hit]`. Then a third request matching the first should hit cache:

```bash
# Same as first call — should hit cache
curl -s -X POST http://localhost:3001/analyze -H "Content-Type: application/json" \
  -d '{"input":"Test cache key.","mode":"quick"}' >/dev/null
```

Watch log: should see `[cache hit]`.

- [ ] **Step 5: Stop the proxy and commit**

`Ctrl-C` the proxy.

```bash
cd /Users/zefan/Claude/claim_check
git add proxy/server.js
git commit -m "proxy: server accepts mode, validates, wraps response {mode,data}, mode-keyed cache"
```

---

## Phase 2 — Extension (UI)

### Task 2.1: `popup.html` + `popup.css` — segmented control

**Files:**
- Modify: `extension/popup/popup.html`
- Modify: `extension/popup/popup.css`

- [ ] **Step 1: Add segmented control to popup.html**

In `extension/popup/popup.html`, find the `<form id="form">` block and ADD the segmented control immediately BEFORE it:

Find:
```html
    <form id="form">
      <textarea id="input" placeholder="Paste the tweet text (URLs may not load — X requires auth)" rows="4"></textarea>
      <button id="submit" type="submit">Analyze</button>
    </form>
```

Replace with:
```html
    <div id="mode-control" class="mode-control" role="radiogroup" aria-label="Analysis mode">
      <button type="button" class="mode-pill" data-mode="quick" role="radio" aria-checked="false" title="~10s. Fewer claims, briefer evidence. Sonnet.">Quick</button>
      <button type="button" class="mode-pill is-selected" data-mode="standard" role="radio" aria-checked="true" title="~20s. Balanced for everyday use. Sonnet.">Standard</button>
      <button type="button" class="mode-pill" data-mode="deep" role="radio" aria-checked="false" title="~60–90s. Thorough, more sources. Opus reasoning.">Deep</button>
    </div>

    <form id="form">
      <textarea id="input" placeholder="Paste the tweet text (URLs may not load — X requires auth)" rows="4"></textarea>
      <button id="submit" type="submit">Analyze</button>
    </form>
```

Note: `is-selected` is hardcoded on `standard` so the user sees a consistent default state immediately, before the async `chrome.storage.local` read completes (avoids flash-of-wrong-pill per spec §5).

- [ ] **Step 2: Add pill styling to popup.css**

Append to `extension/popup/popup.css`:

```css
.mode-control {
  display: flex;
  margin-bottom: 10px;
  gap: 4px;
}
.mode-pill {
  flex: 1;
  padding: 6px 4px;
  background: white;
  color: #1a1a1a;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}
.mode-pill:hover { background: #f0f0f0; }
.mode-pill.is-selected {
  background: #1a1a1a;
  color: white;
  border-color: #1a1a1a;
}
.mode-pill.is-selected:hover { background: #1a1a1a; }
```

- [ ] **Step 3: Reload extension and visually verify**

`chrome://extensions` → reload icon on ClaimCheck. Click ClaimCheck icon. Expected:
- Three pill buttons in a row above the textarea: `Quick | Standard | Deep`
- `Standard` has the dark filled background; `Quick` and `Deep` have light bg with border
- Hovering an unselected pill darkens it slightly
- Tooltips appear on hover

(Clicks don't do anything yet — that's Task 2.2.)

- [ ] **Step 4: Commit**

```bash
cd /Users/zefan/Claude/claim_check
git add extension/popup/popup.html extension/popup/popup.css
git commit -m "extension: segmented control markup + pill styling"
```

### Task 2.2: `popup.js` — module-level mode variable + pill handlers

**Files:**
- Modify: `extension/popup/popup.js`

- [ ] **Step 1: Read the current popup.js**

```bash
cat /Users/zefan/Claude/claim_check/extension/popup/popup.js
```

Familiarize yourself with the current structure (it's ~110 lines: imports, on-open IIFE, form submit handler, helpers).

- [ ] **Step 2: Update popup.js**

The full new contents of `extension/popup/popup.js`:

```javascript
import { render, clear } from './render.js';

const isDetached = new URLSearchParams(window.location.search).get('detached') === '1';

const form = document.getElementById('form');
const input = document.getElementById('input');
const submitBtn = document.getElementById('submit');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const popoutBtn = document.getElementById('popout');
const urlHintEl = document.getElementById('url-hint');
const inflightEl = document.getElementById('inflight-banner');

const TWEET_URL_RE = /^https?:\/\/(www\.)?(x|twitter)\.com\/[^\s]+$/i;
const CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_INFLIGHT_MS = 5 * 60 * 1000;
const VALID_MODES = ['quick', 'standard', 'deep'];

// Module-level mode state (single source of truth — see spec §7).
// Initialized from storage in the on-open IIFE; updated synchronously on pill click.
let currentMode = 'standard';

// ---------- Pop-out button ----------
if (isDetached) {
  popoutBtn?.classList.add('hidden');
} else {
  popoutBtn?.addEventListener('click', async () => {
    await chrome.windows.create({
      url: chrome.runtime.getURL('popup/popup.html?detached=1'),
      type: 'popup',
      width: 440,
      height: 720,
    });
    window.close();
  });
}

// ---------- Mode pill controls ----------
function applyModeUI(mode) {
  document.querySelectorAll('.mode-pill').forEach(btn => {
    const isSelected = btn.dataset.mode === mode;
    btn.classList.toggle('is-selected', isSelected);
    btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
  });
}

document.querySelectorAll('.mode-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (!VALID_MODES.includes(mode)) return;
    currentMode = mode;
    applyModeUI(mode);
    // Persist; fire-and-forget. Storage write is not on the submit critical path.
    chrome.storage.local.set({ mode }).catch(() => {});
  });
});

// ---------- Inflight cancel button ----------
document.getElementById('inflight-cancel').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'cancel' });
  hideInFlight();
});

// ---------- On-open: load mode + restore cached/in-flight state ----------
(async () => {
  // Load persisted mode (if any) and reflect in UI without flashing wrong pill.
  // The HTML defaults to `standard` selected; we update only if a different valid mode is stored.
  try {
    const { mode: storedMode } = await chrome.storage.local.get('mode');
    if (typeof storedMode === 'string' && VALID_MODES.includes(storedMode)) {
      currentMode = storedMode;
      if (storedMode !== 'standard') applyModeUI(storedMode);
    }
  } catch { /* storage failed — keep default 'standard' */ }

  // Stale-detection: if the marker is older than the proxy could reasonably take,
  // the worker that owned it is dead. Clear and treat as no-in-flight.
  let inFlight = await chrome.runtime.sendMessage({ type: 'getInFlight' });
  if (inFlight && Date.now() - inFlight.startedAt > STALE_INFLIGHT_MS) {
    await chrome.runtime.sendMessage({ type: 'cancel' });
    inFlight = null;
  }

  if (inFlight) {
    input.value = inFlight.input || '';
    showInFlight();
    setupInFlightListener();
    return;
  }

  const cached = await chrome.runtime.sendMessage({ type: 'getCachedResult' });
  if (cached && Date.now() - cached.completedAt < CACHE_TTL_MS) {
    input.value = cached.input || '';
    showResult(cached.data);
  }
})();

// ---------- Submit ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  hideUrlHint();
  if (TWEET_URL_RE.test(text)) {
    showUrlHint('Heads up: tweet URLs often fail to load (X requires auth). Pasting the tweet text usually works better. Trying anyway…');
  }

  setLoading(true);
  clear();
  resultEl.classList.add('hidden');

  // Submit reads mode from the in-memory variable (synchronously up-to-date with last pill click).
  const response = await chrome.runtime.sendMessage({ type: 'analyze', input: text, mode: currentMode });

  setLoading(false);

  if (!response || !response.ok) {
    showError(response?.error || 'Unknown error. Is the proxy running on localhost?');
    return;
  }

  showResult(response.data);
});

function setLoading(on) {
  submitBtn.disabled = on;
  if (on) {
    statusEl.textContent = 'Analyzing… web search can take 30–90 seconds.';
    statusEl.classList.remove('hidden', 'error');
  } else {
    statusEl.classList.add('hidden');
  }
}

function showError(msg) {
  statusEl.textContent = `Error: ${msg}`;
  statusEl.classList.remove('hidden');
  statusEl.classList.add('error');
}

function showResult(data) {
  hideInFlight();
  render(data);
  resultEl.classList.remove('hidden');
}

function showUrlHint(msg) {
  urlHintEl.textContent = msg;
  urlHintEl.classList.remove('hidden');
  urlHintEl.classList.add('info');
}
function hideUrlHint() {
  urlHintEl.classList.add('hidden');
  urlHintEl.classList.remove('info');
  urlHintEl.textContent = '';
}

function showInFlight() {
  document.getElementById('inflight-text').textContent =
    'Analysis is still running in the background — will display when ready…';
  inflightEl.classList.remove('hidden');
  inflightEl.classList.add('info');
  submitBtn.disabled = true;
}
function hideInFlight() {
  inflightEl.classList.add('hidden');
  inflightEl.classList.remove('info');
  document.getElementById('inflight-text').textContent = '';
  submitBtn.disabled = false;
}

function setupInFlightListener() {
  const handler = (changes, area) => {
    if (area !== 'session') return;
    if ('lastResult' in changes && changes.lastResult.newValue) {
      const cached = changes.lastResult.newValue;
      if (cached.input === input.value) {
        showResult(cached.data);
        chrome.storage.onChanged.removeListener(handler);
      }
    }
    if ('inFlight' in changes && !changes.inFlight.newValue) {
      setTimeout(async () => {
        const finalCheck = await chrome.runtime.sendMessage({ type: 'getCachedResult' });
        if (!finalCheck || finalCheck.input !== input.value) {
          hideInFlight();
          showError('Background analysis ended without a result. Check the proxy log.');
          chrome.storage.onChanged.removeListener(handler);
        }
      }, 500);
    }
  };
  chrome.storage.onChanged.addListener(handler);
}
```

Key changes vs current popup.js:
- Adds `VALID_MODES`, `currentMode` module-level variable
- Adds `applyModeUI(mode)` and pill-click handlers (synchronous update of `currentMode`, fire-and-forget storage write)
- On-open IIFE reads persisted mode and reflects it in the UI (without flashing wrong pill)
- Submit handler includes `mode: currentMode` in the sendMessage payload

- [ ] **Step 3: Syntax check**

```bash
node --check /Users/zefan/Claude/claim_check/extension/popup/popup.js
```

Expected: exit 0.

- [ ] **Step 4: Reload extension and verify pill clicks**

`chrome://extensions` → reload. Open popup. Test:
- Click `Quick` → Quick gets dark bg, Standard becomes light. Click `Deep` → switches. Click `Standard` → switches back.
- Close popup, reopen → the last selected pill stays selected (storage persistence).

(Submitting still goes through; we'll validate the full mode flow in Phase 3.)

- [ ] **Step 5: Commit**

```bash
cd /Users/zefan/Claude/claim_check
git add extension/popup/popup.js
git commit -m "extension: popup mode state + pill click handlers + persistence"
```

### Task 2.3: `service_worker.js` — accept + pass mode, unwrap response envelope

**Files:**
- Modify: `extension/background/service_worker.js`

- [ ] **Step 1: Update service_worker.js**

The full new contents of `extension/background/service_worker.js`:

```javascript
const PROXY_URL = 'http://localhost:3001/analyze';

let activeAbortController = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'analyze') {
    handleAnalyze(msg.input, msg.mode)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (msg.type === 'getCachedResult') {
    chrome.storage.session.get('lastResult').then(({ lastResult }) => {
      sendResponse(lastResult || null);
    });
    return true;
  }

  if (msg.type === 'getInFlight') {
    chrome.storage.session.get('inFlight').then(({ inFlight }) => {
      sendResponse(inFlight || null);
    });
    return true;
  }

  if (msg.type === 'cancel') {
    if (activeAbortController) {
      try { activeAbortController.abort(); } catch { /* ignore */ }
      activeAbortController = null;
    }
    chrome.storage.session.remove('inFlight').then(() => sendResponse(true));
    return true;
  }
});

async function handleAnalyze(input, mode) {
  const requestedAt = Date.now();
  await chrome.storage.session.set({ inFlight: { input, mode, startedAt: requestedAt } });

  if (activeAbortController) {
    try { activeAbortController.abort(); } catch { /* ignore */ }
  }
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  try {
    let res;
    try {
      res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, mode }),
        signal,
      });
    } catch (netErr) {
      if (netErr.name === 'AbortError') {
        throw new Error('Analysis cancelled');
      }
      throw new Error(`Couldn't reach the proxy at ${PROXY_URL}. Is it running? (${netErr.message})`);
    }
    if (!res.ok) {
      let msg = `Proxy returned ${res.status}`;
      try {
        const body = await res.json();
        if (body && typeof body.error === 'string') msg = body.error;
      } catch { /* response body not JSON; fall back to status */ }
      throw new Error(msg);
    }
    const body = await res.json();
    // Unwrap the new {mode, data} envelope. Forward-compat: handle older proxies that
    // returned just the JSON directly (no wrapping).
    const data = (body && typeof body === 'object' && 'data' in body) ? body.data : body;
    if (!data || typeof data !== 'object' || !Array.isArray(data.claims)) {
      throw new Error('Proxy returned unexpected response shape (missing claims array).');
    }
    await chrome.storage.session.set({
      lastResult: { data, requestedAt, completedAt: Date.now(), input, mode }
    });
    return data;
  } finally {
    if (activeAbortController?.signal === signal) {
      activeAbortController = null;
    }
    await chrome.storage.session.remove('inFlight');
  }
}
```

Key changes vs current service_worker.js:
- `handleAnalyze` accepts `mode` parameter, includes it in the fetch body and the inFlight/lastResult records
- Response unwrapping: `const data = (body && typeof body === 'object' && 'data' in body) ? body.data : body;` — handles both new and legacy proxy response shapes
- Inflight record now also stores `mode`

- [ ] **Step 2: Syntax check**

```bash
node --check /Users/zefan/Claude/claim_check/extension/background/service_worker.js
```

Expected: exit 0.

- [ ] **Step 3: Reload extension**

`chrome://extensions` → reload icon on ClaimCheck. Click "Service worker" link, confirm no errors in DevTools console.

- [ ] **Step 4: Commit**

```bash
cd /Users/zefan/Claude/claim_check
git add extension/background/service_worker.js
git commit -m "extension: service worker passes mode through + unwraps {mode,data} envelope"
```

---

## Phase 3 — Validation & demo readiness

### Task 3.1: End-to-end test — all three modes through the extension

- [ ] **Step 1: Start the proxy**

```bash
cd /Users/zefan/Claude/claim_check/proxy
npm start
```

Wait for `ClaimCheck proxy listening on http://localhost:3001`.

- [ ] **Step 2: Reload the extension** (manifest etc. didn't change but make sure latest code is loaded)

`chrome://extensions` → reload.

- [ ] **Step 3: Run through each mode on a real tweet**

Use the homework tweet from `tools/sample_tweets.txt`:
```
A new study confirms that homework has no measurable effect on academic performance for elementary school students. Why are we still assigning it?
```

For each of the three modes:
1. Select the pill (Quick / Standard / Deep)
2. Paste the tweet text into the textarea
3. Click Analyze
4. Watch the loading state
5. When complete, verify all 6 cards populate
6. Note: the elapsed time + the proxy log line `[analyze] <hash> mode=<expected> ...`
7. **Verify the response includes the `mode` field:** open Chrome DevTools on the popup (right-click in popup → Inspect → Network tab → click the `/analyze` request → Response tab). Confirm the response body shape is `{"mode":"<expected>","data":{...}}`. The `mode` field must be present and match the requested mode.

Expected approximate timings (per spec §3):
- Quick: 5–15s
- Standard: 15–30s
- Deep: 30–90s

(If actual timings deviate >50% from these estimates, adjust the tooltip copy in popup.html accordingly.)

- [ ] **Step 4: Verify pill persistence**

Close the popup, reopen — last-selected pill should still be highlighted. Repeat across all three modes.

- [ ] **Step 5: Verify cache key (no false hits across modes)**

In the proxy log:
- Run the same tweet in `quick` mode (cache miss → `[analyze]`)
- Run the same tweet again in `quick` mode (cache hit → `[cache hit]`)
- Run the same tweet in `standard` mode (cache miss → `[analyze]`, NOT `[cache hit]`)

- [ ] **Step 6: Verify silent-fallback detection**

Send an invalid mode via curl while watching the proxy log:

```bash
curl -s -X POST http://localhost:3001/analyze \
  -H "Content-Type: application/json" \
  -d '{"input":"Test fallback.","mode":"INVALID"}' | head -10
```

Expected: response includes `"mode":"standard"` (server fell back); proxy log includes the `[mode] rejected invalid mode value "INVALID"` warning.

(The extension itself doesn't surface a UI warning for fallback per spec — the popup just renders the result. The mode field in the response is reserved for telemetry/future use.)

- [ ] **Step 7: Stop the proxy**

`Ctrl-C` the proxy.

(No commit for this task — pure validation.)

### Task 3.2: §10 acceptance gates revisited

- [ ] **Step 1: Confirm Phase 0 results held up**

Re-read the Phase 0 decision review notes (Task 0.1 step 3). If you adjusted MODE_CONFIG values during Phase 0, those should be reflected in the spec and the implemented code. Verify they match by:

```bash
grep -A 4 "MODE_CONFIG = {" /Users/zefan/Claude/claim_check/proxy/prompt.js
```

Expected: the same numbers you decided on at end of Phase 0.

- [ ] **Step 2: Latency adjustment if needed**

If actual timings observed in Task 3.1 step 3 deviate >50% from spec estimates, edit `extension/popup/popup.html` tooltip text on the pills to match observed reality. Example: if Quick takes 18s instead of 10s, change `title="~10s. Fewer claims, briefer evidence. Sonnet."` to `title="~15-25s. Fewer claims, briefer evidence. Sonnet."`. Commit if changed:

```bash
cd /Users/zefan/Claude/claim_check
git add extension/popup/popup.html
git commit -m "extension: refine mode pill tooltips with observed latency"
```

### Task 3.3: Demo dry run

- [ ] **Step 1: Pre-flight checklist**

Confirm:
- Proxy starts cleanly (`npm start` shows `startup: OK`)
- Extension is loaded and reloaded after the latest commits
- `claude login` is fresh (run `claude --print "hi"` to sanity-check auth)
- A primary demo tweet is queued (suggested: the homework tweet — works in all 3 modes per Task 3.1 verification)
- Backup screenshots saved from prior demo prep

- [ ] **Step 2: Walk the demo**

Pitch order (matches the track judging criteria):

1. Lead with **Standard** (default behavior — the curious user's everyday choice)
   - Paste tweet, click Analyze
   - Narrate the no-verdict design philosophy as the cards populate
   - Highlight the steelman vs evidence routing
2. Switch to **Quick** for the same tweet (or a second tweet) — show responsiveness
   - 10-15s wait → terser output, same structure
   - Talking point: "for users who just want a critical-thinking nudge, not a research paper"
3. Switch to **Deep** for a complex tweet — show depth
   - Mention this is the previous behavior, now opt-in
   - Talking point: "users serious about a topic can opt in; we don't make everyone wait"

- [ ] **Step 3: Final commit + push**

```bash
cd /Users/zefan/Claude/claim_check
git add -A
git commit -m "demo: pre-flight pass" --allow-empty
git push
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Plan task |
|---|---|
| §3 MODE_CONFIG values | 1.1 |
| §4 buildSystemPrompt(mode) | 1.1 |
| §5 segmented control + UI behavior on open | 2.1, 2.2 |
| §6 data flow (popup → worker → proxy → analyze) | 2.2, 2.3, 1.2, 1.3 |
| §6 server response shape `{mode, data}` | 1.3 |
| §7 file changes | All Phase 1 + Phase 2 tasks |
| §8 edge cases (cache key, in-memory mode, response unwrap) | 1.3 (cache), 2.2 (in-memory), 2.3 (unwrap) |
| §10 Sonnet reliability gate | 0.1 |
| §10 maxTokens truncation gate | 0.1 (Sonnet quick row) |
| §10 latency measurement | 3.1, 3.2 |
| §10 steelman quality gate | 0.1 (steelman_words check) |

**Placeholder scan:** No "TBD" / "implement later" steps. Every step has either a code block, a command, or a concrete decision criterion. The Phase 0 decision review (Task 0.1 step 3) has explicit pass/fail criteria.

**Type/signature consistency:**
- `MODE_CONFIG` keys: `quick`, `standard`, `deep` — consistent across prompt.js, analyze.js, server.js, popup.js, validator-style fallback
- `analyze(input, mode = 'standard')` — same signature in 1.2 and called consistently from 1.3
- `buildSystemPrompt(mode)` — same in 1.1 (definition) and 1.2 (caller)
- Response shape `{ mode, data }` — produced in 1.3, unwrapped in 2.3
- `currentMode` module variable — defined in 2.2, read by submit handler in 2.2 (same file)
- Cache key `hash(input + ':' + mode)` — consistent in 1.3 across cache write and cache read
- Response field name `data` — consistent across server.js, service_worker.js (`body.data`)
