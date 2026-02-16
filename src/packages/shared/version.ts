export type VersionRelation = 'behind' | 'equal' | 'ahead' | 'unknown';

type CheckOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type NpmVersionCheckResult = {
  currentVersion: string;
  latestVersion: string | null;
  relation: VersionRelation;
};

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function parseSemver(version: string): { core: number[]; prerelease: string[] } | null {
  const normalized = normalizeVersion(version);
  const match = normalized.match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;

  const core = match[1].split('.').map(part => Number.parseInt(part, 10));
  if (core.some(Number.isNaN)) return null;

  const prerelease = match[2] ? match[2].split('.') : [];
  return { core, prerelease };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;

    const leftNum = /^\d+$/.test(left) ? Number.parseInt(left, 10) : null;
    const rightNum = /^\d+$/.test(right) ? Number.parseInt(right, 10) : null;

    if (leftNum !== null && rightNum !== null) {
      if (leftNum > rightNum) return 1;
      if (leftNum < rightNum) return -1;
      continue;
    }

    if (leftNum !== null) return -1;
    if (rightNum !== null) return 1;

    const cmp = left.localeCompare(right);
    if (cmp !== 0) return cmp > 0 ? 1 : -1;
  }

  return 0;
}

export function compareVersions(a: string, b: string): number | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;

  const maxLen = Math.max(left.core.length, right.core.length);
  for (let i = 0; i < maxLen; i += 1) {
    const leftPart = left.core[i] ?? 0;
    const rightPart = right.core[i] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

export function getVersionRelation(currentVersion: string, latestVersion: string): VersionRelation {
  const compared = compareVersions(currentVersion, latestVersion);
  if (compared === null) return 'unknown';
  if (compared < 0) return 'behind';
  if (compared > 0) return 'ahead';
  return 'equal';
}

export async function fetchLatestNpmVersion(packageName: string, options: CheckOptions = {}): Promise<string | null> {
  const { timeoutMs = 3000, fetchImpl = fetch } = options;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeout);
    if (!response.ok) return null;

    const data = await response.json() as { version?: unknown };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

export async function checkNpmVersion(packageName: string, currentVersion: string, options: CheckOptions = {}): Promise<NpmVersionCheckResult> {
  if (!currentVersion || currentVersion === 'unknown') {
    return { currentVersion, latestVersion: null, relation: 'unknown' };
  }

  const latestVersion = await fetchLatestNpmVersion(packageName, options);
  if (!latestVersion) {
    return { currentVersion, latestVersion: null, relation: 'unknown' };
  }

  return {
    currentVersion,
    latestVersion,
    relation: getVersionRelation(currentVersion, latestVersion),
  };
}
