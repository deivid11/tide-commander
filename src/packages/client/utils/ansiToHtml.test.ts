import { describe, expect, it } from 'vitest';
import { ansiToHtml, hasAnsiCodes, stripAnsi } from './ansiToHtml';

describe('ansiToHtml', () => {
  it('leaves plain text untouched but HTML-escaped', () => {
    expect(ansiToHtml('a < b && c')).toBe('a &lt; b &amp;&amp; c');
  });

  it('maps basic 16-color SGR to inline-styled spans and resets on 0/39', () => {
    const html = ansiToHtml('\x1b[32m✓\x1b[39m ok \x1b[31mfail\x1b[0m done');
    expect(html).toBe(
      '<span style="color:#a3be8c">✓</span> ok <span style="color:#e88080">fail</span> done',
    );
  });

  it('combines bold/dim/italic/underline/strike', () => {
    expect(ansiToHtml('\x1b[1;4mx\x1b[0m')).toBe('<span style="font-weight:bold;text-decoration:underline">x</span>');
    expect(ansiToHtml('\x1b[2mdim\x1b[22mnormal')).toBe('<span style="opacity:0.6">dim</span>normal');
    expect(ansiToHtml('\x1b[9mgone\x1b[29m')).toBe('<span style="text-decoration:line-through">gone</span>');
    expect(ansiToHtml('\x1b[3mi\x1b[23m')).toBe('<span style="font-style:italic">i</span>');
  });

  it('supports 256-color foreground/background (38;5;n / 48;5;n)', () => {
    // 196 = cube (5,0,0) → rgb(255,0,0); 244 = grayscale step 12 → 8+12*10 = 128
    expect(ansiToHtml('\x1b[38;5;196mred\x1b[0m')).toBe('<span style="color:rgb(255,0,0)">red</span>');
    expect(ansiToHtml('\x1b[48;5;244mgray\x1b[0m')).toBe('<span style="background-color:rgb(128,128,128)">gray</span>');
    // 0-15 reuse the basic palette so 256-color output matches 16-color output
    expect(ansiToHtml('\x1b[38;5;2mg\x1b[0m')).toBe(ansiToHtml('\x1b[32mg\x1b[0m'));
    expect(ansiToHtml('\x1b[38;5;9mr\x1b[0m')).toBe(ansiToHtml('\x1b[91mr\x1b[0m'));
  });

  it('supports truecolor (38;2;r;g;b / 48;2;r;g;b) without misreading params as dim/reset', () => {
    // Regression: `2` used to be applied as SGR "dim" and `0` as reset.
    expect(ansiToHtml('\x1b[38;2;255;136;0mtc\x1b[0m')).toBe('<span style="color:rgb(255,136,0)">tc</span>');
    expect(ansiToHtml('\x1b[1;48;2;0;0;0mbg\x1b[0m')).toBe(
      '<span style="background-color:rgb(0,0,0);font-weight:bold">bg</span>',
    );
    // A leading 0 in the same sequence still resets before the color applies
    expect(ansiToHtml('\x1b[31mA\x1b[0;38;2;1;2;3mB\x1b[0m')).toBe(
      '<span style="color:#e88080">A</span><span style="color:rgb(1,2,3)">B</span>',
    );
  });

  it('renders inverse video by swapping fg/bg (with default pair fallback)', () => {
    expect(ansiToHtml('\x1b[7mhl\x1b[27mn')).toBe('<span style="color:#2e3440;background-color:#d8dee9">hl</span>n');
    expect(ansiToHtml('\x1b[32;7mhl\x1b[0m')).toBe('<span style="color:#2e3440;background-color:#a3be8c">hl</span>');
  });

  it('accepts bare "[31m" sequences whose ESC byte was lost upstream', () => {
    expect(ansiToHtml('[33m6548[39m tokens')).toBe('<span style="color:#ebcb8b">6548</span> tokens');
  });

  it('treats an empty SGR (ESC[m) as reset', () => {
    expect(ansiToHtml('\x1b[31mA\x1b[mB')).toBe('<span style="color:#e88080">A</span>B');
  });

  it('exposes hasAnsiCodes / stripAnsi helpers', () => {
    expect(hasAnsiCodes('\x1b[32mx')).toBe(true);
    expect(hasAnsiCodes('plain')).toBe(false);
    expect(stripAnsi('\x1b[1m\x1b[32mx\x1b[0m')).toBe('x');
  });
});
