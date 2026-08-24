import { randomUUID } from 'node:crypto';
import type { Agent } from '../../../shared/types.js';
import type {
  PluginActionContext,
  PluginAgentNameProposal,
  PluginAgentNameProposalsData,
  PluginCommandContext,
  TideServerPluginActivation,
  TideServerPluginApi,
} from '../../../shared/plugin-types.js';
import { agentService, runtimeService } from '../../services/index.js';
import { getCommanderBaseUrl } from '../../utils/index.js';
import { PluginRuntimeError, type BuiltinPluginDefinition } from '../manager.js';

export type RenameAgentSnapshot = Pick<Agent,
  | 'id'
  | 'name'
  | 'class'
  | 'cwd'
  | 'currentTask'
  | 'lastAssignedTask'
  | 'taskLabel'
  | 'trackingStatusDetail'
  | 'latestTodos'
>;

interface RenameAgentDependencies {
  getAgent: (id: string) => RenameAgentSnapshot | undefined;
  renameAgent: (id: string, name: string) => RenameAgentSnapshot | null;
  askAgent: (id: string, prompt: string) => Promise<void>;
  baseUrl: () => string;
}

const DEFAULT_DEPENDENCIES: RenameAgentDependencies = {
  getAgent: (id) => agentService.getAgent(id),
  renameAgent: (id, name) => agentService.updateAgent(id, { name }),
  askAgent: (id, prompt) => runtimeService.sendCommand(id, prompt),
  baseUrl: getCommanderBaseUrl,
};

const GENERATION_FEEDBACK_MS = 3 * 60_000;

interface PendingRenameRequest {
  data: PluginAgentNameProposalsData;
  agentClass: string;
  timer?: NodeJS.Timeout;
}

function cleanName(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64).trim()
    : '';
}

function identityTokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function preservesAgentIdentity(name: string, currentName: string, agentClass: string): boolean {
  const proposalTokens = new Set(identityTokens(name));
  const currentNameTokens = identityTokens(currentName);
  const classTokens = identityTokens(agentClass);
  const preservesCurrentName = currentNameTokens.length > 0
    && currentNameTokens.every((token) => proposalTokens.has(token));
  const preservesClass = classTokens.length > 0
    && classTokens.every((token) => proposalTokens.has(token));
  return preservesCurrentName || preservesClass;
}

function cleanReason(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180).trim()
    : '';
}

export function validateAiNameProposals(
  value: unknown,
  currentName: string,
  agentClass: string,
): PluginAgentNameProposal[] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new PluginRuntimeError('La IA debe devolver exactamente tres propuestas', 400, 'AGENT_PROPOSALS_INVALID');
  }
  const proposals = value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new PluginRuntimeError('Formato de propuesta inválido', 400, 'AGENT_PROPOSALS_INVALID');
    }
    const record = candidate as Record<string, unknown>;
    const name = cleanName(record.name);
    const reason = cleanReason(record.reason);
    if (name.length < 3 || name.split(/\s+/).length > 7 || !reason) {
      throw new PluginRuntimeError('Cada propuesta necesita un nombre breve y una explicación', 400, 'AGENT_PROPOSALS_INVALID');
    }
    if (!preservesAgentIdentity(name, currentName, agentClass)) {
      throw new PluginRuntimeError(
        `Cada propuesta debe conservar el nombre ${currentName} o la clase ${agentClass}`,
        400,
        'AGENT_IDENTITY_REQUIRED',
      );
    }
    return { name, reason };
  });
  const normalized = proposals.map((proposal) => proposal.name.toLocaleLowerCase());
  if (new Set(normalized).size !== 3 || normalized.includes(currentName.trim().toLocaleLowerCase())) {
    throw new PluginRuntimeError('Las tres propuestas deben ser distintas del nombre actual', 400, 'AGENT_PROPOSALS_INVALID');
  }
  return proposals;
}

function activityHint(agent: RenameAgentSnapshot): string {
  const todo = agent.latestTodos?.find((item) => item.status === 'in_progress')?.content
    ?? agent.latestTodos?.find((item) => item.status === 'pending')?.content;
  return [agent.taskLabel, agent.currentTask, todo, agent.trackingStatusDetail, agent.lastAssignedTask]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim().slice(0, 180)
    ?? `Clase ${String(agent.class)} en ${agent.cwd.split(/[\\/]/).filter(Boolean).pop() || 'su proyecto actual'}`;
}

