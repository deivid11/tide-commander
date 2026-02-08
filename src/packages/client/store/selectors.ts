/**
 * Store Selectors
 *
 * React hooks for accessing store state with optimized re-renders.
 */

import { useCallback, useRef, useState, useEffect } from 'react';
import type {
  Agent,
  DrawingArea,
  DrawingTool,
  Building,
  PermissionRequest,
  DelegationDecision,
  Skill,
  CustomAgentClass,
  AgentSupervisorHistoryEntry,
  GlobalUsageStats,
  ExecTask,
  Secret,
  QueryResult,
  QueryHistoryEntry,
  Subagent,
} from '../../shared/types';
import type {
  StoreState,
  AgentOutput,
  LastPrompt,
  Activity,
  Settings,
  SupervisorState,
  ToolExecution,
  FileChange,
  AgentTaskProgress,
  DatabaseBuildingState,
} from './types';
import type { ShortcutConfig } from './shortcuts';
import type { MouseControlsState, CameraSensitivityConfig } from './mouseControls';
import { store } from './index';
import { debugLog } from '../services/agentDebugger';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Shallow comparison for arrays - returns true if arrays have same elements
 */
function shallowArrayEqual<T>(a: T[], b: T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Shallow comparison for Maps - returns true if maps have same keys and values
 */
function shallowMapEqual<K, V>(a: Map<K, V>, b: Map<K, V>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

/**
 * Shallow comparison for Sets
 */
function shallowSetEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/**
 * Generic selector hook with shallow comparison
 */
function useSelector<T>(
  selector: (state: StoreState) => T,
  equalityFn: (a: T, b: T) => boolean = Object.is
): T {
  const [value, setValue] = useState(() => selector(store.getState()));
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    const checkForUpdates = () => {
      const newValue = selector(store.getState());
      if (!equalityFn(valueRef.current, newValue)) {
        valueRef.current = newValue;
        setValue(newValue);
      }
    };

    checkForUpdates();
    return store.subscribe(checkForUpdates);
  }, [selector, equalityFn]);

  return value;
}

// ============================================================================
// LEGACY HOOK
// ============================================================================

/**
 * @deprecated Use granular selectors (useAgents, useSelectedAgentIds, etc.) instead.
 * This hook causes re-renders on ANY store change.
 */
export function useStore(): StoreState {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    return store.subscribe(() => forceUpdate({}));
  }, []);

  return store.getState();
}

// ============================================================================
// AGENT SELECTORS
// ============================================================================

/**
 * Get all agents as a Map. Only re-renders when agents Map changes.
 */
export function useAgents(): Map<string, Agent> {
  return useSelector(
    useCallback((state: StoreState) => state.agents, []),
    shallowMapEqual
  );
}

/**
 * Get all agents as an array. Only re-renders when agents change.
 */
export function useAgentsArray(): Agent[] {
  const agents = useAgents();
  const arrayRef = useRef<Agent[]>([]);

  const newArray = Array.from(agents.values());
  if (!shallowArrayEqual(arrayRef.current, newArray)) {
    arrayRef.current = newArray;
  }
  return arrayRef.current;
}

/**
 * Get a single agent by ID. Only re-renders when that specific agent changes.
 */
export function useAgent(agentId: string | null): Agent | undefined {
  return useSelector(
    useCallback(
      (state: StoreState) => (agentId ? state.agents.get(agentId) : undefined),
      [agentId]
    )
  );
}

/**
 * Get selected agent IDs. Only re-renders when selection changes.
 */
export function useSelectedAgentIds(): Set<string> {
  return useSelector(
    useCallback((state: StoreState) => state.selectedAgentIds, []),
    shallowSetEqual
  );
}

/**
 * Get selected agents as array. Only re-renders when selection or agents change.
 */
export function useSelectedAgents(): Agent[] {
  const agents = useAgents();
  const selectedIds = useSelectedAgentIds();
  const arrayRef = useRef<Agent[]>([]);

  const newArray: Agent[] = [];
  for (const id of selectedIds) {
    const agent = agents.get(id);
    if (agent) newArray.push(agent);
  }

  if (!shallowArrayEqual(arrayRef.current, newArray)) {
    arrayRef.current = newArray;
  }
  return arrayRef.current;
}

/**
 * Get boss agents only. Only re-renders when boss agents change.
 */
