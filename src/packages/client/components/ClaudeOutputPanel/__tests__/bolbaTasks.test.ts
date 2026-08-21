import { describe, it, expect } from 'vitest';
import { shellTokenize, parseCurlCommand, detectTcApiCall } from '../curlParser';
import { detectBolbaTasksCall } from '../../../plugins/bolba-tasks/bolbaCurl';
import { classifyBolbaTasksOutput, parseBolbaTextTable } from '../../../plugins/bolba-tasks/bolbaTasksOutput';

// The literal multi-line mutation pattern Bolba uses (backslash continuation +
// `-d @-` heredoc, markdown/emoji payload).
const PATCH_CMD = `curl -s --max-time 15 -X PATCH -H "Content-Type: application/json" -H "X-Auth-Token: abcd" -H "X-Actor: bolba" \\
  http://127.0.0.1:7492/tasks/5261 -d @- <<'EOF'
{"status":"open","due":"2026-08-18","timeline":[{"ts":"2026-08-18 09:24","text":"🔴 **La revalidación falló** ..."}]}
EOF`;

describe('shellTokenize line continuation', () => {
  it('removes backslash-newline outside quotes (no phantom token)', () => {
    expect(shellTokenize('a \\\n b')).toEqual(['a', 'b']);
  });

  it('removes backslash-newline inside double quotes', () => {
    expect(shellTokenize('"a\\\nb"')).toEqual(['ab']);
  });

  it('keeps other escapes intact', () => {
    expect(shellTokenize('a\\ b "x\\"y"')).toEqual(['a b', 'x"y']);
  });
});

describe('parseCurlCommand with continuations', () => {
  it('finds the URL after a backslash-newline continuation', () => {
    const parsed = parseCurlCommand(PATCH_CMD);
    expect(parsed?.url).toBe('http://127.0.0.1:7492/tasks/5261');
    expect(parsed?.method).toBe('PATCH');
    expect(parsed?.headers['X-Actor']).toBe('bolba');
  });
});

describe('detectBolbaTasksCall', () => {
  const parse = (cmd: string) => {
    const parsed = parseCurlCommand(cmd);
    expect(parsed).not.toBeNull();
    return detectBolbaTasksCall(parsed!, cmd);
  };

  it('detects a PATCH update with heredoc body', () => {
    const call = parse(PATCH_CMD);
    expect(call).not.toBeNull();
    expect(call!.action).toBe('update');
    expect(call!.taskId).toBe('5261');
    expect(call!.actor).toBe('bolba');
    expect(call!.body).toMatchObject({ status: 'open', due: '2026-08-18' });
  });

  it('detects the board read with filters and as=text', () => {
    const call = parse('curl -s "http://127.0.0.1:7492/tasks?due=overdue&as=text" -H "X-Auth-Token: abcd"');
    expect(call!.action).toBe('board');
    expect(call!.asText).toBe(true);
    expect(call!.filters).toBe('due=overdue');
    expect(call!.taskId).toBeUndefined();
  });

  it('detects search with a decoded query', () => {
    const call = parse('curl -s "http://127.0.0.1:7492/search?q=aurora%20mysql&as=text" -H "X-Auth-Token: abcd"');
    expect(call!.action).toBe('search');
    expect(call!.query).toBe('aurora mysql');
  });

  it('detects timeline / close / reopen / delete sub-actions', () => {
    expect(parse('curl -s -X POST http://127.0.0.1:7492/tasks/5267/timeline -d \'{"timeline":["x"]}\'')!.action).toBe('timeline');
    expect(parse('curl -s -X POST http://127.0.0.1:7492/tasks/5266/close -d \'{"status":"done"}\'')!.action).toBe('close');
    expect(parse('curl -s -X POST http://127.0.0.1:7492/tasks/5266/reopen')!.action).toBe('reopen');
    expect(parse('curl -s -X DELETE http://127.0.0.1:7492/tasks/5275')!.action).toBe('delete');
  });

  it('detects create with an inline body title', () => {
    const call = parse('curl -s -X POST http://127.0.0.1:7492/tasks -d \'{"title":"nueva","proj":"MDO"}\'');
    expect(call!.action).toBe('create');
    expect(call!.body).toMatchObject({ title: 'nueva' });
  });

  it('detects health / stats / duplicates', () => {
    expect(parse('curl -s http://127.0.0.1:7492/health')!.action).toBe('health');
    expect(parse('curl -s http://127.0.0.1:7492/stats -H "X-Auth-Token: abcd"')!.action).toBe('stats');
    expect(parse('curl -s "http://127.0.0.1:7492/duplicates?title=algo" -H "X-Auth-Token: abcd"')!.query).toBe('algo');
  });

  it('ignores non-7492 hosts (TC API keeps its own card)', () => {
    const parsed = parseCurlCommand('curl -s http://localhost:5174/api/agents -H "X-Auth-Token: abcd"');
    expect(detectBolbaTasksCall(parsed!)).toBeNull();
    expect(detectTcApiCall(parsed!)).not.toBeNull();
  });

  it('ignores remote hosts on port 7492', () => {
    const parsed = parseCurlCommand('curl -s http://10.0.0.5:7492/tasks');
    expect(detectBolbaTasksCall(parsed!)).toBeNull();
  });
});

