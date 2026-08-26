/**
 * Command Handler
 * Handles sending commands to agents (both regular and boss agents)
 */

import * as fs from 'fs';
import * as path from 'path';
import { agentService, runtimeService, skillService, customClassService } from '../../services/index.js';
import { createLogger, getCommanderBaseUrl } from '../../utils/index.js';
import { getAuthToken } from '../../auth/index.js';
import { handleRequestContextStats } from './agent-handler.js';
import { pluginManager } from '../../plugins/index.js';
import type { HandlerContext } from './types.js';
import type { ServerMessage } from '../../../shared/types.js';

const log = createLogger('CommandHandler');

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', '.next', '__pycache__', '.cache',
  'coverage', '.claude', '.venv', 'venv', 'build', 'out', '.turbo',
]);

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'tiff', 'heic', 'avif',
  'zip', 'tar', 'gz', 'bz2', 'rar', '7z', 'xz', 'zst',
  'exe', 'dll', 'so', 'dylib', 'bin', 'obj', 'o', 'a',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv', 'flac', 'ogg', 'webm',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'pyc', 'pyo', 'class', 'jar',
  'db', 'sqlite', 'sqlite3',
]);

function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

// Escape a string for safe use inside an XML attribute value.
function attr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Recursively list every entry (file or dir) under `dirPath`, respecting the
// ignore list. Used to build the structural listing for `[@folder:]` mentions —
// the LLM sees the layout (paths only) without paying the token cost of every
// file's content. Binary files are kept in the listing because their presence
// is informative (e.g. "there's an .apk here") even though they wouldn't be
// read for a `[@file:]` mention.
function listDirEntriesRecursive(dirPath: string, relBase: string, maxDepth = 6): string[] {
  const entries: string[] = [];
  function walk(dir: string, rel: string, depth: number) {
    if (depth > maxDepth) return;
    let dirents: fs.Dirent[];
    try { dirents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const dirent of dirents) {
      if (IGNORED_DIRS.has(dirent.name)) continue;
      const entryRel = rel ? `${rel}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        entries.push(`${entryRel}/`);
        walk(path.join(dir, dirent.name), entryRel, depth + 1);
      } else if (dirent.isFile()) {
        entries.push(entryRel);
      }
    }
  }
  walk(dirPath, relBase, 0);
  return entries;
}

export async function expandFileMentions(command: string, cwd: string): Promise<string> {
  const FILE_RE = /\[@file:([^\]]+)\]/g;
  const FOLDER_RE = /\[@folder:([^\]]+)\]/g;
  const AGENT_RE = /\[@agent:([^\]]+)\]/g;

  const fileMatches = [...command.matchAll(FILE_RE)];
  const folderMatches = [...command.matchAll(FOLDER_RE)];
  const agentMatches = [...command.matchAll(AGENT_RE)];
  if (fileMatches.length === 0 && folderMatches.length === 0 && agentMatches.length === 0) return command;

  // PASO 1 & 2: Strip tokens from user text, build resolution maps
  let userText = command;
  for (const match of [...fileMatches, ...folderMatches, ...agentMatches]) {
    userText = userText.replace(match[0], '');
  }

  const filesToProcess = new Map<string, string>(); // relPath -> fullPath (deduplicated)
  const foldersToList = new Map<string, string[]>(); // relPath -> recursive entry listing
  const resolvedMentions = new Map<string, string>(); // original ref -> resolved relPath

  // PASO 2: Resolve file tokens
  for (const match of fileMatches) {
    const relPath = match[1].trim();
    resolvedMentions.set(relPath, relPath);
    if (!isBinaryFile(relPath)) {
      filesToProcess.set(relPath, path.join(cwd, relPath));
    }
  }

  // PASO 2: Resolve folder tokens — list structure only. File contents are
  // intentionally NOT inlined here: the LLM should see the layout and ask for
  // specific files via `[@file:]` if it needs their content.
  for (const match of folderMatches) {
    const relPath = match[1].trim();
    const fullPath = path.join(cwd, relPath);
    resolvedMentions.set(relPath, relPath);
    try {
      const stat = await fs.promises.stat(fullPath);
      if (stat.isDirectory()) {
        foldersToList.set(relPath, listDirEntriesRecursive(fullPath, relPath));
      }
    } catch {
      // folder not found — skip
    }
  }

  // PASO 2: Resolve agent tokens. Tagging an agent injects that agent's identity
  // (the id is the key the prompted agent needs to coordinate / message them)
  // as context only — no message is sent to the tagged agent here.
  const agenteBlocks: string[] = [];
  const seenAgents = new Set<string>();
  for (const match of agentMatches) {
    const agentId = match[1].trim();
    if (seenAgents.has(agentId)) continue;
    seenAgents.add(agentId);
    const a = agentService.getAgent(agentId);
    if (!a) continue;
    const estado = a.trackingStatus || a.status || 'unknown';
    agenteBlocks.push(
      `  <agente id="${attr(agentId)}" nombre="${attr(a.name)}" clase="${attr(a.class)}"` +
        ` jefe="${a.isBoss ? 'true' : 'false'}" estado="${attr(String(estado))}" cwd="${attr(a.cwd || '')}"/>`
    );
  }

  // PASO 4 (rewrite): normalize @mention text in the user prompt to exact resolved paths
  const MENTION_RE = /@([\w./\-]+)/g;
  userText = userText.replace(MENTION_RE, (_full, ref) => {
    if (resolvedMentions.has(ref)) return `@${resolvedMentions.get(ref)}`;
    // suffix match: @src → android/app/src
    for (const [orig] of resolvedMentions) {
      if (orig === ref || orig.endsWith(`/${ref}`)) return `@${orig}`;
    }
    return _full;
  });

  userText = userText.trim();

  // PASO 3a: Read each [@file:] mention and wrap content in XML CDATA
  const archivoBlocks: string[] = [];
  for (const [relPath, fullPath] of filesToProcess) {
    try {
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      archivoBlocks.push(
        `  <archivo ruta="${relPath}">\n    <![CDATA[\n${content}\n    ]]>\n  </archivo>`
      );
    } catch {
      // skip unreadable files
    }
  }

  // PASO 3b: Emit folder mentions as structure-only listings (no file content).
  // Directories are marked with a trailing slash so the layout reads naturally.
  const carpetaBlocks: string[] = [];
  for (const [relPath, entries] of foldersToList) {
    const listing = entries.length > 0 ? entries.join('\n') : '(carpeta vacía)';
    carpetaBlocks.push(
      `  <carpeta ruta="${relPath}">\n    <![CDATA[\n${listing}\n    ]]>\n  </carpeta>`
    );
  }

  if (archivoBlocks.length === 0 && carpetaBlocks.length === 0 && agenteBlocks.length === 0) {
    return userText || command;
  }

  // PASO 4: Compile — structured context first, then internal guidance (wrapped
  // in <instrucciones_internas> so the chat UI strips it and the user only sees
  // their original text), then the user instruction. Each context kind that is
  // present contributes its own block and its own guidance paragraph.
  const sections: string[] = [];
  const guidanceParts: string[] = [];

  if (archivoBlocks.length > 0 || carpetaBlocks.length > 0) {
    const contextChildren = [...archivoBlocks, ...carpetaBlocks].join('\n\n');
    sections.push(`<archivos_contexto>\n${contextChildren}\n</archivos_contexto>`);
    // Tell the model to echo back the exact `ruta="..."` value as plain text —
    // the Tide file viewer resolves clicks against the agent cwd, so any
    // deviation produces a 404.
    guidanceParts.push(
      'Formato de rutas en tu respuesta: cuando te refieras a un archivo del contexto anterior, ' +
        'usa exactamente el valor del atributo ruta="..." como texto plano (ej. src/foo/bar.ts:42). ' +
        'No envuelvas la ruta en tags XML, no agregues prefijos como "archivo:"/"file:"/"carpeta:", ' +
        'y no la pongas en un enlace de markdown. Para una <carpeta>, solo recibes su estructura ' +
        '(listado de rutas) — si necesitas el contenido de un archivo específico de adentro, ' +
        'léelo con tus herramientas habituales antes de responder.'
    );
  }

  if (agenteBlocks.length > 0) {
    sections.push(`<agentes_contexto>\n${agenteBlocks.join('\n')}\n</agentes_contexto>`);
    guidanceParts.push(
      'Agentes mencionados: el bloque <agentes_contexto> lista otros agentes del sistema que el ' +
        'usuario etiquetó con @. Para coordinarte o delegar con alguno, usa su atributo id="..." ' +
        'exacto al enviarle un mensaje vía la API (POST /api/agents/<id>/message) o la skill de ' +
        'mensajería entre agentes. No inventes ids; usa solo los que aparecen aquí. Esto es ' +
        'contexto: no se envió ningún mensaje a esos agentes automáticamente al etiquetarlos.'
    );
  }

  const pathGuidance = `<instrucciones_internas>\n${guidanceParts.join('\n\n')}\n</instrucciones_internas>`;
  return `${sections.join('\n\n')}\n\n${pathGuidance}\n\nPetición: ${userText}`;
}

/**
 * Track last boss commands for delegation parsing
 */
const lastBossCommands = new Map<string, string>();

/**
 * Get the last command sent to a boss agent
 */
export function getLastBossCommand(bossId: string): string | undefined {
  return lastBossCommands.get(bossId);
}

/**
 * Set the last command sent to a boss agent
 */
export function setLastBossCommand(bossId: string, command: string): void {
  lastBossCommands.set(bossId, command);
}

/**
 * Build the agent identity header with ID and name
 * This helps agents know who they are for notifications and other self-referential tasks
 */
function buildAgentIdentityHeader(agentId: string): string {
  const agent = agentService.getAgent(agentId);
  const agentName = agent?.name || 'Unknown';
  const authToken = getAuthToken();
  const authHeader = authToken ? ` -H "X-Auth-Token: ${authToken}"` : '';
  const baseUrl = getCommanderBaseUrl();

  return `# Agent Identity

You are agent **${agentName}** with ID \`${agentId}\`.

Use this ID when sending notifications via the Tide Commander API:
\`\`\`bash
curl -s -X POST ${baseUrl}/api/notify -H "Content-Type: application/json"${authHeader} -d '{"agentId":"${agentId}","title":"Title","message":"Message"}'
\`\`\`

---

`;
}

/**
 * Build customAgentConfig for an agent based on its class instructions, skills, and custom instructions
 * Returns undefined if no instructions or skills are configured
 */
export function buildCustomAgentConfig(agentId: string, agentClass: string): { name: string; definition: { description: string; prompt: string } } | undefined {
  // Skip boss agents - they have their own prompt handling
  if (agentClass === 'boss') {
    return undefined;
  }

  const agent = agentService.getAgent(agentId);
  const classInstructions = customClassService.getClassInstructions(agentClass);
  const skillsContent = skillService.buildSkillPromptContent(agentId, agentClass, agent?.isBoss);
  const customInstructions = agent?.customInstructions;

  // Always include agent identity header so agents know their ID
  let combinedPrompt = buildAgentIdentityHeader(agentId);

  if (skillsContent) {
    combinedPrompt += skillsContent;
  }

  // Keep class instructions in a dedicated section near the end so they are
  // less likely to get buried by long skill docs.
  if (classInstructions) {
    combinedPrompt += '\n\n# Agent Class Instructions\n\n';
    combinedPrompt += 'The following class instructions are mandatory and must be followed unless the user explicitly overrides them.\n\n';
    combinedPrompt += classInstructions;
  }

  // Append agent-specific custom instructions at the end
  if (customInstructions) {
    combinedPrompt += '\n\n# Custom Instructions\n\n';
    combinedPrompt += customInstructions;
  }

  // Even if no class instructions or skills, we still return the config with identity header
  const customClass = customClassService.getCustomClass(agentClass);
  return {
    name: customClass?.id || agentClass,
    definition: {
      description: customClass?.description || `Agent class: ${agentClass}`,
      prompt: combinedPrompt,
    },
  };
}

/**
 * Handle send_command message
 * Routes commands differently for boss agents vs regular agents
 */
export async function handleSendCommand(
  ctx: HandlerContext,
  payload: { agentId: string; command: string; forceInterrupt?: boolean; queueOnly?: boolean },
  buildBossMessage: (bossId: string, command: string) => Promise<{ message: string; systemPrompt: string }>
): Promise<void> {
  const { agentId, command, forceInterrupt, queueOnly } = payload;
  const agent = agentService.getAgent(agentId);

  if (!agent) {
    log.error(` Agent not found: ${agentId}`);
    return;
  }

  const trimmedCmd = command.trim();
  const pluginCommand = pluginManager.matchSlashCommand(trimmedCmd);

  // Commands handled entirely here never reach the runner, so they'd never get
  // the usual `command_started` broadcast and the user's own command would
  // vanish from the chat. Echo it first so every slash command the user types
  // appears in history through the same path as an ordinary message.
  const isInterceptedCommand = trimmedCmd === '/context'
    || trimmedCmd === '/cost'
    || trimmedCmd === '/clear'
    || pluginCommand !== null;
  if (isInterceptedCommand) {
    ctx.broadcast({
      type: 'command_started',
      payload: { agentId, command: trimmedCmd },
    } as ServerMessage);
  }

  // Intercept /context and /cost for ALL agents (boss or regular) BEFORE routing.
  // The CLI /context slash command does NOT work via stdin in --print mode
  // (it gets treated as a user message). We generate stats from tracked data instead.
  if (trimmedCmd === '/context' || trimmedCmd === '/cost') {
    log.log(`Agent ${agent.name}: Intercepting ${trimmedCmd} - generating stats from tracked data`);
    await handleRequestContextStats(ctx, { agentId });
    return;
  }

  // Handle /clear command - clear session and start fresh
  if (trimmedCmd === '/clear') {
    log.log(`Agent ${agent.name}: /clear command - clearing session`);
    await runtimeService.stopAgent(agentId);
    agentService.updateAgent(agentId, {
      status: 'idle',
      currentTask: undefined,
      taskLabel: undefined,
      currentTool: undefined,
      lastAssignedTask: undefined,
      lastAssignedTaskTime: undefined,
      sessionId: undefined,
      tokensUsed: 0,
      contextUsed: 0,
      contextStats: undefined, // Clear context stats since session is reset
    });
    ctx.sendActivity(agentId, 'Session cleared - new session on next command');
    return;
  }

  // Enabled plugin slash commands are server-owned and never reach the LLM
  // runner. Their structured output is tied to this agent's chat transcript.
  if (pluginCommand) {
    log.log(`Agent ${agent.name}: Intercepting plugin command ${pluginCommand.invokedAs} (${pluginCommand.pluginId})`);
    try {
      const output = await pluginManager.executeSlashCommand(agentId, trimmedCmd);
      ctx.broadcast({
        type: 'plugin_output',
        payload: { agentId, output },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Plugin command ${pluginCommand.invokedAs} failed:`, err);
      ctx.sendActivity(agentId, `Plugin command failed: ${message}`);
    }
    return;
  }

  // Expand [@file:path] and [@folder:path] mentions by injecting file content
  const finalCommand = await expandFileMentions(command, agent.cwd);
  const sendOpts = forceInterrupt
    ? { forceInterrupt: true }
    : queueOnly
      ? { queueOnly: true }
      : undefined;

  // If this is a boss agent, handle differently
  if (agent.isBoss || agent.class === 'boss') {
    await handleBossCommand(ctx, agentId, finalCommand, agent.name, buildBossMessage, sendOpts);
  } else {
    await handleRegularAgentCommand(ctx, agentId, finalCommand, agent, sendOpts);
  }
}

/**
 * Handle command for boss agents
 * Boss agents get context injected in the user message
 */
async function handleBossCommand(
  ctx: HandlerContext,
  agentId: string,
  command: string,
  agentName: string,
  buildBossMessage: (bossId: string, command: string) => Promise<{ message: string; systemPrompt: string }>,
  sendOpts?: { forceInterrupt?: boolean; queueOnly?: boolean }
): Promise<void> {
  log.log(` Boss ${agentName} received command: "${command.slice(0, 50)}..."`);

  // Track the last command sent to this boss (for delegation parsing)
  lastBossCommands.set(agentId, command);

  // Detect if this is a team/status question vs a coding task
  const isTeamQuestion = /\b(subordinat|team|equipo|status|estado|hacen|doing|trabajando|working|progress|reporte|report|agentes|agents|chavos|who are you|hello|hola|hi\b)\b/i.test(command);

  try {
    // Boss agents get context injected in the user message with delimiters
    const { message: bossMessage, systemPrompt } = await buildBossMessage(agentId, command);
    // Also build customAgentConfig so boss gets its assigned skills (e.g. boss-instructions)
    const agent = agentService.getAgent(agentId);
    const customAgentConfig = agent ? buildCustomAgentConfig(agentId, agent.class) : undefined;
    runtimeService.sendCommand(agentId, bossMessage, systemPrompt, undefined, customAgentConfig, sendOpts);
  } catch (err: any) {
    log.error(` Boss ${agentName}: failed to build boss message:`, err);
    // Fallback to sending raw command
    runtimeService.sendCommand(agentId, command, undefined, undefined, undefined, sendOpts);
  }

  if (isTeamQuestion) {
    log.log(` Boss ${agentName}: detected team question`);
  } else {
    log.log(` Boss ${agentName}: detected coding task, delegation will be in response`);
  }
}

/**
 * Handle command for regular agents
 * Regular agents get custom class instructions and skills combined into a prompt
 */
async function handleRegularAgentCommand(
  ctx: HandlerContext,
  agentId: string,
  command: string,
  agent: { id: string; name: string; class: string; provider?: 'claude' | 'codex' | 'opencode' | 'grok' | 'pi'; contextUsed?: number; contextLimit?: number },
  sendOpts?: { forceInterrupt?: boolean; queueOnly?: boolean }
): Promise<void> {
  // Note: /context, /cost, /compact are intercepted at the handleSendCommand level
  // so they never reach here. This function only handles actual commands to send to the agent.

  const customAgentConfig = buildCustomAgentConfig(agentId, agent.class);

  if (customAgentConfig) {
    log.log(` Agent ${agent.name} customAgentConfig: name=${customAgentConfig.name}, promptLen=${customAgentConfig.definition.prompt.length}`);
  } else {
    log.log(` Agent ${agent.name} NO customAgentConfig (no instructions or skills)`);
  }

  // Check if agent has pending updates - inject into message if so
  let finalCommand = command;

  // Property updates (class, permissionMode, useChrome)
  if (agentService.hasPendingPropertyUpdates(agentId)) {
    const propertyNotification = agentService.buildPropertyUpdateNotification(agentId);
    if (propertyNotification) {
      finalCommand = propertyNotification + finalCommand;
      log.log(` Agent ${agent.name}: Injecting property update notification (${propertyNotification.length} chars)`);
    }
    agentService.clearPendingPropertyUpdates(agentId);
  }

  // Skill updates - send as UI notification instead of injecting into conversation
  if (skillService.hasPendingSkillUpdates(agentId)) {
    const skillUpdateData = skillService.getSkillUpdateData(agentId, agent.class as import('../../../shared/types.js').AgentClass);
    if (skillUpdateData) {
      // Send skill update as a special output message for UI rendering
      ctx.broadcast({
        type: 'output',
        payload: {
          agentId,
          text: '', // Empty text - the UI will render the skillUpdate data
          isStreaming: false,
          timestamp: Date.now(),
          skillUpdate: skillUpdateData,
        },
      });
      log.log(` Agent ${agent.name}: Sent skill update notification (${skillUpdateData.skills.length} skills)`);
    }
    skillService.clearPendingSkillUpdates(agentId);
  }

  try {
    await runtimeService.sendCommand(agentId, finalCommand, undefined, undefined, customAgentConfig, sendOpts);
  } catch (err: any) {
    log.error(' Failed to send command:', err);
    ctx.sendActivity(agentId, `Error: ${err.message}`);
  }
}
