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
    const { agentId, prompt, workingDir, sessionId, model, useChrome, permissionMode = 'bypass', systemPrompt, forceNewSession, customAgent } = request;

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
      customAgent,
    });

    // Get executable path
    const executable = this.backend.getExecutablePath();

    log.log(` Starting: ${executable} ${args.join(' ')}`);
    log.log(` Working dir: ${workingDir}`);

    // Spawn process with its own process group (detached: true)
    // This allows us to kill the entire process tree when stopping
    // Note: shell: false to avoid issues with special characters in args
    const childProcess = spawn(executable, args, {
      cwd: workingDir,
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
      },
      shell: false,
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
      const wasTracked = this.activeProcesses.has(agentId);
      this.activeProcesses.delete(agentId);

      // Determine exit type for logging
      if (signal) {
        // Process was killed by a signal
        if (signal === 'SIGINT') {
          log.log(`🛑 [EXIT] Agent ${agentId}: Process terminated by SIGINT (user interrupt), pid was ${childProcess.pid}`);
        } else if (signal === 'SIGTERM') {
          log.log(`🛑 [EXIT] Agent ${agentId}: Process terminated by SIGTERM (stop request), pid was ${childProcess.pid}`);
        } else if (signal === 'SIGKILL') {
          log.log(`🛑 [EXIT] Agent ${agentId}: Process force-killed by SIGKILL, pid was ${childProcess.pid}`);
        } else {
          log.log(`⚠️ [EXIT] Agent ${agentId}: Process killed by signal ${signal}, pid was ${childProcess.pid}`);
        }
      } else if (code === 0) {
        log.log(`✅ [EXIT] Agent ${agentId}: Process completed successfully (exit code 0), pid was ${childProcess.pid}`);
      } else {
        log.log(`❌ [EXIT] Agent ${agentId}: Process exited with error code ${code}, pid was ${childProcess.pid}${!wasTracked ? ' (unexpected - was not being tracked)' : ''}`);
      }

      this.callbacks.onComplete(agentId, code === 0);
    });

    childProcess.on('error', (err) => {
      log.error(`❌ [SPAWN ERROR] Agent ${agentId}: Failed to spawn process: ${err.message}`);
      this.activeProcesses.delete(agentId);
      this.callbacks.onError(agentId, err.message);
    });

    // Log process start
    childProcess.on('spawn', () => {
      log.log(`🚀 [SPAWN] Agent ${agentId}: Process started with pid ${childProcess.pid}`);
    });

    // Send the prompt via stdin (keep stdin open for additional messages)
    if (this.backend.requiresStdinInput() && childProcess.stdin) {
      const stdinInput = this.backend.formatStdinInput(prompt);
      log.log(` Sending stdin: ${stdinInput.substring(0, 100)}...`);
      childProcess.stdin.write(stdinInput + '\n', 'utf8', (err) => {
        if (err) {
          log.error(` Failed to write initial prompt to stdin for ${agentId}:`, err);
        }
      });
      // Don't close stdin - allow sending additional messages
    }
  }

  /**
   * Send an additional message to a running agent process
   * Returns true if message was queued for sending, false if no running process
   */
  sendMessage(agentId: string, message: string): boolean {
    const activeProcess = this.activeProcesses.get(agentId);
    if (!activeProcess) {
      log.log(` No active process for agent ${agentId}`);
      return false;
    }

    const stdin = activeProcess.process.stdin;
    if (!stdin || !stdin.writable) {
      log.log(` No writable stdin for agent ${agentId}`);
      return false;
    }

    const stdinInput = this.backend.formatStdinInput(message);
    log.log(` Sending additional message to ${agentId}: ${stdinInput.substring(0, 100)}...`);

    // Write to stdin with error handling
    const success = stdin.write(stdinInput + '\n', 'utf8', (err) => {
      if (err) {
        log.error(` Failed to write to stdin for ${agentId}:`, err);
      }
    });

    if (!success) {
      // Buffer is full, wait for drain event
      log.log(` stdin buffer full for ${agentId}, waiting for drain...`);
      stdin.once('drain', () => {
        log.log(` stdin drained for ${agentId}`);
      });
    }

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
      log.log(`⚡ [INTERRUPT] Agent ${agentId}: No active process to interrupt`);
      return false;
    }

    const pid = activeProcess.process.pid;
    if (!pid) {
      log.log(`⚡ [INTERRUPT] Agent ${agentId}: No PID available`);
      return false;
    }

    log.log(`⚡ [INTERRUPT] Agent ${agentId}: Sending SIGINT to pid ${pid} (graceful interrupt)`);
    try {
      // Send SIGINT to the process (like Ctrl+C)
      activeProcess.process.kill('SIGINT');
      log.log(`⚡ [INTERRUPT] Agent ${agentId}: SIGINT sent successfully`);
      return true;
    } catch (e) {
      log.error(`⚡ [INTERRUPT] Agent ${agentId}: Failed to send SIGINT:`, e);
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
          log.log(`🔵 [TEXT EVENT] agent=${agentId}, isStreaming=${event.isStreaming}, textLen=${event.text.length}, text="${event.text.substring(0, 80)}..."`);
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

      case 'context_stats':
        // Send context stats raw output to client for rendering
        if (event.contextStatsRaw) {
          this.callbacks.onOutput(agentId, event.contextStatsRaw);
        }
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
    if (!activeProcess) {
      log.log(`🛑 [STOP] Agent ${agentId}: No active process to stop`);
      return;
    }

    const pid = activeProcess.process.pid;
    log.log(`🛑 [STOP] Agent ${agentId}: Initiating stop sequence for pid ${pid}`);

    // Remove from tracking immediately
    this.activeProcesses.delete(agentId);

    // First, try sending SIGINT (Ctrl+C) which Claude CLI handles gracefully
    if (pid) {
      try {
        // Send SIGINT to process group (like Ctrl+C)
        process.kill(-pid, 'SIGINT');
        log.log(`🛑 [STOP] Agent ${agentId}: Sent SIGINT to process group ${pid}`);
      } catch (e) {
        log.log(`🛑 [STOP] Agent ${agentId}: Process group SIGINT failed, trying direct signal`);
      }
    }

    // Also send SIGINT to the main process
    try {
      activeProcess.process.kill('SIGINT');
      log.log(`🛑 [STOP] Agent ${agentId}: Sent direct SIGINT to process`);
    } catch (e) {
      // Ignore if already dead
    }

    // Notify that the process was stopped (so UI updates)
    this.callbacks.onComplete(agentId, false);

    // Give it a moment to terminate gracefully with SIGINT, then escalate to SIGTERM
    setTimeout(() => {
      try {
        if (pid && !activeProcess.process.killed) {
          log.log(`🛑 [STOP] Agent ${agentId}: Escalating to SIGTERM for pid ${pid} (process did not exit gracefully)`);
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
          log.log(`🛑 [STOP] Agent ${agentId}: Force killing pid ${pid} with SIGKILL (process unresponsive)`);
          process.kill(-pid, 'SIGKILL');
          activeProcess.process.kill('SIGKILL');
        }
      } catch (e) {
        // Process already dead, ignore
      }
    }, 1500);
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
