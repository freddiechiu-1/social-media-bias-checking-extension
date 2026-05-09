import { query } from '@anthropic-ai/claude-agent-sdk';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import { validate } from './validator.js';

const REQUEST_TIMEOUT_MS = 180_000;

export async function analyze(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('input must be a non-empty string');
  }
  if (input.length > 4000) {
    input = input.slice(0, 4000);
  }

  let timeoutId;
  return Promise.race([
    runAnalysis(input).finally(() => clearTimeout(timeoutId)),
    new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`analyze timed out after ${REQUEST_TIMEOUT_MS}ms`)),
        REQUEST_TIMEOUT_MS
      );
    }),
  ]);
}

async function runAnalysis(input) {
  const prompt = buildUserPrompt(input);

  const events = [];
  for await (const event of query({
    prompt,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      model: 'claude-opus-4-7',
      maxTokens: 4096,
      // Pre-allow WebSearch so the SDK doesn't gate per-call.
      allowedTools: ['WebSearch'],
    }
  })) {
    events.push(event);
  }

  const text = extractFinalText(events);
  const parsed = parseJson(text);
  const clean = validate(parsed);
  return clean;
}

function extractFinalText(events) {
  // The SDK emits a final `result` event with the assistant's last text in `.result`.
  // Fall back to scanning assistant message text blocks if the result event is missing
  // (e.g. on early termination).
  const resultEvent = events.find(e => e.type === 'result');
  if (resultEvent && typeof resultEvent.result === 'string') {
    return resultEvent.result;
  }
  const assistantTexts = events
    .filter(e => e.type === 'assistant')
    .flatMap(e => (e.message?.content || []).filter(c => c.type === 'text'))
    .map(c => c.text);
  if (assistantTexts.length === 0) {
    throw new Error('No assistant text in SDK events. Inspect events:\n' + JSON.stringify(events.slice(-3), null, 2));
  }
  return assistantTexts[assistantTexts.length - 1];
}

function parseJson(text) {
  // Be lenient: strip markdown fences if Claude added them anyway.
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  try {
    return JSON.parse(s);
  } catch (err) {
    throw new Error(`Could not parse Claude output as JSON: ${err.message}\n\nRaw output:\n${text.slice(0, 500)}`);
  }
}
