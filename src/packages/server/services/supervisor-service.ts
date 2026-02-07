/**
 * Supervisor Service
 * Manages periodic analysis of agent activities via Claude Code
 * Generates human-readable activity narratives
 */

import * as agentService from './agent-service.js';
import type {
  ActivityNarrative,
  Agent,
  AgentStatusSummary,
  SupervisorReport,
  SupervisorConfig,
  AgentAnalysis,
  AgentSupervisorHistoryEntry,
  AgentSupervisorHistory,
} from '../../shared/types.js';
import type { RuntimeEvent as StandardEvent } from '../runtime/index.js';
import { loadSession } from '../claude/index.js';
import { callClaudeForAnalysis, stripCodeFences } from './supervisor-claude.js';
import {
  loadSupervisorHistory,
  saveSupervisorHistory,
  addSupervisorHistoryEntry,
  getAgentSupervisorHistory as getAgentHistoryFromStorage,
  deleteSupervisorHistory,
} from '../data/index.js';
import { logger, sanitizeUnicode, generateId, truncateOrEmpty, formatToolNarrative } from '../utils/index.js';
import { SINGLE_AGENT_PROMPT, DEFAULT_SUPERVISOR_PROMPT } from './supervisor-prompts.js';

const log = logger.supervisor;

// In-memory narrative storage per agent
const narratives = new Map<string, ActivityNarrative[]>();

// Supervisor history storage per agent (persisted to disk)
let supervisorHistory: Map<string, AgentSupervisorHistoryEntry[]> = new Map();

// Configuration
let config: SupervisorConfig = {
  enabled: true,
  intervalMs: 60000, // Not used for timer anymore, kept for compatibility
  maxNarrativesPerAgent: 20,
  autoReportOnComplete: false, // Generate report when agent completes task (disabled by default)
};

// Debounce for report generation (avoid generating too many reports in quick succession)
let reportDebounceTimer: NodeJS.Timeout | null = null;
const REPORT_DEBOUNCE_MS = 3000; // Wait 3 seconds after last event before generating

// Per-agent debounce timers for single-agent report generation
const agentReportTimers = new Map<string, NodeJS.Timeout>();
const agentReportInProgress = new Set<string>();

// Track if a full report is currently being generated
let isGeneratingReport = false;

// Latest report
let latestReport: SupervisorReport | null = null;

// Event listeners
type SupervisorListener = (event: string, data: unknown) => void;
const listeners = new Set<SupervisorListener>();

// ============================================================================
// Initialization
// ============================================================================

export function init(): void {
  // Load persisted supervisor history
  supervisorHistory = loadSupervisorHistory();
  log.log(' Initialized (event-driven mode, using Claude Code)');
  log.log(` Loaded history for ${supervisorHistory.size} agents`);
}

export function shutdown(): void {
  if (reportDebounceTimer) {
    clearTimeout(reportDebounceTimer);
    reportDebounceTimer = null;
  }
}

// ============================================================================
// Event System
// ============================================================================

export function subscribe(listener: SupervisorListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: string, data: unknown): void {
  listeners.forEach((listener) => listener(event, data));
}

// ============================================================================
// Narrative Generation
// ============================================================================

/**
 * Generate a human-readable narrative from a Claude event
 */
export function generateNarrative(
  agentId: string,
  event: StandardEvent
): ActivityNarrative | null {
  const agent = agentService.getAgent(agentId);
  if (!agent) return null;

  let narrative: string | null = null;
  let type: ActivityNarrative['type'] = 'output';
  let toolName: string | undefined;

  switch (event.type) {
    case 'tool_start':
      type = 'tool_use';
      toolName = event.toolName;
      narrative = formatToolNarrative(event.toolName, event.toolInput);
      break;

    case 'text':
      if (event.text && event.text.length > 10) {
        type = 'output';
        narrative = `Responding: "${truncateOrEmpty(event.text, 100)}"`;
      }
      break;

    case 'thinking':
      if (event.text) {
        type = 'thinking';
        narrative = `Thinking: "${truncateOrEmpty(event.text, 80)}"`;
      }
      break;

    case 'error':
      type = 'error';
      narrative = `Error occurred: ${event.errorMessage || 'Unknown error'}`;
      break;

    case 'step_complete':
      type = 'task_complete';
      narrative = `Completed processing step (${event.tokens?.input || 0} input, ${event.tokens?.output || 0} output tokens)`;
      break;
  }

  if (!narrative) return null;

  const activityNarrative: ActivityNarrative = {
    id: generateId(),
    agentId,
    timestamp: Date.now(),
    type,
    narrative,
    toolName,
  };

  // Store narrative
  addNarrative(agentId, activityNarrative);

  // Emit for real-time updates
  emit('narrative', { agentId, narrative: activityNarrative });

  // Trigger single-agent report generation on significant events (task start or complete)
  if (event.type === 'init' || event.type === 'step_complete') {
    log.log(` Event trigger: ${event.type} from agent ${agentId}`);
    scheduleAgentReportGeneration(agentId);
  }

  return activityNarrative;
}

