/**
 * Claude Code Process Runner
 * Spawns and manages Claude Code CLI processes with streaming output
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import { StringDecoder } from 'string_decoder';
import type {
  CLIBackend,
  RunnerRequest,
  RunnerCallbacks,
  ActiveProcess,
  StandardEvent,
} from './types.js';
import { ClaudeBackend } from './backend.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Runner');

export class ClaudeRunner {
  private backend: CLIBackend;
  private activeProcesses: Map<string, ActiveProcess> = new Map();
  private callbacks: RunnerCallbacks;

  constructor(callbacks: RunnerCallbacks) {
    this.backend = new ClaudeBackend();
    this.callbacks = callbacks;
  }

  /**
   * Run a prompt for an agent
   */
  async run(request: RunnerRequest): Promise<void> {
    const { agentId, prompt, workingDir, sessionId, model, useChrome, permissionMode = 'bypass', systemPrompt, disableTools, forceNewSession } = request;

    // Kill existing process for this agent if any
    await this.stop(agentId);

    // Build CLI arguments
    // If forceNewSession is true, don't pass sessionId (start fresh)
    const args = this.backend.buildArgs({
      sessionId: forceNewSession ? undefined : sessionId,
      model,
      workingDir,
      permissionMode,
      useChrome,
      systemPrompt,
      disableTools,
    });

    // Get executable path
    const executable = this.backend.getExecutablePath();

    log.log(` Starting: ${executable} ${args.join(' ')}`);
    log.log(` Working dir: ${workingDir}`);

    // Spawn process with its own process group (detached: true)
    // This allows us to kill the entire process tree when stopping
    const childProcess = spawn(executable, args, {
      cwd: workingDir,
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        // Pass server URL for permission hooks in interactive mode
        TIDE_SERVER: `http://localhost:${process.env.TIDE_PORT || 5174}`,
      },
      shell: true,
      detached: true,
    });

    // Track the active process
    const activeProcess: ActiveProcess = {
      agentId,
      sessionId,
      startTime: Date.now(),
      process: childProcess,
    };
    this.activeProcesses.set(agentId, activeProcess);

    // Handle stdout (stream-json events)
    this.handleStdout(agentId, childProcess);

    // Handle stderr
    this.handleStderr(agentId, childProcess);

    // Handle process exit
    childProcess.on('close', (code, signal) => {
      log.log(` Process exited for ${agentId} with code=${code} signal=${signal}`);
      this.activeProcesses.delete(agentId);
      this.callbacks.onComplete(agentId, code === 0);
    });

    childProcess.on('error', (err) => {
      log.error(` Process spawn error for ${agentId}:`, err);
      this.activeProcesses.delete(agentId);
      this.callbacks.onError(agentId, err.message);
    });

    // Log process start
    childProcess.on('spawn', () => {
      log.log(` Process spawned for ${agentId} (pid: ${childProcess.pid})`);
    });

    // Send the prompt via stdin (keep stdin open for additional messages)
    if (this.backend.requiresStdinInput()) {
      const stdinInput = this.backend.formatStdinInput(prompt);
      log.log(` Sending stdin: ${stdinInput.substring(0, 100)}...`);
      childProcess.stdin?.write(stdinInput + '\n');
      // Don't close stdin - allow sending additional messages
    }
  }

  /**
   * Send an additional message to a running agent process
   * Returns true if message was sent, false if no running process
   */
  sendMessage(agentId: string, message: string): boolean {
    const activeProcess = this.activeProcesses.get(agentId);
    if (!activeProcess || !activeProcess.process.stdin?.writable) {
      log.log(` No writable stdin for agent ${agentId}`);
      return false;
    }

    const stdinInput = this.backend.formatStdinInput(message);
    log.log(` Sending additional message to ${agentId}: ${stdinInput.substring(0, 100)}...`);
    activeProcess.process.stdin.write(stdinInput + '\n');
    return true;
  }

  /**
   * Interrupt a running agent process (like Ctrl+C) without killing it
   * This stops the current operation but keeps the process alive for more input
   * Returns true if interrupt was sent, false if no running process
   */
  interrupt(agentId: string): boolean {
    const activeProcess = this.activeProcesses.get(agentId);
    if (!activeProcess) {
      log.log(` No active process to interrupt for agent ${agentId}`);
      return false;
    }

    const pid = activeProcess.process.pid;
    if (!pid) {
      log.log(` No PID for agent ${agentId}`);
      return false;
    }

    log.log(` Sending SIGINT (interrupt) to agent ${agentId} (pid: ${pid})`);
    try {
      // Send SIGINT to the process (like Ctrl+C)
      activeProcess.process.kill('SIGINT');
      return true;
    } catch (e) {
      log.error(` Failed to interrupt agent ${agentId}:`, e);
      return false;
    }
  }

  /**
   * Handle stdout streaming with UTF-8 safe parsing
   */
  private handleStdout(agentId: string, process: ChildProcess): void {
    const decoder = new StringDecoder('utf8');
    let buffer = '';

    process.stdout?.on('data', (data: Buffer) => {
      // Decode with UTF-8 safety for multi-byte characters
      buffer += decoder.write(data);

      // Split by newlines
      const lines = buffer.split('\n');
      // Keep incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        this.processLine(agentId, line);
      }
    });

    // Handle remaining buffer on end
    process.stdout?.on('end', () => {
      const remaining = buffer + decoder.end();
      if (remaining.trim()) {
        this.processLine(agentId, remaining);
      }
    });
  }

  /**
   * Process a single JSON line from stdout
   */
  private processLine(agentId: string, line: string): void {
    try {
      const rawEvent = JSON.parse(line);

      // Log result events for debugging context tracking
      if (rawEvent.type === 'result') {
        log.log(` Got result event for ${agentId}:`, JSON.stringify(rawEvent).substring(0, 500));
      }

      // Extract session ID if present
      const sessionId = this.backend.extractSessionId(rawEvent);
      if (sessionId) {
        const activeProcess = this.activeProcesses.get(agentId);
        if (activeProcess) {
          activeProcess.sessionId = sessionId;
        }
        this.callbacks.onSessionId(agentId, sessionId);
      }

      // Parse to normalized event
      const event = this.backend.parseEvent(rawEvent);
      if (event) {
        this.handleEvent(agentId, event);
      }
    } catch {
      // Not JSON - raw output
      this.callbacks.onOutput(agentId, `[raw] ${line}`);
    }
  }

  /**
   * Handle a normalized event
   */
  private handleEvent(agentId: string, event: StandardEvent): void {
    // Send to callback
    this.callbacks.onEvent(agentId, event);

    // Also generate human-readable output
    switch (event.type) {
      case 'init':
        this.callbacks.onOutput(
          agentId,
          `Session started: ${event.sessionId} (${event.model})`
        );
        break;

      case 'text':
        if (event.text) {
          this.callbacks.onOutput(agentId, event.text, event.isStreaming);
        }
        break;

      case 'thinking':
        if (event.text) {
          this.callbacks.onOutput(
            agentId,
            `[thinking] ${event.text}`,
            event.isStreaming
          );
        }
        break;

      case 'tool_start':
        // Send tool name and input as separate messages for better formatting
        this.callbacks.onOutput(agentId, `Using tool: ${event.toolName}`);
        if (event.toolInput) {
          try {
            const inputStr = typeof event.toolInput === 'string'
              ? event.toolInput
              : JSON.stringify(event.toolInput, null, 2);
            this.callbacks.onOutput(agentId, `Tool input: ${inputStr}`);
          } catch {
            // Ignore serialization errors
          }
        }
        break;

      case 'tool_result':
        const output = event.toolOutput?.substring(0, 500) || '';
        this.callbacks.onOutput(
          agentId,
          `Tool result: ${output}${output.length >= 500 ? '...' : ''}`
        );
        break;

      case 'step_complete':
        if (event.tokens) {
          this.callbacks.onOutput(
            agentId,
            `Tokens: ${event.tokens.input} in, ${event.tokens.output} out`
          );
        }
        if (event.cost !== undefined) {
          this.callbacks.onOutput(agentId, `Cost: $${event.cost.toFixed(4)}`);
        }
        break;

      case 'error':
        this.callbacks.onError(agentId, event.errorMessage || 'Unknown error');
        break;
    }
  }

  /**
   * Handle stderr
   */
  private handleStderr(agentId: string, process: ChildProcess): void {
    const decoder = new StringDecoder('utf8');

    process.stderr?.on('data', (data: Buffer) => {
      const text = decoder.write(data);
      log.error(` stderr for ${agentId}:`, text);
      // Don't treat all stderr as errors - some is just logging
      if (text.toLowerCase().includes('error')) {
        this.callbacks.onError(agentId, text);
      }
    });
  }

  /**
   * Stop a running process for an agent
   */
  async stop(agentId: string): Promise<void> {
    const activeProcess = this.activeProcesses.get(agentId);
    if (activeProcess) {
      const pid = activeProcess.process.pid;
      log.log(` Stopping process for ${agentId} (pid: ${pid})`);

      // Remove from tracking immediately
      this.activeProcesses.delete(agentId);

      // First, try sending SIGINT (Ctrl+C) which Claude CLI handles gracefully
      if (pid) {
        try {
          // Send SIGINT to process group (like Ctrl+C)
          process.kill(-pid, 'SIGINT');
          log.log(` Sent SIGINT to process group ${pid}`);
        } catch (e) {
          log.log(` Process group SIGINT failed, trying direct`);
        }
      }

      // Also send SIGINT to the main process
      try {
        activeProcess.process.kill('SIGINT');
      } catch (e) {
        // Ignore if already dead
      }

      // Notify that the process was stopped (so UI updates)
      this.callbacks.onComplete(agentId, false);

      // Give it a moment to terminate gracefully with SIGINT, then escalate to SIGTERM
      setTimeout(() => {
        try {
          if (pid && !activeProcess.process.killed) {
            log.log(` Escalating to SIGTERM for process ${pid}`);
            process.kill(-pid, 'SIGTERM');
            activeProcess.process.kill('SIGTERM');
          }
        } catch (e) {
          // Process already dead, ignore
        }
      }, 500);

      // Final resort: force kill with SIGKILL
      setTimeout(() => {
        try {
          if (pid && !activeProcess.process.killed) {
            log.log(` Force killing process ${pid} with SIGKILL`);
            process.kill(-pid, 'SIGKILL');
            activeProcess.process.kill('SIGKILL');
          }
        } catch (e) {
          // Process already dead, ignore
        }
      }, 1500);
    }
  }

  /**
   * Stop all running processes
   */
  async stopAll(): Promise<void> {
    for (const [agentId] of this.activeProcesses) {
      await this.stop(agentId);
    }
  }

  /**
   * Check if an agent has an active process
   */
  isRunning(agentId: string): boolean {
    return this.activeProcesses.has(agentId);
  }

  /**
   * Get session ID for an agent
   */
  getSessionId(agentId: string): string | undefined {
    return this.activeProcesses.get(agentId)?.sessionId;
  }

  /**
   * Get memory usage for an agent's process in MB
   * Returns undefined if process is not running or memory cannot be determined
   */
  getProcessMemoryMB(agentId: string): number | undefined {
    const activeProcess = this.activeProcesses.get(agentId);
    if (!activeProcess || !activeProcess.process.pid) {
      return undefined;
    }

    const pid = activeProcess.process.pid;

    try {
      // On Linux, read from /proc/{pid}/status for VmRSS (Resident Set Size)
      // This is the actual physical memory used by the process
      const status = execSync(`cat /proc/${pid}/status 2>/dev/null | grep VmRSS`, {
        encoding: 'utf8',
        timeout: 1000,
      });

      // Parse "VmRSS:    12345 kB"
      const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
      if (match) {
        const kB = parseInt(match[1], 10);
        return Math.round(kB / 1024); // Convert to MB
      }
    } catch {
      // Process might have died or /proc not available (non-Linux)
      // Try ps as fallback (works on macOS too)
      try {
        const psOutput = execSync(`ps -o rss= -p ${pid}`, {
          encoding: 'utf8',
          timeout: 1000,
        });
        const kB = parseInt(psOutput.trim(), 10);
        if (!isNaN(kB)) {
          return Math.round(kB / 1024); // Convert to MB
        }
      } catch {
        // Process not found or error
      }
    }

    return undefined;
  }

  /**
   * Get memory usage for all active processes
   * Returns a Map of agentId -> memoryMB
   */
  getAllProcessMemory(): Map<string, number> {
    const memoryMap = new Map<string, number>();

    for (const [agentId] of this.activeProcesses) {
      const memMB = this.getProcessMemoryMB(agentId);
      if (memMB !== undefined) {
        memoryMap.set(agentId, memMB);
      }
    }

    return memoryMap;
  }
}
