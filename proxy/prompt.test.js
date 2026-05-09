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
