#!/usr/bin/env gjs

/*
 * Tide Commander KRunner DBus Runner
 *
 * Exposes org.kde.krunner1 for native KRunner autocomplete and activation.
 */

imports.gi.versions.Gio = '2.0';
imports.gi.versions.GLib = '2.0';
const { Gio, GLib } = imports.gi;

const BUS_NAME = 'org.kde.runners.tide';
const OBJECT_PATH = '/runner';
const API_BASE = GLib.getenv('TIDE_API_BASE') || 'http://localhost:5174/api';
const TIDE_AUTH_TOKEN = GLib.getenv('TIDE_AUTH_TOKEN') || '';
const MAX_RESULTS = 12;
const CURL_TIMEOUT_SECONDS = '0.8';

let lastActivationToken = '';
let cachedAgents = [];
let cachedAreas = [];
let cacheAtMs = 0;

const IFACE_XML = `
<node>
  <interface name="org.kde.krunner1">
    <method name="Teardown"/>
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

function log(message) {
  GLib.log_structured('tide-krunner-runner', GLib.LogLevelFlags.LEVEL_INFO, {
    MESSAGE: message,
  });
}

function jsonCurl(url) {
  const args = [
    'curl',
    '-sS',
    '--max-time',
    CURL_TIMEOUT_SECONDS,
    '-H',
    'Accept: application/json',
  ];
  if (TIDE_AUTH_TOKEN) {
    args.push('-H', `Authorization: Bearer ${TIDE_AUTH_TOKEN}`);
  }
  args.push(url);

  try {
    const [ok, stdoutBytes] = GLib.spawn_sync(
      null,
      args,
      null,
      GLib.SpawnFlags.SEARCH_PATH,
      null
    );
    if (!ok) return null;
    const text = imports.byteArray.toString(stdoutBytes).trim();
    if (!text) return null;
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function shell(command) {
  try {
    GLib.spawn_command_line_async(command);
  } catch (_err) {
    // Best effort only.
  }
}

function ensureCache() {
  const now = Date.now();
  if (now - cacheAtMs < 1500 && cachedAgents.length > 0) {
    return;
  }

  const agents = jsonCurl(`${API_BASE}/agents`) || [];
  const areas = jsonCurl(`${API_BASE}/areas`) || [];

  cachedAgents = Array.isArray(agents) ? agents : [];
  cachedAreas = Array.isArray(areas) ? areas : [];
  cacheAtMs = now;
}

function toLower(value) {
  return String(value || '').toLowerCase();
}

function getActivitySortFields(agent) {
  const status = toLower(agent?.status);
  const isActive = status === 'working' || status === 'waiting' || status === 'waiting_permission' || status === 'orphaned'
    ? 1
    : 0;
  const rawLastActivity = Number(agent?.lastActivity ?? 0);
  const lastActivity = Number.isFinite(rawLastActivity) ? rawLastActivity : 0;
  return { isActive, lastActivity };
}

function areaByAgentId(agentId) {
  for (const area of cachedAreas) {
    const ids = Array.isArray(area.assignedAgentIds) ? area.assignedAgentIds : [];
    if (ids.includes(agentId)) {
      return area.name || 'Unknown area';
    }
  }
  return 'No area';
}

function matchQuery(rawQuery) {
  const query = String(rawQuery || '').trim();
  const lq = toLower(query);
  const prefixes = ['tide', 'agent'];

  const hasPrefix = prefixes.some((p) => lq === p || lq.startsWith(`${p} `));
  if (!hasPrefix) {
    return [];
  }

  const narrowed = lq.includes(' ') ? lq.split(/\s+/, 2)[1].trim() : '';
  ensureCache();

  const entries = [];
  for (const agent of cachedAgents) {
    const area = areaByAgentId(agent.id);
    const haystack = `${toLower(agent.name)} ${toLower(agent.id)} ${toLower(agent.class)} ${toLower(area)} ${toLower(agent.status)}`;
    if (narrowed && !haystack.includes(narrowed)) {
      continue;
    }

    const subtext = `${agent.class || 'agent'} • ${agent.status || 'unknown'} • ${area}`;
    const { isActive, lastActivity } = getActivitySortFields(agent);
    entries.push({
      id: `agent:${agent.id}`,
      text: agent.name || agent.id,
      icon: 'utilities-terminal',
      type: 100,
      relevance: narrowed ? 0.95 : 0.75,
      isActive,
      lastActivity,
      sortName: toLower(agent.name || agent.id),
      props: {
        subtext: new GLib.Variant('s', subtext),
        category: new GLib.Variant('s', 'Tide Commander Agents'),
      },
    });
  }

  entries.sort((a, b) => {
    if (b.isActive !== a.isActive) return b.isActive - a.isActive;
    if (b.lastActivity !== a.lastActivity) return b.lastActivity - a.lastActivity;
    if (Number(b.relevance) !== Number(a.relevance)) return Number(b.relevance) - Number(a.relevance);
    return a.sortName.localeCompare(b.sortName);
  });
  return entries.slice(0, MAX_RESULTS);
}

function activateTideWindowAndFocusAgent(agentId) {
  const jsPath = '/tmp/tide-focus-kwin.js';
  const jsCode = `var t=null;for (const w of workspace.windowList()){if((w.caption||'').indexOf('Tide Commander')!==-1||w.desktopFileName==='brave-idemibpphagihbobmgmaojhjfidlfpdl-Default'||w.resourceClass==='brave-idemibpphagihbobmgmaojhjfidlfpdl-Default'){t=w;break;}}if(t){t.minimized=false;workspace.activeWindow=t;}`;
  GLib.file_set_contents(jsPath, jsCode);

  const plugin = `tide_focus_${GLib.get_real_time()}`;
  shell(`qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript ${jsPath} ${plugin} >/dev/null 2>&1`);
  shell('qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.start >/dev/null 2>&1');
  shell(`qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript ${plugin} >/dev/null 2>&1`);

  const tokenHeader = lastActivationToken
    ? `-H 'X-KDE-ActivationToken: ${lastActivationToken.replace(/'/g, "'\\''")}' `
    : '';
  const authHeader = TIDE_AUTH_TOKEN
    ? `-H 'Authorization: Bearer ${TIDE_AUTH_TOKEN.replace(/'/g, "'\\''")}' `
    : '';
  const payload = `'{\"agentId\":\"${agentId}\",\"openTerminal\":true}'`;
  shell(`curl -s -X POST ${API_BASE}/focus-agent -H 'Content-Type: application/json' ${authHeader}${tokenHeader}-d ${payload} >/dev/null 2>&1`);
}