describe('parseBolbaTextTable', () => {
  const TABLE = [
    'id    proj           status    due         age  title',
    '--------------------------------------------------------------------------------------------------------------',
    '5267  OPM            open      2026-08-18  1d   ALT-19309 / SIR0118433: explicar qué actividad hacía TIDE',
    '5248  Administracion waiting   -           4d   confirmar llegada de la RTX 3090',
    '5262  Personal       open      2026-08-17 12:00 1d   preparar la computadora para el corte eléctrico',
    '5259  MDO            open      2026-08-17  1d   **revisar y apoyar el folio OSPEI-2870** solicitado',
  ].join('\n');

  it('parses rows including bare `-` due and due-with-time', () => {
    const rows = parseBolbaTextTable(TABLE);
    expect(rows).toHaveLength(4);
    expect(rows![0]).toMatchObject({ id: 5267, proj: 'OPM', status: 'open', due: '2026-08-18', age: '1d' });
    expect(rows![1].due).toBeUndefined();
    expect(rows![2]).toMatchObject({ id: 5262, due: '2026-08-17 12:00' });
    expect(rows![3].title).toContain('**revisar');
  });

  it('returns null for a markdown block (single task as=text)', () => {
    expect(parseBolbaTextTable('- [ ] 🚢 tide-commander — 🛠️ **algo**\n  - due:: 2026-08-19')).toBeNull();
  });
});

