import { execFile } from 'child_process';
import { PiBackend } from './backend.js';

export interface PiModelCatalogEntry {
  id: string;
  provider: string;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  thinking: boolean;
  images: boolean;
}

const CATALOG_TTL_MS = 60 * 60 * 1000;
let cachedCatalog: { entries: PiModelCatalogEntry[]; fetchedAt: number } | undefined;

export function parsePiTokenCount(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)([KMG])?$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2]?.toUpperCase();
  const multiplier = unit === 'G' ? 1_000_000_000 : unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1;
  return Number.isFinite(amount) ? Math.round(amount * multiplier) : 0;
}

export function parsePiModelCatalog(output: string): PiModelCatalogEntry[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('provider '))
    .map((line) => {
      const [provider, model, context, maxOut, thinking, images] = line.split(/\s+/);
      if (!provider || !model || !context || !maxOut) return undefined;
      const contextWindow = parsePiTokenCount(context);
      const maxOutputTokens = parsePiTokenCount(maxOut);
      if (contextWindow <= 0) return undefined;
      return {
        id: `${provider}/${model}`,
        provider,
        model,
        contextWindow,
        maxOutputTokens,
        thinking: thinking === 'yes',
        images: images === 'yes',
      } satisfies PiModelCatalogEntry;
    })
    .filter((entry): entry is PiModelCatalogEntry => entry !== undefined);
}

function runPiListModels(): Promise<string> {
  const executable = new PiBackend().getExecutablePath();
  return new Promise((resolve, reject) => {
    execFile(executable, ['--list-models'], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function getPiModelCatalog(refresh = false): Promise<PiModelCatalogEntry[]> {
  const now = Date.now();
  if (!refresh && cachedCatalog && now - cachedCatalog.fetchedAt < CATALOG_TTL_MS) {
    return cachedCatalog.entries;
  }

  const entries = parsePiModelCatalog(await runPiListModels());
  if (entries.length === 0) throw new Error('pi CLI returned no models (are provider credentials configured?)');
  cachedCatalog = { entries, fetchedAt: now };
  return entries;
}

export async function getPiModelContextWindow(model: string | undefined): Promise<number | undefined> {
  const id = model?.trim();
  if (!id) return undefined;
  const entry = (await getPiModelCatalog()).find((candidate) => candidate.id === id);
  return entry?.contextWindow;
}

export function getPiModelCatalogFetchedAt(): number | undefined {
  return cachedCatalog?.fetchedAt;
}
