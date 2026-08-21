import type {
  PluginProviderUsageAccount,
  PluginProviderUsageEntry,
  PluginProviderUsagesData,
  PluginProviderUsageWindow,
  TideServerPluginActivation,
} from '../../../shared/plugin-types.js';
import { getClaudeCredentialProfilesUsage } from '../../services/claude-credentials-service.js';
import { getCodexCredentialProfilesUsage } from '../../services/codex-usage-service.js';
import { getGrokAccountRateLimits } from '../../services/grok-usage-service.js';
import {
  getPiCredentialProfilesUsage,
  listLoadedPiSubscriptions,
} from '../../services/pi-subscription-usage-service.js';
import type { BuiltinPluginDefinition } from '../manager.js';

interface RawUsageWindow {
  utilization: number;
  resetsAt: string;
  windowDurationMins?: number | null;
}

interface TideUsagesDependencies {
  claude: () => Promise<{
    usage: Array<{
      id: string;
      rateLimits: {
        fiveHour: RawUsageWindow | null;
        sevenDay: RawUsageWindow | null;
      } | null;
      error: string | null;
    }>;
  }>;
  codex: () => Promise<{
    usage: Array<{
      id: string;
      rateLimits: {
        daily: RawUsageWindow | null;
        weekly: RawUsageWindow | null;
      } | null;
      error: string | null;
    }>;
  }>;
  grok: () => Promise<{
    rateLimits: { weekly: RawUsageWindow | null } | null;
    error: string | null;
  }>;
  listPiSubscriptions: () => Array<{ provider: string; label: string }>;
  pi: (provider: string) => Promise<{
    usage: Array<{
      id: string;
      quotaWindows: Array<RawUsageWindow & { key: string }>;
      error: string | null;
    }>;
  }>;
}

const DEFAULT_DEPENDENCIES: TideUsagesDependencies = {
  claude: getClaudeCredentialProfilesUsage,
  codex: getCodexCredentialProfilesUsage,
  grok: getGrokAccountRateLimits,
  listPiSubscriptions: listLoadedPiSubscriptions,
  pi: getPiCredentialProfilesUsage,
};

