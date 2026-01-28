/**
 * Permission Service
 * Manages permission requests from Claude hooks for interactive approval
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { PermissionRequest, PermissionResponse, AgentStatus } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';
import * as agentService from './agent-service.js';

const log = createLogger('Permission');

// File to store remembered patterns
const TIDE_DATA_DIR = path.join(os.homedir(), '.tide-commander');
const REMEMBERED_PATTERNS_FILE = path.join(TIDE_DATA_DIR, 'remembered-permissions.json');

// Remembered pattern structure
interface RememberedPattern {
  tool: string;
  pattern: string;
  description: string;
  createdAt: number;
}

// Pending permission requests - Map<requestId, { request, resolve, previousStatus }>
interface PendingRequest {
  request: PermissionRequest;
  resolve: (decision: { decision: 'approve' | 'block'; reason?: string }) => void;
  timeout: NodeJS.Timeout;
  previousStatus: AgentStatus; // Status before waiting_permission
}

const pendingRequests = new Map<string, PendingRequest>();

// Event listeners for broadcasting permission requests
type PermissionListener = (request: PermissionRequest) => void;
const listeners = new Set<PermissionListener>();

// Default timeout for permission requests (5 minutes)
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

/**
 * Subscribe to permission request events
 */
export function subscribe(listener: PermissionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Broadcast a permission request to all listeners
 */
function broadcast(request: PermissionRequest): void {
  listeners.forEach((listener) => listener(request));
}

/**
 * Create a new permission request and wait for user response
 * This is called by the HTTP endpoint when the hook sends a request
 */
export async function createPermissionRequest(
  request: Omit<PermissionRequest, 'status' | 'agentId'>,
  agentId: string
): Promise<{ decision: 'approve' | 'block'; reason?: string }> {
  const fullRequest: PermissionRequest = {
    ...request,
    agentId,
    status: 'pending',
  };

  log.log(`Permission request created: ${request.id} for tool ${request.tool}`);

  // Get current agent status before changing to waiting_permission
  const agent = agentService.getAgent(agentId);
  const previousStatus: AgentStatus = agent?.status || 'working';

  // Set agent status to waiting_permission
  agentService.updateAgent(agentId, { status: 'waiting_permission' }, false);

  return new Promise((resolve) => {
    // Set up timeout
    const timeout = setTimeout(() => {
      log.log(`Permission request ${request.id} timed out`);
      pendingRequests.delete(request.id);
      // Restore previous status on timeout
      agentService.updateAgent(agentId, { status: previousStatus }, false);
      resolve({ decision: 'block', reason: 'Permission request timed out' });
    }, DEFAULT_TIMEOUT);

    // Store the pending request with previous status
    pendingRequests.set(request.id, {
      request: fullRequest,
      resolve,
      timeout,
      previousStatus,
    });

    // Broadcast to clients
    broadcast(fullRequest);
  });
}

/**
 * Respond to a permission request
 * This is called when the user approves/denies via WebSocket
 */
export function respondToPermissionRequest(response: PermissionResponse): boolean {
  const pending = pendingRequests.get(response.requestId);
  if (!pending) {
    log.log(`No pending request found for ${response.requestId}`);
    return false;
  }

  log.log(`Permission response received for ${response.requestId}: ${response.approved ? 'approved' : 'denied'}${response.remember ? ' (remembering)' : ''}`);

  // Clear timeout
  clearTimeout(pending.timeout);

  // Remove from pending
  pendingRequests.delete(response.requestId);

  // Update request status
  pending.request.status = response.approved ? 'approved' : 'denied';

  // Restore agent status to previous status (likely 'working')
  agentService.updateAgent(pending.request.agentId, { status: pending.previousStatus }, false);

  // If approved and remember flag is set, add to remembered patterns
  if (response.approved && response.remember) {
    addRememberedPattern(pending.request.tool, pending.request.toolInput);
  }

  // Resolve the waiting promise
  pending.resolve({
    decision: response.approved ? 'approve' : 'block',
    reason: response.reason,
  });

  return true;
}

/**
 * Get all pending permission requests
 */
export function getPendingRequests(): PermissionRequest[] {
  return Array.from(pendingRequests.values()).map((p) => p.request);
}

/**
 * Get pending requests for a specific agent
 */
export function getPendingRequestsForAgent(agentId: string): PermissionRequest[] {
  return Array.from(pendingRequests.values())
    .filter((p) => p.request.agentId === agentId)
    .map((p) => p.request);
}

/**
 * Cancel all pending requests for an agent (e.g., when agent is stopped)
 * Returns the IDs of cancelled requests so callers can broadcast to clients
 */
export function cancelRequestsForAgent(agentId: string): string[] {
  const cancelledIds: string[] = [];
  for (const [id, pending] of pendingRequests) {
    if (pending.request.agentId === agentId) {
      log.log(`Cancelling permission request ${id} for stopped agent ${agentId}`);
      clearTimeout(pending.timeout);
      // Restore agent status (though agent is being stopped, this keeps state consistent)
      agentService.updateAgent(agentId, { status: pending.previousStatus }, false);
      pending.resolve({ decision: 'block', reason: 'Agent was stopped' });
      pendingRequests.delete(id);
      cancelledIds.push(id);
    }
  }
  return cancelledIds;
}

/**
 * Find agent ID by session ID
 * This is needed because the hook only knows the session ID, not the agent ID
 */
export function findAgentBySessionId(
  sessionId: string,
  getAgent: (id: string) => { sessionId?: string } | undefined,
  getAllAgents: () => Array<{ id: string; sessionId?: string }>
): string | null {
  // Search through all agents to find one with matching session ID
  const agents = getAllAgents();
  for (const agent of agents) {
    if (agent.sessionId === sessionId) {
      return agent.id;
    }
  }
  return null;
}

/**
 * Add a remembered permission pattern
 * This pattern will auto-approve matching requests in the future
 */
export function addRememberedPattern(
  tool: string,
  toolInput: Record<string, unknown>
): RememberedPattern | null {
  try {
    // Ensure data directory exists
    if (!fs.existsSync(TIDE_DATA_DIR)) {
      fs.mkdirSync(TIDE_DATA_DIR, { recursive: true });
    }

    // Generate pattern based on tool type
    let pattern = '';
    let description = '';

    if (tool === 'Write' || tool === 'Edit') {
      // For file operations, remember the directory
      const filePath = String(toolInput.file_path || '');
      const dir = path.dirname(filePath);
      pattern = dir + '/';
      description = `All files in ${dir}`;
    } else if (tool === 'Bash') {
      // For Bash, remember the command prefix (first word)
      const cmd = String(toolInput.command || '');
      const firstWord = cmd.split(/\s+/)[0];
      pattern = firstWord;
      description = `Commands starting with "${firstWord}"`;
    } else {
      // For other tools, use the tool name as pattern
      pattern = tool;
      description = `All ${tool} operations`;
    }

    // Load existing patterns
    let patterns: RememberedPattern[] = [];
    if (fs.existsSync(REMEMBERED_PATTERNS_FILE)) {
      try {
        patterns = JSON.parse(fs.readFileSync(REMEMBERED_PATTERNS_FILE, 'utf-8'));
      } catch {
        patterns = [];
      }
    }

    // Check if pattern already exists
    const exists = patterns.some((p) => p.tool === tool && p.pattern === pattern);
    if (exists) {
      log.log(`Pattern already remembered: ${tool} -> ${pattern}`);
      return null;
    }

    // Add new pattern
    const newPattern: RememberedPattern = {
      tool,
      pattern,
      description,
      createdAt: Date.now(),
    };
    patterns.push(newPattern);

    // Save patterns
    fs.writeFileSync(REMEMBERED_PATTERNS_FILE, JSON.stringify(patterns, null, 2));
    log.log(`Remembered pattern: ${tool} -> ${pattern}`);

    return newPattern;
  } catch (err) {
    log.error('Failed to add remembered pattern:', err);
    return null;
  }
}

/**
 * Get all remembered patterns
 */
export function getRememberedPatterns(): RememberedPattern[] {
  try {
    if (fs.existsSync(REMEMBERED_PATTERNS_FILE)) {
      return JSON.parse(fs.readFileSync(REMEMBERED_PATTERNS_FILE, 'utf-8'));
    }
  } catch {
    // Ignore errors
  }
  return [];
}

/**
 * Remove a remembered pattern
 */
export function removeRememberedPattern(tool: string, pattern: string): boolean {
  try {
    if (!fs.existsSync(REMEMBERED_PATTERNS_FILE)) return false;

    let patterns: RememberedPattern[] = JSON.parse(
      fs.readFileSync(REMEMBERED_PATTERNS_FILE, 'utf-8')
    );

    const originalLength = patterns.length;
    patterns = patterns.filter((p) => !(p.tool === tool && p.pattern === pattern));

    if (patterns.length < originalLength) {
      fs.writeFileSync(REMEMBERED_PATTERNS_FILE, JSON.stringify(patterns, null, 2));
      log.log(`Removed remembered pattern: ${tool} -> ${pattern}`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Clear all remembered patterns
 */
export function clearRememberedPatterns(): void {
  try {
    if (fs.existsSync(REMEMBERED_PATTERNS_FILE)) {
      fs.writeFileSync(REMEMBERED_PATTERNS_FILE, '[]');
      log.log('Cleared all remembered patterns');
    }
  } catch {
    // Ignore errors
  }
}
