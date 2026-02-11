#!/usr/bin/env gjs

/**
 * Tide Commander KRunner DBus Runner
 *
 * Query examples:
 *   tc gus
 *   tide area backend
 */

imports.gi.versions.Gio = '2.0';
imports.gi.versions.GLib = '2.0';

const { Gio, GLib } = imports.gi;

const BUS_NAME = 'org.riven.tide.krunner';
const OBJECT_PATH = '/runner';
const API_BASE = GLib.getenv('TIDE_COMMANDER_API') || 'http://localhost:5174/api';
const APP_CAPTION = GLib.getenv('TIDE_COMMANDER_WINDOW_CAPTION') || 'Tide Commander';
const APP_DESKTOP_FILE = GLib.getenv('TIDE_COMMANDER_DESKTOP_FILE') || 'brave-idemibpphagihbobmgmaojhjfidlfpdl-Default';
const APP_KWIN_SHORTCUT = GLib.getenv('TIDE_COMMANDER_KWIN_SHORTCUT') || 'AppToggler25TideCommander';
let lastActivationToken = '';

const IFACE_XML = `
<node>
  <interface name="org.kde.krunner1">
    <method name="Config">
      <arg name="config" type="a{sv}" direction="out"/>
    </method>
    <method name="Actions">
      <arg name="actions" type="a(sss)" direction="out"/>
    </method>
    <method name="SetActivationToken">
      <arg name="token" type="s" direction="in"/>
    </method>
    <method name="Run">
      <arg name="matchId" type="s" direction="in"/>
      <arg name="actionId" type="s" direction="in"/>
    </method>
    <method name="Match">
      <arg name="query" type="s" direction="in"/>
      <arg name="matches" type="a(sssida{sv})" direction="out"/>
    </method>
  </interface>
</node>`;