function clampUtilization(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function usageWindow(
  source: RawUsageWindow | null | undefined,
  key: PluginProviderUsageWindow['key'],
  label: string,
): PluginProviderUsageWindow | null {
  if (!source || !Number.isFinite(source.utilization)) return null;
  return {
    key,
    label,
    utilization: clampUtilization(source.utilization),
    ...(source.resetsAt ? { resetsAt: source.resetsAt } : {}),
  };
}

function credentialsExpired(error: string | null | undefined): boolean {
  return Boolean(error && /expired|expirad|refresh failed|sign in|401|unauthorized|revoked|invalidated oauth token/i.test(error));
}

function unavailableAccount(label: string, error: string): PluginProviderUsageAccount {
  return {
    id: 'active',
    label,
    active: true,
    expired: credentialsExpired(error),
    daily: null,
    weekly: null,
    status: 'unavailable',
    error,
  };
}

function statusFor(
  daily: PluginProviderUsageWindow | null,
  weekly: PluginProviderUsageWindow | null,
): PluginProviderUsageAccount['status'] {
  return daily || weekly ? 'available' : 'unavailable';
}

function sortAccounts(accounts: PluginProviderUsageAccount[]): PluginProviderUsageAccount[] {
  const statusRank = (account: PluginProviderUsageAccount) => (
    account.expired ? 4 : account.active ? 0 : account.status === 'available' ? 1 : account.status === 'free' ? 2 : 3
  );
  return [...accounts].sort((left, right) => (
    statusRank(left) - statusRank(right) || left.label.localeCompare(right.label)
  ));
}

async function loadClaude(dependencies: TideUsagesDependencies): Promise<PluginProviderUsageEntry> {
  try {
    const result = await dependencies.claude();
    if (result.usage.length === 0) {
      return { id: 'claude', label: 'Claude', accounts: [unavailableAccount('Cuenta activa', 'No hay credenciales de Claude registradas')] };
    }
    const accounts = result.usage.map((entry) => {
      const daily = usageWindow(entry.rateLimits?.fiveHour, 'five-hour', '5 horas');
      const weekly = usageWindow(entry.rateLimits?.sevenDay, 'weekly', 'Semanal');
      return {
        id: entry.id,
        label: entry.id === 'active' ? 'Cuenta activa' : entry.id,
        active: entry.id === 'active',
        expired: credentialsExpired(entry.error),
        daily,
        weekly,
        status: statusFor(daily, weekly),
        ...(entry.error ? { error: entry.error } : {}),
        note: 'Claude publica una ventana de 5 horas en lugar de un límite diario.',
      } satisfies PluginProviderUsageAccount;
    });
    return { id: 'claude', label: 'Claude', accounts: sortAccounts(accounts) };
  } catch (error) {
    return { id: 'claude', label: 'Claude', accounts: [unavailableAccount('Cuenta activa', error instanceof Error ? error.message : String(error))] };
  }
}

async function loadCodex(dependencies: TideUsagesDependencies): Promise<PluginProviderUsageEntry> {
  try {
    const result = await dependencies.codex();
    if (result.usage.length === 0) {
      return { id: 'codex', label: 'Codex', accounts: [unavailableAccount('Cuenta activa', 'No hay credenciales de Codex registradas')] };
    }
    const accounts = result.usage.map((entry) => {
      const shortTerm = entry.rateLimits?.daily;
      const isHourly = typeof shortTerm?.windowDurationMins === 'number' && shortTerm.windowDurationMins < 24 * 60;
      const shortTermHours = isHourly ? Math.max(1, Math.round(shortTerm.windowDurationMins! / 60)) : null;
      const daily = usageWindow(shortTerm, isHourly ? 'five-hour' : 'daily', shortTermHours ? `${shortTermHours} horas` : 'Diario');
      const weekly = usageWindow(entry.rateLimits?.weekly, 'weekly', 'Semanal');
      return {
        id: entry.id,
        label: entry.id === 'active' ? 'Cuenta activa' : entry.id,
        active: entry.id === 'active',
        expired: credentialsExpired(entry.error),
        daily,
        weekly,
        status: statusFor(daily, weekly),
        ...(entry.error ? { error: entry.error } : {}),
      } satisfies PluginProviderUsageAccount;
    });
    return { id: 'codex', label: 'Codex', accounts: sortAccounts(accounts) };
  } catch (error) {
    return { id: 'codex', label: 'Codex', accounts: [unavailableAccount('Cuenta activa', error instanceof Error ? error.message : String(error))] };
  }
}

async function loadGrok(dependencies: TideUsagesDependencies): Promise<PluginProviderUsageEntry> {
  try {
    const result = await dependencies.grok();
    const weekly = usageWindow(result.rateLimits?.weekly, 'weekly', 'Semanal');
    return {
      id: 'grok',
      label: 'Grok',
      accounts: [{
        id: 'active',
        label: 'Cuenta activa',
        active: true,
        expired: credentialsExpired(result.error),
        daily: null,
        weekly,
        status: statusFor(null, weekly),
        ...(result.error ? { error: result.error } : {}),
        note: 'Grok no publica un límite diario para la cuenta.',
      }],
    };
  } catch (error) {
    return { id: 'grok', label: 'Grok', accounts: [unavailableAccount('Cuenta activa', error instanceof Error ? error.message : String(error))] };
  }
}

function piQuotaAccount(
  provider: string,
  label: string,
  entry: {
    id: string;
    quotaWindows: Array<RawUsageWindow & { key: string }>;
    error: string | null;
  } | undefined,
): PluginProviderUsageAccount {
  const dailySource = entry?.quotaWindows.find((window) => window.key === 'daily')
    ?? entry?.quotaWindows.find((window) => window.key === 'five-hour')
    ?? entry?.quotaWindows.find((window) => window.key === 'session');
  const isHourly = typeof dailySource?.windowDurationMins === 'number'
    && dailySource.windowDurationMins < 24 * 60;
  const dailyKey: PluginProviderUsageWindow['key'] = isHourly
    ? 'five-hour'
    : dailySource?.key === 'daily'
      ? 'daily'
      : dailySource?.key === 'session'
        ? 'session'
        : 'five-hour';
  const hourlyLabel = isHourly ? `${Math.max(1, Math.round(dailySource!.windowDurationMins! / 60))} horas` : null;
  const dailyLabel = hourlyLabel ?? (dailyKey === 'daily' ? 'Diario' : dailyKey === 'session' ? 'Sesión' : '5 horas');
  const weeklySource = entry?.quotaWindows.find((window) => window.key === 'weekly');
  const daily = usageWindow(dailySource, dailyKey, dailyLabel);
  const weekly = usageWindow(weeklySource, 'weekly', 'Semanal');
  const error = entry?.error ?? (entry ? null : `No hay límites disponibles para ${label}`);
  const accountId = entry?.id ?? 'active';
  return {
    id: `${provider}:${accountId}`,
    label: entry ? `${label} · ${accountId === 'active' ? 'Cuenta activa' : accountId}` : label,
    active: accountId === 'active',
    expired: credentialsExpired(error),
    daily,
    weekly,
    status: statusFor(daily, weekly),
    ...(error ? { error } : {}),
  };
}

async function loadPi(dependencies: TideUsagesDependencies): Promise<{
  provider: PluginProviderUsageEntry;
  openCodeGo: PluginProviderUsageAccount[];
}> {
  try {
    const subscriptions = dependencies.listPiSubscriptions();
    const accountGroups = await Promise.all(subscriptions.map(async (subscription) => {
      try {
        const result = await dependencies.pi(subscription.provider);
        return result.usage.length > 0
          ? result.usage.map((entry) => piQuotaAccount(subscription.provider, subscription.label, entry))
          : [piQuotaAccount(subscription.provider, subscription.label, undefined)];
      } catch (error) {
        return [{
          ...unavailableAccount(subscription.label, error instanceof Error ? error.message : String(error)),
          id: `${subscription.provider}:active`,
        }];
      }
    }));
    const accounts = accountGroups.flat();
    const visibleAccounts = accounts.length > 0
      ? sortAccounts(accounts)
      : [{
          id: 'runtime',
          label: 'Proveedor del modelo activo',
          daily: null,
          weekly: null,
          status: 'unavailable' as const,
          note: 'Pi no tiene una cuota propia; usa los límites del proveedor seleccionado.',
        }];
    return {
      provider: { id: 'pi', label: 'Pi', accounts: visibleAccounts },
      openCodeGo: accounts.filter((account) => account.id.startsWith('opencode-go:')),
    };
  } catch (error) {
    return {
      provider: { id: 'pi', label: 'Pi', accounts: [unavailableAccount('Proveedor del modelo activo', error instanceof Error ? error.message : String(error))] },
      openCodeGo: [],
    };
  }
}

/** Build one provider-neutral daily/weekly quota report without failing the whole report when one provider is offline. */
export async function fetchRegisteredProviderUsages(
  dependencies: TideUsagesDependencies = DEFAULT_DEPENDENCIES,
): Promise<PluginProviderUsagesData> {
  const [claude, codex, grok, pi] = await Promise.all([
    loadClaude(dependencies),
    loadCodex(dependencies),
    loadGrok(dependencies),
    loadPi(dependencies),
  ]);
  const openCodeAccounts: PluginProviderUsageAccount[] = pi.openCodeGo.length > 0
    ? pi.openCodeGo.map((account) => ({
        ...account,
        label: account.active ? 'Cuenta activa' : account.label.replace(/^OpenCode Go · /, ''),
      }))
    : [{
        id: 'free',
        label: 'OpenCode Free',
        daily: null,
        weekly: null,
        status: 'free',
        note: 'La capacidad gratuita es dinámica; OpenCode no publica cuotas diarias o semanales.',
      }];
  return {
    kind: 'provider-usages',
    title: 'Límites de proveedores LLM',
    fetchedAt: Date.now(),
    providers: [
      claude,
      codex,
      grok,
      { id: 'opencode', label: 'OpenCode', accounts: openCodeAccounts },
      pi.provider,
    ],
  };
}

export function createTideUsagesPlugin(
  dependencies: TideUsagesDependencies = DEFAULT_DEPENDENCIES,
): BuiltinPluginDefinition {
  const activate = (): TideServerPluginActivation => ({
    commands: {
      usages: () => fetchRegisteredProviderUsages(dependencies),
    },
  });
  return {
    manifest: {
      id: 'tide-commander',
      name: 'Tide Commander',
      version: '1.0.0',
      description: 'Built-in Tide Commander commands and runtime utilities.',
      contributes: {
        slashCommands: [{
          name: '/usages',
          summary: 'Muestra los límites diarios y semanales de todos los proveedores LLM registrados',
          handler: 'usages',
          renderer: 'provider-usages',
        }],
        outputRenderers: [{ id: 'provider-usages' }],
      },
    },
    activate,
  };
}

export const tideUsagesPlugin = createTideUsagesPlugin();
