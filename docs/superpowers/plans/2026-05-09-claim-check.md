# ClaimCheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension + local Node proxy that helps users think critically about social-media posts (primarily X/Twitter) by extracting claims, web-searching for evidence, generating steel-manned counter-arguments, and being explicit about what couldn't be verified — without rendering verdicts.

**Architecture:** Chrome MV3 extension (popup + background service worker) calls a local Node proxy on `localhost:3001`. The proxy authenticates to Claude via Claude Agent SDK using the user's Claude Max OAuth credentials, calls Claude with the `web_search` tool, validates the output (no-verdict gate + schema enforcement), and returns structured JSON. The popup renders the JSON as 6 fixed sections (TL;DR, Claims, Evidence, Strongest disagreement, What we couldn't verify, How to verify yourself).

**Tech Stack:** Chrome Manifest V3 (vanilla HTML/JS, no build step), Node.js, `@anthropic-ai/claude-agent-sdk` (or equivalent — confirmed at kickoff), Claude Max OAuth, `web_search` tool.

**Reference:**
- Spec: `docs/superpowers/specs/2026-05-09-claim-check-design.md`
- Pitfalls: `docs/claude-pitfalls.md` — read before any task
- Project doc: `CLAUDE.md`

**Work split:**
- **Phase 0 — Kickoff (joint):** validate primitives, lock contract.
- **Phase 1A — Extension (Person 1):** parallel with 1B. Extension UI, render, mock proxy.
- **Phase 1B — Proxy (Person 2):** parallel with 1A. Proxy server, prompt, validator, SDK call.
- **Phase 2 — Integration & demo (joint):** wire halves together, smoke test, cut decision, dry run.

The team sequences phases in person; clock times are not specified by this plan.

**Frozen contracts (locked at end of Phase 0):**
- `schema.md` — JSON output schema specification
- `tools/sample_response.json` — fixture conforming to the schema; Person 1's renderer is built against this

If Person 2 finds the SDK can't deliver the schema verbatim, Person 2 adds a transformation layer in `proxy/analyze.js` to reshape — does NOT change the contract unilaterally.

---

## File Structure

```
claim_check/
├── extension/                       Person 1 territory
│   ├── manifest.json
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   ├── popup.js
│   │   └── render.js
│   └── background/
│       └── service_worker.js
├── proxy/                           Person 2 territory
│   ├── package.json
│   ├── server.js
│   ├── analyze.js
│   ├── prompt.js
│   ├── validator.js
│   └── test_prompt.js
├── tools/
│   ├── mock_proxy.js                Person 1 territory (used during 1A only)
│   ├── sample_response.json         Joint, FROZEN after Phase 0
│   └── sample_tweets.txt            Joint
├── schema.md                        Joint, FROZEN after Phase 0
├── CLAUDE.md                        (already exists)
├── docs/                            (already exists)
└── .gitignore                       (already exists)
```

Each file has one owner. The `tools/sample_response.json`, `tools/sample_tweets.txt`, and `schema.md` files are frozen after Phase 0; if either person needs to change them, both pause and align.

---

## Phase 0 — Kickoff (joint, must finish before parallel work begins)

**Workflow:** All Phase 0 work happens on ONE machine (the user's, with the Max plan logged in). Both teammates collaborate live (pair-programming style). A single person makes all Phase 0 commits to keep history clean. After Task 0.4 push, the second teammate clones the repo on their own machine and picks up Phase 1B.

The "Lead: P1/P2" tags below indicate who knows the relevant tech best — they drive while the other watches.

**Exit criteria for Phase 0:**
- A working real call to Claude with `web_search`, OAuth-authenticated, returns parseable JSON conforming to the schema.
- A working spike popup that fetches from a local server with CORS.
- `schema.md` and `tools/sample_response.json` are committed.
- Initial scaffolds are pushed to remote.
- Second teammate has cloned the repo on their machine and verified the scaffold.

### Task 0.1: Spike — Verify Claude Agent SDK + Max OAuth + web_search [Lead: P2, watched by P1]

This is the single biggest project-killer. If the SDK + OAuth + web_search combo doesn't work, the architecture pivots before parallel work begins.

**Files:**
- Create: `proxy/spike.js` (temporary — gets replaced in Task 1B.3)
- Create: `proxy/package.json`
- Create: `proxy/.gitignore`

- [ ] **Step 1: Initialize the proxy package**

```bash
cd /Users/zefan/Claude/claim_check
mkdir -p proxy
cd proxy
npm init -y
```

- [ ] **Step 2: Add a `.gitignore` for `node_modules`**

Create `proxy/.gitignore`:

```
node_modules/
*.log
```

- [ ] **Step 3: Install the Claude Agent SDK**

The exact package name is one of `@anthropic-ai/claude-agent-sdk` or `@anthropic-ai/claude-code`. Try the first; if it fails, try the second.

```bash
npm install @anthropic-ai/claude-agent-sdk
```

If that fails:

```bash
npm install @anthropic-ai/claude-code
```

Note which one worked. Update subsequent code samples in this plan to match.

- [ ] **Step 4: Authenticate with Claude Max OAuth**

If you don't already have Claude Code installed:

```bash
npm install -g @anthropic-ai/claude-code
```

Then log in (one-time):

```bash
claude login
```

Follow the OAuth flow in the browser. Confirm with `claude --version` or by running `claude --print "hello"` and getting a response.

- [ ] **Step 5: Write the spike script**

Create `proxy/spike.js`. The exact API may vary — adapt based on the installed package. Best-guess:

```javascript
import { query } from '@anthropic-ai/claude-agent-sdk';

const tweet = `Breaking: New CDC report shows 80% of seasonal flu hospitalizations last winter were among people who hadn't gotten the flu shot.`;

const prompt = `Analyze this social media post. Use web_search to verify factual claims. Return ONLY JSON (no markdown fences, no commentary) of the shape:
{ "tldr": "<one sentence>", "claims": [{"id":"c1","text":"...","type":"factual|opinion|mixed"}], "evidence": [{"claim_id":"c1","sources":[{"url":"...","title":"..."}],"synthesis":"..."}] }

POST:
${tweet}`;

(async () => {
  const events = [];
  for await (const event of query({
    prompt,
    options: {
      model: 'claude-opus-4-7',
      // web_search tool name — verify the exact identifier from SDK docs
    }
  })) {
    events.push(event);
    console.log(JSON.stringify(event, null, 2));
  }
  console.log('--- DONE ---');
  console.log(`Total events: ${events.length}`);

  // Conformance check: try to parse the final text as JSON and report shape
  const textEvents = events.filter(e =>
    typeof (e.text || e.content) === 'string'
  );
  const last = textEvents[textEvents.length - 1];
  if (!last) {
    console.error('CONFORMANCE: NO TEXT EVENT FOUND — adapt extractFinalText() in Task 1B.3');
    return;
  }
  let raw = (last.text || last.content).trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(raw);
    const keys = Object.keys(parsed);
    console.log('CONFORMANCE: keys =', keys);
    console.log('CONFORMANCE: parsed top-level types =', Object.fromEntries(
      keys.map(k => [k, Array.isArray(parsed[k]) ? 'array' : typeof parsed[k]])
    ));
  } catch (err) {
    console.error('CONFORMANCE: JSON parse failed —', err.message);
    console.error('Raw output (first 500 chars):', raw.slice(0, 500));
  }
})();
```

If `query` isn't the right export, check the SDK's README for the correct entry point (commonly `query`, `run`, or a default export).

- [ ] **Step 6: Add `"type": "module"` to `package.json` so ES module imports work**

Edit `proxy/package.json`, ensure it has:

```json
{
  "type": "module"
}
```

- [ ] **Step 7: Run the spike**

```bash
node proxy/spike.js
```

**Expected:** events stream. At least one event should be a `tool_use` for `web_search`. The final event(s) should contain text that includes a JSON-shaped response or contains links from web search.

**If it fails:**
- "Cannot find module" → wrong package name; try the alternative
- "Not authenticated" → re-run `claude login`
- "Tool not available" / `web_search` not invoked → check SDK docs for how to enable web_search; may require `tools: [...]` option or may be enabled by default
- `CONFORMANCE: JSON parse failed` → either tighten the prompt to demand pure JSON (no markdown fences) or expect the parser in Task 1B.3 to strip fences
- Total failure → pivot to CLI subprocess. Replace `proxy/spike.js` with the version below; if it works, port to `proxy/analyze.js` in Task 1B.3 (replacing the SDK call with the same `spawn`-based approach).

**CLI subprocess fallback** (if SDK import fails entirely):

```javascript
// proxy/spike.js (CLI fallback variant)
import { spawn } from 'node:child_process';

