import React from 'react';
import { Icon } from '../../components/Icon';
import type { PluginOutputRendererProps } from '../types';

interface SudoCommandRequestedData {
  kind: 'sudo-command-requested';
  invocation: string;
  status: 'awaiting-user-authorization';
}

function readData(value: unknown): SudoCommandRequestedData | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<SudoCommandRequestedData>;
  return data.kind === 'sudo-command-requested'
    && typeof data.invocation === 'string'
    && data.status === 'awaiting-user-authorization'
    ? data as SudoCommandRequestedData
    : null;
}

export function ExecuteSudoCommandStatusCard({ output }: PluginOutputRendererProps) {
  const data = readData(output.data);
  if (!data) return <div className="execute-sudo-command-status is-error">Solicitud sudo inválida.</div>;
  return (
    <section className="execute-sudo-command-status">
      <span className="execute-sudo-command-status__icon"><Icon name="lock" size={15} /></span>
      <div>
        <small>Execute Sudo Command</small>
        <strong>Esperando tu autorización</strong>
        <code>{data.invocation}</code>
        <span>La tarjeta privada para ingresar la contraseña está abierta en la conversación del agente.</span>
      </div>
    </section>
  );
}
