import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { MODE_CONFIG, resolveModeConfig, buildSystemPrompt, buildUserPrompt } from './prompt.js';

describe('MODE_CONFIG', () => {
  it('has the three mode keys', () => {
    assert.deepEqual(Object.keys(MODE_CONFIG).sort(), ['deep', 'quick', 'standard']);
  });
  it('quick is Haiku, no search by default', () => {
    assert.equal(MODE_CONFIG.quick.model, 'claude-haiku-4-5-20251001');
    assert.equal(MODE_CONFIG.quick.maxClaims, 2);
    assert.equal(MODE_CONFIG.quick.defaultSearch, false);
  });
  it('standard is Sonnet, no search by default', () => {
    assert.equal(MODE_CONFIG.standard.model, 'claude-sonnet-4-6');
    assert.equal(MODE_CONFIG.standard.maxClaims, 4);
    assert.equal(MODE_CONFIG.standard.defaultSearch, false);
  });
  it('deep is Opus, search by default', () => {
    assert.equal(MODE_CONFIG.deep.model, 'claude-opus-4-7');
    assert.equal(MODE_CONFIG.deep.maxClaims, 8);
    assert.equal(MODE_CONFIG.deep.defaultSearch, true);
  });
});

describe('resolveModeConfig(mode, searchOverride)', () => {
  it('quick without override: no search, smaller maxTokens, no tools', () => {
    const r = resolveModeConfig('quick');
    assert.equal(r.searchAvailable, false);
    assert.equal(r.maxTokens, 768);
    assert.equal(r.maxSources, 0);
    assert.deepEqual(r.tools, []);
  });
  it('quick with override: search on, larger maxTokens, WebSearch tool', () => {
    const r = resolveModeConfig('quick', true);
    assert.equal(r.searchAvailable, true);
    assert.equal(r.maxTokens, 1536);
    assert.equal(r.maxSources, 1);
    assert.deepEqual(r.tools, ['WebSearch']);
  });
  it('standard without override: no search', () => {
    const r = resolveModeConfig('standard');
    assert.equal(r.searchAvailable, false);
    assert.equal(r.maxTokens, 1536);
    assert.deepEqual(r.tools, []);
  });
  it('standard with override: search on', () => {
    const r = resolveModeConfig('standard', true);
    assert.equal(r.searchAvailable, true);
    assert.equal(r.maxTokens, 3072);
    assert.equal(r.maxSources, 2);
    assert.deepEqual(r.tools, ['WebSearch']);
  });
  it('deep always has search', () => {
    const r1 = resolveModeConfig('deep');
    const r2 = resolveModeConfig('deep', false);
    const r3 = resolveModeConfig('deep', true);
    for (const r of [r1, r2, r3]) {
      assert.equal(r.searchAvailable, true);
      assert.deepEqual(r.tools, ['WebSearch']);
      assert.equal(r.maxSources, 3);
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

describe('buildSystemPrompt(mode, searchOverride)', () => {
  it('quick (no search) — has brevity rule, says NO WEB SEARCH', () => {
    const p = buildSystemPrompt('quick');
    assert.match(p, /BREVITY/);
    assert.match(p, /WEB SEARCH IS UNAVAILABLE/);
    assert.match(p, /at most 2 distinct claims/);
  });
  it('quick (with search) — has brevity, has web_search instruction', () => {
    const p = buildSystemPrompt('quick', true);
    assert.match(p, /BREVITY/);
    assert.match(p, /use the web_search tool/);
    assert.doesNotMatch(p, /WEB SEARCH IS UNAVAILABLE/);
    assert.match(p, /at most 1 sources? per claim/);
  });
  it('standard (no search) — no brevity, says NO WEB SEARCH', () => {
    const p = buildSystemPrompt('standard');
    assert.doesNotMatch(p, /BREVITY/);
    assert.match(p, /WEB SEARCH IS UNAVAILABLE/);
    assert.match(p, /at most 4 distinct claims/);
  });
  it('standard (with search) — no brevity, has web_search', () => {
    const p = buildSystemPrompt('standard', true);
    assert.doesNotMatch(p, /BREVITY/);
    assert.match(p, /use the web_search tool/);
    assert.match(p, /at most 2 sources? per claim/);
  });
  it('deep — always has search regardless of override', () => {
    for (const ov of [false, true]) {
      const p = buildSystemPrompt('deep', ov);
      assert.match(p, /use the web_search tool/);
      assert.doesNotMatch(p, /WEB SEARCH IS UNAVAILABLE/);
      assert.match(p, /at most 8 distinct claims/);
      assert.match(p, /at most 3 sources? per claim/);
    }
  });
  it('preserves rules 1, 3-7 across modes', () => {
    for (const mode of ['quick', 'standard', 'deep']) {
      for (const ov of [false, true]) {
        const p = buildSystemPrompt(mode, ov);
        for (const rule of ['NO VERDICTS', 'ROUTE OPINIONS', 'ANTI-FALSE-BALANCE', 'EXPLICIT LIMITS', 'TEACHING VERIFICATION', 'OUTPUT VALID JSON ONLY']) {
          assert.ok(p.includes(rule), `${mode} ov=${ov} missing ${rule}`);
        }
      }
    }
  });
});

describe('buildUserPrompt(input) — unchanged', () => {
  it('embeds the input under POST:', () => {
    const p = buildUserPrompt('hello world');
    assert.match(p, /POST:\s*\nhello world/);
  });
});
