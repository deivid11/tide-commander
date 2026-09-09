/**
 * JAVA_HOME repair.
 *
 * A dangling JAVA_HOME (the JDK it points to was removed on upgrade) makes
 * every Maven/Gradle build crash on boot with "JAVA_HOME is not defined
 * correctly". Under PM2 that turned into a restart storm (~90/s) that filled
 * pm2.log with tens of GB. Tide inherits its env into every building and
 * agent shell, so we sanitise it once at boot and again when spawning PM2.
 */

import { existsSync, readdirSync, readlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

function hasJavaBinary(home: string | undefined | null): home is string {
  if (!home) return false;
  return existsSync(path.join(home, 'bin', 'java')) || existsSync(path.join(home, 'bin', 'java.exe'));
}

/** Candidate JDK roots, most specific first. Only existing, runnable ones are returned. */
function discoverJavaHomes(): string[] {
  const found: string[] = [];
  const push = (candidate: string | null | undefined) => {
    if (candidate && hasJavaBinary(candidate) && !found.includes(candidate)) found.push(candidate);
  };

  // Linux alternatives (Fedora/RHEL: java_sdk; Debian: java resolves to .../bin/java)
  for (const link of ['/etc/alternatives/java_sdk', '/etc/alternatives/java_home']) {
    try { push(readlinkSync(link)); } catch { /* not present */ }
  }
  try {
    const javaBin = readlinkSync('/etc/alternatives/java');
    push(path.resolve(path.dirname(javaBin), '..'));
  } catch { /* not present */ }

  // macOS
  if (process.platform === 'darwin') {
    try {
      push(execFileSync('/usr/libexec/java_home', { encoding: 'utf8', timeout: 3000 }).trim());
    } catch { /* no JDK registered */ }
  }

  // Common install roots
  for (const root of ['/usr/lib/jvm', '/usr/local/lib/jvm', '/opt/java', '/Library/Java/JavaVirtualMachines']) {
    let entries: string[] = [];
    try { entries = readdirSync(root); } catch { continue; }
    for (const entry of entries.sort().reverse()) {
      push(path.join(root, entry));
      push(path.join(root, entry, 'Contents', 'Home'));
    }
  }
  return found;
}

/**
 * Return a JAVA_HOME that actually contains bin/java: the configured one when
 * valid, otherwise the best discovered JDK, otherwise null.
 */
export function resolveJavaHome(configured: string | undefined = process.env.JAVA_HOME): string | null {
  if (hasJavaBinary(configured)) return configured;
  return discoverJavaHomes()[0] ?? null;
}

/**
 * Repair process.env.JAVA_HOME in place when it points at a JDK that no longer
 * exists. Returns a description of what changed (for logging) or null.
 */
export function repairProcessJavaHome(): { from: string; to: string | null } | null {
  const configured = process.env.JAVA_HOME;
  if (!configured || hasJavaBinary(configured)) return null;
  const replacement = resolveJavaHome(undefined);
  if (replacement) process.env.JAVA_HOME = replacement;
  else delete process.env.JAVA_HOME;
  return { from: configured, to: replacement };
}
