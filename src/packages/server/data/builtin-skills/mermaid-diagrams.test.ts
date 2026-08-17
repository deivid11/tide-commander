import { describe, expect, it } from 'vitest';
import { mermaidDiagrams } from './mermaid-diagrams.js';

describe('Mermaid Diagrams built-in skill', () => {
  it('is opt-in rather than forced onto every agent class', () => {
    expect(mermaidDiagrams.assignedAgentClasses).toEqual([]);
  });
});
