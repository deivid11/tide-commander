/**
 * LLM Matcher Service
 * Evaluates whether events match triggers using LLM-powered semantic matching,
 * and extracts structured variables from unstructured event content.
 *
 * Uses the Anthropic SDK to call Claude (requires TC_ANTHROPIC_API_KEY environment variable).
 * Haiku by default (fast, cheap classification).
 * 15-second timeout — match treated as false on timeout (fail-safe).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LLMMatchResult, LLMExtractResult } from '../../shared/trigger-types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('LLMMatcher');

const TIMEOUT_MS = 15_000;

// Model mapping — use latest available model IDs
const MODEL_MAP: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6-20250514',
  opus: 'claude-opus-4-7',
  'claude-opus-4-7': 'claude-opus-4-7',
  'claude-opus-4-6': 'claude-opus-4-6-20250514',
};

function resolveModel(model?: string): string {
  if (!model) return MODEL_MAP.haiku;
  return MODEL_MAP[model] || model;
}

/**
 * Execute a prompt via the Anthropic SDK.
 * Returns the raw text response.
 */
async function callAnthropicAPI(prompt: string, model: string): Promise<{ text: string; durationMs: number }> {
  const startTime = Date.now();

  const client = new Anthropic({
    apiKey: process.env.TC_ANTHROPIC_API_KEY,
    timeout: TIMEOUT_MS,
  });

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const durationMs = Date.now() - startTime;
    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('\n');

    return { text, durationMs };
  } catch (err) {
    throw err;
  }
}

// ─── LLM Match ───

export async function llmMatch(
  formattedEvent: string,
  config: { prompt: string; model?: string; temperature?: number; maxTokens?: number }
): Promise<LLMMatchResult> {
  const startTime = Date.now();
  const model = resolveModel(config.model);

  const prompt = `You are an event classifier. Your job is to decide whether an incoming event matches a given condition.

EVENT:
---
${formattedEvent}
---

CONDITION TO EVALUATE:
---
${config.prompt}
---

Analyze the event and determine if it matches the condition.
Respond ONLY with valid JSON (no markdown, no explanation outside JSON):
{
  "match": true or false,
  "reason": "Brief explanation of why the event does or does not match",
  "confidence": 0.0 to 1.0
}`;

  try {
    const { text, durationMs } = await callAnthropicAPI(prompt, model);

    try {
      // Extract JSON from response (handle potential markdown wrapping)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const parsed = JSON.parse(jsonMatch[0]) as { match: boolean; reason: string; confidence: number };

      return {
        match: Boolean(parsed.match),
        reason: parsed.reason || '',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : (parsed.match ? 1.0 : 0.0),
        durationMs,
        model,
        tokensUsed: 0,
      };
    } catch (parseErr) {
      log.error('Failed to parse LLM match response:', text);
      return {
        match: false,
        reason: `Parse error: ${parseErr instanceof Error ? parseErr.message : 'unknown'}`,
        confidence: 0,
        durationMs,
        model,
        tokensUsed: 0,
      };
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const reason = err instanceof Error ? err.message : 'unknown';

    if (reason.includes('timed out') || reason.includes('timeout')) {
      log.warn(`LLM match timed out after ${TIMEOUT_MS}ms`);
      return { match: false, reason: `LLM call timed out (${TIMEOUT_MS}ms)`, confidence: 0, durationMs, model, tokensUsed: 0 };
    }

    log.error('LLM match error:', err);
    return { match: false, reason: `LLM error: ${reason}`, confidence: 0, durationMs, model, tokensUsed: 0 };
  }
}

// ─── LLM Variable Extraction ───

export async function llmExtractVariables(
  formattedEvent: string,
  config: { prompt: string; variables: string[]; model?: string }
): Promise<LLMExtractResult> {
  const startTime = Date.now();
  const model = resolveModel(config.model);

  const variableList = config.variables.map(v => `- ${v}`).join('\n');

  const prompt = `You are a data extractor. Extract specific variables from the event below.

EVENT:
---
${formattedEvent}
---

VARIABLES TO EXTRACT:
${variableList}

EXTRACTION INSTRUCTIONS:
---
${config.prompt}
---

Respond ONLY with valid JSON (no markdown, no explanation outside JSON):
{
  "variables": {
    "variable_name_1": "extracted value or empty string if not found",
    "variable_name_2": "extracted value or empty string if not found"
  },
  "reason": "Brief explanation of how you extracted each value"
}`;

  try {
    const { text, durationMs } = await callAnthropicAPI(prompt, model);

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const parsed = JSON.parse(jsonMatch[0]) as { variables: Record<string, string>; reason: string };

      // Ensure all expected variables exist (fill with empty string if missing)
      const variables: Record<string, string> = {};
      for (const v of config.variables) {
        variables[v] = parsed.variables?.[v] ?? '';
      }

      return { variables, reason: parsed.reason || '', durationMs, model, tokensUsed: 0 };
    } catch (parseErr) {
      log.error('Failed to parse LLM extract response:', text);
      const variables: Record<string, string> = {};
      for (const v of config.variables) { variables[v] = ''; }
      return {
        variables,
        reason: `Parse error: ${parseErr instanceof Error ? parseErr.message : 'unknown'}`,
        durationMs, model, tokensUsed: 0,
      };
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const variables: Record<string, string> = {};
    for (const v of config.variables) { variables[v] = ''; }
    const reason = err instanceof Error ? err.message : 'unknown';

    if (reason.includes('timed out') || reason.includes('timeout')) {
      log.warn(`LLM extract timed out after ${TIMEOUT_MS}ms`);
      return { variables, reason: `LLM call timed out (${TIMEOUT_MS}ms)`, durationMs, model, tokensUsed: 0 };
    }

    log.error('LLM extract error:', err);
    return { variables, reason: `LLM error: ${reason}`, durationMs, model, tokensUsed: 0 };
  }
}
