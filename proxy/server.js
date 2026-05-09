import http from 'node:http';
import crypto from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { analyze } from './analyze.js';
import { MODE_CONFIG, resolveModeConfig } from './prompt.js';

const PORT = 3001;
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function resolveMode(raw) {
  if (typeof raw === 'string' && Object.prototype.hasOwnProperty.call(MODE_CONFIG, raw)) {
    return { mode: raw };
  }
  if (raw !== undefined) {
    console.warn(`[mode] rejected invalid mode value ${JSON.stringify(raw)} — falling back to 'standard'`);
  }
  return { mode: 'standard' };
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
    const searchOverride = !!parsed.searchOverride;
    const resolved = resolveModeConfig(mode, searchOverride);
    const searchAvailable = resolved.searchAvailable;

    // Cache key includes both mode AND search dimension
    const hash = crypto.createHash('sha256').update(`${input}:${mode}:${searchAvailable ? 'search' : 'nosearch'}`).digest('hex');
    const cached = cache.get(hash);
    if (cached && Date.now() - cached.completedAt < CACHE_TTL_MS) {
      console.log(`[cache hit] ${hash.slice(0, 8)} mode=${mode} search=${searchAvailable}`);
      return ok(res, { mode: cached.mode, searchAvailable: cached.searchAvailable, data: cached.data });
    }

    console.log(`[analyze] ${hash.slice(0, 8)} mode=${mode} search=${searchAvailable} ${input.slice(0, 60)}...`);
    try {
      const data = await analyze(input, mode, { searchOverride });
      cache.set(hash, { data, mode, searchAvailable, completedAt: Date.now() });
      ok(res, { mode, searchAvailable, data });
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
