/**
 * LLM Matcher Service
 * Evaluates whether events match triggers using LLM-powered semantic matching,
 * and extracts structured variables from unstructured event content.
 *
 * Uses Anthropic's API with Haiku by default (fast, cheap classification).
 * Temperature 0 for deterministic results.
 * 5-second timeout — match treated as false on timeout (fail-safe).
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LLMMatchResult, LLMExtractResult } from '../../shared/trigger-types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('LLMMatcher');

// Model mapping: short names to full model IDs
const MODEL_MAP: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
};

function resolveModel(model?: string): string {
  if (!model) return MODEL_MAP.haiku;
  return MODEL_MAP[model] || model;
}

// Lazy-initialized client
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

// ─── LLM Match ───

export async function llmMatch(
  formattedEvent: string,
  config: { prompt: string; model?: string; temperature?: number; maxTokens?: number }
): Promise<LLMMatchResult> {
  const startTime = Date.now();
  const model = resolveModel(config.model);
  const temperature = config.temperature ?? 0;
  const maxTokens = config.maxTokens ?? 150;

  const systemPrompt = `You are an event classifier. Your job is to decide whether an incoming event matches a given condition.

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await getClient().messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: systemPrompt }],
    }, { signal: controller.signal });

    clearTimeout(timeout);

    const durationMs = Date.now() - startTime;
    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

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
        tokensUsed,
      };
    } catch (parseErr) {
      log.error('Failed to parse LLM match response:', text);
      return {
        match: false,
        reason: `Parse error: ${parseErr instanceof Error ? parseErr.message : 'unknown'}`,
        confidence: 0,
        durationMs,
        model,
        tokensUsed,
      };
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;

    if (err instanceof Error && err.name === 'AbortError') {
      log.warn('LLM match timed out after 5s');
      return {
        match: false,
        reason: 'LLM call timed out (5s)',
        confidence: 0,
        durationMs,
        model,
        tokensUsed: 0,
      };
    }

    log.error('LLM match error:', err);
    return {
      match: false,
      reason: `LLM error: ${err instanceof Error ? err.message : 'unknown'}`,
      confidence: 0,
      durationMs,
      model,
      tokensUsed: 0,
    };
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

  const systemPrompt = `You are a data extractor. Extract specific variables from the event below.

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await getClient().messages.create({
      model,
      max_tokens: 300,
      temperature: 0,
      messages: [{ role: 'user', content: systemPrompt }],
    }, { signal: controller.signal });

    clearTimeout(timeout);

    const durationMs = Date.now() - startTime;
    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const parsed = JSON.parse(jsonMatch[0]) as { variables: Record<string, string>; reason: string };

      // Ensure all expected variables exist (fill with empty string if missing)
      const variables: Record<string, string> = {};
      for (const v of config.variables) {
        variables[v] = parsed.variables?.[v] ?? '';
      }

      return {
        variables,
        reason: parsed.reason || '',
        durationMs,
        model,
        tokensUsed,
      };
    } catch (parseErr) {
      log.error('Failed to parse LLM extract response:', text);
      // Return empty variables on parse failure
      const variables: Record<string, string> = {};
      for (const v of config.variables) {
        variables[v] = '';
      }
      return {
        variables,
        reason: `Parse error: ${parseErr instanceof Error ? parseErr.message : 'unknown'}`,
        durationMs,
        model,
        tokensUsed,
      };
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const variables: Record<string, string> = {};
    for (const v of config.variables) {
      variables[v] = '';
    }

    if (err instanceof Error && err.name === 'AbortError') {
      log.warn('LLM extract timed out after 5s');
      return { variables, reason: 'LLM call timed out (5s)', durationMs, model, tokensUsed: 0 };
    }

    log.error('LLM extract error:', err);
    return {
      variables,
      reason: `LLM error: ${err instanceof Error ? err.message : 'unknown'}`,
      durationMs,
      model,
      tokensUsed: 0,
    };
  }
}
