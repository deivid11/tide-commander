import React, { useEffect, useRef } from 'react';
import type { TableColumn, TableInfo } from '../../../shared/types';
import { Icon } from '../Icon';

const RESERVED_WORDS = new Set([
  'all', 'and', 'as', 'asc', 'by', 'cross', 'delete', 'desc', 'distinct', 'from',
  'full', 'group', 'having', 'inner', 'insert', 'into', 'join', 'left', 'limit',
  'on', 'or', 'order', 'outer', 'right', 'select', 'set', 'union', 'update',
  'using', 'values', 'where',
]);

const TABLE_CONTEXT_RE = /\b(from|join|update|into)\s+([A-Za-z_][\w$]*)?$/i;
const COLUMN_CONTEXT_RE = /\b(select|where|on|group\s+by|order\s+by|having)\b/i;
export interface QueryAutocompleteSchema {
  columns: TableColumn[];
}

export interface QueryAutocompletePosition {
  left: number;
  top: number;
}

export interface QueryAutocompleteSuggestion {
  kind: 'table' | 'column';
  label: string;
  detail?: string;
  source?: string;
  insertText: string;
  replaceStart: number;
  replaceEnd: number;
}

export interface QueryAutocompleteResult {
  suggestions: QueryAutocompleteSuggestion[];
  missingSchemaTables: string[];
}

interface ReferencedTable {
  tableName: string;
  alias?: string;
}

interface QueryAutocompleteProps {
  open: boolean;
  position: QueryAutocompletePosition | null;
  suggestions: QueryAutocompleteSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: QueryAutocompleteSuggestion) => void;
  onHover: (index: number) => void;
}

