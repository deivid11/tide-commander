import { describe, expect, it } from 'vitest';
import { filterCostText, formatTokenCapacity } from './formatting';

describe('formatTokenCapacity', () => {
  it('formats context windows without unnecessary decimals', () => {
    expect(formatTokenCapacity(200_000)).toBe('200k');
    expect(formatTokenCapacity(272_000)).toBe('272k');
    expect(formatTokenCapacity(1_000_000)).toBe('1M');
    expect(formatTokenCapacity(1_500_000)).toBe('1.5M');
  });
});

describe('filterCostText', () => {
  it('returns the input untouched when hideCost is off or nothing looks like a price', () => {
    const code = '```py\n    def x():\n        pass\n```';
    expect(filterCostText(code, false)).toBe(code);
    expect(filterCostText(code, true)).toBe(code); // indentation preserved
    const shell = 'echo $HOME && printf "%s" "$VAR"';
    expect(filterCostText(shell, true)).toBe(shell);
    expect(filterCostText(undefined, true)).toBe('');
  });

  it('strips prices without collapsing whitespace elsewhere', () => {
    expect(filterCostText('Total cost: $0.05', true)).toBe('Total cost:');
    expect(filterCostText('The run cost $1.23 and finished', true)).toBe('The run cost and finished');
    expect(filterCostText('Roughly ~$0.10 per call', true)).toBe('Roughly per call');
    expect(filterCostText('Cost:$3.50\nnext line   \n  indented', true)).toBe('Cost:\nnext line\n  indented');
    expect(filterCostText('| a | b |\n|---|---|\n| 1 | $2 |', true)).toBe('| a | b |\n|---|---|\n| 1 | |');
  });

  it('leaves real-world money alone (grouped or >= $10,000)', () => {
    const statement = 'GNP SAB GNP9211244P0 COYOACAN\n$217,501.30\n20 ago 2026';
    expect(filterCostText(statement, true)).toBe(statement);
    expect(filterCostText('El pago fue de $1,234.56 MXN', true)).toBe('El pago fue de $1,234.56 MXN');
    expect(filterCostText('Budget is $250000 this year', true)).toBe('Budget is $250000 this year');
    // and never mangles a grouped amount down to its leading digits
    expect(filterCostText('Total: $217,501.30', true)).not.toContain(',501.30\n');
    expect(filterCostText('cost: $217,501.30', true)).toBe('cost: $217,501.30');
  });

  it('memoizes by text (same reference back on repeat calls)', () => {
    const text = 'Total cost: $0.05 for ' + 'x'.repeat(10_000);
    const a = filterCostText(text, true);
    const b = filterCostText(text, true);
    expect(b).toBe(a);
  });
});
