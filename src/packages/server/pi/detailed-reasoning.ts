import * as path from 'path';
import { fileURLToPath } from 'url';

/** Absolute path passed to Pi's repeatable `--extension` CLI option. */
export function getPiDetailedReasoningExtensionPath(): string {
  const modulePath = fileURLToPath(import.meta.url);
  // tsx runs this module from source (.ts); production runs tsc output (.js).
  const extension = path.extname(modulePath) === '.ts' ? '.ts' : '.js';
  return path.join(
    path.dirname(modulePath),
    `detailed-reasoning-extension${extension}`,
  );
}

/** Add Tide's provider-payload hook that requests detailed safe summaries. */
export function addPiDetailedReasoningExtension(args: string[]): void {
  args.push('--extension', getPiDetailedReasoningExtensionPath());
}