export const QueryEditorAutocomplete: React.FC<QueryAutocompleteProps> = ({
  open,
  position,
  suggestions,
  selectedIndex,
  onSelect,
  onHover,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || selectedIndex < 0 || !listRef.current) return;
    const item = listRef.current.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [open, selectedIndex]);

  if (!open || !position || suggestions.length === 0) {
    return null;
  }

  return (
    <div
      ref={listRef}
      className="query-editor-autocomplete"
      role="listbox"
      style={{
        left: position.left,
        top: position.top,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {suggestions.map((suggestion, index) => (
        <button
          key={`${suggestion.kind}:${suggestion.source ?? ''}:${suggestion.label}:${index}`}
          type="button"
          data-index={index}
          role="option"
          aria-selected={index === selectedIndex}
          className={`query-editor-autocomplete__item${index === selectedIndex ? ' query-editor-autocomplete__item--selected' : ''}`}
          onMouseEnter={() => onHover(index)}
          onClick={() => onSelect(suggestion)}
        >
          <span className="query-editor-autocomplete__icon">
            <Icon name={suggestion.kind === 'table' ? 'clipboard' : 'list'} size={12} />
          </span>
          <span className="query-editor-autocomplete__main">
            <span className="query-editor-autocomplete__label">{suggestion.label}</span>
            {suggestion.source && (
              <span className="query-editor-autocomplete__source">{suggestion.source}</span>
            )}
          </span>
          {suggestion.detail && (
            <span className="query-editor-autocomplete__detail">{suggestion.detail}</span>
          )}
        </button>
      ))}
    </div>
  );
};

export function buildQueryAutocomplete(params: {
  query: string;
  cursorPosition: number;
  tables: TableInfo[];
  tableSchemas: Map<string, QueryAutocompleteSchema>;
}): QueryAutocompleteResult {
  const { query, cursorPosition, tables, tableSchemas } = params;
  const context = getAutocompleteContext(query, cursorPosition);
  if (!context) {
    return { suggestions: [], missingSchemaTables: [] };
  }

  if (context.kind === 'table') {
    return {
      suggestions: filterTables(tables, context.filter, context.replaceStart, cursorPosition),
      missingSchemaTables: [],
    };
  }

  const referencedTables = parseReferencedTables(context.statement);
  const targetTables = context.qualifier
    ? resolveQualifiedTables(context.qualifier, referencedTables, tables)
    : referencedTables.length > 0
      ? referencedTables.map((ref) => ref.tableName)
      : Array.from(tableSchemas.keys());

  const uniqueTargetTables = uniqueKnownTables(targetTables, tables);
  const missingSchemaTables = uniqueTargetTables.filter((tableName) => !tableSchemas.has(tableName));

  const suggestions = uniqueTargetTables.flatMap((tableName) => {
    const schema = tableSchemas.get(tableName);
    if (!schema) return [];
    const source = context.qualifier ? undefined : tableName;
    return schema.columns.map((column) => columnToSuggestion(
      column,
      context.filter,
      context.replaceStart,
      cursorPosition,
      source,
    ));
  }).filter((suggestion): suggestion is QueryAutocompleteSuggestion => Boolean(suggestion));

  return {
    suggestions: sortSuggestions(suggestions, context.filter),
    missingSchemaTables,
  };
}

export function getTextareaCaretCoordinates(
  textarea: HTMLTextAreaElement,
  cursorPosition: number,
): { left: number; top: number; lineHeight: number } {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  const marker = document.createElement('span');
  const styleProps = [
    'boxSizing', 'width', 'height', 'overflowX', 'overflowY', 'borderTopWidth',
    'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop',
    'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize',
    'fontWeight', 'fontStyle', 'letterSpacing', 'textTransform', 'textAlign',
    'lineHeight', 'wordSpacing', 'tabSize',
  ] as const;

  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';

  styleProps.forEach((prop) => {
    mirror.style[prop] = computed[prop];
  });

  mirror.style.width = `${textarea.offsetWidth}px`;
  mirror.textContent = textarea.value.slice(0, cursorPosition);
  marker.textContent = textarea.value.slice(cursorPosition, cursorPosition + 1) || '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.5 || 18;
  const coordinates = {
    left: marker.offsetLeft - textarea.scrollLeft,
    top: marker.offsetTop - textarea.scrollTop,
    lineHeight,
  };

  document.body.removeChild(mirror);
  return coordinates;
}

function getAutocompleteContext(query: string, cursorPosition: number): {
  kind: 'table' | 'column';
  filter: string;
  qualifier?: string;
  replaceStart: number;
  statement: string;
} | null {
  const statementStart = query.lastIndexOf(';', cursorPosition - 1) + 1;
  const statementEndIndex = query.indexOf(';', cursorPosition);
  const statementEnd = statementEndIndex === -1 ? query.length : statementEndIndex;
  const statement = query.slice(statementStart, statementEnd);
  const beforeCursor = query.slice(statementStart, cursorPosition);
  const dotMatch = beforeCursor.match(/([A-Za-z_][\w$]*)\.([A-Za-z_][\w$]*)?$/);

  if (dotMatch) {
    const filter = dotMatch[2] ?? '';
    return {
      kind: 'column',
      filter,
      qualifier: dotMatch[1],
      replaceStart: cursorPosition - filter.length,
      statement,
    };
  }

  const wordMatch = beforeCursor.match(/([A-Za-z_][\w$]*)$/);
  const filter = wordMatch?.[1] ?? '';
  const beforeFilter = filter ? beforeCursor.slice(0, -filter.length) : beforeCursor;

  if (TABLE_CONTEXT_RE.test(beforeCursor)) {
    return {
      kind: 'table',
      filter,
      replaceStart: cursorPosition - filter.length,
      statement,
    };
  }

  if (COLUMN_CONTEXT_RE.test(beforeFilter) || COLUMN_CONTEXT_RE.test(beforeCursor)) {
    return {
      kind: 'column',
      filter,
      replaceStart: cursorPosition - filter.length,
      statement,
    };
  }

  return null;
}

function filterTables(
  tables: TableInfo[],
  filter: string,
  replaceStart: number,
  replaceEnd: number,
): QueryAutocompleteSuggestion[] {
  const suggestions: QueryAutocompleteSuggestion[] = [];
  tables.forEach((table) => {
    if (getFuzzyScore(table.name, filter) === null) return;
    suggestions.push({
      kind: 'table',
      label: table.name,
      detail: table.type,
      insertText: table.name,
      replaceStart,
      replaceEnd,
    });
  });

  return sortSuggestions(suggestions, filter);
}

function columnToSuggestion(
  column: TableColumn,
  filter: string,
  replaceStart: number,
  replaceEnd: number,
  source?: string,
): QueryAutocompleteSuggestion | null {
  if (getFuzzyScore(column.name, filter) === null) return null;
  return {
    kind: 'column',
    label: column.name,
    detail: column.type,
    source,
    insertText: column.name,
    replaceStart,
    replaceEnd,
  };
}

function parseReferencedTables(statement: string): ReferencedTable[] {
  const refs: ReferencedTable[] = [];
  const regex = /\b(from|join|update|into)\s+([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)(?:\s+(?:as\s+)?([A-Za-z_][\w$]*))?/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(statement)) !== null) {
    const tableName = unqualifyIdentifier(match[2]);
    const alias = match[3]?.toLowerCase();
    refs.push({
      tableName,
      alias: alias && !RESERVED_WORDS.has(alias) ? match[3] : undefined,
    });
  }

  return refs;
}