const nodeInfo = Gio.DBusNodeInfo.new_for_xml(IFACE_XML);
const ifaceInfo = nodeInfo.interfaces[0];

let registrationId = 0;
let ownerId = 0;

function onMethodCall(_conn, _sender, _objPath, _iface, method, params, invocation) {
  try {
    switch (method) {
      case 'Config': {
        const config = {
          MinLetterCount: new GLib.Variant('i', 1),
          TriggerWords: new GLib.Variant('as', ['tide', 'agent']),
        };
        invocation.return_value(new GLib.Variant('(a{sv})', [config]));
        break;
      }
      case 'Actions': {
        invocation.return_value(new GLib.Variant('(a(sss))', [[]]));
        break;
      }
      case 'SetActivationToken': {
        const [token] = params.deepUnpack();
        lastActivationToken = String(token || '');
        invocation.return_value(null);
        break;
      }
      case 'Teardown': {
        cachedAgents = [];
        cachedAreas = [];
        cacheAtMs = 0;
        invocation.return_value(null);
        break;
      }
      case 'Match': {
        const [query] = params.deepUnpack();
        const matches = matchQuery(query).map((m) => [
          m.id,
          m.text,
          m.icon,
          m.type,
          m.relevance,
          m.props,
        ]);
        invocation.return_value(new GLib.Variant('(a(sssida{sv}))', [matches]));
        break;
      }
      case 'Run': {
        const [matchId] = params.deepUnpack();
        if (String(matchId).startsWith('agent:')) {
          const agentId = String(matchId).slice('agent:'.length);
          activateTideWindowAndFocusAgent(agentId);
        }
        invocation.return_value(null);
        break;
      }
      default:
        invocation.return_dbus_error('org.kde.runners.tide.Error', `Unsupported method: ${method}`);
        break;
    }
  } catch (err) {
    invocation.return_dbus_error('org.kde.runners.tide.Error', `${err}`);
  }
}

const vtable = {
  method_call: onMethodCall,
};

function onBusAcquired(conn) {
  registrationId = conn.register_object(OBJECT_PATH, ifaceInfo, vtable, null);
  if (registrationId <= 0) {
    throw new Error('Failed to register org.kde.krunner1 object');
  }
  log('Runner registered on DBus');
}

function onNameLost() {
  log('DBus name lost, exiting');
  loop.quit();
}

const loop = new GLib.MainLoop(null, false);

ownerId = Gio.bus_own_name(
  Gio.BusType.SESSION,
  BUS_NAME,
  Gio.BusNameOwnerFlags.NONE,
  onBusAcquired,
  null,
  onNameLost
);

loop.run();

if (registrationId > 0) {
  try {
    const conn = Gio.bus_get_sync(Gio.BusType.SESSION, null);
    conn.unregister_object(registrationId);
  } catch (_err) {
    // Ignore during shutdown.
  }
}

if (ownerId > 0) {
  Gio.bus_unown_name(ownerId);
}