export function useBossAgents(): Agent[] {
  const agents = useAgents();
  const arrayRef = useRef<Agent[]>([]);

  const newArray = Array.from(agents.values()).filter(
    (a) => a.isBoss === true || a.class === 'boss'
  );
  if (!shallowArrayEqual(arrayRef.current, newArray)) {
    arrayRef.current = newArray;
  }
  return arrayRef.current;
}

/**
 * Get non-boss agents (subordinates). Only re-renders when they change.
 */
export function useSubordinateAgents(): Agent[] {
  const agents = useAgents();
  const arrayRef = useRef<Agent[]>([]);

  const newArray = Array.from(agents.values()).filter((a) => a.class !== 'boss');
  if (!shallowArrayEqual(arrayRef.current, newArray)) {
    arrayRef.current = newArray;
  }
  return arrayRef.current;
}

// ============================================================================
// OUTPUT SELECTORS
// ============================================================================

/**
 * Get outputs for a specific agent. Only re-renders when that agent's outputs change.
 */
export function useAgentOutputs(agentId: string | null): AgentOutput[] {
  const emptyArray = useRef<AgentOutput[]>([]);
  const prevLengthRef = useRef(0);

  const outputs = useSelector(
    useCallback(
      (state: StoreState) => {
        if (!agentId) return emptyArray.current;
        return state.agentOutputs.get(agentId) || emptyArray.current;
      },
      [agentId]
    ),
    shallowArrayEqual
  );

  // Log when outputs change
  if (outputs.length !== prevLengthRef.current) {
    debugLog.info(`Selector: ${prevLengthRef.current} -> ${outputs.length}`, {
      agentId,
      lastText: outputs.length > 0 ? outputs[outputs.length - 1].text.slice(0, 40) : null,
    }, 'useAgentOutputs');
    prevLengthRef.current = outputs.length;
  }

  return outputs;
}

/**
 * Get last prompt for a specific agent.
 */
export function useLastPrompt(agentId: string | null): LastPrompt | undefined {
  return useSelector(
    useCallback(
      (state: StoreState) => (agentId ? state.lastPrompts.get(agentId) : undefined),
      [agentId]
    )
  );
}

/**
 * Get all last prompts. Only re-renders when lastPrompts change.
 */
export function useLastPrompts(): Map<string, LastPrompt> {
  return useSelector(
    useCallback((state: StoreState) => state.lastPrompts, []),
    shallowMapEqual
  );
}

// ============================================================================
// ACTIVITY SELECTORS
// ============================================================================

/**
 * Get activities. Only re-renders when activities change.
 */
export function useActivities(): Activity[] {
  return useSelector(
    useCallback((state: StoreState) => state.activities, []),
    shallowArrayEqual
  );
}

// ============================================================================
// CONNECTION SELECTORS
// ============================================================================

/**
 * Get connection status. Only re-renders when connection status changes.
 */
export function useIsConnected(): boolean {
  return useSelector(useCallback((state: StoreState) => state.isConnected, []));
}

// ============================================================================
// AREA SELECTORS
// ============================================================================

/**
 * Get all areas. Only re-renders when areas change.
 */
export function useAreas(): Map<string, DrawingArea> {
  return useSelector(
    useCallback((state: StoreState) => state.areas, []),
    shallowMapEqual
  );
}

/**
 * Get active drawing tool. Only re-renders when tool changes.
 */
export function useActiveTool(): DrawingTool {
  return useSelector(useCallback((state: StoreState) => state.activeTool, []));
}

/**
 * Get selected area ID. Only re-renders when selection changes.
 */
export function useSelectedAreaId(): string | null {
  return useSelector(useCallback((state: StoreState) => state.selectedAreaId, []));
}

// ============================================================================
// BUILDING SELECTORS
// ============================================================================

/**
 * Get all buildings. Only re-renders when buildings change.
 */
export function useBuildings(): Map<string, Building> {
  return useSelector(
    useCallback((state: StoreState) => state.buildings, []),
    shallowMapEqual
  );
}

/**
 * Get selected building IDs. Only re-renders when selection changes.
 */
export function useSelectedBuildingIds(): Set<string> {
  return useSelector(
    useCallback((state: StoreState) => state.selectedBuildingIds, []),
    shallowSetEqual
  );
}

/**
 * Get building logs. Only re-renders when logs change.
 */
