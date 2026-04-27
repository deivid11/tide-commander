/**
 * Git History API Client
 * Handles per-file git history fetches used by the file explorer's
 * "Show Git History" context menu action.
 */

import { apiUrl, authFetch } from '../utils/storage';

export interface GitFileHistoryCommit {
  sha: string;
  shortSha: string;
  author: string;
  email: string;
  date: string;
  subject: string;
}

export interface GitFileHistoryResponse {
  commits: GitFileHistoryCommit[];
}

export type GitCommitFileChangeType = 'added' | 'modified' | 'deleted';

export interface GitCommitFileTextDiff {
  binary: false;
  filename: string;
  language: string;
  changeType: GitCommitFileChangeType;
  originalContent: string;
  modifiedContent: string;
}

export interface GitCommitFileBinaryDiff {
  binary: true;
  filename: string;
  changeType: GitCommitFileChangeType;
}

export type GitCommitFileDiffResponse = GitCommitFileTextDiff | GitCommitFileBinaryDiff;

export interface FetchFileGitHistoryArgs {
  path: string;
  cwd: string;
  limit?: number;
}

export async function fetchFileGitHistory({
  path,
  cwd,
  limit,
}: FetchFileGitHistoryArgs): Promise<GitFileHistoryResponse> {
  const params = new URLSearchParams({ path, cwd });
  if (typeof limit === 'number' && Number.isFinite(limit)) {
    params.set('limit', String(limit));
  }
  const response = await authFetch(apiUrl(`/api/files/git-file-history?${params.toString()}`));
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error || `Failed to load file git history: ${response.statusText}`);
  }
  const data = await response.json();
  return { commits: Array.isArray(data.commits) ? data.commits : [] };
}

export interface FetchCommitFileDiffArgs {
  path: string;
  cwd: string;
  sha: string;
}

export async function fetchCommitFileDiff({
  path,
  cwd,
  sha,
}: FetchCommitFileDiffArgs): Promise<GitCommitFileDiffResponse> {
  const params = new URLSearchParams({ path, cwd, sha });
  const response = await authFetch(apiUrl(`/api/files/git-file-commit-diff?${params.toString()}`));
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error || `Failed to load commit diff: ${response.statusText}`);
  }
  const data = await response.json();
  if (data.binary === true) {
    return {
      binary: true,
      filename: data.filename ?? '',
      changeType: data.changeType ?? 'modified',
    };
  }
  return {
    binary: false,
    filename: data.filename ?? '',
    language: data.language ?? 'plaintext',
    changeType: data.changeType ?? 'modified',
    originalContent: typeof data.originalContent === 'string' ? data.originalContent : '',
    modifiedContent: typeof data.modifiedContent === 'string' ? data.modifiedContent : '',
  };
}
