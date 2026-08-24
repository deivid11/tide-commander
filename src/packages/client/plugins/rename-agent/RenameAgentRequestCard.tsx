import React from 'react';
import { Icon } from '../../components/Icon';
import type { RenameAgentRequestInfo } from './renameAgentRequest';

export function RenameAgentRequestCard({ request }: { request: RenameAgentRequestInfo }) {
  return (
    <section className="rename-agent-request-card">
      <div className="rename-agent-request-card__glow" aria-hidden="true" />
      <header>
        <span className="rename-agent-request-card__mark">
          <Icon name="signature" size={16} />
          <i aria-hidden="true" />
        </span>
        <div className="rename-agent-request-card__heading">
          <small>Rename Agent · AI identity studio</small>
          <strong>Creando tres nombres contextuales</strong>
        </div>
        <span className="rename-agent-request-card__live"><i /> Analizando</span>
      </header>

      <div className="rename-agent-request-card__identity">
        <span><small>Nombre</small><strong>{request.currentName || 'Agente seleccionado'}</strong></span>
        <em>o</em>
        <span><small>Clase</small><strong>{request.agentClass || 'Identidad original'}</strong></span>
      </div>

      <div className="rename-agent-request-card__pipeline" aria-label="Proceso de generación">
        <span className="is-active"><Icon name="brain" size={11} /> Conversación</span>
        <i />
        <span><Icon name="dna" size={11} /> Identidad</span>
        <i />
        <span><Icon name="sparkle" size={11} /> 3 propuestas</span>
      </div>

      <footer>
        <Icon name="shield" size={11} />
        La IA conservará el nombre actual o la clase del agente.
      </footer>
    </section>
  );
}