describe('classifyBolbaTasksOutput', () => {
  it('classifies {count, tasks} listings', () => {
    const out = classifyBolbaTasksOutput(JSON.stringify({
      count: 2,
      tasks: [
        { id: 5267, proj: 'OPM', type: 'validacion', status: 'open', due: '2026-08-18', title: 'ALT-19309' },
        { id: 5248, proj: 'Administracion', status: 'waiting', due: null, title: 'RTX 3090' },
      ],
    }));
    expect(out).toMatchObject({ kind: 'list', count: 2 });
    if (out?.kind !== 'list') return;
    expect(out.tasks[0]).toMatchObject({ id: 5267, proj: 'OPM', status: 'open' });
    expect(out.tasks[1].due).toBeUndefined();
  });

  it('classifies the as=text table as a list', () => {
    const out = classifyBolbaTasksOutput('id    proj  status    due         age  title\n----\n5267  OPM   open      2026-08-18  1d   algo');
    expect(out).toMatchObject({ kind: 'list', count: 1 });
  });

  it('classifies a create 201 with its new id', () => {
    const out = classifyBolbaTasksOutput(JSON.stringify({
      id: 5275,
      reimported: [],
      task: { id: 5275, proj: 'tide-commander', status: 'open', title: 'INVENTARIO ejemplo', head: '🚢 tide-commander — 🛠️ **INVENTARIO ejemplo**', timeline_count: 1, last_event: '2026-08-18 09:36 ejemplo' },
    }));
    expect(out).toMatchObject({ kind: 'mutation', createdId: 5275 });
    if (out?.kind !== 'mutation') return;
    expect(out.task.head).toContain('🚢');
    expect(out.task.timelineCount).toBe(1);
  });

  it('classifies a close with warnings and reimported files', () => {
    const out = classifyBolbaTasksOutput(JSON.stringify({
      task: { id: 5266, status: 'done', done: '2026-08-18 09:36', due: null, real: 5, title: 'layout enviado' },
      warnings: ['cerraste sin evento de timeline; agrega la evidencia del cierre'],
      reimported: ['Tareas.md'],
    }));
    expect(out).toMatchObject({ kind: 'mutation' });
    if (out?.kind !== 'mutation') return;
    expect(out.warnings).toHaveLength(1);
    expect(out.reimported).toEqual(['Tareas.md']);
    expect(out.task).toMatchObject({ status: 'done', real: 5 });
  });

  it('classifies a timeline append with its added count', () => {
    const out = classifyBolbaTasksOutput(JSON.stringify({ task: { id: 5267, title: 'x', status: 'open' }, added: 3 }));
    expect(out).toMatchObject({ kind: 'mutation', added: 3 });
  });

  it('classifies DELETE result', () => {
    expect(classifyBolbaTasksOutput('{"deleted": 5275}')).toEqual({ kind: 'deleted', id: 5275 });
  });

  it('classifies the 409 duplicate decision with candidates', () => {
    const out = classifyBolbaTasksOutput(JSON.stringify({
      error: 'posible duplicado; revisa y reintenta con force=true o usa PATCH',
      candidates: [{ id: 5261, title: 'salud del ambiente UAT', proj: 'MDO', status: 'open', similarity: 1.0, jaccard: 0.22, containment: 1.0 }],
    }));
    expect(out).toMatchObject({ kind: 'duplicate' });
    if (out?.kind !== 'duplicate') return;
    expect(out.candidates[0]).toMatchObject({ id: 5261, similarity: 1.0 });
  });

  it('classifies validation errors with the valid list', () => {
    const out = classifyBolbaTasksOutput('{"error":"proj invalido: NOPE","valid":["MDO","OPM"]}');
    expect(out).toMatchObject({ kind: 'error', error: 'proj invalido: NOPE', valid: ['MDO', 'OPM'] });
  });

  it('classifies /health', () => {
    const out = classifyBolbaTasksOutput(JSON.stringify({
      ok: true,
      db: '/home/riven/.local/share/bolba/tasks.db',
      drift: [],
      stats: { by_status: { open: 26, done: 97 }, due_today_or_overdue: 14, counter: '5277' },
    }));
    expect(out).toMatchObject({ kind: 'health', ok: true, dueTodayOrOverdue: 14 });
    if (out?.kind !== 'health') return;
    expect(out.byStatus).toContainEqual(['open', 26]);
  });

  it('classifies bare /stats output (no ok/stats wrapper)', () => {
    const out = classifyBolbaTasksOutput(JSON.stringify({
      by_status: { open: 26, waiting: 2 },
      open_by_proj: { MDO: 11 },
      due_today_or_overdue: 14,
      counter: '5277',
    }));
    expect(out).toMatchObject({ kind: 'health', ok: true, dueTodayOrOverdue: 14 });
  });

  it('falls back to text for python-formatted one-liners', () => {
    const out = classifyBolbaTasksOutput('5261 -> open | due: 2026-08-18 | section: hoy | eventos: 35');
    expect(out).toMatchObject({ kind: 'text' });
  });

  it('returns null for empty output', () => {
    expect(classifyBolbaTasksOutput('')).toBeNull();
    expect(classifyBolbaTasksOutput(undefined)).toBeNull();
  });
});
