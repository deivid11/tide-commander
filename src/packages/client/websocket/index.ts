/**
 * WebSocket module – public API re-exports.
 *
 * Internal structure:
 *   state.ts      – HMR-persisted WebSocket state
 *   callbacks.ts  – Callback registry (set/clear)
 *   handlers.ts   – Server message routing (handleServerMessage)
 *   connection.ts – Connect / disconnect / reconnect lifecycle
 *   send.ts       – sendMessage, isConnected, getSocket
 */

export { connect, disconnect, reconnect } from './connection';
export { sendMessage, isConnected, getSocket } from './send';
export { setCallbacks, clearCallbacks, clearSceneCallbacks } from './callbacks';
