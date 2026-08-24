import { describe, expect, it } from 'vitest';
import {
  parseRenameAgentRequest,
  renameAgentRequestPreview,
} from './renameAgentRequest';

const request = `[RENAME_AGENT_PROPOSALS_REQUEST]
Analiza tu conversación y actividad.

Identidad que debes preservar:
- Nombre actual: "Soporte"
- Clase: "voltorb"

Reglas:
- Genera tres propuestas.
[/RENAME_AGENT_PROPOSALS_REQUEST]`;

describe('rename agent request presentation', () => {
  it('extracts identity without exposing the orchestration prompt', () => {
    expect(parseRenameAgentRequest(request)).toEqual({
      currentName: 'Soporte',
      agentClass: 'voltorb',
    });
    expect(renameAgentRequestPreview(request)).toBe('Rename Agent · Generando 3 propuestas con IA…');
  });

  it('recognizes a truncated marker for compact task labels', () => {
    expect(parseRenameAgentRequest('[RENAME_AGENT_PROPOSALS_REQUEST] Analiza tu…')).toEqual({
      currentName: undefined,
      agentClass: undefined,
    });
  });

  it('ignores ordinary user prompts', () => {
    expect(parseRenameAgentRequest('Ayúdame con el release')).toBeNull();
    expect(renameAgentRequestPreview('Ayúdame con el release')).toBeNull();
  });
});