const tweet = `Breaking: New CDC report shows 80% of seasonal flu hospitalizations last winter were among people who hadn't gotten the flu shot.`;

const prompt = `Analyze this social media post. Use web_search if needed. Return ONLY JSON of shape:
{ "tldr": "<one sentence>", "claims": [...], "evidence": [...] }

POST:
${tweet}`;

const proc = spawn('claude', ['--print', '--output-format', 'json'], { stdio: ['pipe', 'pipe', 'inherit'] });
proc.stdin.write(prompt);
proc.stdin.end();

let out = '';
proc.stdout.on('data', d => { out += d.toString(); });
proc.on('close', code => {
  if (code !== 0) {
    console.error(`claude CLI exited ${code}`);
    process.exit(1);
  }
  console.log('Raw output:', out.slice(0, 1000));
  // claude --print --output-format json wraps the response in a metadata envelope; the assistant text
  // is in `.result` or similar. Inspect the envelope and extract.
  try {
    const envelope = JSON.parse(out);
    console.log('Envelope keys:', Object.keys(envelope));
  } catch (err) {
    console.error('Could not parse CLI output as JSON envelope:', err.message);
  }
});
```

If this works but the SDK path doesn't, Task 1B.3 (analyze.js) becomes a wrapper around `spawn('claude', ...)` instead of `query()`. Same JSON-parse → validate flow.

- [ ] **Step 8: Adverse-prompt to verify the no-verdict guard works at the prompt level**

Modify the prompt to deliberately try to elicit a partisan-lean field:

```javascript
const adversePrompt = `Analyze this post and rate its political_lean from -1 (left) to +1 (right). Include the rating in your output.

POST: "Tax cuts boost the economy and create jobs."`;
```

Run it. **Expected:** Claude declines to rate or returns the field but Person 2 confirms it's something the validator (Task 1B.4) will strip.

- [ ] **Step 9: Commit**

```bash
cd /Users/zefan/Claude/claim_check
git add proxy/spike.js proxy/package.json proxy/.gitignore proxy/package-lock.json
git commit -m "spike: validate Claude Agent SDK + OAuth + web_search"
```

### Task 0.2: Spike — Verify Chrome extension → localhost CORS path [Lead: P1, watched by P2]

If extensions can't reach localhost or CORS blocks the call, the architecture has to change. Validate now.

**Files:**
- Create: `extension/manifest.json` (skeleton)
- Create: `extension/popup/popup.html` (minimal)
- Create: `extension/popup/popup.js` (minimal)
- Create: `tools/spike_server.js` (temporary — replaced/removed after Phase 0)

- [ ] **Step 1: Create the spike server**

Create `tools/spike_server.js`:

```javascript
import http from 'node:http';

const server = http.createServer((req, res) => {
  // Allow any extension origin for dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/test') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url: req.url, method: req.method }));
    return;
  }

  res.writeHead(404);
  res.end();
});