export function useBuildingLogs(): Map<string, string[]> {
  return useSelector(
    useCallback((state: StoreState) => state.buildingLogs, []),
    shallowMapEqual
  );
}

// ============================================================================
// SUPERVISOR SELECTORS
// ============================================================================

/**
 * Get supervisor state. Only re-renders when supervisor state changes.
 */
export function useSupervisor(): SupervisorState {
  return useSelector(useCallback((state: StoreState) => state.supervisor, []));
}

/**
 * Get supervisor enabled status. Only re-renders when enabled changes.
 */
export function useSupervisorEnabled(): boolean {
  return useSelector(useCallback((state: StoreState) => state.supervisor.enabled, []));
}

/**
 * Get supervisor history for a specific agent.
 */
export function useAgentSupervisorHistory(agentId: string | null): AgentSupervisorHistoryEntry[] {
  const emptyArray = useRef<AgentSupervisorHistoryEntry[]>([]);

  return useSelector(
    useCallback(
      (state: StoreState) => {
        if (!agentId) return emptyArray.current;
        return state.supervisor.agentHistories.get(agentId) || emptyArray.current;
      },
      [agentId]
    ),
    shallowArrayEqual
  );
}

// ============================================================================
// PERMISSION SELECTORS
// ============================================================================

/**
 * Get permission requests. Only re-renders when requests change.
 */
export function usePermissionRequests(): Map<string, PermissionRequest> {
  return useSelector(
    useCallback((state: StoreState) => state.permissionRequests, []),
    shallowMapEqual
  );
}

// ============================================================================
// DELEGATION SELECTORS
// ============================================================================

/**
 * Get delegation history for a specific boss.
 */
export function useDelegationHistory(bossId: string | null): DelegationDecision[] {
  const emptyArray = useRef<DelegationDecision[]>([]);

  return useSelector(
    useCallback(
      (state: StoreState) => {
        if (!bossId) return emptyArray.current;
        return state.delegationHistories.get(bossId) || emptyArray.current;
      },
      [bossId]
    ),
    shallowArrayEqual
  );
}

/**
 * Get pending delegation. Only re-renders when pending delegation changes.
 */
export function usePendingDelegation(): { bossId: string; command: string } | null {
  return useSelector(useCallback((state: StoreState) => state.pendingDelegation, []));
}

/**
 * Get last delegation received for an agent.
 */
export function useLastDelegationReceived(
  agentId: string | null
): { bossName: string; taskCommand: string; timestamp: number } | undefined {
  return useSelector(
    useCallback(
      (state: StoreState) =>
        agentId ? state.lastDelegationReceived.get(agentId) : undefined,
      [agentId]
    )
  );
}

// ============================================================================
// SETTINGS SELECTORS
// ============================================================================

/**
 * Get settings. Only re-renders when settings change.
 */
export function useSettings(): Settings {
  return useSelector(useCallback((state: StoreState) => state.settings, []));
}

/**
 * Get hideCost setting. Only re-renders when hideCost changes.
 */
export function useHideCost(): boolean {
  return useSelector(useCallback((state: StoreState) => state.settings.hideCost, []));
}

/**
 * Get custom agent names. Only re-renders when custom names change.
 */
export function useCustomAgentNames(): string[] {
  return useSelector(
    useCallback((state: StoreState) => state.settings.customAgentNames, []),
    shallowArrayEqual
  );
}

/**
 * Get shortcuts. Only re-renders when shortcuts change.
 */
export function useShortcuts(): ShortcutConfig[] {
  return useSelector(
    useCallback((state: StoreState) => state.shortcuts, []),
    shallowArrayEqual
  );
}

/**
 * Get mouse controls state. Only re-renders when mouse controls change.
 */
export function useMouseControls(): MouseControlsState {
  return useSelector(useCallback((state: StoreState) => state.mouseControls, []));
}

/**
 * Get camera sensitivity settings. Only re-renders when sensitivity changes.
 */
export function useCameraSensitivity(): CameraSensitivityConfig {
  return useSelector(useCallback((state: StoreState) => state.mouseControls.sensitivity, []));
}

/**
 * Get trackpad config. Only re-renders when trackpad config changes.
 */
export function useTrackpadConfig() {
  return useSelector(useCallback((state: StoreState) => state.mouseControls.trackpad, []));
}

