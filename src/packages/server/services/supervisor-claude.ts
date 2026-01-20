/**
 * Supervisor Claude Integration
 * Handles Claude API calls for agent analysis
 */

import { spawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { ClaudeBackend } from '../claude/index.js';
import { logger, sanitizeUnicode } from '../utils/index.js';

const log = logger.supervisor;
const claudeBackend = new ClaudeBackend();

/**
 * Call Claude Code to analyze agent activities
 * Spawns a one-shot Claude process with --print flag to get the response
 * Uses stdin input format for large prompts (avoids shell argument limits)
 */
export async function callClaudeForAnalysis(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    log.log(' Spawning Claude Code for analysis...');

    const executable = claudeBackend.getExecutablePath();
    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--no-session-persistence',
    ];

    log.log(` Command: ${executable} ${args.join(' ')}`);

    const childProcess = spawn(executable, args, {
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
      },
      shell: true,
    });

    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let textOutput = '';

    childProcess.stdout?.on('data', (data: Buffer) => {
      buffer += decoder.write(data);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                textOutput += block.text;
              }
            }
          }
          if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
            if (event.event.delta?.type === 'text_delta' && event.event.delta.text) {
              textOutput += event.event.delta.text;
            }
          }
        } catch {
          log.log(' Non-JSON line:', line.substring(0, 100));
        }
      }
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      log.error(' stderr:', decoder.write(data));
    });

    childProcess.on('close', (code) => {
      const remaining = buffer + decoder.end();
      if (remaining.trim()) {
        try {
          const event = JSON.parse(remaining);
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                textOutput += block.text;
              }
            }
          }
        } catch { /* ignore */ }
      }

      log.log(` Claude Code exited with code ${code}, output length: ${textOutput.length}`);

      if (code !== 0 && textOutput.length === 0) {
        reject(new Error(`Claude Code exited with code ${code}`));
      } else if (!textOutput) {
        reject(new Error('No response from Claude Code'));
      } else {
        resolve(textOutput);
      }
    });

    childProcess.on('error', (err) => {
      log.error(' Process spawn error:', err);
      reject(err);
    });

    childProcess.on('spawn', () => {
      log.log(' Process spawned, sending prompt via stdin...');
      const sanitizedPrompt = sanitizeUnicode(prompt);
      const stdinMessage = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: sanitizedPrompt },
      });
      childProcess.stdin?.write(stdinMessage + '\n');
      childProcess.stdin?.end();
    });

    setTimeout(() => {
      if (!childProcess.killed) {
        childProcess.kill('SIGTERM');
        reject(new Error('Claude Code timed out'));
      }
    }, 120000);
  });
}

/**
 * Strip markdown code fences from JSON response
 */
export function stripCodeFences(response: string): string {
  let jsonStr = response.trim();
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }
  return jsonStr.trim();
}
