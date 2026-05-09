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

  for (const k of ALLOWED_TOP_LEVEL) {
    if (!(k in raw)) throw new Error(`validator: missing required field "${k}"`);
  }

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
      if (FORBIDDEN_KEYS.includes(k)) continue;
      out[k] = stripForbidden(v);
    }
    return out;
  }
  return value;
}