/**
 * Get terminal open state. Only re-renders when terminal state changes.
 */
export function useTerminalOpen(): boolean {
  return useSelector(useCallback((state: StoreState) => state.terminalOpen, []));
}

/**
 * Get terminal resizing state. Only re-renders when resizing state changes.
 */
export function useTerminalResizing(): boolean {
  return useSelector(useCallback((state: StoreState) => state.terminalResizing, []));
}

/**
 * Get mobile view mode. Only re-renders when mobile view changes.
 */
export function useMobileView(): 'terminal' | '3d' {
  return useSelector(useCallback((state: StoreState) => state.mobileView, []));
}

/**
 * Get file viewer path. Only re-renders when path changes.
 */
export function useFileViewerPath(): string | null {
  return useSelector(useCallback((state: StoreState) => state.fileViewerPath, []));
}

/**
 * Get file viewer edit data (for diff view or line highlight). Only re-renders when it changes.
 */
export function useFileViewerEditData(): {
  oldString?: string;
  newString?: string;
  operation?: string;
  highlightRange?: { offset: number; limit: number };
  targetLine?: number;
} | null {
  return useSelector(useCallback((state: StoreState) => state.fileViewerEditData, []));
}

/**
 * Get file explorer folder path. Only re-renders when it changes.
 */
export function useExplorerFolderPath(): string | null {
  return useSelector(useCallback((state: StoreState) => state.explorerFolderPath, []));
}

/**
 * Get context modal agent ID. Only re-renders when it changes.
 */
export function useContextModalAgentId(): string | null {
  return useSelector(useCallback((state: StoreState) => state.contextModalAgentId, []));
}

// ============================================================================
// TOOL HISTORY SELECTORS
// ============================================================================

/**
 * Get tool executions. Only re-renders when executions change.
 */
export function useToolExecutions(): ToolExecution[] {
  return useSelector(
    useCallback((state: StoreState) => state.toolExecutions, []),
    shallowArrayEqual
  );
}

/**
 * Get file changes. Only re-renders when file changes update.
 */
export function useFileChanges(): FileChange[] {
  return useSelector(
    useCallback((state: StoreState) => state.fileChanges, []),
    shallowArrayEqual
  );
}

// ============================================================================
// SKILL SELECTORS
// ============================================================================

/**
 * Get all skills. Only re-renders when skills change.
 */
export function useSkills(): Map<string, Skill> {
  return useSelector(
    useCallback((state: StoreState) => state.skills, []),
    shallowMapEqual
  );
}

/**
 * Get all skills as an array. Only re-renders when skills change.
 */
export function useSkillsArray(): Skill[] {
  const skills = useSkills();
  const arrayRef = useRef<Skill[]>([]);

  const newArray = Array.from(skills.values());
  if (!shallowArrayEqual(arrayRef.current, newArray)) {
    arrayRef.current = newArray;
  }
  return arrayRef.current;
}

/**
 * Get a single skill by ID. Only re-renders when that specific skill changes.
 */
export function useSkill(skillId: string | null): Skill | undefined {
  return useSelector(
    useCallback(
      (state: StoreState) => (skillId ? state.skills.get(skillId) : undefined),
      [skillId]
    )
  );
}

/**
 * Get skills assigned to a specific agent.
 */
export function useAgentSkills(agentId: string | null): Skill[] {
  const emptyArray = useRef<Skill[]>([]);
  const agents = useAgents();
  const skills = useSkills();

  if (!agentId) return emptyArray.current;

  const agent = agents.get(agentId);
  if (!agent) return emptyArray.current;

  const matchingSkills = Array.from(skills.values()).filter((skill) => {
    if (!skill.enabled) return false;
    if (skill.assignedAgentIds.includes(agentId)) return true;
    if (skill.assignedAgentClasses.includes(agent.class)) return true;
    return false;
  });

  return matchingSkills;
}

// ============================================================================
// CUSTOM AGENT CLASS SELECTORS
// ============================================================================

/**
 * Get all custom agent classes. Only re-renders when custom classes change.
 */
export function useCustomAgentClasses(): Map<string, CustomAgentClass> {
  return useSelector(
    useCallback((state: StoreState) => state.customAgentClasses, []),
    shallowMapEqual
  );
}

/**
 * Get all custom agent classes as an array. Only re-renders when custom classes change.
 */
