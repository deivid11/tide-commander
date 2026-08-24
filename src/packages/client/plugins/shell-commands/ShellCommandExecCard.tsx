import React from 'react';
import { useExecTasks, store } from '../../store';
import { ExecTaskIndicator } from '../../components/ClaudeOutputPanel/ExecTaskIndicator';
import { Icon } from '../../components/Icon';
import type { PluginOutputRendererProps, PluginShellCommandExecData } from '../types';

function isExecData(value: unknown): value is PluginShellCommandExecData {
  return Boolean(value && typeof value === 'object'
    && (value as { kind?: unknown }).kind === 'shell-command-exec'
    && typeof (value as { taskId?: unknown }).taskId === 'string');
}

export function ShellCommandExecCard({ output, agentId }: PluginOutputRendererProps) {
  const tasks = useExecTasks(agentId ?? '');
  if (!isExecData(output.data)) return <div className="shell-command-exec-missing">Invalid shell command output</div>;
  const data = output.data;
  const task = tasks.find((candidate) => candidate.taskId === data.taskId);
  if (!task) {
    return (
      <div className="shell-command-exec-pending">
        <Icon name="hourglass" size={14} />
        <div><strong>{data.invocation}</strong><span>Waiting for the execution stream…</span></div>
      </div>
    );
  }
  return (
    <div className="shell-command-exec-card">
      <ExecTaskIndicator
        task={task}
        defaultExpanded
        onClose={() => {
          if (agentId) store.dismissPluginOutput(agentId, output.instanceId);
        }}
      />
    </div>
  );
}
