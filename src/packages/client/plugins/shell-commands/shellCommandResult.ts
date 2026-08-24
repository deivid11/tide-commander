export const SHELL_COMMAND_RESULT_START = '[COMMANDER_SLASH_COMMAND_RESULT]';
export const SHELL_COMMAND_RESULT_END = '[/COMMANDER_SLASH_COMMAND_RESULT]';

export interface ShellCommandResultInfo {
  command: string;
  exitCode: number | null;
  durationMs: number;
  output: string;
  outputTruncated: boolean;
}

export function parseShellCommandResult(text: string | null | undefined): ShellCommandResultInfo | null {
  const trimmed = text?.trim() ?? '';
  if (!trimmed.startsWith(SHELL_COMMAND_RESULT_START)) return null;
  const endIndex = trimmed.indexOf(SHELL_COMMAND_RESULT_END);
  const block = endIndex >= 0
    ? trimmed.slice(SHELL_COMMAND_RESULT_START.length, endIndex).trim()
    : trimmed.slice(SHELL_COMMAND_RESULT_START.length).trim();
  const command = block.match(/^Command:\s*(.+)$/mi)?.[1]?.trim();
  const exitValue = block.match(/^Exit code:\s*(.+)$/mi)?.[1]?.trim();
  const durationValue = block.match(/^Duration:\s*(\d+)\s*ms$/mi)?.[1];
  const outputMatch = block.match(/^Output(\s*\(tail; earlier output omitted\))?:\s*\n([\s\S]*)$/mi);
  if (!command || !exitValue || !durationValue || !outputMatch) return null;
  const parsedExit = /^-?\d+$/.test(exitValue) ? Number(exitValue) : null;
  const rawOutput = outputMatch[2].trimEnd();
  return {
    command,
    exitCode: parsedExit,
    durationMs: Number(durationValue),
    output: rawOutput === '(no output)' ? '' : rawOutput,
    outputTruncated: Boolean(outputMatch[1]),
  };
}

export function shellCommandResultPreview(text: string | null | undefined): string | null {
  const result = parseShellCommandResult(text);
  if (!result) return null;
  return `Sudo ${result.exitCode === 0 ? 'completado' : 'finalizado'} · ${result.command}`;
}
