/**
 * Shared provider display helpers (icons, labels, colors) for Claude/Codex/OpenCode/Grok/Pi.
 */

import type { AgentProvider } from '../../shared/types';

export function providerAssetUrl(provider: AgentProvider | string | undefined, baseUrl = ''): string {
  const p = provider || 'claude';
  if (p === 'codex') return `${baseUrl}assets/codex.png`;
  if (p === 'opencode') return `${baseUrl}assets/opencode.png`;
  if (p === 'grok') return `${baseUrl}assets/grok.png`;
  if (p === 'pi') return `${baseUrl}assets/pi.png`;
  return `${baseUrl}assets/claude.png`;
}

export function resolvePiModelProvider(
  piModel: string | undefined,
  runtimeProvider?: string,
): string | undefined {
  const explicit = piModel?.trim();
  if (explicit?.includes('/')) {
    const source = explicit.slice(0, explicit.indexOf('/')).trim().toLowerCase();
    if (source) return source;
  }
  return runtimeProvider?.trim().toLowerCase() || undefined;
}

const PI_PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI',
  xai: 'xAI',
  google: 'Google',
  'google-gemini': 'Google',
  'google-vertex': 'Google Vertex',
  'amazon-bedrock': 'Amazon Bedrock',
  'azure-openai': 'Azure OpenAI',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  groq: 'Groq',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  cerebras: 'Cerebras',
  minimax: 'MiniMax',
  moonshot: 'Moonshot',
  'github-copilot': 'GitHub Copilot',
};

export function piModelProviderLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  const known = PI_PROVIDER_LABELS[normalized];
  if (known) return known;
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ') || 'Model provider';
}

export function piModelProviderAssetUrl(provider: string, baseUrl = ''): string | undefined {
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'anthropic' || normalized === 'amazon-bedrock') return providerAssetUrl('claude', baseUrl);
  if (normalized === 'openai' || normalized === 'openai-codex' || normalized === 'azure-openai') {
    return providerAssetUrl('codex', baseUrl);
  }
  if (normalized === 'xai') return providerAssetUrl('grok', baseUrl);
  if (normalized === 'google' || normalized === 'google-gemini' || normalized === 'google-vertex') {
    return `${baseUrl}assets/vscode-icons/file_type_gemini.svg`;
  }
  return undefined;
}

export function providerLabel(
  provider: AgentProvider | string | undefined,
  piModel?: string,
  piModelProvider?: string,
): string {
  const p = provider || 'claude';
  if (p === 'codex') return 'Codex';
  if (p === 'opencode') return 'OpenCode';
  if (p === 'grok') return 'Grok';
  if (p === 'pi') {
    const source = resolvePiModelProvider(piModel, piModelProvider);
    return source ? `${piModelProviderLabel(source)} via Pi` : 'Pi';
  }
  return 'Claude';
}

export function providerAgentTitle(
  provider: AgentProvider | string | undefined,
  piModel?: string,
  piModelProvider?: string,
): string {
  return `${providerLabel(provider, piModel, piModelProvider)} Agent`;
}

export function providerShortCode(provider: AgentProvider | string | undefined): string {
  const p = provider || 'claude';
  if (p === 'codex') return 'CX';
  if (p === 'opencode') return 'OC';
  if (p === 'grok') return 'GK';
  if (p === 'pi') return 'PI';
  return 'CL';
}

export function providerDotColor(provider: AgentProvider | string | undefined): string {
  const p = provider || 'claude';
  if (p === 'codex') return '#4a9eff';
  if (p === 'opencode') return '#10b981';
  if (p === 'grok') return '#6366f1';
  if (p === 'pi') return '#a855f7';
  return '#ff9e4a';
}

export function providerCssClass(provider: AgentProvider | string | undefined): string {
  const p = provider || 'claude';
  if (p === 'codex' || p === 'opencode' || p === 'grok' || p === 'pi') return p;
  return 'claude';
}

export function isKnownProvider(provider: AgentProvider | string | undefined): boolean {
  return provider === 'claude' || provider === 'codex' || provider === 'opencode' || provider === 'grok' || provider === 'pi';
}