const PORT = 9999;
server.listen(PORT, () => {
  console.log(`Spike server listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Create the extension scaffold**

Create `extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "ClaimCheck (spike)",
  "version": "0.0.1",
  "description": "Spike: localhost connectivity test",
  "action": {
    "default_popup": "popup/popup.html"
  },
  "host_permissions": [
    "http://localhost:9999/*",
    "http://localhost:3001/*"
  ]
}
```

Create `extension/popup/popup.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>body { font-family: system-ui; padding: 12px; width: 280px; }</style>
  </head>
  <body>
    <button id="test">Test localhost</button>
    <pre id="out" style="white-space: pre-wrap; font-size: 11px;"></pre>
    <script src="popup.js"></script>
  </body>
</html>
```

Create `extension/popup/popup.js`:

```javascript
document.getElementById('test').addEventListener('click', async () => {
  const out = document.getElementById('out');
  out.textContent = 'fetching...';
  try {
    const res = await fetch('http://localhost:9999/test');
    const data = await res.json();
    out.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    out.textContent = `ERROR: ${err.message}`;
  }
});
```

- [ ] **Step 3: Run the spike server**

```bash
node tools/spike_server.js
```

Leave it running.

- [ ] **Step 4: Load the extension in Chrome**

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `/Users/zefan/Claude/claim_check/extension` directory

**Expected:** "ClaimCheck (spike)" appears in the extensions list with no errors.

- [ ] **Step 5: Click the extension icon and click "Test localhost"**

**Expected:** the `<pre>` shows `{ "ok": true, "url": "/test", "method": "GET" }`.

**If it fails:**
- Console error about CORS → confirm spike_server is sending the `Access-Control-Allow-Origin` header
- "Failed to fetch" / network error → confirm spike_server is running on 9999; confirm `host_permissions` in manifest includes `http://localhost:9999/*`
- Popup closes immediately → check Chrome's extension console for JS errors

- [ ] **Step 6: Commit**

```bash
cd /Users/zefan/Claude/claim_check
git add extension/ tools/spike_server.js
git commit -m "spike: validate chrome-extension → localhost CORS path"
```

(Note: `tools/spike_server.js` becomes vestigial after Phase 0 — it's not used by the real proxy or the mock proxy. Leave it committed as a Phase 0 artifact, or delete in a later cleanup task. Not load-bearing.)

### Task 0.3: Lock the JSON schema [Joint]

Based on the real API output observed in Task 0.1, finalize the schema. Both people review and lock it.

**Files:**
- Create: `schema.md`
- Create: `tools/sample_response.json`
- Create: `tools/sample_tweets.txt`

- [ ] **Step 1: Write `schema.md`**

Create `schema.md`:

````markdown
# ClaimCheck JSON Schema

The proxy returns this shape from `POST /analyze`. The renderer in `extension/popup/render.js` consumes it. **Frozen after Phase 0** — changes require both people to align.

## Top-level fields (allowlist)

Exactly these six top-level keys. The renderer drops anything else.

| Field | Type | Description |
|---|---|---|
| `tldr` | string | One neutral sentence restating the post |
| `claims` | array of Claim | Distinct claims extracted from the post |
| `evidence` | array of Evidence | One entry per factual or mixed claim |
| `steelman` | array of Steelman | One entry per opinion or mixed claim |
| `couldnt_verify` | array of string | Explicit limitations |
| `how_to_verify` | array of string | Validation strategies for the user |

## Claim

```json
{
  "id": "c1",
  "text": "the claim, paraphrased or quoted",
  "type": "factual" | "opinion" | "mixed"
}
```

## Evidence

```json
{
  "claim_id": "c1",
  "sources": [
    { "url": "https://example.com/article", "title": "Article title", "summary": "what the source says" }
  ],
  "synthesis": "descriptive read on what the sources say re. the claim — NOT a verdict",
  "linked_source_check": null | {
    "url": "https://...",
    "represented_accurately": "yes" | "no" | "partial",
    "explanation": "..."
  }
}
```

`linked_source_check` is non-null only when the post itself contains a link to a source.

## Steelman

```json
{
  "claim_id": "c2",
  "counter": "thoughtful disagreement (only if claim isn't factually wrong); empty string if redirected",
  "factually_wrong_redirect": null | "non-null only when claim is factually wrong; user routed to evidence section instead"
}
```

If `factually_wrong_redirect` is non-null, `counter` is the empty string.

## Forbidden fields (validator strips these)

The proxy MUST strip any output containing these keys, anywhere in the tree:

- `partisan_lean`, `political_lean`, `bias_score`, `bias_rating`
- `verdict_label`, `verdict`, `truth_score`
- `is_extreme`, `extremism_score`, `radicalism_score`

This list is enforced in `proxy/validator.js`.
````

- [ ] **Step 2: Write the sample response fixture**

Create `tools/sample_response.json` with a realistic example matching the schema. Use a tweet-like input as the imagined source.

```json
{
  "tldr": "The post claims that 80% of last winter's flu hospitalizations were among unvaccinated people, and argues this proves the flu shot's effectiveness.",
  "claims": [
    {
      "id": "c1",
      "text": "80% of last winter's flu hospitalizations were among people who hadn't gotten the flu shot.",
      "type": "factual"
    },
    {
      "id": "c2",
      "text": "This proves the flu shot's effectiveness.",
      "type": "opinion"
    }
  ],
  "evidence": [
    {
      "claim_id": "c1",
      "sources": [
        {
          "url": "https://www.cdc.gov/flu/spotlights/example.htm",
          "title": "CDC FluView: 2024-25 Season Update",
          "summary": "CDC reports the share of flu hospitalizations among unvaccinated adults during the 2024-25 season."
        }
      ],
      "synthesis": "CDC's FluView reports a hospitalization breakdown by vaccination status. The 80% figure is in the right ballpark for some demographic slices but not the headline number — the post may be selecting a specific cohort.",
      "linked_source_check": null
    }
  ],
  "steelman": [
    {
      "claim_id": "c2",
      "counter": "Hospitalization rates by vaccination status alone don't establish causal effectiveness — they reflect a mix of vaccine effect, behavioral differences between vaccinated and unvaccinated populations, and exposure variation. A thoughtful critic would point to randomized or test-negative-design studies, not raw hospitalization shares.",
      "factually_wrong_redirect": null
    }
  ],
  "couldnt_verify": [
    "I couldn't find the exact source the post is citing — the 80% figure could be from a specific age cohort or risk group, not the overall CDC headline.",
    "Establishing 'effectiveness' requires study design beyond observational hospitalization shares; I don't have access to the underlying data."
  ],
  "how_to_verify": [
    "Check CDC FluView (cdc.gov/flu/weekly) for the exact metric the post is citing — note the cohort and time range.",
    "For effectiveness specifically, look for test-negative-design studies in journals like NEJM or CDC's MMWR — single statistics rarely prove causal claims.",
    "Watch for cohort-narrowing in citations: 'X% of hospitalizations' may exclude age groups, regions, or seasons that change the picture."
  ]
}
```

- [ ] **Step 3: Write `tools/sample_tweets.txt`**

A handful of input texts to test against. One per blank-line-separated block.

```
Breaking: New CDC report shows 80% of seasonal flu hospitalizations last winter were among people who hadn't gotten the flu shot.

A new study confirms that homework has no measurable effect on academic performance for elementary school students. Why are we still assigning it?

The Fed should cut rates immediately. Inflation is dead and unemployment is climbing. Anyone arguing otherwise hasn't looked at the data.
```

- [ ] **Step 4: Both people review the fixture and confirm**

Both: open `tools/sample_response.json` and `schema.md` side-by-side. Confirm:
- All 6 top-level keys present
- Field types match the schema
- A `factually_wrong_redirect` example is documented (even if null in the fixture, the schema explains it)
- Validator forbidden-field list is exhaustive enough

If any concerns, edit before commit. After commit, the fixture is FROZEN.

- [ ] **Step 5: Commit**

```bash
cd /Users/zefan/Claude/claim_check
git add schema.md tools/sample_response.json tools/sample_tweets.txt
git commit -m "lock JSON schema and fixtures (Phase 0)"
```

### Task 0.4: Push and split to two machines (joint)

End of Phase 0. The Phase 0 committer pushes; the second teammate clones to their machine to start Phase 1B.

**Files:** none new — pushing existing.

- [ ] **Step 1 (if not linked yet): Add the GitHub remote**

On the Phase 0 machine:

```bash
cd /Users/zefan/Claude/claim_check
git remote add origin <REPO_URL>
git branch -M main
```

- [ ] **Step 2: Push everything from Phase 0**

```bash
git push -u origin main
```

**Expected:** all commits from Tasks 0.1–0.3 on remote `main`.

- [ ] **Step 3: Second teammate clones the repo on their machine**

```bash
git clone <REPO_URL> ~/claim_check
cd ~/claim_check
ls
```

**Expected:** scaffold present including `proxy/`, `extension/`, `tools/`, `schema.md`, `CLAUDE.md`, `docs/`.

- [ ] **Step 4: Both teammates confirm starting points**

- Person 1 stays on the Phase 0 machine (already has everything). Begins Phase 1A.
- Person 2 reads `docs/superpowers/specs/2026-05-09-claim-check-design.md`, `docs/claude-pitfalls.md`, and Phase 1B of this plan on the cloned machine. Runs `cd proxy && npm install` to get dependencies. Runs `claude login` if not already authenticated.

From this point on, both machines push to `main` independently. File ownership prevents conflicts.

---

## Phase 1A — Extension (Person 1)

Person 1 develops entirely against `tools/mock_proxy.js`, which serves the frozen `tools/sample_response.json`. Zero dependency on Person 2's real proxy until Phase 2 integration.

### Task 1A.1: Real manifest.json (replacing the spike)

**Files:**
- Modify: `extension/manifest.json`

- [ ] **Step 1: Replace the spike manifest with the real one**

Replace `extension/manifest.json` with:

```json
{
  "manifest_version": 3,
  "name": "ClaimCheck",
  "version": "0.1.0",
  "description": "Critical-thinking aid for social media posts. Pastes in, exposes patterns, lets you judge.",
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "ClaimCheck"
  },
  "background": {
    "service_worker": "background/service_worker.js",
    "type": "module"
  },
  "host_permissions": [
    "http://localhost:3001/*",
    "http://localhost:9999/*"
  ]
}
```

(Keep `9999` in `host_permissions` — that's the mock proxy port used during 1A. The real proxy at `3001` is for Phase 2.)

- [ ] **Step 2: Reload the extension in Chrome**

`chrome://extensions` → click reload icon on ClaimCheck. Confirm no errors.

- [ ] **Step 3: Commit**

```bash
git add extension/manifest.json
git commit -m "extension: real manifest.json with service worker"
```

### Task 1A.2: Popup HTML and CSS

**Files:**
- Modify: `extension/popup/popup.html`
- Create: `extension/popup/popup.css`

- [ ] **Step 1: Replace the spike popup.html**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="popup.css" />
    <title>ClaimCheck</title>
  </head>
  <body>
    <header>
      <h1>ClaimCheck</h1>
      <p class="tagline">A footnote on what you're reading.</p>
    </header>

    <form id="form">
      <textarea id="input" placeholder="Paste a tweet URL or the post text" rows="4"></textarea>
      <button id="submit" type="submit">Analyze</button>
    </form>

    <div id="status" class="status hidden"></div>

    <main id="result" class="hidden">
      <section class="card" data-key="tldr">
        <h2>TL;DR</h2>
        <div class="content"></div>
      </section>
      <section class="card" data-key="claims">
        <h2>What it's claiming</h2>
        <div class="content"></div>
      </section>
      <section class="card" data-key="evidence">
        <h2>What we found</h2>
        <div class="content"></div>
      </section>
      <section class="card" data-key="steelman">
        <h2>Strongest disagreement</h2>
        <div class="content"></div>
      </section>
      <section class="card" data-key="couldnt_verify">
        <h2>What we couldn't verify</h2>
        <div class="content"></div>
      </section>
      <section class="card" data-key="how_to_verify">
        <h2>How you'd verify yourself</h2>
        <div class="content"></div>
      </section>
    </main>

    <script src="render.js" type="module"></script>
    <script src="popup.js" type="module"></script>
  </body>
</html>
```

- [ ] **Step 2: Create popup.css**

```css
body {
  font-family: system-ui, -apple-system, sans-serif;
  width: 380px;
  max-height: 600px;
  margin: 0;
  padding: 14px;
  font-size: 13px;
  color: #1a1a1a;
}

header h1 {
  margin: 0 0 2px 0;
  font-size: 18px;
}

.tagline {
  margin: 0 0 12px 0;
  color: #666;
  font-size: 11px;
}

#form { margin-bottom: 12px; }

#input {
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 12px;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  resize: vertical;
}

#submit {
  margin-top: 8px;
  padding: 8px 14px;
  background: #1a1a1a;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

#submit:disabled { opacity: 0.5; cursor: wait; }

.status {
  padding: 10px;
  background: #f4f4f4;
  border-radius: 4px;
  font-size: 12px;
  margin-bottom: 8px;
}

.status.error { background: #fde2e2; color: #8a1a1a; }

.hidden { display: none; }

.card {
  margin-bottom: 14px;
  padding: 10px;
  background: #fafafa;
  border-radius: 4px;
}

.card h2 {
  margin: 0 0 6px 0;
  font-size: 13px;
  color: #333;
}

.card .content {
  font-size: 12px;
  line-height: 1.4;
}

.card .empty { color: #999; font-style: italic; }

.claim-tag {
  display: inline-block;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  margin-right: 4px;
  text-transform: uppercase;
  font-weight: 600;
}

.claim-tag.factual { background: #e0f0e0; color: #225522; }
.claim-tag.opinion { background: #fff0d8; color: #8a5a00; }
.claim-tag.mixed { background: #e8e0f8; color: #4a2080; }

.source-link { display: block; font-size: 11px; margin: 2px 0; }
.source-link a { color: #1a4a8a; text-decoration: none; }
.source-link a:hover { text-decoration: underline; }
```

- [ ] **Step 3: Reload extension and open popup**

`chrome://extensions` → reload. Click the icon. **Expected:** popup shows the form with the textarea and Analyze button. Result cards are hidden until rendered.

- [ ] **Step 4: Commit**

```bash
git add extension/popup/popup.html extension/popup/popup.css
git commit -m "extension: popup HTML + CSS"
```

### Task 1A.3: Mock proxy

Person 1 develops against this. Returns the frozen sample response on `POST /analyze`.

**Files:**
- Create: `tools/mock_proxy.js`

- [ ] **Step 1: Write the mock proxy**

```javascript
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, 'sample_response.json');

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/analyze') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      console.log('mock_proxy: received', body.slice(0, 80) + '...');
      // Simulate latency to test the popup loading state
      await new Promise(r => setTimeout(r, 800));
      const fixture = await fs.readFile(FIXTURE_PATH, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fixture);
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

const PORT = 9999;
server.listen(PORT, () => {
  console.log(`mock_proxy listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Run it and curl**

```bash
node tools/mock_proxy.js
```

In another terminal:

```bash
curl -s -X POST http://localhost:9999/analyze -H "Content-Type: application/json" -d '{"input":"hello"}' | head -40
```

**Expected:** the JSON content of `tools/sample_response.json`.

- [ ] **Step 3: Commit**

```bash
git add tools/mock_proxy.js
git commit -m "mock proxy serving sample_response.json on localhost:9999"
```

### Task 1A.4: Background service worker

Owns the `fetch` to the proxy. The popup `sendMessage`s the worker; worker fetches and responds. Worker also caches the latest result in `chrome.storage.session` so a popup that closes mid-analysis can recover on reopen.

**Files:**
- Create: `extension/background/service_worker.js`

- [ ] **Step 1: Write the service worker**

```javascript
const PROXY_URL = 'http://localhost:9999/analyze'; // TODO Phase 2: switch to 3001

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'analyze') {
    handleAnalyze(msg.input)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true; // keep channel open for async response
  }

  if (msg.type === 'getCachedResult') {
    chrome.storage.session.get('lastResult').then(({ lastResult }) => {
      sendResponse(lastResult || null);
    });
    return true;
  }
});

async function handleAnalyze(input) {
  const requestedAt = Date.now();
  let res;
  try {
    res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input })
    });
  } catch (netErr) {
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
  const data = await res.json();
  // Minimal shape check — guards against the proxy returning the wrong shape
  // (e.g. a health-check response leaking through). Renderer is also defensive,
  // but failing loudly here gives a clearer error than 6 cards of "—".
  if (!data || typeof data !== 'object' || !Array.isArray(data.claims)) {
    throw new Error('Proxy returned unexpected response shape (missing claims array).');
  }
  // Cache so popup-reopen can recover
  await chrome.storage.session.set({
    lastResult: { data, requestedAt, completedAt: Date.now(), input }
  });
  return data;
}
```

- [ ] **Step 2: Reload extension; check service-worker registers**

`chrome://extensions` → reload → click "Service worker" link under ClaimCheck. **Expected:** DevTools opens to the worker; no errors.

- [ ] **Step 3: Commit**

```bash
git add extension/background/service_worker.js
git commit -m "extension: background service worker calls proxy + caches result"
```

### Task 1A.5: Popup wiring (popup.js)

Submits the form, talks to the service worker, hands the result to the renderer. Handles loading, error, and recovery-on-reopen.

**Files:**
- Create: `extension/popup/popup.js`

- [ ] **Step 1: Write popup.js**

```javascript
import { render, clear } from './render.js';

const form = document.getElementById('form');
const input = document.getElementById('input');
const submitBtn = document.getElementById('submit');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

// On open, check for a cached result (handles popup-closed-mid-analysis case)
(async () => {
  const cached = await chrome.runtime.sendMessage({ type: 'getCachedResult' });
  if (cached && Date.now() - cached.completedAt < 5 * 60 * 1000) {
    input.value = cached.input || '';
    showResult(cached.data);
  }
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  setLoading(true);
  clear();
  resultEl.classList.add('hidden');

  const response = await chrome.runtime.sendMessage({ type: 'analyze', input: text });

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
    statusEl.textContent = 'Analyzing… web search may take 20–30 seconds.';
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
  render(data);
  resultEl.classList.remove('hidden');
}
```

- [ ] **Step 2: Reload, click icon, paste sample text, click Analyze**

Make sure `tools/mock_proxy.js` is running. Paste a tweet from `tools/sample_tweets.txt`. Click Analyze.

**Expected:** loading message appears for ~800ms, then errors out (because render.js is empty / not yet implemented). The fetch to mock proxy succeeded — that's what we're verifying. Network tab should show the POST.

- [ ] **Step 3: Commit**

```bash
git add extension/popup/popup.js
git commit -m "extension: popup form + service worker handoff"
```

### Task 1A.6: Renderer (render.js) with defensive parsing

Renders the 6 sections. Type-checks every field. Whitelist of accepted top-level keys. Empty fields render "—".

**Files:**
- Create: `extension/popup/render.js`

- [ ] **Step 1: Write render.js**

```javascript
const ALLOWED_KEYS = ['tldr', 'claims', 'evidence', 'steelman', 'couldnt_verify', 'how_to_verify'];

export function clear() {
  for (const key of ALLOWED_KEYS) {
    const card = document.querySelector(`.card[data-key="${key}"] .content`);
    if (card) card.innerHTML = '';
  }
}

export function render(raw) {
  const data = sanitize(raw);

  setText('tldr', data.tldr);
  setClaims('claims', data.claims);
  setEvidence('evidence', data.evidence, data.claims);
  setSteelman('steelman', data.steelman, data.claims);
  setStringList('couldnt_verify', data.couldnt_verify);
  setStringList('how_to_verify', data.how_to_verify);
}

function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return blank();
  const out = blank();
  if (typeof raw.tldr === 'string') out.tldr = raw.tldr;
  if (Array.isArray(raw.claims)) out.claims = raw.claims;
  if (Array.isArray(raw.evidence)) out.evidence = raw.evidence;
  if (Array.isArray(raw.steelman)) out.steelman = raw.steelman;
  if (Array.isArray(raw.couldnt_verify)) out.couldnt_verify = raw.couldnt_verify.filter(s => typeof s === 'string');
  if (Array.isArray(raw.how_to_verify)) out.how_to_verify = raw.how_to_verify.filter(s => typeof s === 'string');
  // Anything else is dropped (allowlist).
  const extras = Object.keys(raw).filter(k => !ALLOWED_KEYS.includes(k));
  if (extras.length) console.warn('ClaimCheck: dropped unexpected keys:', extras);
  return out;
}

function blank() {
  return { tldr: '', claims: [], evidence: [], steelman: [], couldnt_verify: [], how_to_verify: [] };
}

function content(key) {
  return document.querySelector(`.card[data-key="${key}"] .content`);
}

function setText(key, text) {
  const el = content(key);
  if (!text) {
    el.innerHTML = '<span class="empty">—</span>';
    return;
  }
  el.textContent = text;
}

function setStringList(key, items) {
  const el = content(key);
  if (!items.length) {
    el.innerHTML = '<span class="empty">—</span>';
    return;
  }
  const ul = document.createElement('ul');
  ul.style.margin = '0';
  ul.style.paddingLeft = '18px';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.appendChild(li);
  }
  el.innerHTML = '';
  el.appendChild(ul);
}

function setClaims(key, claims) {
  const el = content(key);
  if (!claims.length) {
    el.innerHTML = '<span class="empty">—</span>';
    return;
  }
  el.innerHTML = '';
  for (const c of claims) {
    const div = document.createElement('div');
    div.style.marginBottom = '6px';
    const tag = document.createElement('span');
    tag.className = `claim-tag ${typeOf(c.type)}`;
    tag.textContent = typeOf(c.type);
    div.appendChild(tag);
    const text = document.createElement('span');
    text.textContent = typeof c.text === 'string' ? c.text : '(missing claim text)';
    div.appendChild(text);
    el.appendChild(div);
  }
}

function typeOf(t) {
  return ['factual', 'opinion', 'mixed'].includes(t) ? t : 'mixed';
}

function setEvidence(key, evidence, claims) {
  const el = content(key);
  if (!evidence.length) {
    el.innerHTML = '<span class="empty">—</span>';
    return;
  }
  el.innerHTML = '';
  for (const e of evidence) {
    const block = document.createElement('div');
    block.style.marginBottom = '10px';

    const claim = claims.find(c => c.id === e.claim_id);
    if (claim) {
      const cite = document.createElement('div');
      cite.style.fontSize = '11px';
      cite.style.color = '#666';
      cite.textContent = `Claim: ${claim.text}`;
      block.appendChild(cite);
    }

    if (typeof e.synthesis === 'string') {
      const syn = document.createElement('div');
      syn.style.margin = '4px 0';
      syn.textContent = e.synthesis;
      block.appendChild(syn);
    }

    if (Array.isArray(e.sources) && e.sources.length) {
      for (const s of e.sources) {
        const link = document.createElement('div');
        link.className = 'source-link';
        if (typeof s.url === 'string' && typeof s.title === 'string') {
          link.innerHTML = `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>`;
          if (typeof s.summary === 'string') {
            const sum = document.createElement('div');
            sum.style.fontSize = '11px';
            sum.style.color = '#555';
            sum.textContent = s.summary;
            link.appendChild(sum);
          }
        }
        block.appendChild(link);
      }
    }

    if (e.linked_source_check && typeof e.linked_source_check === 'object') {
      const lsc = document.createElement('div');
      lsc.style.marginTop = '6px';
      lsc.style.padding = '6px';
      lsc.style.background = '#fff8e0';
      lsc.style.borderRadius = '3px';
      lsc.style.fontSize = '11px';
      const accuracy = e.linked_source_check.represented_accurately;
      const explanation = e.linked_source_check.explanation;
      lsc.innerHTML = `<strong>Linked source check:</strong> ${escapeHtml(accuracy || '?')} — ${escapeHtml(explanation || '')}`;
      block.appendChild(lsc);
    }

    el.appendChild(block);
  }
}

function setSteelman(key, steelman, claims) {
  const el = content(key);
  if (!steelman.length) {
    el.innerHTML = '<span class="empty">—</span>';
    return;
  }
  el.innerHTML = '';
  for (const s of steelman) {
    const block = document.createElement('div');
    block.style.marginBottom = '10px';

    const claim = claims.find(c => c.id === s.claim_id);
    if (claim) {
      const cite = document.createElement('div');
      cite.style.fontSize = '11px';
      cite.style.color = '#666';
      cite.textContent = `Claim: ${claim.text}`;
      block.appendChild(cite);
    }

    if (typeof s.factually_wrong_redirect === 'string' && s.factually_wrong_redirect) {
      const redirect = document.createElement('div');
      redirect.style.padding = '6px';
      redirect.style.background = '#fde0e0';
      redirect.style.borderRadius = '3px';
      redirect.textContent = s.factually_wrong_redirect;
      block.appendChild(redirect);
    } else if (typeof s.counter === 'string') {
      const counter = document.createElement('div');
      counter.style.margin = '4px 0';
      counter.textContent = s.counter;
      block.appendChild(counter);
    }

    el.appendChild(block);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

- [ ] **Step 2: Reload, paste a sample tweet, click Analyze**

Mock proxy must be running. Paste the first tweet from `sample_tweets.txt`. Click Analyze.

**Expected:** ~800 ms loading, then all 6 cards populate from the fixture. Visual scan: TL;DR shows the neutral restatement; Claims shows tagged claims; Evidence shows linked sources; Strongest disagreement shows the steel-man; What we couldn't verify and How you'd verify yourself show bulleted lists.

- [ ] **Step 3: Test defensive parsing**

Edit `tools/sample_response.json` to deliberately introduce broken fields:
- Set `claims` to `null`
- Add an unexpected top-level key `partisan_lean: 0.6`

Reload, click Analyze. **Expected:** popup still renders without crashing. `claims` card shows "—". Console shows warning about dropped `partisan_lean`.

Revert the fixture afterward (`git checkout tools/sample_response.json`).

- [ ] **Step 4: Commit**

```bash
git add extension/popup/render.js
git commit -m "extension: defensive 6-section renderer"
```

### Task 1A.7 [stretch — gated]: Active-tab auto-fill

**Skip unless 1A.1–1A.6 are committed and an end-to-end mock-proxy run renders all 6 sections successfully.** Stretch goals are for surplus time, not work-in-progress.

If the active tab is a tweet permalink (`x.com/.../status/...` or `twitter.com/.../status/...`), pre-fill the input.

**Files:**
- Modify: `extension/popup/popup.js`
- Modify: `extension/manifest.json`

- [ ] **Step 1: Add `activeTab` permission to the manifest**

Edit `extension/manifest.json` to add:

```json
{
  "permissions": ["activeTab"]
}
```

- [ ] **Step 2: Read active tab URL on popup open**

Modify `popup.js`. After the existing IIFE that checks cached result, add:

```javascript
(async () => {
  if (input.value) return; // already filled by cache
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  if (/^https?:\/\/(www\.)?(x|twitter)\.com\/[^/]+\/status\/\d+/.test(tab.url)) {
    input.value = tab.url;
  }
})();
```

- [ ] **Step 3: Test**

Open a real tweet permalink. Click ClaimCheck icon. **Expected:** input pre-filled with the URL.

- [ ] **Step 4: Commit**

```bash
git add extension/popup/popup.js extension/manifest.json
git commit -m "extension: stretch — auto-fill active tweet permalink"
```

---

## Phase 1B — Proxy (Person 2)

Person 2 develops the real proxy in parallel with Phase 1A. The proxy is responsible for: OAuth-authenticated Claude calls, prompt construction, no-verdict validation, schema enforcement, in-memory result cache, and HTTP server with CORS.

**Note on SDK API:** the code samples below use a best-guess Claude Agent SDK API. Adapt based on what was confirmed in Task 0.1.

### Task 1B.1: Initialize the proxy

`proxy/package.json`, `proxy/.gitignore`, install deps. (Some of this was done in Task 0.1 — finish the rest.)

**Files:**
- Modify: `proxy/package.json`

- [ ] **Step 1: Edit package.json**

```json
{
  "name": "claim-check-proxy",
  "version": "0.1.0",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test-prompt": "node test_prompt.js"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^x.y.z"
  },
  "engines": {
    "node": ">=20"
  }
}
```

Replace `^x.y.z` with the actual installed version (`npm ls @anthropic-ai/claude-agent-sdk`).

- [ ] **Step 2: Commit**

```bash
git add proxy/package.json
git commit -m "proxy: package.json with start + test-prompt scripts"
```

### Task 1B.2: System prompt and prompt builder

**Files:**
- Create: `proxy/prompt.js`

- [ ] **Step 1: Write prompt.js**

```javascript
export const SYSTEM_PROMPT = `You are ClaimCheck. You help users think critically about social-media posts (typically tweets/X posts). You DO NOT render verdicts.

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
8. BUDGET: extract at most 8 distinct claims. Cite at most 3 sources per claim. If the post has more potential claims, pick the most load-bearing ones.

If the input contains a URL, use web_search to fetch it and check whether the post represents it accurately (set linked_source_check accordingly).`;

export function buildUserPrompt(input) {
  return `Analyze the following social-media post. Return JSON matching the schema above.

POST:
${input}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add proxy/prompt.js
git commit -m "proxy: system prompt with no-verdict + anti-false-balance rules"
```

### Task 1B.3: analyze() — Claude Agent SDK call

**Files:**
- Create: `proxy/analyze.js`
- Delete: `proxy/spike.js` (was a Phase 0 throwaway)

- [ ] **Step 1: Write analyze.js**

SDK invocation pattern below was confirmed at kickoff (Task 0.1 spike):
- Package: `@anthropic-ai/claude-agent-sdk`
- Tool name: `WebSearch` (PascalCase)
- Pre-grant via `allowedTools: ['WebSearch']` (otherwise SDK gates per-call and silently fails in headless mode)
- Final assistant text appears in the `result` event's `.result` field

```javascript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import { validate } from './validator.js';

const REQUEST_TIMEOUT_MS = 60_000;

export async function analyze(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('input must be a non-empty string');
  }
  if (input.length > 4000) {
    input = input.slice(0, 4000);
  }

  let timeoutId;
  return Promise.race([
    runAnalysis(input).finally(() => clearTimeout(timeoutId)),
    new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`analyze timed out after ${REQUEST_TIMEOUT_MS}ms`)),
        REQUEST_TIMEOUT_MS
      );
    }),
  ]);
}

async function runAnalysis(input) {
  const prompt = buildUserPrompt(input);

  const events = [];
  for await (const event of query({
    prompt,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      model: 'claude-opus-4-7',
      maxTokens: 4096,
      // Pre-allow WebSearch so the SDK doesn't gate per-call.
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
  // Confirmed at kickoff: the SDK emits a final `result` event with the assistant's
  // last text in `.result`. Fall back to scanning assistant message text blocks if
  // the result event is missing (e.g. on early termination).
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
  // Be lenient: strip markdown fences if Claude added them anyway
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

- [ ] **Step 2: Delete the spike**

```bash
rm proxy/spike.js
```

- [ ] **Step 3: Commit**

```bash
git add proxy/analyze.js proxy/spike.js
git commit -m "proxy: analyze() — SDK call + JSON extraction"
```

### Task 1B.4: Validator (TDD — this is load-bearing)

The no-verdict gate. Strips forbidden field names anywhere in the tree. Enforces top-level allowlist.

**Files:**
- Create: `proxy/validator.js`
- Create: `proxy/validator.test.js`

- [ ] **Step 1: Install a tiny test runner and verify ESM works**

```bash
cd proxy
npm install --save-dev mocha
```

Add to `proxy/package.json` `scripts`:

```json
"test": "mocha validator.test.js"
```

ESM sanity check — write a placeholder `validator.test.js` and run it once before writing real tests:

```javascript
// proxy/validator.test.js (temporary)
import { describe, it } from 'mocha';
import { strict as assert } from 'node:assert';
describe('sanity', () => {
  it('mocha + ESM works', () => assert.equal(1, 1));
});
```

Run:

```bash
npm test
```

**Expected:** "1 passing". If you get "Cannot use import statement outside a module" or similar, mocha needs ESM config — create `proxy/.mocharc.cjs`:

```javascript
module.exports = { spec: ['*.test.js'] };
```

…and confirm `package.json` has `"type": "module"`. Re-run.

- [ ] **Step 2: Write the failing test**

Create `proxy/validator.test.js`:

```javascript
import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { validate, FORBIDDEN_KEYS } from './validator.js';

describe('validate()', () => {
  it('keeps the 6 allowlisted top-level keys', () => {
    const input = {
      tldr: 'x', claims: [], evidence: [], steelman: [],
      couldnt_verify: [], how_to_verify: []
    };
    const out = validate(input);
    for (const k of ['tldr', 'claims', 'evidence', 'steelman', 'couldnt_verify', 'how_to_verify']) {
      assert.ok(k in out, `missing ${k}`);
    }
  });

  it('drops unexpected top-level keys', () => {
    const input = {
      tldr: 'x', claims: [], evidence: [], steelman: [],
      couldnt_verify: [], how_to_verify: [],
      partisan_lean: 0.7,
      verdict_label: 'biased',
      surprise_field: 'whatever'
    };
    const out = validate(input);
    assert.equal('partisan_lean' in out, false);
    assert.equal('verdict_label' in out, false);
    assert.equal('surprise_field' in out, false);
  });

  it('strips forbidden keys nested anywhere', () => {
    const input = {
      tldr: 'x', claims: [{ id: 'c1', text: 't', type: 'factual', bias_score: 9 }],
      evidence: [{ claim_id: 'c1', sources: [{ url: 'u', title: 't', political_lean: 1 }], synthesis: 's' }],
      steelman: [], couldnt_verify: [], how_to_verify: []
    };
    const out = validate(input);
    assert.equal('bias_score' in out.claims[0], false);
    assert.equal('political_lean' in out.evidence[0].sources[0], false);
  });

  it('throws if input is missing required fields', () => {
    assert.throws(() => validate({ tldr: 'x' }), /missing required field/i);
  });

  it('exports the forbidden keys list', () => {
    assert.ok(Array.isArray(FORBIDDEN_KEYS));
    assert.ok(FORBIDDEN_KEYS.includes('partisan_lean'));
    assert.ok(FORBIDDEN_KEYS.includes('verdict_label'));
  });
});
```

- [ ] **Step 3: Run the test, see it fail**

```bash
cd proxy
npm test
```

**Expected:** "Cannot find module './validator.js'" or similar import error.

- [ ] **Step 4: Implement validator.js**

```javascript
export const ALLOWED_TOP_LEVEL = [
  'tldr', 'claims', 'evidence', 'steelman', 'couldnt_verify', 'how_to_verify'
];

export const FORBIDDEN_KEYS = [
  'partisan_lean', 'political_lean', 'bias_score', 'bias_rating',
  'verdict_label', 'verdict', 'truth_score',
  'is_extreme', 'extremism_score', 'radicalism_score',
];

export function validate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('validator: input must be a non-null object');
  }

  const required = ['tldr', 'claims', 'evidence', 'steelman', 'couldnt_verify', 'how_to_verify'];
  for (const k of required) {
    if (!(k in raw)) throw new Error(`validator: missing required field "${k}"`);
  }

  // Build the allowlisted output; deep-strip forbidden keys.
  const out = {};
  for (const k of ALLOWED_TOP_LEVEL) {
    out[k] = stripForbidden(raw[k]);
  }
  return out;
}

function stripForbidden(value) {
  if (Array.isArray(value)) {
    return value.map(stripForbidden);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.includes(k)) continue; // strip
      out[k] = stripForbidden(v);
    }
    return out;
  }
  return value;
}
```

- [ ] **Step 5: Run the test, see it pass**

```bash
npm test
```

**Expected:** all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/zefan/Claude/claim_check
git add proxy/validator.js proxy/validator.test.js proxy/package.json proxy/package-lock.json
git commit -m "proxy: validator (no-verdict gate + schema allowlist) with tests"
```

### Task 1B.5: HTTP server with cache and CORS

**Files:**
- Create: `proxy/server.js`

- [ ] **Step 1: Write server.js**

```javascript
import http from 'node:http';
import crypto from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { analyze } from './analyze.js';

const PORT = 3001;
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // hash -> { data, completedAt }

const server = http.createServer(async (req, res) => {
  // CORS for chrome extensions and dev tools
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

    const hash = crypto.createHash('sha256').update(input).digest('hex');
    const cached = cache.get(hash);
    if (cached && Date.now() - cached.completedAt < CACHE_TTL_MS) {
      console.log(`[cache hit] ${hash.slice(0, 8)}`);
      return ok(res, cached.data);
    }

    console.log(`[analyze] ${hash.slice(0, 8)} ${input.slice(0, 60)}...`);
    try {
      const data = await analyze(input);
      cache.set(hash, { data, completedAt: Date.now() });
      ok(res, data);
    } catch (err) {
      console.error(`[analyze error] ${err.message}`);
      // Detect auth-style errors so the extension can show a friendlier message
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

// Startup smoke: verify the SDK + OAuth path before accepting traffic.
// Lightweight SDK ping — no web_search, tiny output. Fails fast if auth is stale.
async function startupCheck() {
  console.log('startup: pinging Claude to verify SDK + OAuth...');
  try {
    let count = 0;
    for await (const _ of query({
      prompt: 'Reply with the single word: ok',
      options: { model: 'claude-opus-4-7', maxTokens: 16 },
    })) {
      count++;
    }
    console.log(`startup: OK (${count} events)`);
  } catch (err) {
    console.error('startup: FAILED —', err.message);
    console.error('Hint: run `claude login` and try again, or check the SDK install.');
    process.exit(1);
  }
}

// Run startup check BEFORE binding the port so a failed check doesn't leave a
// half-bound port behind on force-quit.
await startupCheck();

server.listen(PORT, () => {
  console.log(`ClaimCheck proxy listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Start the server**

```bash
cd proxy
npm start
```

**Expected:** "ClaimCheck proxy listening on http://localhost:3001"

- [ ] **Step 3: Health check**

```bash
curl -s http://localhost:3001/health
```

**Expected:** `{"ok":true}`

- [ ] **Step 4: Smoke test the analyze endpoint**

```bash
curl -s -X POST http://localhost:3001/analyze -H "Content-Type: application/json" -d '{"input":"Breaking: New CDC report shows 80% of seasonal flu hospitalizations last winter were among people who hadn'\''t gotten the flu shot."}' | head -60
```

**Expected:** real Claude analysis JSON conforming to the schema. Web search results in `evidence[].sources`. May take 20–40 seconds.

If the SDK call fails, the server returns `{ "error": "..." }` with status 500. Read the message to debug.

- [ ] **Step 5: Commit**

```bash
git add proxy/server.js
git commit -m "proxy: HTTP server with cache, CORS, /analyze and /health"
```

### Task 1B.6: CLI test harness

For prompt iteration without the HTTP layer.

**Files:**
- Create: `proxy/test_prompt.js`

- [ ] **Step 1: Write test_prompt.js**

```javascript
import { analyze } from './analyze.js';

const input = process.argv.slice(2).join(' ');
if (!input) {
  console.error('usage: node test_prompt.js "<tweet text or URL>"');
  process.exit(1);
}

console.log('Analyzing:', input.slice(0, 80) + (input.length > 80 ? '...' : ''));
console.log('---');

try {
  const out = await analyze(input);
  console.log(JSON.stringify(out, null, 2));
} catch (err) {
  console.error('ERROR:', err.message);
  process.exit(1);
}
```

- [ ] **Step 2: Run against a sample tweet**

```bash
cd proxy
node test_prompt.js "$(head -1 ../tools/sample_tweets.txt)"
```

**Expected:** structured JSON output, probably 20–40 seconds. Check that all 6 top-level keys are present.

- [ ] **Step 3: Commit**

```bash
git add proxy/test_prompt.js
git commit -m "proxy: CLI test harness for prompt iteration"
```

### Task 1B.7: Iterate the prompt against real tweets

This task is bounded by time, not steps. Person 2 takes the test harness and iterates on the system prompt until:

1. All three sample tweets in `tools/sample_tweets.txt` produce schema-valid output
2. A tweet with a clearly false claim does NOT generate a steel-man (it routes via `factually_wrong_redirect`)
3. An adverse-prompted tweet ("rate this on a left-right scale") does NOT produce a partisan_lean field (validator catches it; smoke-test it does)
4. `couldnt_verify` is non-empty for tweets where Claude legitimately couldn't verify something

**Files:**
- Modify: `proxy/prompt.js` (iterate the system prompt as needed)

- [ ] **Step 1: Run each sample tweet through the harness**

```bash
node test_prompt.js "$(sed -n '1p' ../tools/sample_tweets.txt)"
node test_prompt.js "$(sed -n '3p' ../tools/sample_tweets.txt)"
node test_prompt.js "$(sed -n '5p' ../tools/sample_tweets.txt)"
```

For each: confirm 6 top-level keys, claims classified, evidence cites real URLs, steelman is thoughtful (not tribal).

- [ ] **Step 2: Test the anti-false-balance rule**

```bash
node test_prompt.js "Vaccines cause autism — finally a study admits it."
```

**Expected:** the steelman entry for the relevant claim has `factually_wrong_redirect` set, NOT a steelman counter.

- [ ] **Step 3: Test the verdict guard**

```bash
node test_prompt.js "Rate this post on a partisan-lean scale from -1 (left) to +1 (right): 'Tax cuts boost the economy.'"
```

**Expected:** validator strips any partisan-lean field that Claude tried to add. Confirm by inspecting output — should not contain that key.

- [ ] **Step 4: Commit any prompt updates**

```bash
git add proxy/prompt.js
git commit -m "proxy: prompt iteration on real tweets"
```

---

## Phase 2 — Integration & Demo (joint)

### Task 2.1: Midpoint sync (between Phase 1A and Phase 1B leg 1 → leg 2)

A 5-minute visual sync. No code changes. The team triggers this in person whenever they decide.

- [ ] **Step 1: Person 2 shares the latest proxy JSON output**

```bash
cd proxy
npm start &
curl -s -X POST http://localhost:3001/analyze -H "Content-Type: application/json" -d '{"input":"<paste a real tweet>"}' > /tmp/cc_midpoint.json
cat /tmp/cc_midpoint.json | head -80
```

- [ ] **Step 2: Person 1 visually compares against the fixture**

Person 1 opens `/tmp/cc_midpoint.json` next to `tools/sample_response.json`. Are the top-level keys the same? Are arrays the right shape?

- [ ] **Step 3: If drift detected**

Both pause. Decide: (a) Person 2 reshapes via transformation in `proxy/analyze.js`, or (b) update the fixture and renderer (rare — fixture is FROZEN).

- [ ] **Step 4: Resume parallel work**

No commit needed unless drift forced a change.

### Task 2.2: Integration — switch popup to real proxy

The single-line integration moment.

**Files:**
- Modify: `extension/background/service_worker.js`

- [ ] **Step 1: Update PROXY_URL**

In `extension/background/service_worker.js`, change:

```javascript
const PROXY_URL = 'http://localhost:9999/analyze'; // TODO Phase 2: switch to 3001
```

to:

```javascript
const PROXY_URL = 'http://localhost:3001/analyze';
```

- [ ] **Step 2: Start the real proxy**

```bash
cd proxy
npm start
```

- [ ] **Step 3: Reload the extension; paste a sample tweet; click Analyze**

`chrome://extensions` → reload. Click icon. Paste tweet. Analyze.

**Expected:** loading state shows for 20–40 seconds (real `web_search`); then 6 cards populate from real Claude output.

If it breaks, frozen-half rule applies (spec §10.4). Whichever side broke owns the fix.

- [ ] **Step 4: Commit**

```bash
git add extension/background/service_worker.js
git commit -m "integrate: extension calls real proxy on localhost:3001"
```

### Task 2.3: Real-post smoke test

Paste 3–5 real X posts into the running extension. Capture screenshots.

- [ ] **Step 1: Find 3–5 real X posts on x.com**

Mix of: a clear factual claim, a strong opinion, a tweet linking to an article (the 断章取义 case).

- [ ] **Step 2: Run each through the extension end-to-end**

For each: paste, click Analyze, observe. Note any rendering issues, any incorrect classifications, any hallucinated sources, any failures.

- [ ] **Step 3: Capture screenshots of working outputs**

Use Cmd-Shift-4 on macOS. Save to a `demo/` folder. Decide whether to commit:

- **Commit them:** judges can see the screenshots in the repo — useful, but binary churn.
- **Gitignore them:** keep them as local demo backups only. Add `demo/` to `.gitignore`:

```bash
echo "demo/" >> .gitignore
```

Either is fine. Pick one and stick with it.

```bash
mkdir -p demo
# paste screenshots into demo/
```

These are demo backups in case the live API is slow during judging.

- [ ] **Step 4: If issues found, fix the worst offender**

If Person 1 spots a render issue: Person 1 fixes. If Person 2 spots a prompt issue: Person 2 fixes. Frozen-half rule.

### Task 2.4: Cut decision (apply only if a section is broken)

If during the smoke test, one of the 6 sections is consistently broken or unhelpful, cut it.

**Cut order:** `steelman` → `how_to_verify`. NEVER cut `couldnt_verify`, `tldr`, `claims`, or `evidence`.

**Files:** depends on what's cut.

- [ ] **Step 1: Diagnose which section is broken**

Is it the prompt (LLM output is wrong) or the renderer (output is fine, render is wrong)?

- [ ] **Step 2 (option A): Cut from the renderer**

If Person 1 cuts a section: hide the relevant `<section data-key="X">` in `popup.html` (add `class="hidden"`), or remove it.

- [ ] **Step 2 (option B): Cut from the prompt**

If Person 2 cuts a section: edit `prompt.js` to omit that field from the schema instruction; the validator will accept missing fields if they're optional, or you'll need to relax the validator's required-fields check for that key.

- [ ] **Step 3: Re-test after cut**

End-to-end run. Confirm clean.

- [ ] **Step 4: Commit**

```bash
git add <changed files>
git commit -m "cut: <section_name> — output unreliable in real-post smoke"
```

### Task 2.5: Final shape sync

Last check before demo. Both compare actual proxy output against fixture.

- [ ] **Step 1: Run a fresh real-post analysis through the full extension**

Paste, click Analyze, capture the JSON via DevTools (popup → Inspect → Network → click `/analyze` → Response tab → copy).

- [ ] **Step 2: Save the captured JSON**

```bash
# paste into a file
pbpaste > /tmp/cc_final.json
```

- [ ] **Step 3: Diff top-level keys against the fixture**

Node one-liner (no `jq` dependency):

```bash
node -e "
const fs = require('fs');
const a = Object.keys(JSON.parse(fs.readFileSync('tools/sample_response.json'))).sort();
const b = Object.keys(JSON.parse(fs.readFileSync('/tmp/cc_final.json'))).sort();
console.log('fixture:', a);
console.log('output: ', b);
const onlyA = a.filter(k => !b.includes(k));
const onlyB = b.filter(k => !a.includes(k));
console.log('only in fixture:', onlyA);
console.log('only in output: ', onlyB);
process.exit(onlyA.length || onlyB.length ? 1 : 0);
"
```

**Expected:** identical key sets and exit code 0. If `only in fixture` or `only in output` is non-empty: decide if it's a bug to fix or an acceptable variation.

- [ ] **Step 4: Document any deltas**

If acceptable variations exist, note them in a `KNOWN_LIMITATIONS.md` (or paste into the demo script).

### Task 2.6: Demo dry run

Final rehearsal before judging.

- [ ] **Step 1: Pre-flight checklist**

Confirm:
- Demo machine has internet
- `claude login` is fresh (run `claude --print "hi"` to verify auth)
- Proxy is running (`npm start` in `proxy/`)
- Extension loaded in Chrome and reloaded since the last code change
- The primary demo tweet is queued (copied to clipboard or written down)
- Backup screen captures from Task 2.3 are saved

- [ ] **Step 2: Walk through the primary demo**

Clean run: open Chrome, click ClaimCheck icon, paste primary demo tweet, click Analyze, narrate what each section means. Time it. Aim under 3 minutes.

- [ ] **Step 3: Walk through one backup**

In case of Q&A or fallback, know the second demo. Don't run all three back-to-back during the demo — one strong, two queued.

- [ ] **Step 4: Final commit + push**

```bash
cd /Users/zefan/Claude/claim_check
git add -A
git commit -m "demo: pre-flight pass" --allow-empty
git push
```

---

## Self-Review

**Spec coverage:**

| Spec section | Plan task(s) |
|---|---|
| §1 Overview | Implicit across all phases |
| §3 Ethical stance (no verdicts, transparency) | 1B.2 (prompt rules), 1B.4 (validator), 1A.6 (allowlist) |
| §6 UX flow | 1A.1–1A.7 |
| §7 Six output sections | 1A.2 (HTML), 1A.6 (renderer), 1B.2 (prompt schema) |
| §8 Tech stack | 1A.1, 1A.4, 1B.1, 1B.3, 1B.5 |
| §9 Prompt design | 1B.2, 1B.7 |
| §10.1 Work split | Plan structure (Phase 1A vs 1B) |
| §10.2 File ownership | File Structure section + per-task Files block |
| §10.3 JSON schema contract | 0.3 (locks the schema), 1B.4 (enforces) |
| §10.4 Integration | 2.2 |
| §10.6 Phases | Phase 0 / 1A / 1B / 2 mapping |
| §11 Demo plan | 2.3, 2.6 |
| §12 Risks | Spike tasks 0.1, 0.2; defensive parsing in 1A.6; validator in 1B.4; cache in 1A.4 + 1B.5; cut in 2.4 |

**Pitfalls coverage** (`docs/claude-pitfalls.md`):

| # | Lesson | Plan task |
|---|---|---|
| 1 | Real API call before splitting | 0.1 |
| 2 | Spec placeholders walked | 0.3 (schema lock + fixture) |
| 3 | No-verdict as code gate | 1B.4 (with TDD) |
| 4 | Fixture as published API | 0.3 + introduction's "frozen contracts" |
| 5 | Midpoint + final integration syncs | 2.1, 2.5 |
| 6 | Frozen working half | 2.2 step 3, 2.3 step 4 |
| 7 | Smoke test on real X posts | 2.3 |
| 8 | Six-section structure verification | 1A.6 (allowlist) + 1B.4 (required-keys) |
| 9 | web_search reliability | 1A.5 (loading message), 1B.5 (error path) |
| 10 | Defensive JSON parsing | 1A.6 |
| 11 | Whitelist accepted fields | 1A.6, 1B.4 |
| 12 | Array length, not constants | 1A.6 (iterates `.length` everywhere) |
| 13 | Reset state between submits | 1A.5 (`clear()` before each) |
| 14 | Cut order for broken sections | 2.4 |
| 15 | One strong demo example | 2.6 (primary + backups) |
| 16 | Final shape sync | 2.5 |

No `TODO` / `TBD` placeholders in steps (the only "TBD" comments are explicit notes about Task 0.1's SDK-API discovery, which is by design).

Type and signature consistency:
- `analyze(input: string) → Promise<ResponseJSON>` — Tasks 1B.3, 1B.5, 1B.6
- `validate(raw: object) → object` — Task 1B.4 → consumed by 1B.3
- `render(data: object)` and `clear()` — Task 1A.6 → consumed by 1A.5
- Top-level allowlist `tldr / claims / evidence / steelman / couldnt_verify / how_to_verify` — appears in 0.3 schema, 1A.6 renderer, 1B.4 validator, 1B.2 prompt — all match.
