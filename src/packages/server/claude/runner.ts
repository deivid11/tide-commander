/**
 * Claude Code Process Runner
 * Spawns and manages Claude Code CLI processes with streaming output
 *
 * Processes are spawned with detached: true and unref() to survive commander crashes.
 * PIDs are persisted to disk for crash recovery.
 *
 * ULTRA-RESILIENT FEATURES:
 * - Auto-restart on unexpected crashes
 * - Detailed death diagnostics
 * - Process watchdog monitoring
 * - PID persistence for recovery across commander restarts
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import { StringDecoder } from 'string_decoder';
import type {
  CLIBackend,
  RunnerRequest,
  RunnerCallbacks,
  ActiveProcess,
  StandardEvent,
  ProcessDeathInfo,
} from './types.js';
import { ClaudeBackend } from './backend.js';
import { createLogger } from '../utils/logger.js';
import { saveRunningProcesses, loadRunningProcesses, isProcessRunning, clearRunningProcesses, type RunningProcessInfo } from '../data/index.js';

const log = createLogger('Runner');

// Interval for persisting running processes (every 10 seconds)
const PERSIST_INTERVAL = 10000;

// Watchdog interval - check process health (every 5 seconds)
const WATCHDOG_INTERVAL = 5000;

// Auto-restart configuration
const MAX_RESTART_ATTEMPTS = 3;  // Max restarts within the cooldown period
const RESTART_COOLDOWN_MS = 60000;  // Reset restart count after 1 minute of stability
const MIN_RUNTIME_FOR_RESTART_MS = 5000;  // Don't restart if process died within 5s (likely config error)

export class ClaudeRunner {
  private backend: CLIBackend;
  private activeProcesses: Map<string, ActiveProcess> = new Map();
  private callbacks: RunnerCallbacks;
  private persistTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;

  // Track recent process deaths for diagnostics
  private recentDeaths: ProcessDeathInfo[] = [];
  private readonly MAX_DEATH_HISTORY = 50;

  // Track last stderr for each agent (for death diagnostics)
  private lastStderr: Map<string, string> = new Map();

  // Auto-restart enabled flag
  private autoRestartEnabled = true;

  // Callbacks for activity watchdog (called when next activity is received)
  private activityCallbacks: Map<string, Array<() => void>> = new Map();

  constructor(callbacks: RunnerCallbacks) {
    this.backend = new ClaudeBackend();
    this.callbacks = callbacks;

    // Start periodic persistence of running processes
    this.persistTimer = setInterval(() => {
      this.persistRunningProcesses();
    }, PERSIST_INTERVAL);

    // Start watchdog to monitor process health
    this.watchdogTimer = setInterval(() => {
      this.runWatchdog();
    }, WATCHDOG_INTERVAL);

    // Check for orphaned processes from previous commander instance
    this.recoverOrphanedProcesses();

    log.log('🛡️ Runner initialized with auto-restart and watchdog enabled');
  }

  /**
   * Enable or disable auto-restart
   */
  setAutoRestart(enabled: boolean): void {
    this.autoRestartEnabled = enabled;
    log.log(`🔄 Auto-restart ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get recent process death history for diagnostics
   */
  getDeathHistory(): ProcessDeathInfo[] {
    return [...this.recentDeaths];
  }

  /**
   * Watchdog - periodically check that tracked processes are still alive
   * If a process dies without triggering the 'close' event, this will catch it
   */
  private runWatchdog(): void {
    for (const [agentId, activeProcess] of this.activeProcesses) {
      const pid = activeProcess.process.pid;
      if (!pid) continue;

      // Check if process is still alive
      if (!isProcessRunning(pid)) {
        log.error(`🐕 [WATCHDOG] Agent ${agentId}: Process ${pid} is dead but was still being tracked!`);

        // Record death
        this.recordDeath({
          agentId,
          pid,
          exitCode: null,
          signal: null,
          runtime: Date.now() - activeProcess.startTime,
          wasTracked: true,
          timestamp: Date.now(),
          stderr: this.lastStderr.get(agentId),
        });

        // Clean up
        this.activeProcesses.delete(agentId);
        this.lastStderr.delete(agentId);

        // Attempt auto-restart
        this.maybeAutoRestart(agentId, activeProcess, null, null);
      }
    }
  }

  /**
   * Record a process death for diagnostics
   */
  private recordDeath(info: ProcessDeathInfo): void {
    this.recentDeaths.unshift(info);
    if (this.recentDeaths.length > this.MAX_DEATH_HISTORY) {
      this.recentDeaths.pop();
    }

    // Log detailed death info
    const runtimeSec = (info.runtime / 1000).toFixed(1);
    log.error(`💀 [DEATH RECORD] Agent ${info.agentId}:`);
    log.error(`   PID: ${info.pid}`);
    log.error(`   Exit code: ${info.exitCode}`);
    log.error(`   Signal: ${info.signal}`);
    log.error(`   Runtime: ${runtimeSec}s`);
    log.error(`   Was tracked: ${info.wasTracked}`);
    if (info.stderr) {
      log.error(`   Last stderr: ${info.stderr.substring(0, 500)}`);
    }

    // Check for patterns in recent deaths
    this.analyzeDeathPatterns();
  }

  /**
   * Analyze death patterns to detect systemic issues
   */
  private analyzeDeathPatterns(): void {
    const recentWindow = 60000; // 1 minute
    const now = Date.now();
    const recentDeaths = this.recentDeaths.filter(d => now - d.timestamp < recentWindow);

    if (recentDeaths.length >= 3) {
      log.error(`⚠️ [PATTERN] ${recentDeaths.length} processes died in the last minute!`);

      // Check if all deaths have the same signal
      const signals = recentDeaths.map(d => d.signal).filter(s => s);
      if (signals.length > 0 && signals.every(s => s === signals[0])) {
        log.error(`⚠️ [PATTERN] All deaths have signal: ${signals[0]} - possible external kill`);
      }

      // Check if all deaths have the same exit code
      const codes = recentDeaths.map(d => d.exitCode).filter(c => c !== null);
      if (codes.length > 0 && codes.every(c => c === codes[0])) {
        log.error(`⚠️ [PATTERN] All deaths have exit code: ${codes[0]}`);
        if (codes[0] === 137) {
          log.error(`⚠️ [PATTERN] Exit code 137 = OOM killed! Check system memory.`);
        } else if (codes[0] === 1) {
          log.error(`⚠️ [PATTERN] Exit code 1 = general error. Check Claude Code installation.`);
        }
      }

      // Check for very short runtimes (config/startup errors)
      const shortLived = recentDeaths.filter(d => d.runtime < 5000);
      if (shortLived.length >= 2) {
        log.error(`⚠️ [PATTERN] ${shortLived.length} processes died within 5s of starting - likely config error`);
      }
    }
  }

  /**
   * Attempt to auto-restart a crashed process
   */
  private maybeAutoRestart(
    agentId: string,
    activeProcess: ActiveProcess,
    exitCode: number | null,
    signal: NodeJS.Signals | null
  ): void {
    if (!this.autoRestartEnabled) {
      log.log(`🔄 [AUTO-RESTART] Disabled, not restarting ${agentId}`);
      return;
    }

    const lastRequest = activeProcess.lastRequest;
    if (!lastRequest) {
      log.log(`🔄 [AUTO-RESTART] No last request stored for ${agentId}, cannot restart`);
      return;
    }

    const runtime = Date.now() - activeProcess.startTime;

    // Don't restart if process died too quickly (likely config error)
    if (runtime < MIN_RUNTIME_FOR_RESTART_MS) {
      log.error(`🔄 [AUTO-RESTART] Process ${agentId} died after only ${runtime}ms - NOT restarting (likely config error)`);
      this.callbacks.onError(agentId, `Process crashed immediately (${runtime}ms) - not auto-restarting. Check Claude Code installation.`);
      return;
    }

    // Don't restart if it was a clean exit (code 0) or intentional stop (SIGINT/SIGTERM)
    if (exitCode === 0) {
      log.log(`🔄 [AUTO-RESTART] Process ${agentId} exited cleanly (code 0), not restarting`);
      return;
    }
    if (signal === 'SIGINT' || signal === 'SIGTERM') {
      log.log(`🔄 [AUTO-RESTART] Process ${agentId} was stopped intentionally (${signal}), not restarting`);
      return;
    }

    // Check restart count
    const restartCount = (activeProcess.restartCount || 0);
    const lastRestartTime = activeProcess.lastRestartTime || 0;
    const timeSinceLastRestart = Date.now() - lastRestartTime;

    // Reset restart count if enough time has passed
    const effectiveRestartCount = timeSinceLastRestart > RESTART_COOLDOWN_MS ? 0 : restartCount;

    if (effectiveRestartCount >= MAX_RESTART_ATTEMPTS) {
      log.error(`🔄 [AUTO-RESTART] Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached for ${agentId}`);
      this.callbacks.onError(agentId, `Process keeps crashing - auto-restart disabled after ${MAX_RESTART_ATTEMPTS} attempts. Manual intervention required.`);
      return;
    }

    // Perform restart
    log.log(`🔄 [AUTO-RESTART] Restarting ${agentId} (attempt ${effectiveRestartCount + 1}/${MAX_RESTART_ATTEMPTS})...`);

    // Small delay before restart to avoid rapid cycling
    setTimeout(async () => {
      try {
        // Create a new request with updated restart tracking
        const newRequest: RunnerRequest = {
          ...lastRequest,
        };

        // Run with restart tracking
        await this.run(newRequest);

        // Update restart count on the new process
        const newProcess = this.activeProcesses.get(agentId);
        if (newProcess) {
          newProcess.restartCount = effectiveRestartCount + 1;
          newProcess.lastRestartTime = Date.now();
        }

        log.log(`🔄 [AUTO-RESTART] Successfully restarted ${agentId}`);
        this.callbacks.onOutput(agentId, `[System] Process was automatically restarted after crash`);
      } catch (err) {
        log.error(`🔄 [AUTO-RESTART] Failed to restart ${agentId}:`, err);
        this.callbacks.onError(agentId, `Auto-restart failed: ${err}`);
      }
    }, 1000);
  }

  /**
   * Persist running process PIDs to disk for crash recovery
   */
  private persistRunningProcesses(): void {
    const processes: RunningProcessInfo[] = [];

    for (const [agentId, activeProcess] of this.activeProcesses) {
      if (activeProcess.process.pid) {
        processes.push({
          agentId,
          pid: activeProcess.process.pid,
          sessionId: activeProcess.sessionId,
          startTime: activeProcess.startTime,
          outputFile: activeProcess.outputFile,
          stderrFile: activeProcess.stderrFile,
          lastRequest: activeProcess.lastRequest,
        });
      }
    }

    if (processes.length > 0) {
      saveRunningProcesses(processes);
    } else {
      clearRunningProcesses();
    }
  }

  /**
   * Check for orphaned processes from a previous commander instance
   * Since we use pipe-based I/O, processes die when server restarts.
   * This just cleans up the tracking state.
   */
  private recoverOrphanedProcesses(): void {
    const savedProcesses = loadRunningProcesses();

    if (savedProcesses.length === 0) {
      return;
    }

    log.log(`🔍 Checking ${savedProcesses.length} processes from previous commander instance...`);

    for (const savedProcess of savedProcesses) {
      if (isProcessRunning(savedProcess.pid)) {
        log.log(`✅ Found orphaned process for agent ${savedProcess.agentId} (PID ${savedProcess.pid}) - still running`);
        // Note: We can't reconnect to pipe-based processes, but we can note they're running
        // The agent's status will be synced separately
      } else {
        log.log(`❌ Process for agent ${savedProcess.agentId} (PID ${savedProcess.pid}) is no longer running`);
      }
    }

    // Clear the saved processes - agents will be restarted if needed
    clearRunningProcesses();
  }

  /**
   * Run a prompt for an agent
   *
   * Uses standard pipe-based I/O. Processes will NOT survive server restarts,
   * but we implement auto-resume using Claude's session persistence.
   */
  async run(request: RunnerRequest): Promise<void> {
    const { agentId, prompt, workingDir, sessionId, model, useChrome, permissionMode = 'bypass', systemPrompt, forceNewSession, customAgent } = request;

    // Kill existing process for this agent if any
    await this.stop(agentId);

    // Build CLI arguments
    // If forceNewSession is true, don't pass sessionId (start fresh)
    const backendConfig = {
      agentId,
      sessionId: forceNewSession ? undefined : sessionId,
      model,
      workingDir,
      permissionMode,
      useChrome,
      systemPrompt,
      customAgent,
    };
    const args = this.backend.buildArgs(backendConfig);
    const executable = this.backend.getExecutablePath();

    log.log(`🚀 Spawning: ${executable} ${args.join(' ')}`);

    // Spawn process with its own process group (detached: true)
    // Note: shell: false is required to properly pass arguments with special characters
    const isWindows = process.platform === 'win32';
    const childProcess = spawn(executable, args, {
      cwd: workingDir,
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        // Pass server URL for permission hooks in interactive mode
        TIDE_SERVER: `http://localhost:${process.env.TIDE_PORT || process.env.PORT || 5174}`,
      },
      shell: isWindows ? true : false,
      detached: isWindows ? false : true,
    });

    // Track the active process with the request for potential auto-restart
    const activeProcess: ActiveProcess = {
      agentId,
      sessionId,
      startTime: Date.now(),
      process: childProcess,
      lastRequest: request,
      restartCount: 0,
    };
    this.activeProcesses.set(agentId, activeProcess);

    // Handle stdout (stream-json events) - returns promise when fully processed
    const stdoutDone = this.handleStdout(agentId, childProcess);

    // Handle stderr
    this.handleStderr(agentId, childProcess);

    // Handle process exit - wait for stdout to be fully processed first
    childProcess.on('close', async (code, signal) => {
      // Wait for stdout to be fully processed before signaling completion
      // This fixes a race condition where the last message might not be received
      await stdoutDone;
      const wasTracked = this.activeProcesses.has(agentId);
      const trackedProcess = this.activeProcesses.get(agentId);
      const runtime = trackedProcess ? Date.now() - trackedProcess.startTime : 0;

      // Record death for diagnostics
      const deathInfo: ProcessDeathInfo = {
        agentId,
        pid: childProcess.pid,
        exitCode: code,
        signal,
        runtime,
        wasTracked,
        timestamp: Date.now(),
        stderr: this.lastStderr.get(agentId),
      };

      // Clean up tracking
      this.activeProcesses.delete(agentId);
      this.lastStderr.delete(agentId);

      // Determine exit type for logging
      if (signal) {
        if (signal === 'SIGINT') {
          log.log(`🛑 [EXIT] Agent ${agentId}: Process terminated by SIGINT (user interrupt), pid was ${childProcess.pid}, runtime ${(runtime/1000).toFixed(1)}s`);
        } else if (signal === 'SIGTERM') {
          log.log(`🛑 [EXIT] Agent ${agentId}: Process terminated by SIGTERM (stop request), pid was ${childProcess.pid}, runtime ${(runtime/1000).toFixed(1)}s`);
        } else if (signal === 'SIGKILL') {
          log.log(`🛑 [EXIT] Agent ${agentId}: Process force-killed by SIGKILL, pid was ${childProcess.pid}, runtime ${(runtime/1000).toFixed(1)}s`);
          this.recordDeath(deathInfo);
        } else {
          log.log(`⚠️ [EXIT] Agent ${agentId}: Process killed by signal ${signal}, pid was ${childProcess.pid}, runtime ${(runtime/1000).toFixed(1)}s`);
          this.recordDeath(deathInfo);
        }
      } else if (code === 0) {
        log.log(`✅ [EXIT] Agent ${agentId}: Process completed successfully (exit code 0), pid was ${childProcess.pid}, runtime ${(runtime/1000).toFixed(1)}s`);
      } else {
        log.error(`❌ [EXIT] Agent ${agentId}: Process exited with error code ${code}, pid was ${childProcess.pid}, runtime ${(runtime/1000).toFixed(1)}s${!wasTracked ? ' (unexpected - was not being tracked)' : ''}`);
        this.recordDeath(deathInfo);
      }

      this.callbacks.onComplete(agentId, code === 0);

      // Attempt auto-restart for unexpected crashes
      if (trackedProcess && code !== 0 && signal !== 'SIGINT' && signal !== 'SIGTERM') {
        this.maybeAutoRestart(agentId, trackedProcess, code, signal);
      }
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

    // Send the prompt via stdin
    if (this.backend.requiresStdinInput() && childProcess.stdin) {
      const stdinInput = this.backend.formatStdinInput(prompt);
      childProcess.stdin.write(stdinInput + '\n', 'utf8', (err) => {
        if (err) {
          log.error(`Failed to write initial prompt to stdin for ${agentId}:`, err);
        }
      });
    }
  }

  /**
   * Send an additional message to a running agent process
   * Returns true if message was sent, false if no running process
   */
  sendMessage(agentId: string, message: string): boolean {
    const activeProcess = this.activeProcesses.get(agentId);
    if (!activeProcess) {
      return false;
    }

    const stdin = activeProcess.process.stdin;
    if (!stdin || !stdin.writable) {
      return false;
    }

    const stdinInput = this.backend.formatStdinInput(message);
    stdin.write(stdinInput + '\n', 'utf8', (err) => {
      if (err) {
        log.error(`Failed to write to stdin for ${agentId}:`, err);
      }
    });

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
      return false;
    }

    const pid = activeProcess.process.pid;
    if (!pid) {
      return false;
    }
    try {
      activeProcess.process.kill('SIGINT');
      return true;
    } catch (e) {
      log.error(`Failed to interrupt ${agentId}:`, e);
      return false;
    }
  }

  /**
   * Handle stdout streaming with UTF-8 safe parsing
   * Returns a promise that resolves when stdout is fully processed
   */
  private handleStdout(agentId: string, process: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      let resolved = false; // Guard against double-resolve race condition

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
        // Signal that stdout is fully processed
        if (!resolved) {
          resolved = true;
          resolve();
        }
      });

      // Also resolve on close in case end doesn't fire
      // But only if 'end' hasn't already resolved (fixes race condition where
      // 'close' can fire before 'end', causing the last message to be lost)
      process.stdout?.on('close', () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      });
    });
  }

  /**
   * Process a single JSON line from stdout
   */
  private processLine(agentId: string, line: string): void {
    try {
      const rawEvent = JSON.parse(line);

      // PERF: Verbose event logging disabled - was causing CPU spikes
      // Enable via DEBUG env var if needed for debugging
      if (process.env.DEBUG) {
        log.log(`[EVENT] ${agentId.slice(0,4)}: type=${rawEvent.type}, subtype=${rawEvent.subtype || 'none'}, tool_name=${rawEvent.tool_name || 'none'}`);
      }

      // Extract session ID if present
      const sessionId = this.backend.extractSessionId(rawEvent);
      if (sessionId) {
        const activeProcess = this.activeProcesses.get(agentId);
        if (activeProcess) {
          // Always track current session ID from Claude
          activeProcess.sessionId = sessionId;
          // Only update lastRequest if this is the first session (was undefined)
          // This preserves the original session ID for auto-restart attempts
          if (activeProcess.lastRequest && !activeProcess.lastRequest.sessionId) {
            activeProcess.lastRequest.sessionId = sessionId;
          }
        }
        this.callbacks.onSessionId(agentId, sessionId);
      }

      // Parse to normalized event (may return array for multiple tool_use blocks)
      const eventOrEvents = this.backend.parseEvent(rawEvent);
      if (eventOrEvents) {
        if (Array.isArray(eventOrEvents)) {
          // Handle array of events (e.g., multiple tool_use blocks in assistant message)
          for (const event of eventOrEvents) {
            this.handleEvent(agentId, event);
          }
        } else {
          this.handleEvent(agentId, eventOrEvents);
        }
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
    // Update last activity time for this agent
    const activeProcess = this.activeProcesses.get(agentId);
    if (activeProcess) {
      activeProcess.lastActivityTime = Date.now();
    }

    // Trigger any waiting activity callbacks
    const callbacks = this.activityCallbacks.get(agentId);
    if (callbacks && callbacks.length > 0) {
      for (const callback of callbacks) {
        try {
          callback();
        } catch (err) {
          log.error(`Activity callback error for ${agentId}:`, err);
        }
      }
      this.activityCallbacks.delete(agentId);
    }

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
        // Send tool name as text output (needed for simple view mode display)
        // Send immediately without marking as streaming to ensure it displays
        this.callbacks.onOutput(agentId, `Using tool: ${event.toolName}`, false);
        // Send tool input as JSON (needed for simple view to show file paths, commands, etc.)
        if (event.toolInput) {
          this.callbacks.onOutput(agentId, `Tool input: ${JSON.stringify(event.toolInput)}`, false);
        }
        break;

      case 'tool_result':
        // Send Bash tool results as text output for display
        // Other tool results are too verbose (file contents, etc.)
        if (event.toolName === 'Bash' && event.toolOutput) {
          // Send as non-streaming to ensure it displays properly in Guake
          this.callbacks.onOutput(agentId, `Bash output:\n${event.toolOutput}`, false);
        }
        break;

      case 'step_complete':
        // Output the result text if available (fallback for non-streamed responses)
        // This handles cases where Claude returns a quick response without streaming deltas
        if (event.resultText) {
          this.callbacks.onOutput(agentId, event.resultText, false);
        }
        if (event.tokens) {
          this.callbacks.onOutput(
            agentId,
            `Tokens: ${event.tokens.input} in, ${event.tokens.output} out`,
            false
          );
        }
        if (event.cost !== undefined) {
          this.callbacks.onOutput(agentId, `Cost: $${event.cost.toFixed(4)}`, false);
        }
        break;

      case 'error':
        this.callbacks.onError(agentId, event.errorMessage || 'Unknown error');
        break;

      case 'context_stats':
        // Send context stats raw output to client for rendering
        if (event.contextStatsRaw) {
          this.callbacks.onOutput(agentId, event.contextStatsRaw, false);
        }
        break;
    }
  }

  /**
   * Handle stderr - capture for diagnostics and error reporting
   */
  private handleStderr(agentId: string, process: ChildProcess): void {
    const decoder = new StringDecoder('utf8');
    let stderrBuffer = '';

    process.stderr?.on('data', (data: Buffer) => {
      const text = decoder.write(data);
      log.error(` stderr for ${agentId}:`, text);

      // Accumulate stderr for death diagnostics (keep last 2KB)
      stderrBuffer += text;
      if (stderrBuffer.length > 2048) {
        stderrBuffer = stderrBuffer.slice(-2048);
      }
      this.lastStderr.set(agentId, stderrBuffer);

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
      return;
    }

    const pid = activeProcess.process.pid;
    log.log(`🛑 Stopping agent ${agentId} (pid ${pid})`);

    // Remove from tracking immediately
    this.activeProcesses.delete(agentId);

    // Clear any pending activity callbacks
    this.activityCallbacks.delete(agentId);

    // First, try sending SIGINT (Ctrl+C) which Claude CLI handles gracefully
    if (pid) {
      try {
        process.kill(-pid, 'SIGINT');
      } catch {
        // Process group SIGINT failed, try direct
      }
    }

    // Also send SIGINT to the main process
    try {
      activeProcess.process.kill('SIGINT');
    } catch {
      // Ignore if already dead
    }

    // Notify that the process was stopped (so UI updates)
    this.callbacks.onComplete(agentId, false);

    // Give it a moment to terminate gracefully with SIGINT, then escalate to SIGTERM
    setTimeout(() => {
      try {
        if (pid && !activeProcess.process.killed) {
          process.kill(-pid, 'SIGTERM');
          activeProcess.process.kill('SIGTERM');
        }
      } catch {
        // Process already dead, ignore
      }
    }, 500);

    // Final resort: force kill with SIGKILL
    setTimeout(() => {
      try {
        if (pid && !activeProcess.process.killed) {
          process.kill(-pid, 'SIGKILL');
          activeProcess.process.kill('SIGKILL');
        }
      } catch {
        // Process already dead, ignore
      }
    }, 1500);
  }

  /**
   * Stop all running processes
   */
  async stopAll(): Promise<void> {
    // Stop the persist timer
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }

    // Stop the watchdog timer
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    // Disable auto-restart during shutdown
    this.autoRestartEnabled = false;

    // Stop all tracked processes
    for (const [agentId] of this.activeProcesses) {
      await this.stop(agentId);
    }

    // Clear the persisted processes file
    clearRunningProcesses();

    // Clear stderr tracking
    this.lastStderr.clear();
  }

  /**
   * Check if an agent has an active process that is actually running
   * This verifies both that we're tracking the process AND that the process is alive
   */
  isRunning(agentId: string): boolean {
    const activeProcess = this.activeProcesses.get(agentId);
    if (!activeProcess) {
      return false;
    }

    // Verify the process is actually still alive
    const pid = activeProcess.process.pid;
    if (!pid) {
      // No PID means process never started properly - clean up
      this.activeProcesses.delete(agentId);
      return false;
    }

    // Check if process is actually running using signal 0
    const actuallyRunning = isProcessRunning(pid);
    if (!actuallyRunning) {
      // Process died without us knowing - clean up tracking
      this.activeProcesses.delete(agentId);
      this.lastStderr.delete(agentId);
      return false;
    }

    return true;
  }

  /**
   * Get session ID for an agent
   */
  getSessionId(agentId: string): string | undefined {
    return this.activeProcesses.get(agentId)?.sessionId;
  }

  /**
   * Check if agent has received activity within the given time window
   * @param agentId The agent to check
   * @param withinMs Time window in milliseconds
   * @returns true if activity was received within the window, false otherwise
   */
  hasRecentActivity(agentId: string, withinMs: number): boolean {
    const activeProcess = this.activeProcesses.get(agentId);
    if (!activeProcess) {
      return false;
    }
    const lastActivity = activeProcess.lastActivityTime || activeProcess.startTime;
    return (Date.now() - lastActivity) < withinMs;
  }

  /**
   * Register a one-time callback to be called when the next activity is received for an agent
   * Used by the stdin watchdog to cancel timeout when activity is received
   * @param agentId The agent to watch
   * @param callback Function to call when activity is received
   */
  onNextActivity(agentId: string, callback: () => void): void {
    if (!this.activityCallbacks.has(agentId)) {
      this.activityCallbacks.set(agentId, []);
    }
    this.activityCallbacks.get(agentId)!.push(callback);
  }

  /**
   * Clear all pending activity callbacks for an agent
   * Called when process is stopped to clean up
   */
  clearActivityCallbacks(agentId: string): void {
    this.activityCallbacks.delete(agentId);
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
