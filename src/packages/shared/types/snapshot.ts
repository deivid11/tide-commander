/**
 * Snapshot Types - For capturing conversation and file artifacts
 *
 * These types define the structure for saving and restoring agent conversation
 * snapshots, including conversation outputs and files created/modified by Claude.
 */

import type { AgentClass } from '../types';

/**
 * File captured in a snapshot
 * Tracks whether the file was created or modified during the conversation
 */
export interface SnapshotFile {
  /** Absolute path to the file */
  path: string;
  /** File content at the time of snapshot */
  content: string;
  /** Whether file was created new or modified existing */
  type: 'created' | 'modified';
  /** File size in bytes */
  size?: number;
  /** Language/file type for syntax highlighting */
  language?: string;
}

/**
 * Conversation output entry
 * Represents a single message/output in the conversation
 */
export interface SnapshotOutput {
  /** Unique ID for this output */
  id: string;
  /** Output text content */
  text: string;
  /** Timestamp when output was generated */
  timestamp: number;
  /** Whether this was streaming or complete */
  isStreaming?: boolean;
}

/**
 * Full conversation snapshot
 * Contains all data needed to view and restore a conversation
 */
export interface ConversationSnapshot {
  /** Unique snapshot ID */
  id: string;
  /** ID of the agent that created this snapshot */
  agentId: string;
  /** Name of the agent at time of snapshot */
  agentName: string;
  /** Agent class at time of snapshot */
  agentClass: AgentClass;
  /** User-provided title for the snapshot */
  title: string;
  /** Optional description of what this snapshot contains */
  description?: string;
  /** Conversation outputs (messages) */
  outputs: SnapshotOutput[];
  /** Files created/modified during the conversation */
  files: SnapshotFile[];
  /** Timestamp when snapshot was created */
  createdAt: number;
  /** Working directory of the agent */
  cwd: string;
  /** Additional metadata */
  metadata?: {
    /** Total tokens used in conversation */
    tokensUsed?: number;
    /** Context percentage at time of snapshot */
    contextUsed?: number;
    /** Duration of the conversation in ms */
    duration?: number;
  };
}

/**
 * Lightweight snapshot item for listing UI
 * Used in SnapshotManager to show list of snapshots without full data
 */
export interface SnapshotListItem {
  /** Unique snapshot ID */
  id: string;
  /** Snapshot title */
  title: string;
  /** Agent name */
  agentName: string;
  /** Agent class for icon display */
  agentClass: AgentClass;
  /** Creation timestamp */
  createdAt: number;
  /** Number of files in snapshot */
  fileCount: number;
  /** Number of outputs in snapshot */
  outputCount: number;
  /** Optional description preview */
  descriptionPreview?: string;
}

/**
 * Request to create a new snapshot
 */
export interface CreateSnapshotRequest {
  /** Agent ID to snapshot */
  agentId: string;
  /** Title for the snapshot */
  title: string;
  /** Optional description */
  description?: string;
}

/**
 * Response from creating a snapshot
 */
export interface CreateSnapshotResponse {
  /** Whether creation was successful */
  success: boolean;
  /** Created snapshot (if successful) */
  snapshot?: ConversationSnapshot;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Request to restore files from a snapshot
 */
export interface RestoreSnapshotRequest {
  /** Snapshot ID to restore from */
  snapshotId: string;
  /** Which files to restore (empty = all) */
  filePaths?: string[];
  /** Whether to overwrite existing files */
  overwrite?: boolean;
}

/**
 * Response from restoring snapshot files
 */
export interface RestoreSnapshotResponse {
  /** Whether restore was successful */
  success: boolean;
  /** Files that were restored */
  restoredFiles: string[];
  /** Files that were skipped (e.g., already exist) */
  skippedFiles: string[];
  /** Error message (if failed) */
  error?: string;
}

/**
 * Files currently being tracked for an agent
 * Used to show preview of what will be captured in snapshot
 */
export interface TrackedFiles {
  /** Agent ID */
  agentId: string;
  /** Files being tracked */
  files: Array<{
    path: string;
    type: 'created' | 'modified';
    size?: number;
  }>;
}
