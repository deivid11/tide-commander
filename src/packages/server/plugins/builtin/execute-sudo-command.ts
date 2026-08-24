import { randomUUID } from 'node:crypto';
import type {
  PluginCommandContext,
  PluginShellCommandPrepareResult,
  TideServerPluginActivation,
  TideServerPluginApi,
} from '../../../shared/plugin-types.js';
import {
  EXECUTE_SUDO_COMMAND_ID,
  parsePluginShellCommandArgs,
  pluginShellCommandService,
  type PluginShellCommandService,
} from '../../services/plugin-shell-command-service.js';
import { PluginRuntimeError, type BuiltinPluginDefinition } from '../manager.js';

interface ExecuteSudoCommandDependencies {
  shellCommands: Pick<PluginShellCommandService, 'prepareArgs'>;
}

const DEFAULT_DEPENDENCIES: ExecuteSudoCommandDependencies = {
  shellCommands: pluginShellCommandService,
};

function stripInvocationPrefix(value: string): string {
  const trimmed = value.trim();
  return /^\/?execute-sudo-command(?:\s|$)/i.test(trimmed)
    ? trimmed.replace(/^\/?execute-sudo-command(?:\s+|$)/i, '')
    : trimmed;
}

export function resolveSudoCommandArgs(context: PluginCommandContext): string[] {
  if (context.args.length > 0) return [...context.args];
  const body = context.body ?? {};
  for (const candidate of [
    body.commandToExecute,
    body.sudoCommand,
    body.command,
    context.argsText,
  ]) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const command = stripInvocationPrefix(candidate);
    if (command) return parsePluginShellCommandArgs(command);
  }
  return [];
}

export function createExecuteSudoCommandPlugin(
  dependencies: ExecuteSudoCommandDependencies = DEFAULT_DEPENDENCIES,
): BuiltinPluginDefinition {
  const activate = (api: TideServerPluginApi): TideServerPluginActivation => ({
    commands: {
      execute: async (context) => {
        if (!context.agentId) {
          throw new PluginRuntimeError(
            'Selecciona un agente antes de usar /execute-sudo-command',
            400,
            'AGENT_REQUIRED',
          );
        }
        const args = resolveSudoCommandArgs(context);
        if (args.length === 0) {
          throw new PluginRuntimeError(
            'Indica el ejecutable y sus argumentos, por ejemplo: /execute-sudo-command touch /opt/test',
            400,
            'SUDO_COMMAND_REQUIRED',
          );
        }
        const requestedByAgent = context.body?.source !== 'client-command';
        const prepared: PluginShellCommandPrepareResult = await dependencies.shellCommands.prepareArgs(
          EXECUTE_SUDO_COMMAND_ID,
          context.agentId,
          args,
          requestedByAgent,
        );
        if (!prepared.challengeId || !prepared.expiresAt) {
          throw new PluginRuntimeError(
            'No se pudo crear la autorización sudo',
            500,
            'SUDO_CHALLENGE_INVALID',
          );
        }
        api.emitOutput(context.agentId, {
          pluginId: 'shell-commands',
          rendererId: 'shell-command-sudo-request',
          instanceId: `sudo-${prepared.challengeId}`,
          data: {
            kind: 'shell-command-sudo-request',
            commandId: prepared.commandId,
            invocation: prepared.invocation,
            args: prepared.args,
            challengeId: prepared.challengeId,
            expiresAt: prepared.expiresAt,
          },
          title: 'Execute Sudo Command',
          command: prepared.invocation,
          createdAt: Date.now(),
        });
        // This safe acknowledgement is returned to the requesting agent. The
        // private challenge id exists only in the WebSocket card above.
        return {
          pluginId: 'execute-sudo-command',
          rendererId: 'sudo-command-requested',
          instanceId: `requested-${randomUUID()}`,
          data: {
            kind: 'sudo-command-requested',
            invocation: prepared.invocation,
            status: 'awaiting-user-authorization',
          },
          title: 'Execute Sudo Command',
          command: prepared.invocation,
          createdAt: Date.now(),
        };
      },
    },
  });

  return {
    manifest: {
      id: 'execute-sudo-command',
      name: 'Execute Sudo Command',
      version: '1.0.0',
      description: 'Permite que los agentes soliciten cualquier comando sudo con autorización privada del usuario.',
      contributes: {
        slashCommands: [{
          name: '/execute-sudo-command',
          summary: 'Solicita autorización para ejecutar un comando con sudo',
          handler: 'execute',
          renderer: 'sudo-command-requested',
          requiresAgent: true,
        }],
        outputRenderers: [{ id: 'sudo-command-requested' }],
      },
    },
    activate,
  };
}

export const executeSudoCommandPlugin = createExecuteSudoCommandPlugin();
