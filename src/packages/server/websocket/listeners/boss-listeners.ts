import type { DelegationDecision, ServerMessage } from '../../../shared/types.js';
import { bossService } from '../../services/index.js';

interface BossListenerContext {
  broadcast: (message: ServerMessage) => void;
}

export function setupBossListeners(ctx: BossListenerContext): void {
  bossService.subscribe((event, data) => {
    switch (event) {
      case 'delegation_decision':
        ctx.broadcast({
          type: 'delegation_decision',
          payload: data as DelegationDecision,
        });
        break;
      case 'subordinates_updated': {
        const { bossId, subordinateIds } = data as { bossId: string; subordinateIds: string[] };
        ctx.broadcast({
          type: 'boss_subordinates_updated',
          payload: { bossId, subordinateIds },
        });
        break;
      }
    }
  });
}
