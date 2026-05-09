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

// Run startup check BEFORE binding the port so a failed check doesn't leave a
// half-bound port behind on force-quit.
await startupCheck();

server.listen(PORT, () => {
  console.log(`ClaimCheck proxy listening on http://localhost:${PORT}`);
});
