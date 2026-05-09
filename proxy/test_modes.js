// Phase 0 validation harness — runs the same prompt against multiple model + budget configs
// and reports pass/fail for each spec §10 acceptance criterion.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';
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
      systemPrompt: buildSystemPrompt('standard'),
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
