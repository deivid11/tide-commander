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

  const styleMap: Record<string, string> = {
    table: 'border-collapse:collapse;width:100%;border:1px solid #d0d0d0;margin:8px 0',
    th: 'background:#f0f0f0;color:#1a1a1a;padding:8px 12px;border:1px solid #d0d0d0;font-weight:bold;text-align:left',
    td: 'padding:8px 12px;border:1px solid #d0d0d0',
    h1: 'font-size:2em;font-weight:bold;margin:16px 0 8px;border-bottom:1px solid #d0d0d0;padding-bottom:4px',
    h2: 'font-size:1.5em;font-weight:bold;margin:14px 0 8px;border-bottom:1px solid #d0d0d0;padding-bottom:4px',
    h3: 'font-size:1.25em;font-weight:bold;margin:12px 0 6px',
    h4: 'font-size:1.1em;font-weight:bold;margin:10px 0 4px',
    h5: 'font-size:1em;font-weight:bold;margin:8px 0 4px',
    h6: 'font-size:0.9em;font-weight:bold;margin:8px 0 4px;color:#666',
    pre: 'background:#f6f8fa;padding:16px;border-radius:6px;overflow:auto;border:1px solid #d0d0d0;font-family:monospace;font-size:0.9em;margin:8px 0',
    blockquote: 'border-left:4px solid #d0d0d0;padding-left:16px;color:#666;margin:8px 0',
    a: 'color:#0969da;text-decoration:none',
    ul: 'padding-left:24px;margin:4px 0',
    ol: 'padding-left:24px;margin:4px 0',
    li: 'margin:4px 0',
    hr: 'border:none;border-top:1px solid #d0d0d0;margin:16px 0',
    strong: 'font-weight:bold',
    em: 'font-style:italic',
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
      // Code inside pre: just set font-family, inherit pre styles
      (el as HTMLElement).style.cssText += 'font-family:monospace;background:transparent;padding:0';
    } else {
      (el as HTMLElement).style.cssText += 'background:#f0f0f0;padding:2px 6px;border-radius:3px;font-family:monospace;font-size:0.9em;color:#333';
    }
  }

  // Alternating row backgrounds for table bodies
  for (const table of Array.from(container.querySelectorAll('table'))) {
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach((row, i) => {
      if (i % 2 === 1) {
        (row as HTMLElement).style.cssText += 'background:#f9f9f9';
      }
    });
  }

  return container.innerHTML;
}

export async function copyRichContentToClipboard(html: string, plainText: string): Promise<void> {
  if (
    typeof navigator !== 'undefined'
    && navigator.clipboard?.write
    && typeof ClipboardItem !== 'undefined'
  ) {
    const htmlBlob = new Blob([html], { type: 'text/html' });
    const textBlob = new Blob([plainText], { type: 'text/plain' });

    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': htmlBlob,
        'text/plain': textBlob,
      }),
    ]);
    return;
  }

  await copyTextToClipboard(plainText);
}
