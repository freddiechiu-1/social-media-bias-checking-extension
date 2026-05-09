// Phase 0 Task 0.1 spike — verify Claude Agent SDK + Max OAuth + web_search.
// This file is replaced by analyze.js in Task 1B.3. Delete after Phase 0.
//
// Adapt the import / option keys based on what the SDK actually exposes.
// If the package name is wrong: try `@anthropic-ai/claude-code` instead.

import { query } from '@anthropic-ai/claude-agent-sdk';

const tweet = `Breaking: New CDC report shows 80% of seasonal flu hospitalizations last winter were among people who hadn't gotten the flu shot.`;

const prompt = `Analyze this social media post. Use web_search to verify factual claims. Return ONLY JSON (no markdown fences, no commentary) of the shape:
{ "tldr": "<one sentence>", "claims": [{"id":"c1","text":"...","type":"factual|opinion|mixed"}], "evidence": [{"claim_id":"c1","sources":[{"url":"...","title":"..."}],"synthesis":"..."}] }

POST:
${tweet}`;

const events = [];
for await (const event of query({
  prompt,
  options: {
    model: 'claude-opus-4-7',
    // Pre-allow WebSearch so the SDK doesn't ask for per-call permission.
    // (Note: tool name is `WebSearch` PascalCase, confirmed from init event's tool list.)
    allowedTools: ['WebSearch'],
  }
})) {
  events.push(event);
  // Print compact event summaries instead of the full JSON to keep output readable.
  console.log(`[${event.type}${event.subtype ? '/' + event.subtype : ''}]`,
    event.message?.content?.map(c => c.type).join(',')
    || (event.tool_use_result ? 'tool_use_result' : '')
    || ''
  );
}

console.log('--- DONE ---');
console.log(`Total events: ${events.length}`);

// Did WebSearch actually fire? Check both event-stream uses and the result envelope.
const resultEvent = events.find(e => e.type === 'result');
const webSearchRequests = resultEvent?.usage?.server_tool_use?.web_search_requests ?? 0;
const toolUseBlocks = events
  .filter(e => e.type === 'assistant')
  .flatMap(e => (e.message?.content || []).filter(c => c.type === 'tool_use'));
const webSearchUses = toolUseBlocks.filter(b => b.name === 'WebSearch');
console.log(`WebSearch requests in usage: ${webSearchRequests}`);
console.log(`WebSearch tool_use blocks: ${webSearchUses.length}`);
console.log(`Permission denials: ${(resultEvent?.permission_denials || []).map(d => d.tool_name).join(', ') || 'none'}`);
if (webSearchRequests === 0 && webSearchUses.length === 0) {
  console.warn('⚠ NO WEB_SEARCH ACTIVITY. Either Claude chose not to search, or it was blocked.');
}

// Extract the final assistant text. Two paths:
//   1) `result` event has a `.result` field with the final text (preferred)
//   2) Otherwise, last assistant message's last text block
let finalText = null;
if (resultEvent && typeof resultEvent.result === 'string') {
  finalText = resultEvent.result;
} else {
  const assistantTexts = events
    .filter(e => e.type === 'assistant')
    .flatMap(e => (e.message?.content || []).filter(c => c.type === 'text'))
    .map(c => c.text);
  finalText = assistantTexts[assistantTexts.length - 1] || null;
}

if (!finalText) {
  console.error('CONFORMANCE: COULD NOT EXTRACT FINAL TEXT — inspect events manually');
} else {
  let raw = finalText.trim();
  if (raw.startsWith('```')) raw = raw.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(raw);
    const keys = Object.keys(parsed);
    console.log('CONFORMANCE: keys =', keys);
    console.log('CONFORMANCE: top-level types =', Object.fromEntries(
      keys.map(k => [k, Array.isArray(parsed[k]) ? 'array' : typeof parsed[k]])
    ));
  } catch (err) {
    console.error('CONFORMANCE: JSON parse failed —', err.message);
    console.error('Raw output (first 500 chars):', raw.slice(0, 500));
  }
}
