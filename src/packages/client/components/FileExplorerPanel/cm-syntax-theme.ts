/**
 * CodeMirror highlight style driven by the app's theme variables.
 *
 * The file-explorer viewer panel used to show three different palettes
 * depending on what it had open: CodeMirror's bundled `oneDark` (hardcoded
 * hexes — #e06c75, #98c379, #61afef …) for code files, the Prism theme in
 * `styles/components/file-explorer/_syntax.scss` for markdown source and merge
 * conflicts, and a third Prism palette scoped to `.diff-line-content` for
 * commit diffs. Same file, three looks — and the CodeMirror one ignored the
 * theme picker entirely.
 *
 * This maps Lezer tags onto the SAME `--accent-*` variables the Prism theme
 * uses, so every code surface follows the selected theme. The role table below
 * is the canonical assignment; `_syntax.scss` mirrors it for Prism, and the two
 * must be changed together.
 *
 *   comment            → --text-muted (italic)
 *   keyword            → --accent-pink
 *   string             → --accent-green
 *   number/boolean/null→ --accent-purple
 *   property (keys)    → --accent-pink
 *   function/class     → --accent-yellow
 *   operator/punct/var → --text-primary
 *   regex              → --accent-orange
 *   invalid            → --accent-red
 */

import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const tideHighlightStyle = HighlightStyle.define([
  // Comments and other non-code chrome
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--text-muted)' },

  // Keywords
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self],
    color: 'var(--accent-pink)',
  },

  // Strings
  { tag: [t.string, t.special(t.string), t.character, t.docString], color: 'var(--accent-green)' },
  { tag: t.escape, color: 'var(--accent-orange)' },

  // Literals
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], color: 'var(--accent-purple)' },

  // Object/JSON keys — matches Prism's `.token.property`
  { tag: [t.propertyName, t.labelName], color: 'var(--accent-pink)' },
  { tag: t.constant(t.variableName), color: 'var(--accent-pink)' },

  // Callables and types
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.className, t.typeName, t.namespace],
    color: 'var(--accent-yellow)',
  },

  // Plain identifiers, operators and punctuation stay at body colour so the
  // coloured tokens above are what the eye picks out.
  { tag: [t.variableName, t.definition(t.variableName), t.operator, t.derefOperator, t.compareOperator, t.logicOperator, t.arithmeticOperator], color: 'var(--text-primary)' },
  { tag: [t.punctuation, t.separator, t.bracket, t.paren, t.brace, t.squareBracket, t.angleBracket], color: 'var(--text-primary)' },

  // Markup (HTML/XML/JSX)
  { tag: t.tagName, color: 'var(--accent-pink)' },
  { tag: t.attributeName, color: 'var(--accent-green)' },
  { tag: t.attributeValue, color: 'var(--accent-yellow)' },

  // Patterns and links
  { tag: t.regexp, color: 'var(--accent-orange)' },
  { tag: [t.url, t.link], color: 'var(--text-primary)', textDecoration: 'underline' },

  // Markdown inline formatting
  { tag: t.heading, color: 'var(--accent-pink)', fontWeight: 'bold' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.quote, color: 'var(--text-muted)' },

  { tag: t.invalid, color: 'var(--accent-red)' },
]);
