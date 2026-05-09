# ClaimCheck JSON Schema

The proxy returns this shape from `POST /analyze`. The renderer in `extension/popup/render.js` consumes it. **Frozen after Phase 0** — changes require both teammates to align.

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
