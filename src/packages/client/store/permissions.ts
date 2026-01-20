/**
 * Permissions Store Actions
 *
 * Handles permission requests for interactive permission mode.
 */

import type { ClientMessage, PermissionRequest } from '../../shared/types';
import type { StoreState } from './types';

export interface PermissionActions {
  addPermissionRequest(request: PermissionRequest): void;
  resolvePermissionRequest(requestId: string, approved: boolean): void;
  respondToPermissionRequest(requestId: string, approved: boolean, reason?: string, remember?: boolean): void;
  getPendingPermissionsForAgent(agentId: string): PermissionRequest[];
}

export function createPermissionActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
  getSendMessage: () => ((msg: ClientMessage) => void) | null
): PermissionActions {
  return {
    addPermissionRequest(request: PermissionRequest): void {
      setState((state) => {
        const newRequests = new Map(state.permissionRequests);
        newRequests.set(request.id, request);
        state.permissionRequests = newRequests;
      });
      notify();
    },

    resolvePermissionRequest(requestId: string, approved: boolean): void {
      const state = getState();
      const request = state.permissionRequests.get(requestId);
      if (request) {
        setState((s) => {
          const newRequests = new Map(s.permissionRequests);
          newRequests.set(requestId, {
            ...request,
            status: approved ? 'approved' : 'denied',
          });
          s.permissionRequests = newRequests;
        });
        notify();

        // Remove after a short delay to show the result
        setTimeout(() => {
          setState((s) => {
            const currentRequests = new Map(s.permissionRequests);
            currentRequests.delete(requestId);
            s.permissionRequests = currentRequests;
          });
          notify();
        }, 2000);
      }
    },

    respondToPermissionRequest(
      requestId: string,
      approved: boolean,
      reason?: string,
      remember?: boolean
    ): void {
      getSendMessage()?.({
        type: 'permission_response',
        payload: { requestId, approved, reason, remember },
      });
    },

    getPendingPermissionsForAgent(agentId: string): PermissionRequest[] {
      return Array.from(getState().permissionRequests.values()).filter(
        (r) => r.agentId === agentId && r.status === 'pending'
      );
    },
  };
}
