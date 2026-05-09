# ClaimCheck

A Chrome extension that helps users think critically about social-media posts (primarily Twitter/X) by extracting claims, checking evidence via web search, and surfacing steel-manned counter-arguments — without rendering verdicts.

## Hackathon context

- Track: **Governance & Collaboration**
- Timeline: 8 hours, team of 2
- Built with explicit awareness of the track's ethical considerations: the product is designed *not* to be weaponizable, *not* to render verdicts, and *not* to "both-sides" reality.

## Design philosophy

The product is a **critical-thinking aid, not a verdict tool.** It exposes patterns and lets the user judge.

This is load-bearing. Do NOT introduce features that:

- Render verdicts (e.g. "this post is biased / extreme / 偏激 / left / right")
- Score partisan lean
- Auto-curate "opposite-view" articles for the user
- Flag content as misinformation without showing the user how the conclusion was reached

If a feature looks like a verdict, it is the wrong feature for this product.

The product *does*:

- Extract distinct claims from a post
- Classify each as factual / opinion / mixed
- For factual claims: web-search and report what sources say (descriptively, not as a verdict)
- For opinion claims: generate steel-manned counter-arguments from a *thoughtful* critic (not "what the other tribe says")
- If the post links to a source: check whether the post represents that source accurately (catches 断章取义)
- Be explicit about what it *couldn't* verify
- Teach the user how they would verify it themselves

## Tech stack (v2 — OAuth/local-proxy)

Architecture: Chrome extension (popup + background service worker) → local Node proxy on `localhost:3001` → Claude Agent SDK with the user's Claude Max OAuth → Claude with `web_search` tool.

- Chrome Manifest V3 extension; vanilla HTML+JS popup; background service worker owns the fetch (so popup-close mid-analysis doesn't drop the result)
- Local Node proxy: HTTP server, single `POST /analyze` endpoint, in-memory result cache, CORS for `chrome-extension://*`
- Auth: Claude Max OAuth via Claude Agent SDK. No API key. No hosted backend.
- All data flows: browser → user's local proxy → Anthropic. Nothing else.
- No-verdict validator on the proxy strips any verdict-shaped fields before returning to the extension
- Structured JSON output rendered into 6 fixed sections with defensive parsing (whitelist, type checks, never crash on missing/wrong fields)

## Out of scope (deliberate)

- Partisan-lean / political-bias scoring — re-introduces the verdict trap
- 偏激 / "extreme content" flagging — same
- Auto-paired "opposite-view article" recommendations — "both-sidesing" trap
- Multimedia (images, video, screenshot tweets) — text-only for v1
- API-key path / hosted backend — Max OAuth via local proxy is sufficient for the team's machine; non-team users would need OAuth + Node + the proxy running, which is a deliberate post-hackathon concern
- Browser support beyond Chrome — Chrome only for v1
- Polished DOM injection (per-tweet buttons, viewport detection) — popup-with-paste for v1

## Required reading before editing

- `docs/superpowers/specs/2026-05-09-claim-check-design.md` — the full design spec
- `docs/claude-pitfalls.md` — the 16 highest-leverage failure modes for this project; cross-reference before any code change, especially during integration. Distilled from `docs/lessons-learned.md`.

If you're editing the spec or writing the implementation plan, walk through `claude-pitfalls.md` and make sure the relevant lessons are addressed.
