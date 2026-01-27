/**
 * Secrets Store Actions
 *
 * Handles secrets management. Secrets are key-value pairs that can be
 * referenced in prompts using {{KEY}} placeholders.
 */

import type { ClientMessage, Secret } from '../../shared/types';
import type { StoreState } from './types';

export interface SecretActions {
  // Secrets CRUD
  setSecretsFromServer(secretsArray: Secret[]): void;
  addSecretFromServer(secret: Secret): void;
  updateSecretFromServer(secret: Secret): void;
  removeSecretFromServer(secretId: string): void;
  getSecret(secretId: string): Secret | undefined;
  getSecretByKey(key: string): Secret | undefined;
  getAllSecrets(): Secret[];
  createSecret(secretData: Omit<Secret, 'id' | 'createdAt' | 'updatedAt'>): void;
  updateSecret(secretId: string, updates: Partial<Omit<Secret, 'id' | 'createdAt' | 'updatedAt'>>): void;
  deleteSecret(secretId: string): void;
}

export function createSecretActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
  getSendMessage: () => ((msg: ClientMessage) => void) | null
): SecretActions {
  return {
    setSecretsFromServer(secretsArray: Secret[]): void {
      setState((state) => {
        const newSecrets = new Map<string, Secret>();
        for (const secret of secretsArray) {
          newSecrets.set(secret.id, secret);
        }
        state.secrets = newSecrets;
      });
      notify();
    },

    addSecretFromServer(secret: Secret): void {
      setState((state) => {
        const newSecrets = new Map(state.secrets);
        newSecrets.set(secret.id, secret);
        state.secrets = newSecrets;
      });
      notify();
    },

    updateSecretFromServer(secret: Secret): void {
      setState((state) => {
        const newSecrets = new Map(state.secrets);
        newSecrets.set(secret.id, secret);
        state.secrets = newSecrets;
      });
      notify();
    },

    removeSecretFromServer(secretId: string): void {
      setState((state) => {
        const newSecrets = new Map(state.secrets);
        newSecrets.delete(secretId);
        state.secrets = newSecrets;
      });
      notify();
    },

    getSecret(secretId: string): Secret | undefined {
      return getState().secrets.get(secretId);
    },

    getSecretByKey(key: string): Secret | undefined {
      return Array.from(getState().secrets.values()).find(s => s.key === key);
    },

    getAllSecrets(): Secret[] {
      return Array.from(getState().secrets.values());
    },

    createSecret(secretData: Omit<Secret, 'id' | 'createdAt' | 'updatedAt'>): void {
      getSendMessage()?.({
        type: 'create_secret',
        payload: secretData,
      });
    },

    updateSecret(secretId: string, updates: Partial<Omit<Secret, 'id' | 'createdAt' | 'updatedAt'>>): void {
      getSendMessage()?.({
        type: 'update_secret',
        payload: { id: secretId, updates },
      });
    },

    deleteSecret(secretId: string): void {
      getSendMessage()?.({
        type: 'delete_secret',
        payload: { id: secretId },
      });
    },
  };
}
