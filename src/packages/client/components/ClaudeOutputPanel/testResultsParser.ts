/**
 * Detects a Tide Commander test-run result JSON in agent output (the response
 * of `GET /api/tests/runs/:id`, printed by a `curl` in the Run Tests skill) and
 * extracts a compact summary so the terminal can render a card instead of raw
 * JSON. Returns null for anything that isn't a test-run result — safe to call on
 * every tool/bash output.
 */

export interface TestRunCardData {
  status: 'passed' | 'failed' | 'error';
  totals: {
    suites: number;
    tests: number;
    passed: number;
    failures: number;
    errors: number;
    skipped: number;
    time: number;
  };
  command?: string;
  targetPath?: string;
  failing: string[]; // up to 6 "Class#method" identifiers
}

function coerceObject(text: string): any | null {
  const t = text.trim();
  // Cheap gate before attempting JSON.parse on arbitrary output.
  if (!t.startsWith('{') || !t.includes('"totals"')) return null;
  try {
    return JSON.parse(t);
  } catch {
    // Tolerate leading/trailing noise around a single JSON object.
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export function parseTestResults(text: string): TestRunCardData | null {
  if (!text) return null;
  const obj = coerceObject(text);
  if (!obj) return null;

  const totals = obj?.result?.totals;
  const status = obj?.status;
  if (!totals || typeof totals.tests !== 'number') return null;
  if (status !== 'passed' && status !== 'failed' && status !== 'error') return null;

  const failing: string[] = [];
  const suites = obj?.result?.suites;
  if (Array.isArray(suites)) {
    outer: for (const s of suites) {
      for (const tc of s?.testcases ?? []) {
        if (tc?.status === 'failed' || tc?.status === 'error') {
          const cls = String(tc.classname || s.name || '').split('.').pop();
          failing.push(cls ? `${cls}#${tc.name}` : String(tc.name));
          if (failing.length >= 6) break outer;
        }
      }
    }
  }

  return {
    status,
    totals: {
      suites: Number(totals.suites) || 0,
      tests: Number(totals.tests) || 0,
      passed: Number(totals.passed) || 0,
      failures: Number(totals.failures) || 0,
      errors: Number(totals.errors) || 0,
      skipped: Number(totals.skipped) || 0,
      time: Number(totals.time) || 0,
    },
    command: typeof obj.command === 'string' ? obj.command : undefined,
    targetPath: typeof obj.targetPath === 'string' ? obj.targetPath : undefined,
    failing,
  };
}