export function useCustomAgentClassesArray(): CustomAgentClass[] {
  const classes = useCustomAgentClasses();
  const arrayRef = useRef<CustomAgentClass[]>([]);

  const newArray = Array.from(classes.values());
  if (!shallowArrayEqual(arrayRef.current, newArray)) {
    arrayRef.current = newArray;
  }
  return arrayRef.current;
}

/**
 * Get a single custom agent class by ID. Only re-renders when that specific class changes.
 */
export function useCustomAgentClass(classId: string | null): CustomAgentClass | undefined {
  return useSelector(
    useCallback(
      (state: StoreState) =>
        classId ? state.customAgentClasses.get(classId) : undefined,
      [classId]
    )
  );
}

/**
 * Get reconnect count. Increments each time WebSocket reconnects after disconnect.
 * Components can use this to refresh their data on reconnection.
 */
export function useReconnectCount(): number {
  return useSelector(
    useCallback((state: StoreState) => state.reconnectCount, [])
  );
}

// ============================================================================
// GLOBAL USAGE SELECTORS
// ============================================================================

/**
 * Get global Claude API usage stats. Only re-renders when usage changes.
 */
export function useGlobalUsage(): GlobalUsageStats | null {
  return useSelector(useCallback((state: StoreState) => state.supervisor.globalUsage, []));
}

/**
 * Get whether usage is currently being refreshed.
 */
export function useRefreshingUsage(): boolean {
  return useSelector(useCallback((state: StoreState) => state.supervisor.refreshingUsage, []));
}

// ============================================================================
// AGENT TASK PROGRESS SELECTORS
// ============================================================================

/**
 * Get agent task progress for a specific boss. Only re-renders when that boss's progress changes.
 */
export function useAgentTaskProgress(bossId: string | null): Map<string, AgentTaskProgress> {
  const emptyMap = useRef<Map<string, AgentTaskProgress>>(new Map());

  return useSelector(
    useCallback(
      (state: StoreState) => {
        if (!bossId) return emptyMap.current;
        return state.agentTaskProgress.get(bossId) || emptyMap.current;
      },
      [bossId]
    ),
    shallowMapEqual
  );
}

// ============================================================================
// EXEC TASK SELECTORS
// ============================================================================

/**
 * Get exec tasks for a specific agent. Only re-renders when that agent's tasks change.
 */
export function useExecTasks(agentId: string | null): ExecTask[] {
  return useSelector(
    useCallback(
      (state: StoreState) => {
        if (!agentId || !state.execTasks) return [];
        return Array.from(state.execTasks.values()).filter((t) => t.agentId === agentId);
      },
      [agentId]
    ),
    shallowArrayEqual
  );
}

/**
 * Get all exec tasks. Only re-renders when tasks change.
 */
export function useAllExecTasks(): ExecTask[] {
  return useSelector(
    useCallback((state: StoreState) => {
      if (!state.execTasks) return [];
      return Array.from(state.execTasks.values());
    }, []),
    shallowArrayEqual
  );
}

// ============================================================================
// SECRET SELECTORS
// ============================================================================

/**
 * Get all secrets. Only re-renders when secrets change.
 */
export function useSecrets(): Map<string, Secret> {
  return useSelector(
    useCallback((state: StoreState) => state.secrets, []),
    shallowMapEqual
  );
}

/**
 * Get all secrets as an array. Only re-renders when secrets change.
 */
export function useSecretsArray(): Secret[] {
  const secrets = useSecrets();
  const arrayRef = useRef<Secret[]>([]);

  const newArray = Array.from(secrets.values());
  if (!shallowArrayEqual(arrayRef.current, newArray)) {
    arrayRef.current = newArray;
  }
  return arrayRef.current;
}

/**
 * Get a single secret by ID. Only re-renders when that specific secret changes.
 */
export function useSecret(secretId: string | null): Secret | undefined {
  return useSelector(
    useCallback(
      (state: StoreState) => (secretId ? state.secrets.get(secretId) : undefined),
      [secretId]
    )
  );
}

// ============================================================================
// DATABASE SELECTORS
// ============================================================================

const emptyDatabaseState: DatabaseBuildingState = {
  connectionStatus: new Map(),
  databases: new Map(),
  tables: new Map(),
  tableSchemas: new Map(),
  queryResults: [],
  queryHistory: [],
  executingQuery: false,
  activeConnectionId: null,
  activeDatabase: null,
};

