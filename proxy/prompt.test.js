import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { MODE_CONFIG, resolveModeConfig, buildSystemPrompt, buildUserPrompt } from './prompt.js';

describe('MODE_CONFIG', () => {
  it('has the three mode keys', () => {
    assert.deepEqual(Object.keys(MODE_CONFIG).sort(), ['deep', 'quick', 'standard']);
  });
  it('quick is Haiku, no search by default, tighter token budget', () => {
    assert.equal(MODE_CONFIG.quick.model, 'claude-haiku-4-5-20251001');
    assert.equal(MODE_CONFIG.quick.maxClaims, 2);
    assert.equal(MODE_CONFIG.quick.defaultSearch, false);
    assert.equal(MODE_CONFIG.quick.maxTokens.noSearch, 384);
    assert.equal(MODE_CONFIG.quick.maxTokens.withSearch, 1536);
  });
  it('standard is Sonnet, search by default, tighter no-search token budget', () => {
    assert.equal(MODE_CONFIG.standard.model, 'claude-sonnet-4-6');
    assert.equal(MODE_CONFIG.standard.maxClaims, 4);
    assert.equal(MODE_CONFIG.standard.defaultSearch, true);
    assert.equal(MODE_CONFIG.standard.maxTokens.noSearch, 512);
    assert.equal(MODE_CONFIG.standard.maxTokens.withSearch, 3072);
  });
  it('deep is Opus, search by default', () => {
    assert.equal(MODE_CONFIG.deep.model, 'claude-opus-4-7');
    assert.equal(MODE_CONFIG.deep.maxClaims, 8);
    assert.equal(MODE_CONFIG.deep.defaultSearch, true);
  });
});

describe('resolveModeConfig(mode, searchOverride)', () => {
  it('quick without override: tools=[], smaller maxTokens', () => {
    const r = resolveModeConfig('quick');
    assert.equal(r.searchAvailable, false);
    assert.equal(r.maxTokens, 384);
    assert.equal(r.maxSources, 0);
    assert.deepEqual(r.tools, []);
  });
  it('quick with override: tools=WebSearch, larger maxTokens', () => {
    const r = resolveModeConfig('quick', true);
    assert.equal(r.searchAvailable, true);
    assert.equal(r.maxTokens, 1536);
    assert.equal(r.maxSources, 1);
    assert.deepEqual(r.tools, ['WebSearch']);
  });
  it('standard without override now defaults to search-on', () => {
    const r = resolveModeConfig('standard');
    assert.equal(r.searchAvailable, true);
    assert.equal(r.maxTokens, 3072);
    assert.equal(r.maxSources, 2);
    assert.deepEqual(r.tools, ['WebSearch']);
  });
  it('standard with override: same as default (search-on)', () => {
    const r = resolveModeConfig('standard', true);
    assert.equal(r.searchAvailable, true);
    assert.equal(r.maxTokens, 3072);
    assert.equal(r.maxSources, 2);
    assert.deepEqual(r.tools, ['WebSearch']);
  });
  it('deep always searches regardless of override flag', () => {
    for (const ov of [false, true]) {
      const r = resolveModeConfig('deep', ov);
      assert.equal(r.searchAvailable, true);
      assert.deepEqual(r.tools, ['WebSearch']);
    }
  });
  it('falsy/unknown mode falls back to standard', () => {
    for (const v of [undefined, null, '', 'STANDARD', 'unknown', 0]) {
      const r = resolveModeConfig(v);
      assert.equal(r.mode, 'standard');
      assert.equal(r.config.maxClaims, 4);
    }
  });
});

describe('buildSystemPrompt — no-search variant (claim-extraction only)', () => {
  it('quick (no search) — explicit empty evidence/steelman + claim extraction language', () => {
    const p = buildSystemPrompt('quick');
    assert.match(p, /CLAIM EXTRACTION ONLY/);
    assert.match(p, /"evidence": \[\]/);
    assert.match(p, /"steelman": \[\]/);
    assert.match(p, /at most 2 distinct claims/);
    assert.match(p, /Web search not run/);
    assert.doesNotMatch(p, /web_search tool/);
    assert.doesNotMatch(p, /ANTI-FALSE-BALANCE/);
    assert.doesNotMatch(p, /ROUTE OPINIONS TO STEEL-MAN/);
  });
  it('standard now defaults to full prompt (search-on by default)', () => {
    const p = buildSystemPrompt('standard');
    assert.match(p, /use the web_search tool/);
    assert.match(p, /at most 4 distinct claims/);
    assert.match(p, /at most 2 sources? per claim/);
    assert.doesNotMatch(p, /CLAIM EXTRACTION ONLY/);
  });
});

describe('buildSystemPrompt — full variant (search-enabled)', () => {
  it('quick (with search) — full prompt with all rules', () => {
    const p = buildSystemPrompt('quick', true);
    assert.match(p, /use the web_search tool/);
    assert.match(p, /at most 2 distinct claims/);
    assert.match(p, /at most 1 sources? per claim/);
    assert.match(p, /ANTI-FALSE-BALANCE/);
    assert.match(p, /ROUTE OPINIONS TO STEEL-MAN/);
  });
  it('standard (search redundantly forced via override) — same full prompt', () => {
    const p = buildSystemPrompt('standard', true);
    assert.match(p, /use the web_search tool/);
    assert.match(p, /at most 4 distinct claims/);
    assert.match(p, /at most 2 sources? per claim/);
  });
  it('deep — always full prompt regardless of override', () => {
    for (const ov of [false, true]) {
      const p = buildSystemPrompt('deep', ov);
      assert.match(p, /use the web_search tool/);
      assert.match(p, /at most 8 distinct claims/);
      assert.match(p, /at most 3 sources? per claim/);
      assert.match(p, /ANTI-FALSE-BALANCE/);
    }
  });
  it('preserves all 8 rules (NO VERDICTS, ROUTE FACTS, etc.) in full prompt', () => {
    const p = buildSystemPrompt('deep');
    for (const rule of ['NO VERDICTS', 'ROUTE FACTS TO EVIDENCE', 'ROUTE OPINIONS TO STEEL-MAN', 'ANTI-FALSE-BALANCE', 'EXPLICIT LIMITS', 'TEACHING VERIFICATION', 'OUTPUT VALID JSON ONLY']) {
      assert.ok(p.includes(rule), `full prompt missing ${rule}`);
    }
  });
});

describe('buildUserPrompt(input) — unchanged', () => {
  it('embeds the input under POST:', () => {
    const p = buildUserPrompt('hello world');
    assert.match(p, /POST:\s*\nhello world/);
  });
});