/**
 * Schedule a single-agent report generation with debouncing
 * Only updates the specific agent that had activity, not all agents
 */
function scheduleAgentReportGeneration(agentId: string): void {
  if (!config.enabled) {
    log.log(' Disabled, skipping scheduled agent report');
    return;
  }

  if (!config.autoReportOnComplete) {
    log.log(' Auto-report on complete disabled, skipping scheduled agent report');
    return;
  }

  // Clear any existing timer for this agent
  const existingTimer = agentReportTimers.get(agentId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  log.log(` Scheduled single-agent report for ${agentId} (${REPORT_DEBOUNCE_MS}ms debounce)`);

  // Schedule report generation after debounce period
  const timer = setTimeout(async () => {
    agentReportTimers.delete(agentId);

    if (agentReportInProgress.has(agentId)) {
      log.log(` Report already in progress for ${agentId}, skipping`);
      return;
    }

    const agent = agentService.getAgent(agentId);
    if (!agent) {
      log.log(` Agent ${agentId} not found, skipping report`);
      return;
    }

    try {
      log.log(` Generating single-agent report for ${agent.name}...`);
      await generateSingleAgentReport(agentId);
    } catch (err) {
      log.error(` Single-agent report failed for ${agentId}:`, err);
    }
  }, REPORT_DEBOUNCE_MS);

  agentReportTimers.set(agentId, timer);
}


// ============================================================================
// Narrative Storage
// ============================================================================

function addNarrative(agentId: string, narrative: ActivityNarrative): void {
  if (!narratives.has(agentId)) {
    narratives.set(agentId, []);
  }
  const agentNarratives = narratives.get(agentId)!;
  agentNarratives.unshift(narrative);

  // Trim to max
  if (agentNarratives.length > config.maxNarrativesPerAgent) {
    agentNarratives.pop();
  }
}

export function getNarratives(agentId: string): ActivityNarrative[] {
  return narratives.get(agentId) || [];
}

export function getAllNarratives(): Map<string, ActivityNarrative[]> {
  return new Map(narratives);
}

export function clearNarratives(agentId: string): void {
  narratives.delete(agentId);
}

// ============================================================================
// Report Generation
// ============================================================================

export async function generateReport(): Promise<SupervisorReport> {
  log.log(' generateReport() called');

  // If already generating, return the latest report (or wait for current one)
  if (isGeneratingReport) {
    log.log(' Report already in progress, returning latest');
    // Return latest report if available, otherwise return a pending status
    if (latestReport) {
      return latestReport;
    }
    // No report yet, return empty one
    return {
      id: generateId(),
      timestamp: Date.now(),
      agentSummaries: [],
      overallStatus: 'healthy',
      insights: ['Report generation in progress...'],
      recommendations: [],
    };
  }

  isGeneratingReport = true;
  log.log(' Starting report generation...');

  try {
    const agents = agentService.getAllAgents();

    if (agents.length === 0) {
      // Return empty report if no agents
      const emptyReport: SupervisorReport = {
        id: generateId(),
        timestamp: Date.now(),
        agentSummaries: [],
        overallStatus: 'healthy',
        insights: ['No agents currently active'],
        recommendations: [],
      };
      latestReport = emptyReport;
      emit('report', emptyReport);
      return emptyReport;
    }

    // Build agent summaries with session history
    const agentSummaries: AgentStatusSummary[] = await Promise.all(
      agents.map(async (agent) => {
        // Try to load recent session history if agent has a session
        let sessionNarratives: ActivityNarrative[] = [];
        if (agent.sessionId) {
          try {
            const history = await loadSession(agent.cwd, agent.sessionId, 20);
            if (history && history.messages.length > 0) {
              // Convert session messages to narratives
              sessionNarratives = history.messages.map((msg, index) => ({
                id: `session-${agent.sessionId}-${index}`,
                agentId: agent.id,
                timestamp: new Date(msg.timestamp).getTime(),
                type: msg.type === 'user' ? 'task_start' as const :
                      msg.type === 'tool_use' ? 'tool_use' as const :
                      msg.type === 'tool_result' ? 'output' as const : 'output' as const,
                narrative: msg.type === 'user' ? `User asked: "${truncateOrEmpty(msg.content, 150)}"` :
                          msg.type === 'assistant' ? `Responded: "${truncateOrEmpty(msg.content, 150)}"` :
                          msg.type === 'tool_use' ? `Used tool: ${msg.toolName}` :
                          `Tool result received`,
                toolName: msg.toolName,
              }));
            }
          } catch (err) {
            console.error(`[SupervisorService] Failed to load session for ${agent.name}:`, err);
          }
        }

        // Combine in-memory narratives with session history, preferring recent in-memory ones
        const inMemoryNarratives = getNarratives(agent.id).slice(0, 10);
        const allNarratives = inMemoryNarratives.length > 0
          ? inMemoryNarratives
          : sessionNarratives.slice(-10);

        return {
          id: agent.id,
          name: agent.name,
          class: agent.class,
          status: agent.status,
          currentTask: agent.currentTask,
          lastAssignedTask: agent.lastAssignedTask,
          lastAssignedTaskTime: agent.lastAssignedTaskTime,
          recentNarratives: allNarratives,
          tokensUsed: agent.tokensUsed,
          contextUsed: agent.contextUsed,
          lastActivityTime: agent.lastActivity,
        };
      })
    );

    // Call Claude for analysis
    const prompt = await buildSupervisorPrompt(agentSummaries);

    let response: string;
    try {
      response = await callClaudeForAnalysis(prompt);
    } catch (err) {
      log.error(' Claude API call failed:', err);
      // Return fallback report (but still emit it to clients)
      const fallbackReport = createFallbackReport(agentSummaries);
      latestReport = fallbackReport;
      emit('report', fallbackReport);
      return fallbackReport;
    }

    // Parse response
    const report = parseClaudeResponse(response, agentSummaries);

    // Save history entries for each agent in the report
    saveReportToHistory(report);

    latestReport = report;
    log.log(` ✓ Report generated successfully (${report.agentSummaries.length} agents analyzed)`);
    emit('report', report);

    return report;
  } finally {
    isGeneratingReport = false;
  }
}

/**
 * Generate a supervisor report for a single agent
 * Used when an agent finishes a task - only analyzes that specific agent
 */
async function generateSingleAgentReport(agentId: string): Promise<void> {
  const agent = agentService.getAgent(agentId);
  if (!agent) return;

  agentReportInProgress.add(agentId);

  try {
    // Build agent summary
    const agentSummary = await buildAgentSummary(agent);

    // Build a simpler prompt for single agent
    const prompt = buildSingleAgentPrompt(agentSummary);

    let response: string;
    try {
      response = await callClaudeForAnalysis(prompt);
    } catch (err) {
      log.error(` Claude API call failed for single agent ${agent.name}:`, err);
      // Create fallback analysis
      const fallbackAnalysis: AgentAnalysis = {
        agentId: agent.id,
        agentName: agent.name,
        statusDescription: `${agent.status} - ${agent.currentTask || 'Task completed'}`,
        progress: agent.status === 'working' ? 'on_track' : 'idle',
        recentWorkSummary: agentSummary.recentNarratives[0]?.narrative || 'No recent activity',
      };
      saveSingleAgentToHistory(fallbackAnalysis);
      emit('agent_analysis', { agentId, analysis: fallbackAnalysis });
      return;
    }

    // Parse response
    const analysis = parseSingleAgentResponse(response, agentSummary);

    // Save to history
    saveSingleAgentToHistory(analysis);

    // Emit the single agent update (not a full report)
    emit('agent_analysis', { agentId, analysis });

    log.log(` ✓ Single-agent report generated for ${agent.name}`);
  } finally {
    agentReportInProgress.delete(agentId);
  }
}

/**
 * Build summary data for a single agent
 */
async function buildAgentSummary(agent: Agent): Promise<AgentStatusSummary> {
  let sessionNarratives: ActivityNarrative[] = [];
  if (agent.sessionId) {
    try {
      const history = await loadSession(agent.cwd, agent.sessionId, 20);
      if (history && history.messages.length > 0) {
        sessionNarratives = history.messages.map((msg, index) => ({
          id: `session-${agent.sessionId}-${index}`,
          agentId: agent.id,
          timestamp: new Date(msg.timestamp).getTime(),
          type: msg.type === 'user' ? 'task_start' as const :
                msg.type === 'tool_use' ? 'tool_use' as const :
                msg.type === 'tool_result' ? 'output' as const : 'output' as const,
          narrative: msg.type === 'user' ? `User asked: "${truncateOrEmpty(msg.content, 150)}"` :
                    msg.type === 'assistant' ? `Responded: "${truncateOrEmpty(msg.content, 150)}"` :
                    msg.type === 'tool_use' ? `Used tool: ${msg.toolName}` :
                    `Tool result received`,
          toolName: msg.toolName,
        }));
      }
    } catch (err) {
      log.error(` Failed to load session for ${agent.name}:`, err);
    }
  }

  const inMemoryNarratives = getNarratives(agent.id).slice(0, 10);
  const allNarratives = inMemoryNarratives.length > 0
    ? inMemoryNarratives
    : sessionNarratives.slice(-10);

  return {
    id: agent.id,
    name: agent.name,
    class: agent.class,
    status: agent.status,
    currentTask: agent.currentTask,
    lastAssignedTask: agent.lastAssignedTask,
    lastAssignedTaskTime: agent.lastAssignedTaskTime,
    recentNarratives: allNarratives,
    tokensUsed: agent.tokensUsed,
    contextUsed: agent.contextUsed,
    lastActivityTime: agent.lastActivity,
  };
}

/**
 * Build a prompt for analyzing a single agent
 */
function buildSingleAgentPrompt(summary: AgentStatusSummary): string {
  const taskAssignedSecondsAgo = summary.lastAssignedTaskTime
    ? Math.round((Date.now() - summary.lastAssignedTaskTime) / 1000)
    : null;

  // Sanitize all string fields to prevent invalid Unicode surrogates
  const agentData = {
    id: summary.id,
    name: sanitizeUnicode(summary.name),
    class: summary.class,
    status: summary.status,
    currentTask: sanitizeUnicode(summary.currentTask || 'None'),
    assignedTask: summary.lastAssignedTask
      ? sanitizeUnicode(truncateOrEmpty(summary.lastAssignedTask, 500))
      : 'No task assigned yet',
    taskAssignedSecondsAgo,
    tokensUsed: summary.tokensUsed,
    contextPercent: Math.round((summary.contextUsed / 200000) * 100),
    timeSinceActivity: Math.round((Date.now() - summary.lastActivityTime) / 1000),
    recentActivities: summary.recentNarratives.map((n) => sanitizeUnicode(n.narrative)).slice(0, 5),
  };

  return SINGLE_AGENT_PROMPT.replace('{{AGENT_DATA}}', JSON.stringify(agentData, null, 2));
}

/**
 * Parse Claude's response for a single agent
 */
function parseSingleAgentResponse(response: string, summary: AgentStatusSummary): AgentAnalysis {
  try {
    const jsonStr = stripCodeFences(response);
    const parsed = JSON.parse(jsonStr);

    return {
      agentId: parsed.agentId || summary.id,
      agentName: parsed.agentName || summary.name,
      statusDescription: parsed.statusDescription || `${summary.status} - ${summary.currentTask || 'Task completed'}`,
      progress: parsed.progress || (summary.status === 'working' ? 'on_track' : 'idle'),
      recentWorkSummary: parsed.recentWorkSummary || 'No recent activity',
      currentFocus: parsed.currentFocus,
      blockers: parsed.blockers || [],
      suggestions: parsed.suggestions || [],
      filesModified: parsed.filesModified || [],
      concerns: parsed.concerns || [],
    };
  } catch (err) {
    log.error(' Failed to parse single agent response:', err);
    return {
      agentId: summary.id,
      agentName: summary.name,
      statusDescription: `${summary.status} - ${summary.currentTask || 'Task completed'}`,
      progress: summary.status === 'working' ? 'on_track' : 'idle',
      recentWorkSummary: summary.recentNarratives[0]?.narrative || 'No recent activity',
    };
  }
}

/**
 * Save a single agent's analysis to history
 */
function saveSingleAgentToHistory(analysis: AgentAnalysis): void {
  const entry: AgentSupervisorHistoryEntry = {
    id: generateId(),
    timestamp: Date.now(),
    reportId: `single-${generateId()}`,
    analysis,
  };

  addSupervisorHistoryEntry(supervisorHistory, analysis.agentId, entry);
  saveSupervisorHistory(supervisorHistory);
  log.log(` Saved single-agent history entry for ${analysis.agentName}`);
}

function buildSupervisorPrompt(summaries: AgentStatusSummary[]): string {
  const customPrompt = config.customPrompt || DEFAULT_SUPERVISOR_PROMPT;

  // Sanitize all string fields to prevent invalid Unicode surrogates
  const agentData = summaries.map((s) => {
    // Calculate time since task was assigned
    const taskAssignedSecondsAgo = s.lastAssignedTaskTime
      ? Math.round((Date.now() - s.lastAssignedTaskTime) / 1000)
      : null;

    return {
      id: s.id, // Include ID so we can match response back
      name: sanitizeUnicode(s.name),
      class: s.class,
      status: s.status,
      currentTask: sanitizeUnicode(s.currentTask || 'None'),
      // Include the full assigned task so supervisor knows what the agent was asked to do
      assignedTask: s.lastAssignedTask
        ? sanitizeUnicode(truncateOrEmpty(s.lastAssignedTask, 500))
        : 'No task assigned yet',
      taskAssignedSecondsAgo,
      tokensUsed: s.tokensUsed,
      contextPercent: Math.round((s.contextUsed / 200000) * 100),
      timeSinceActivity: Math.round((Date.now() - s.lastActivityTime) / 1000),
      recentActivities: s.recentNarratives.map((n) => sanitizeUnicode(n.narrative)).slice(0, 5),
    };
  });

  return customPrompt.replace('{{AGENT_DATA}}', JSON.stringify(agentData, null, 2));
}

function parseClaudeResponse(
  response: string,
  summaries: AgentStatusSummary[]
): SupervisorReport {
  try {
    const jsonStr = stripCodeFences(response);
    const parsed = JSON.parse(jsonStr);

    // Map agentAnalyses to agentSummaries (the field name in our type)
    const agentAnalyses: AgentAnalysis[] = (parsed.agentAnalyses || []).map(
      (a: AgentAnalysis & { agentId?: string; agentName?: string }) => ({
        agentId: a.agentId || '',
        agentName: a.agentName || '',
        statusDescription: a.statusDescription || 'Unknown status',
        progress: a.progress || 'idle',
        recentWorkSummary: a.recentWorkSummary || 'No recent activity',
        concerns: a.concerns || [],
      })
    );

    // Match agent IDs from summaries by name (more reliable than index)
    agentAnalyses.forEach((analysis) => {
      if (!analysis.agentId) {
        // Find matching summary by name
        const matchingSummary = summaries.find(s => s.name === analysis.agentName);
        if (matchingSummary) {
          analysis.agentId = matchingSummary.id;
        }
      }
    });

    return {
      id: generateId(),
      timestamp: Date.now(),
      agentSummaries: agentAnalyses,
      overallStatus: parsed.overallStatus || 'healthy',
      insights: parsed.insights || [],
      recommendations: parsed.recommendations || [],
      rawResponse: response,
    };
  } catch (err) {
    log.error(' Failed to parse Claude response:', err);
    log.error(' Raw response:', response);

    // Return fallback report
    return createFallbackReport(summaries);
  }
}

function createFallbackReport(summaries: AgentStatusSummary[]): SupervisorReport {
  return {
    id: generateId(),
    timestamp: Date.now(),
    agentSummaries: summaries.map((s) => ({
      agentId: s.id,
      agentName: s.name,
      statusDescription: `${s.status} - ${s.currentTask || 'No current task'}`,
      progress: s.status === 'working' ? 'on_track' : 'idle',
      recentWorkSummary: s.recentNarratives[0]?.narrative || 'No recent activity',
    })),
    overallStatus: 'healthy',
    insights: ['Unable to generate detailed analysis - using basic status'],
    recommendations: [],
  };
}

// ============================================================================
// History Management
// ============================================================================

/**
 * Save a report's agent analyses to history
 */
function saveReportToHistory(report: SupervisorReport): void {
  for (const analysis of report.agentSummaries) {
    const entry: AgentSupervisorHistoryEntry = {
      id: generateId(),
      timestamp: report.timestamp,
      reportId: report.id,
      analysis,
    };

    addSupervisorHistoryEntry(supervisorHistory, analysis.agentId, entry);
  }

  // Persist to disk
  saveSupervisorHistory(supervisorHistory);
  log.log(` Saved history entries for ${report.agentSummaries.length} agents`);
}

/**
 * Get supervisor history for a specific agent
 */
export function getAgentSupervisorHistory(agentId: string): AgentSupervisorHistory {
  return getAgentHistoryFromStorage(supervisorHistory, agentId);
}

/**
 * Delete supervisor history for an agent (call when agent is deleted)
 */
export function deleteAgentHistory(agentId: string): void {
  deleteSupervisorHistory(supervisorHistory, agentId);
  saveSupervisorHistory(supervisorHistory);
  log.log(` Deleted history for agent ${agentId}`);
}

// ============================================================================
// Configuration
// ============================================================================

export function getConfig(): SupervisorConfig {
  return { ...config };
}

export function setConfig(updates: Partial<SupervisorConfig>): void {
  config = { ...config, ...updates };

  // If disabling, cancel any pending report
  if (!config.enabled && reportDebounceTimer) {
    clearTimeout(reportDebounceTimer);
    reportDebounceTimer = null;
  }

  emit('config_changed', config);
}

export function getLatestReport(): SupervisorReport | null {
  return latestReport;
}

export function getStatus(): {
  enabled: boolean;
  autoReportOnComplete: boolean;
  lastReportTime: number | null;
  nextReportTime: number | null;
} {
  return {
    enabled: config.enabled,
    autoReportOnComplete: config.autoReportOnComplete === true,
    lastReportTime: latestReport?.timestamp || null,
    // Reports are now event-driven (on task start/complete), not scheduled
    nextReportTime: null,
  };
}

// ============================================================================
// Global Usage Tracking
// ============================================================================

import type { GlobalUsageStats } from '../../shared/types.js';

// Global usage stats (shared across all sessions since they use same API key)
let globalUsage: GlobalUsageStats | null = null;

/**
 * Update global usage stats from a /usage command response
 */
export function updateGlobalUsage(
  agentId: string,
  agentName: string,
  usageData: {
    session: { percentUsed: number; resetTime: string };
    weeklyAllModels: { percentUsed: number; resetTime: string };
    weeklySonnet: { percentUsed: number; resetTime: string };
  }
): void {
  globalUsage = {
    session: usageData.session,
    weeklyAllModels: usageData.weeklyAllModels,
    weeklySonnet: usageData.weeklySonnet,
    sourceAgentId: agentId,
    sourceAgentName: agentName,
    lastUpdated: Date.now(),
  };

  log.log(`✓ Updated global usage stats from ${agentName}:`);
  log.log(`  Session: ${usageData.session.percentUsed}% (resets ${usageData.session.resetTime})`);
  log.log(`  Weekly All: ${usageData.weeklyAllModels.percentUsed}% (resets ${usageData.weeklyAllModels.resetTime})`);
  log.log(`  Weekly Sonnet: ${usageData.weeklySonnet.percentUsed}% (resets ${usageData.weeklySonnet.resetTime})`);

  // Emit event for real-time updates
  emit('global_usage', globalUsage);
}

/**
 * Get current global usage stats
 */
export function getGlobalUsage(): GlobalUsageStats | null {
  return globalUsage;
}

/**
 * Request a usage refresh from any idle agent
 * Returns the agent ID that will provide the data, or null if no agent is available
 */
export async function requestUsageRefresh(): Promise<string | null> {
  console.log('[Supervisor] requestUsageRefresh called');
  const agents = agentService.getAllAgents();
  console.log('[Supervisor] All agents:', agents.map(a => ({ name: a.name, status: a.status, sessionId: a.sessionId })));

  // Find an idle agent with a session
  const idleAgent = agents.find(a => a.status === 'idle' && a.sessionId);
  console.log('[Supervisor] Idle agent found:', idleAgent ? idleAgent.name : 'none');

  if (!idleAgent) {
    log.log('No idle agent available for usage refresh');
    return null;
  }

  log.log(`Requesting usage refresh from ${idleAgent.name}`);

  // Import dynamically to avoid circular dependency
  const { sendSilentCommand } = await import('./claude-service.js');

  try {
    console.log('[Supervisor] Sending /usage command to', idleAgent.name);
    await sendSilentCommand(idleAgent.id, '/usage');
    console.log('[Supervisor] /usage command sent successfully');
    return idleAgent.id;
  } catch (err) {
    console.error('[Supervisor] Failed to send /usage command:', err);
    log.error(`Failed to request usage from ${idleAgent.name}:`, err);
    return null;
  }
}