export function buildAiRenamePrompt(
  agent: RenameAgentSnapshot,
  requestId: string,
  baseUrl: string,
): string {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/plugins/rename-agent/actions/proposals`;
  return `[RENAME_AGENT_PROPOSALS_REQUEST]\nAnaliza tu conversación, contexto, tareas y actividad reciente. Propón exactamente tres nombres significativos que permitan identificar fácilmente tu función actual. Tú eres el mismo agente que será renombrado.\n\nIdentidad que debes preservar:\n- Nombre actual: ${JSON.stringify(agent.name)}\n- Clase: ${JSON.stringify(String(agent.class))}\n\nReglas:\n- CADA propuesta debe conservar una identidad reconocible: incluye todos los términos del nombre actual (puedes intercalar la especialidad), o incluye explícitamente el nombre de la clase.\n- Ejemplos válidos: si el nombre es "Mark Transfer Connect", usa "Mark Releases Transfer Connect"; si la clase es "Charizard", usa "Charizard Liberaciones".\n- Nunca reemplaces tanto el nombre actual como la clase por una identidad completamente nueva.\n- Cada nombre debe tener entre 2 y 7 palabras y máximo 64 caracteres.\n- Deben ser específicos, memorables, distintos entre sí y distintos de ${JSON.stringify(agent.name)}.\n- Evita nombres genéricos como "AI Assistant".\n- Cada propuesta necesita una razón breve en español.\n- Incluye un resumen en español (máximo 180 caracteres) de la señal contextual principal usada.\n- No renombres al agente tú mismo y no le pidas nada al usuario.\n\nCuando termines, haz exactamente un POST autenticado a:\n${endpoint}\n\nBody JSON:\n{\n  "agentId": ${JSON.stringify(agent.id)},\n  "instanceId": ${JSON.stringify(requestId)},\n  "rendererId": "agent-name-proposals",\n  "requestId": ${JSON.stringify(requestId)},\n  "contextSummary": "resumen contextual",\n  "proposals": [\n    {"name":"Nombre 1","reason":"Motivo 1"},\n    {"name":"Nombre 2","reason":"Motivo 2"},\n    {"name":"Nombre 3","reason":"Motivo 3"}\n  ]\n}\n\nUsa el header X-Auth-Token con el token configurado en tus instrucciones de Tide Commander API. Nunca incluyas el token dentro del JSON. Después de un POST exitoso, termina con solo: Propuestas listas.\n[/RENAME_AGENT_PROPOSALS_REQUEST]`;
}

export function createRenameAgentPlugin(
  dependencies: RenameAgentDependencies = DEFAULT_DEPENDENCIES,
): BuiltinPluginDefinition {
  const pending = new Map<string, PendingRenameRequest>();

  const activate = (api: TideServerPluginApi): TideServerPluginActivation => {
    const markGenerationDelayed = (requestId: string) => {
      const request = pending.get(requestId);
      if (!request || request.data.status !== 'generating') return;
      request.timer = undefined;
      request.data = {
        ...request.data,
        status: 'error',
        error: 'El agente está tardando más de lo esperado. La solicitud sigue activa y las propuestas aparecerán cuando responda.',
      };
      api.emitPatch(request.data.agentId, requestId, request.data);
    };

    const propose = (context: PluginCommandContext) => {
      if (!context.agentId) {
        throw new PluginRuntimeError('Selecciona un agente antes de usar /rename-agent', 400, 'AGENT_REQUIRED');
      }
      const agent = dependencies.getAgent(context.agentId);
      if (!agent) throw new PluginRuntimeError('El agente seleccionado ya no existe', 404, 'AGENT_NOT_FOUND');
      // Keep at most one generation callback per agent. Ready cards do not
      // depend on this map and remain selectable indefinitely.
      for (const [pendingId, existing] of pending) {
        if (existing.data.agentId !== agent.id) continue;
        if (existing.timer) clearTimeout(existing.timer);
        pending.delete(pendingId);
      }
      const requestId = randomUUID();
      const requestedAt = Date.now();
      const data: PluginAgentNameProposalsData = {
        kind: 'agent-name-proposals',
        agentId: agent.id,
        requestId,
        previousName: agent.name,
        contextSummary: activityHint(agent),
        proposals: [],
        action: 'rename',
        status: 'generating',
        requestedAt,
      };
      const timer = setTimeout(() => markGenerationDelayed(requestId), GENERATION_FEEDBACK_MS);
      timer.unref();
      pending.set(requestId, { data, agentClass: String(agent.class), timer });
      const prompt = buildAiRenamePrompt(
        agent,
        requestId,
        dependencies.baseUrl(),
      );
      setTimeout(() => {
        void dependencies.askAgent(agent.id, prompt).catch((error) => {
          const request = pending.get(requestId);
          if (!request) return;
          if (request.timer) clearTimeout(request.timer);
          request.data = {
            ...request.data,
            status: 'error',
            error: `No se pudo consultar al agente: ${error instanceof Error ? error.message : String(error)}`,
          };
          request.timer = undefined;
          api.emitPatch(agent.id, requestId, request.data);
        });
      }, 50);
      return {
        pluginId: 'rename-agent',
        rendererId: 'agent-name-proposals',
        instanceId: requestId,
        data,
        title: 'Rename Agent',
        command: '/rename-agent',
        createdAt: requestedAt,
      };
    };

    const submitProposals = (context: PluginActionContext): PluginAgentNameProposalsData => {
      const requestId = typeof context.body.requestId === 'string'
        ? context.body.requestId
        : context.instanceId;
      const request = requestId ? pending.get(requestId) : undefined;
      if (!request || !context.agentId || request.data.agentId !== context.agentId) {
        throw new PluginRuntimeError('La solicitud fue reemplazada por otra o no coincide con el agente', 409, 'AGENT_RENAME_NOT_ACTIVE');
      }
      const proposals = validateAiNameProposals(
        context.body.proposals,
        request.data.previousName,
        request.agentClass,
      );
      const contextSummary = cleanReason(context.body.contextSummary) || request.data.contextSummary;
      if (request.timer) clearTimeout(request.timer);
      const readyData: PluginAgentNameProposalsData = {
        ...request.data,
        contextSummary,
        proposals,
        status: 'ready',
        expiresAt: undefined,
        error: undefined,
      };
      // Selection is self-contained in the signed-in browser card and has no
      // timeout. The callback-only map can be released immediately.
      pending.delete(requestId!);
      return readyData;
    };

    const rename = (context: PluginActionContext): PluginAgentNameProposalsData => {
      if (!context.agentId || !context.data || typeof context.data !== 'object') {
        throw new PluginRuntimeError('La solicitud de nombre no coincide con el agente', 400, 'AGENT_RENAME_MISMATCH');
      }
      const proposalData = context.data as Partial<PluginAgentNameProposalsData>;
      if (
        proposalData.kind !== 'agent-name-proposals'
        || proposalData.agentId !== context.agentId
        || typeof proposalData.requestId !== 'string'
        || proposalData.status !== 'ready'
        || typeof proposalData.previousName !== 'string'
        || typeof proposalData.contextSummary !== 'string'
        || typeof proposalData.action !== 'string'
        || typeof proposalData.requestedAt !== 'number'
        || !Array.isArray(proposalData.proposals)
        || proposalData.proposals.length !== 3
        || !proposalData.proposals.every((proposal) => (
          proposal
          && typeof proposal.name === 'string'
          && typeof proposal.reason === 'string'
        ))
      ) {
        throw new PluginRuntimeError('La tarjeta de propuestas no coincide con el agente', 400, 'AGENT_RENAME_MISMATCH');
      }
      const name = cleanName(context.body.name);
      if (!name || !proposalData.proposals.some((proposal) => proposal.name === name)) {
        throw new PluginRuntimeError('Elige una de las tres propuestas de nombre', 400, 'AGENT_NAME_INVALID');
      }
      const agent = dependencies.getAgent(context.agentId);
      if (!agent) throw new PluginRuntimeError('El agente seleccionado ya no existe', 404, 'AGENT_NOT_FOUND');
      if (!preservesAgentIdentity(name, proposalData.previousName, String(agent.class))) {
        throw new PluginRuntimeError('La propuesta ya no conserva la identidad del agente', 400, 'AGENT_IDENTITY_REQUIRED');
      }
      const updated = dependencies.renameAgent(context.agentId, name);
      if (!updated) throw new PluginRuntimeError('El agente seleccionado ya no existe', 404, 'AGENT_NOT_FOUND');
      pending.delete(proposalData.requestId);
      return {
        ...(proposalData as PluginAgentNameProposalsData),
        selectedName: name,
        renamedAt: Date.now(),
        status: 'renamed',
        expiresAt: undefined,
      };
    };

    return {
      commands: { propose },
      actions: { proposals: submitProposals, rename },
      deactivate: () => {
        for (const request of pending.values()) {
          if (request.timer) clearTimeout(request.timer);
        }
        pending.clear();
      },
    };
  };

  return {
    manifest: {
      id: 'rename-agent',
      name: 'Rename Agent',
      version: '1.0.0',
      description: 'El mismo agente propone tres nombres según su conversación, contexto y actividad.',
      contributes: {
        slashCommands: [{
          name: '/rename-agent',
          summary: 'Pide al agente tres nombres contextuales y deja que el usuario elija',
          handler: 'propose',
          renderer: 'agent-name-proposals',
          requiresAgent: true,
        }],
        outputRenderers: [{ id: 'agent-name-proposals' }],
      },
    },
    activate,
  };
}

export const renameAgentPlugin = createRenameAgentPlugin();
