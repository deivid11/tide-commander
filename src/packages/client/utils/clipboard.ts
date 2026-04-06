function legacyCopyText(text: string): void {
  if (typeof document === 'undefined') {
    throw new Error('Clipboard unavailable');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error('Legacy clipboard copy failed');
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  legacyCopyText(text);
}

/**
 * Adds inline styles to HTML elements so rich text pastes correctly
 * into external apps (Word, Google Docs, email) that don't have our CSS classes.
 * Uses light theme colors since paste destinations typically have white backgrounds.
 */
export function inlineStylesForRichCopy(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;

  // Base font on the root wrapper div (if present)
  const wrapper = container.firstElementChild as HTMLElement | null;
  if (wrapper) {
    wrapper.style.cssText += 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14px;color:#1f2328;line-height:1.6';
  }

  const styleMap: Record<string, string> = {
    // Tables
    table: 'border-collapse:collapse;width:100%;border:1px solid #d1d9e0;margin:12px 0;font-size:13px',
    th: 'background:#f6f8fa;color:#1f2328;padding:6px 12px;border:1px solid #d1d9e0;font-weight:600;text-align:left;white-space:nowrap',
    td: 'padding:6px 12px;border:1px solid #d1d9e0;color:#1f2328;vertical-align:top',
    // Headings
    h1: 'font-size:2em;font-weight:700;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #d1d9e0;color:#1f2328',
    h2: 'font-size:1.5em;font-weight:700;margin:20px 0 10px;padding-bottom:4px;border-bottom:1px solid #d1d9e0;color:#1f2328',
    h3: 'font-size:1.25em;font-weight:600;margin:16px 0 8px;color:#1f2328',
    h4: 'font-size:1.1em;font-weight:600;margin:12px 0 6px;color:#1f2328',
    h5: 'font-size:1em;font-weight:600;margin:10px 0 4px;color:#1f2328',
    h6: 'font-size:0.85em;font-weight:600;margin:10px 0 4px;color:#656d76',
    // Code blocks
    pre: 'background:#f6f8fa;padding:16px;border-radius:6px;overflow:auto;border:1px solid #d1d9e0;font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;font-size:12px;line-height:1.5;margin:12px 0;color:#1f2328',
    // Blockquotes
    blockquote: 'border-left:4px solid #d1d9e0;padding:4px 16px;color:#656d76;margin:12px 0;background:#f6f8fa',
    // Links
    a: 'color:#0969da;text-decoration:underline',
    // Lists
    ul: 'padding-left:28px;margin:8px 0',
    ol: 'padding-left:28px;margin:8px 0',
    li: 'margin:4px 0;color:#1f2328',
    // Dividers
    hr: 'border:none;border-top:2px solid #d1d9e0;margin:20px 0',
    // Emphasis
    strong: 'font-weight:700;color:#1f2328',
    em: 'font-style:italic',
    // Paragraphs
    p: 'margin:8px 0;line-height:1.6',
  };

  for (const [tag, style] of Object.entries(styleMap)) {
    for (const el of Array.from(container.querySelectorAll(tag))) {
      (el as HTMLElement).style.cssText += style;
    }
  }

  // Inline code (not inside pre)
  for (const el of Array.from(container.querySelectorAll('code'))) {
    const parent = el.parentElement;
    if (parent && parent.tagName.toLowerCase() === 'pre') {
      (el as HTMLElement).style.cssText += 'font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;background:transparent;padding:0;font-size:inherit;color:inherit';
    } else {
      (el as HTMLElement).style.cssText += 'background:#eff1f3;padding:2px 6px;border-radius:4px;font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;font-size:0.85em;color:#cf222e';
    }
  }

  // Table enhancements for Google Docs compatibility.
  // Google Docs ignores CSS table-layout and colgroup, but respects inline styles
  // and width attributes on cells. We set percentage widths ensuring each column
  // is wide enough for its header text to never wrap.
  for (const table of Array.from(container.querySelectorAll('table'))) {
    (table as HTMLElement).setAttribute('width', '100%');

    // Alternating row backgrounds
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach((row, i) => {
      if (i % 2 === 0) {
        (row as HTMLElement).style.cssText += 'background:#ffffff';
      } else {
        (row as HTMLElement).style.cssText += 'background:#f6f8fa';
      }
    });

    // Smart column width distribution: ensure headers never wrap.
    // 1. Each column gets a minimum % based on its header text length
    // 2. Remaining space is distributed to columns with long body content
    const headerCells = Array.from(table.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td'));
    const numCols = headerCells.length;
    if (numCols < 2) continue;

    const allRows = Array.from(table.querySelectorAll('tr'));

    // Measure header text, longest single word, and total body content per column
    const headerChars: number[] = [];
    const longestWord: number[] = new Array(numCols).fill(0);
    const bodyMaxChars: number[] = new Array(numCols).fill(0);

    headerCells.forEach((cell, i) => {
      const text = (cell.textContent || '').trim();
      headerChars[i] = text.length;
      // Header text itself is an unbreakable unit
      longestWord[i] = text.length;
    });

    for (const row of allRows) {
      const cells = Array.from(row.children);
      cells.forEach((cell, i) => {
        if (i < numCols) {
          const text = (cell.textContent || '').trim();
          bodyMaxChars[i] = Math.max(bodyMaxChars[i], text.length);
          // Find the longest single word (unbreakable token) in this cell
          const words = text.split(/\s+/);
          for (const word of words) {
            longestWord[i] = Math.max(longestWord[i], word.length);
          }
        }
      });
    }

    // Column width algorithm: ensure no unbreakable word gets truncated,
    // then give remaining space proportionally to columns with more content.
    //
    // Pass 1: Reserve 50% for longest-word protection. Each column gets a
    //   share proportional to its longest unbreakable word (header or body).
    //   Floor scales: 1-3 chars → 3%, 4-6 → 5%, 7+ → 8%.
    // Pass 2: Remaining ~50% distributed linearly by body content length.
    //   No dampening — a column with 10x more text gets 10x more extra space.
    const totalLongestWord = longestWord.reduce((a, b) => a + b, 0) || 1;
    const minPercents = longestWord.map(w => {
      const floor = w <= 3 ? 3 : w <= 6 ? 5 : 8;
      return Math.max(floor, Math.round((w / totalLongestWord) * 50));
    });
    const usedByMin = minPercents.reduce((a, b) => a + b, 0);

    const remaining = Math.max(0, 100 - usedByMin);
    const totalBody = bodyMaxChars.reduce((a, b) => a + b, 0) || 1;
    const colPercents = minPercents.map((mp, i) =>
      mp + Math.round((bodyMaxChars[i] / totalBody) * remaining)
    );

    // Ensure percentages sum to exactly 100
    const sum = colPercents.reduce((a, b) => a + b, 0);
    colPercents[colPercents.length - 1] += 100 - sum;

    // Apply widths to every cell in every row
    for (const row of allRows) {
      const cells = Array.from(row.children) as HTMLElement[];
      cells.forEach((cell, i) => {
        if (i < numCols) {
          const pct = `${colPercents[i]}%`;
          cell.setAttribute('width', pct);
          cell.style.cssText += `;width:${pct}`;
        }
      });
    }
  }

  // Style syntax highlighting spans inside code blocks (hljs classes)
  const syntaxColors: Record<string, string> = {
    'hljs-keyword': 'color:#cf222e;font-weight:600',
    'hljs-built_in': 'color:#8250df',
    'hljs-type': 'color:#8250df',
    'hljs-literal': 'color:#0550ae',
    'hljs-number': 'color:#0550ae',
    'hljs-string': 'color:#0a3069',
    'hljs-comment': 'color:#6e7781;font-style:italic',
    'hljs-doctag': 'color:#cf222e',
    'hljs-meta': 'color:#6e7781',
    'hljs-attr': 'color:#8250df',
    'hljs-attribute': 'color:#0550ae',
    'hljs-name': 'color:#116329',
    'hljs-tag': 'color:#116329',
    'hljs-title': 'color:#8250df;font-weight:600',
    'hljs-variable': 'color:#953800',
    'hljs-params': 'color:#1f2328',
    'hljs-function': 'color:#8250df',
    'hljs-selector-tag': 'color:#116329',
    'hljs-selector-class': 'color:#8250df',
    'hljs-selector-id': 'color:#0550ae',
    'hljs-property': 'color:#0550ae',
    'hljs-regexp': 'color:#0a3069',
    'hljs-symbol': 'color:#0550ae',
    'hljs-addition': 'color:#116329;background:#dafbe1',
    'hljs-deletion': 'color:#cf222e;background:#ffebe9',
  };

  for (const [cls, style] of Object.entries(syntaxColors)) {
    for (const el of Array.from(container.querySelectorAll(`.${cls}`))) {
      (el as HTMLElement).style.cssText += style;
    }
  }

  return container.innerHTML;
}

export async function copyRichContentToClipboard(html: string, _plainText: string): Promise<void> {
  // Use the selection + execCommand approach for reliable rich text copying.
  // navigator.clipboard.write with ClipboardItem blobs doesn't reliably
  // preserve text/html on all platforms (especially Linux/Wayland).
  const container = document.createElement('div');
  container.innerHTML = html;
  // Force light theme so pasted content looks correct on white pages.
  // Without this, the container inherits the app's dark theme via the DOM.
  container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;color:#1f2328;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6';
  document.body.appendChild(container);

  const range = document.createRange();
  range.selectNodeContents(container);
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }

  const copied = document.execCommand('copy');
  document.body.removeChild(container);

  if (selection) {
    selection.removeAllRanges();
  }

  if (!copied) {
    throw new Error('Rich text copy failed');
  }
}