/**
 * Get database state for a building. Only re-renders when that building's database state changes.
 */
export function useDatabaseState(buildingId: string | null): DatabaseBuildingState {
  return useSelector(
    useCallback(
      (state: StoreState) => (buildingId ? state.databaseState.get(buildingId) : undefined) ?? emptyDatabaseState,
      [buildingId]
    )
  );
}

/**
 * Get query results for a database building. Only re-renders when results change.
 */
export function useQueryResults(buildingId: string | null): QueryResult[] {
  return useSelector(
    useCallback(
      (state: StoreState) => {
        if (!buildingId) return [];
        const dbState = state.databaseState.get(buildingId);
        return dbState?.queryResults ?? [];
      },
      [buildingId]
    ),
    shallowArrayEqual
  );
}

/**
 * Get query history for a database building. Only re-renders when history changes.
 */
export function useQueryHistory(buildingId: string | null): QueryHistoryEntry[] {
  return useSelector(
    useCallback(
      (state: StoreState) => {
        if (!buildingId) return [];
        const dbState = state.databaseState.get(buildingId);
        return dbState?.queryHistory ?? [];
      },
      [buildingId]
    ),
    shallowArrayEqual
  );
}

/**
 * Check if a query is executing for a database building.
 */
export function useExecutingQuery(buildingId: string | null): boolean {
  return useSelector(
    useCallback(
      (state: StoreState) => {
        if (!buildingId) return false;
        const dbState = state.databaseState.get(buildingId);
        return dbState?.executingQuery ?? false;
      },
      [buildingId]
    )
  );
}

// ============================================================================
// DOCKER CONTAINERS SELECTORS
// ============================================================================

/**
 * Get list of existing Docker containers (for "existing" mode selection).
 */
export function useDockerContainersList(): import('../../shared/types').ExistingDockerContainer[] {
  return useSelector(
    (state: StoreState) => state.dockerContainersList,
    shallowArrayEqual
  );
}

/**
 * Get list of existing Docker compose projects (for "existing" mode selection).
 */
export function useDockerComposeProjectsList(): import('../../shared/types').ExistingComposeProject[] {
  return useSelector(
    (state: StoreState) => state.dockerComposeProjectsList,
    shallowArrayEqual
  );
}

// ============================================================================
// SNAPSHOT SELECTORS
// ============================================================================

/**
 * Get all snapshots
 */
export function useSnapshots(): import('../../shared/types/snapshot').SnapshotListItem[] {
  return useSelector((state: StoreState) => {
    const snapshots = state.snapshots;
    return Array.from(snapshots.values());
  }, shallowArrayEqual);
}

/**
 * Get current snapshot being viewed
 */
export function useCurrentSnapshot(): import('../../shared/types/snapshot').ConversationSnapshot | null {
  return useSelector((state: StoreState) => state.currentSnapshot);
}

/**
 * Get snapshot loading state
 */
export function useSnapshotsLoading(): boolean {
  return useSelector((state: StoreState) => state.snapshotsLoading);
}

/**
 * Get snapshot error state
 */
export function useSnapshotsError(): string | null {
  return useSelector((state: StoreState) => state.snapshotsError);
}

// ============================================================================
// SUBAGENT SELECTORS
// ============================================================================

/**
 * Get all subagents map
 */
export function useSubagents(): Map<string, Subagent> {
  return useSelector((state: StoreState) => state.subagents, shallowMapEqual);
}

/**
 * Get subagents for a specific parent agent
 */
export function useSubagentsForAgent(parentAgentId: string | null): Subagent[] {
  return useSelector(
    useCallback(
      (state: StoreState) => {
        if (!parentAgentId) return [];
        return Array.from(state.subagents.values()).filter(
          (s) => s.parentAgentId === parentAgentId
        );
      },
      [parentAgentId]
    ),
    shallowArrayEqual
  );
}

// ============================================================================
// VIEW MODE SELECTORS
// ============================================================================

/**
 * Get current view mode
 */
export function useViewMode(): StoreState['viewMode'] {
  return useSelector((state: StoreState) => state.viewMode);
}

export function useOverviewPanelOpen(): boolean {
  return useSelector(useCallback((state: StoreState) => state.overviewPanelOpen, []));
}
