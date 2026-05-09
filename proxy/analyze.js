import { query } from '@anthropic-ai/claude-agent-sdk';
import { resolveModeConfig, buildSystemPrompt, buildUserPrompt } from './prompt.js';
import { validate } from './validator.js';

const REQUEST_TIMEOUT_MS = 180_000;

export async function analyze(input, mode = 'standard', { searchOverride = false } = {}) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('input must be a non-empty string');
  }
  if (input.length > 4000) {
    input = input.slice(0, 4000);
  }

  let timeoutId;
  return Promise.race([
    runAnalysis(input, mode, searchOverride).finally(() => clearTimeout(timeoutId)),
    new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`analyze timed out after ${REQUEST_TIMEOUT_MS}ms`)),
        REQUEST_TIMEOUT_MS
      );
    }),
  ]);
}

async function runAnalysis(input, mode, searchOverride) {
  const resolved = resolveModeConfig(mode, searchOverride);
  const prompt = buildUserPrompt(input);

  const events = [];
  for await (const event of query({
    prompt,
    options: {
      systemPrompt: buildSystemPrompt(mode, searchOverride),
      model: resolved.config.model,
      maxTokens: resolved.maxTokens,
      allowedTools: resolved.tools,
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