function shellEscapeSingleQuotes(str) {
  return str.replace(/'/g, `'\\''`);
}

function runShell(command) {
  try {
    const [ok, stdout, stderr] = GLib.spawn_command_line_sync(command);
    const out = (stdout ? ByteArray.toString(stdout) : '').trim();
    const err = (stderr ? ByteArray.toString(stderr) : '').trim();
    return { ok, out, err };
  } catch (_err) {
    return { ok: false, out: '', err: 'spawn failed' };
  }
}

function fetchJson(url) {
  const cmd = `curl -s --max-time 1 '${shellEscapeSingleQuotes(url)}'`;
  const { out } = runShell(cmd);
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch (_err) {
    return null;
  }
}

function normalize(text) {
  return (text || '').toString().toLowerCase().trim();
}

function contains(haystack, needle) {
  return normalize(haystack).includes(normalize(needle));
}

function splitQuery(query) {
  const trimmed = normalize(query);
  if (!trimmed) return { isTrigger: true, term: '' };

  if (trimmed === 'tc' || trimmed === 'tide') {
    return { isTrigger: true, term: '' };
  }

  if (trimmed.startsWith('tc ')) {
    return { isTrigger: true, term: trimmed.slice(3).trim() };
  }
  if (trimmed.startsWith('tide ')) {
    return { isTrigger: true, term: trimmed.slice(5).trim() };
  }

  // In many KRunner setups, Match receives only the text after trigger words.
  // Accept plain text as a valid term so autocomplete works reliably.
  return { isTrigger: true, term: trimmed };
}

function scoreText(text, term) {
  const t = normalize(text);
  const q = normalize(term);
  if (!q) return 0.7;
  if (t === q) return 1.0;
  if (t.startsWith(q)) return 0.95;
  if (t.includes(q)) return 0.85;
  return 0.0;
}

function isActiveStatus(status) {
  const normalized = normalize(status);
  return normalized === 'working' ||
    normalized === 'waiting' ||
    normalized === 'waiting_permission' ||
    normalized === 'orphaned';
}

function asVariantDict(props) {
  const dict = {};
  for (const [k, v] of Object.entries(props)) {
    if (Array.isArray(v)) {
      dict[k] = GLib.Variant.new_strv(v);
    } else if (typeof v === 'string') {
      dict[k] = new GLib.Variant('s', v);
    } else if (typeof v === 'boolean') {
      dict[k] = new GLib.Variant('b', v);
    } else if (typeof v === 'number') {
      dict[k] = new GLib.Variant('d', v);
    }
  }
  return dict;
}

function makeMatch(id, text, subtext, relevance) {
  return [
    id,
    text,
    'terminal',
    100,
    relevance,
    asVariantDict({
      subtext,
      category: 'Tide Commander',
      actions: [],
    }),
  ];
}

function areaMapFromAreas(areas) {
  const map = new Map();
  for (const area of areas) {
    if (!area || !Array.isArray(area.assignedAgentIds)) continue;
    for (const agentId of area.assignedAgentIds) {
      if (!map.has(agentId)) {
        map.set(agentId, area.name || 'No area');
      }
    }
  }
  return map;
}

function focusTideWindow() {
  // Invoke the persistent AppToggler KWin shortcut (from kde-toggle-windows-shortcuts).
  // Ephemeral KWin scripts loaded via loadScript/start/unloadScript don't get
  // proper focus privileges on Wayland. The AppToggler runs inside KWin as a
  // registered plugin, so workspace.activeWindow = client actually works.
  runShell(
    `qdbus org.kde.kglobalaccel /component/kwin org.kde.kglobalaccel.Component.invokeShortcut '${shellEscapeSingleQuotes(APP_KWIN_SHORTCUT)}' >/dev/null 2>&1`
  );
}

function focusAgent(agentId) {
  const payload = JSON.stringify({ agentId, openTerminal: true }).replace(/'/g, `'\\''`);
  const activationHeader = lastActivationToken
    ? ` -H 'X-KDE-ActivationToken: ${shellEscapeSingleQuotes(lastActivationToken)}'`
    : '';
  runShell(
    `curl -s -X POST '${API_BASE}/focus-agent' -H 'Content-Type: application/json'${activationHeader} -d '${payload}' >/dev/null`
  );
  // Retry focus a few times (Wayland can delay activation).
  focusTideWindow();
}

class TideRunner {
  Config() {
    return {
      TriggerWords: new GLib.Variant('as', ['tc', 'tide']),
      MinLetterCount: new GLib.Variant('i', 0),
    };
  }

  Actions() {
    return [];
  }

  SetActivationToken(token) {
    lastActivationToken = String(token || '');
  }

  Run(matchId, _actionId) {
    if (matchId.startsWith('agent:')) {
      focusAgent(matchId.slice(6));
      return;
    }
    if (matchId.startsWith('area:')) {
      const parts = matchId.slice(5).split(':');
      const fallbackAgentId = parts[1] || '';
      if (fallbackAgentId) {
        focusAgent(fallbackAgentId);
      } else {
        focusTideWindow();
      }
      return;
    }
    focusTideWindow();
  }

  Match(query) {
    const parsed = splitQuery(query);
    if (!parsed.isTrigger) return [];

    const agents = fetchJson(`${API_BASE}/agents`) || [];
    const areas = fetchJson(`${API_BASE}/areas`) || [];

    const term = parsed.term;
    const matches = [];

    const agentsById = new Map();
    for (const agent of agents) {
      agentsById.set(agent.id, agent);
    }
    const areaByAgentId = areaMapFromAreas(areas);

    const agentCandidates = [];
    const areaCandidates = [];

    for (const agent of agents) {
      if (
        term &&
        !contains(agent.name, term) &&
        !contains(agent.class, term) &&
        !contains(areaByAgentId.get(agent.id) || '', term) &&
        !contains(agent.cwd, term) &&
        !contains(agent.status, term)
      ) {
        continue;
      }
      const relevance = Math.max(
        scoreText(agent.name, term),
        scoreText(agent.class, term),
        scoreText(areaByAgentId.get(agent.id) || '', term),
        scoreText(agent.cwd, term),
        scoreText(agent.status, term),
        term ? 0.6 : 0.7
      );
      const lastActivity = Number(agent.lastActivity || 0);
      const activeRank = isActiveStatus(agent.status) ? 1 : 0;
      const areaName = areaByAgentId.get(agent.id) || 'No area';

      agentCandidates.push({
        activeRank,
        lastActivity,
        relevance,
        match: makeMatch(
          `agent:${agent.id}`,
          `${agent.name} [${areaName}]`,
          `${agent.class} • ${agent.status} • Area: ${areaName}`,
          relevance
        ),
      });
    }

    for (const area of areas) {
      if (!area || !area.name) continue;
      if (term && !contains(area.name, term) && !contains('area', term)) continue;

      const assigned = Array.isArray(area.assignedAgentIds) ? area.assignedAgentIds : [];
      const fallbackAgentId = assigned.find((id) => agentsById.has(id)) || '';
      const previewAgent = fallbackAgentId ? agentsById.get(fallbackAgentId).name : 'no agents';

      const relevance = Math.max(scoreText(area.name, term), term ? 0.55 : 0.65);
      areaCandidates.push({
        relevance,
        match: makeMatch(
          `area:${area.id}:${fallbackAgentId}`,
          `Area: ${area.name}`,
          `Open ${previewAgent}`,
          relevance
        ),
      });
    }

    agentCandidates.sort((a, b) => {
      if (b.activeRank !== a.activeRank) return b.activeRank - a.activeRank;
      if (b.lastActivity !== a.lastActivity) return b.lastActivity - a.lastActivity;
      return b.relevance - a.relevance;
    });
    areaCandidates.sort((a, b) => b.relevance - a.relevance);

    for (const candidate of agentCandidates) matches.push(candidate.match);
    for (const candidate of areaCandidates) matches.push(candidate.match);

    if (matches.length === 0) {
      matches.push(
        makeMatch(
          'tide:open',
          'Tide Commander',
          'No agent or area matched',
          0.6
        )
      );
    }

    return matches.slice(0, 12);
  }
}

const ByteArray = imports.byteArray;
const loop = new GLib.MainLoop(null, false);
const runner = new TideRunner();
const dbusObject = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, runner);

const connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
dbusObject.export(connection, OBJECT_PATH);

Gio.bus_own_name_on_connection(
  connection,
  BUS_NAME,
  Gio.BusNameOwnerFlags.NONE,
  null,
  null
);

loop.run();
