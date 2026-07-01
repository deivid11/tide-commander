/**
 * Tests for llm-matcher-service's model-alias resolution (MODEL_MAP / resolveModel).
 */

import { describe, it, expect } from 'vitest';
import { resolveModel } from './llm-matcher-service.js';

describe('resolveModel', () => {
  it('resolves the "sonnet" alias to the latest Sonnet model', () => {
    expect(resolveModel('sonnet')).toBe('claude-sonnet-5');
  });

  it('resolves claude-sonnet-5 and its [1m] label to the bare id', () => {
    expect(resolveModel('claude-sonnet-5')).toBe('claude-sonnet-5');
    expect(resolveModel('claude-sonnet-5[1m]')).toBe('claude-sonnet-5');
  });

  it('still resolves the previous-generation Sonnet 4.6 id explicitly', () => {
    expect(resolveModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6-20250514');
  });

  it('defaults to haiku when no model is given', () => {
    expect(resolveModel(undefined)).toBe('claude-haiku-4-5-20251001');
  });

  it('passes through unrecognized model ids unchanged', () => {
    expect(resolveModel('some-future-model')).toBe('some-future-model');
  });
});
