/**
 * Shared provider display helpers (icons, labels, colors) for Claude/Codex/OpenCode/Grok.
 */

import type { AgentProvider } from '../../shared/types';

export function providerAssetUrl(provider: AgentProvider | string | undefined, baseUrl = ''): string {
  const p = provider || 'claude';
  if (p === 'codex') return `${baseUrl}assets/codex.png`;
  if (p === 'opencode') return `${baseUrl}assets/opencode.png`;
  if (p === 'grok') return `${baseUrl}assets/grok.png`;
  return `${baseUrl}assets/claude.png`;
}

export function providerLabel(provider: AgentProvider | string | undefined): string {
  const p = provider || 'claude';
  if (p === 'codex') return 'Codex';
  if (p === 'opencode') return 'OpenCode';
  if (p === 'grok') return 'Grok';
  return 'Claude';
}

export function providerAgentTitle(provider: AgentProvider | string | undefined): string {
  return `${providerLabel(provider)} Agent`;
}

export function providerShortCode(provider: AgentProvider | string | undefined): string {
  const p = provider || 'claude';
  if (p === 'codex') return 'CX';
  if (p === 'opencode') return 'OC';
  if (p === 'grok') return 'GK';
  return 'CL';
}

export function providerDotColor(provider: AgentProvider | string | undefined): string {
  const p = provider || 'claude';
  if (p === 'codex') return '#4a9eff';
  if (p === 'opencode') return '#10b981';
  if (p === 'grok') return '#6366f1';
  return '#ff9e4a';
}

export function providerCssClass(provider: AgentProvider | string | undefined): string {
  const p = provider || 'claude';
  if (p === 'codex' || p === 'opencode' || p === 'grok') return p;
  return 'claude';
}

export function isKnownProvider(provider: AgentProvider | string | undefined): boolean {
  return provider === 'claude' || provider === 'codex' || provider === 'opencode' || provider === 'grok';
}