function resolveQualifiedTables(
  qualifier: string,
  refs: ReferencedTable[],
  tables: TableInfo[],
): string[] {
  const lowerQualifier = qualifier.toLowerCase();
  const matchedRefs = refs.filter((ref) =>
    ref.alias?.toLowerCase() === lowerQualifier || ref.tableName.toLowerCase() === lowerQualifier
  );

  if (matchedRefs.length > 0) {
    return matchedRefs.map((ref) => ref.tableName);
  }

  return tables
    .filter((table) => table.name.toLowerCase() === lowerQualifier)
    .map((table) => table.name);
}

function uniqueKnownTables(tableNames: string[], tables: TableInfo[]): string[] {
  const known = new Map(tables.map((table) => [table.name.toLowerCase(), table.name]));
  const seen = new Set<string>();
  const result: string[] = [];

  tableNames.forEach((name) => {
    const knownName = known.get(name.toLowerCase());
    if (!knownName || seen.has(knownName.toLowerCase())) return;
    seen.add(knownName.toLowerCase());
    result.push(knownName);
  });

  return result;
}

function unqualifyIdentifier(identifier: string): string {
  const parts = identifier.split('.');
  return parts[parts.length - 1];
}

function sortSuggestions(
  suggestions: QueryAutocompleteSuggestion[],
  filter: string,
): QueryAutocompleteSuggestion[] {
  return [...suggestions].sort((a, b) => {
    const scoreA = getFuzzyScore(a.label, filter) ?? 0;
    const scoreB = getFuzzyScore(b.label, filter) ?? 0;
    if (scoreA !== scoreB) return scoreB - scoreA;
    if (a.kind !== b.kind) return a.kind === 'table' ? -1 : 1;
    return a.label.localeCompare(b.label);
  }).slice(0, 12);
}

function getFuzzyScore(candidate: string, filter: string): number | null {
  if (!filter) return 1;

  const lowerCandidate = candidate.toLowerCase();
  const lowerFilter = filter.toLowerCase();
  if (lowerCandidate === lowerFilter) return 100;
  if (lowerCandidate.startsWith(lowerFilter)) return 80 - lowerCandidate.length / 100;
  if (lowerCandidate.includes(lowerFilter)) return 60 - lowerCandidate.indexOf(lowerFilter) / 100;

  let searchIndex = 0;
  let score = 30;
  for (const char of lowerFilter) {
    const foundIndex = lowerCandidate.indexOf(char, searchIndex);
    if (foundIndex === -1) return null;
    score -= (foundIndex - searchIndex) / 10;
    searchIndex = foundIndex + 1;
  }

  return score;
}
