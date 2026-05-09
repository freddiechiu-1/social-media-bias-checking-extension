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
