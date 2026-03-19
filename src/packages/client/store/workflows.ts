/**
 * Workflows Store Actions
 *
 * Handles workflow definition management, instance tracking,
 * detail view navigation, and chat state.
 */

import type { ClientMessage } from '../../shared/types';
import type {
  WorkflowDefinition,
  WorkflowModelStatus,
  WorkflowInstanceStatus,
  WorkflowHistoryEntry,
  ChatMessage,
  WorkflowChatScope,
  CreateWorkflowPayload,
  UpdateWorkflowPayload,
} from '../../shared/workflow-types';
import type { StoreState } from './types';

// ─── Workflow Instance (client-side representation) ───

export interface WorkflowInstanceRow {
  id: string;
  workflowDefId: string;
  workflowName: string;
  status: WorkflowInstanceStatus;
  currentStateId: string;
  variables: Record<string, unknown>;
  history: WorkflowHistoryEntry[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
}

// ─── Detail View Navigation ───

export type WorkflowDetailLevel =
  | { level: 'overview' }
  | { level: 'execution'; instanceId: string }
  | { level: 'step'; instanceId: string; stepId: string };

// ─── Workflow Store State (added to StoreState) ───

export interface WorkflowStoreState {
  workflowDefinitions: Map<string, WorkflowDefinition>;
  workflowInstances: Map<string, WorkflowInstanceRow>;
  selectedWorkflowId: string | null;
  workflowDetailOpen: boolean;
  workflowDetailLevel: WorkflowDetailLevel;
  workflowChatMessages: ChatMessage[];
  workflowChatScope: WorkflowChatScope;
  workflowChatLoading: boolean;
}

export const DEFAULT_WORKFLOW_STATE: WorkflowStoreState = {
  workflowDefinitions: new Map(),
  workflowInstances: new Map(),
  selectedWorkflowId: null,
  workflowDetailOpen: false,
  workflowDetailLevel: { level: 'overview' },
  workflowChatMessages: [],
  workflowChatScope: { level: 'workflow' },
  workflowChatLoading: false,
};

// ─── Actions Interface ───

export interface WorkflowActions {
  // Definition CRUD
  setWorkflowDefinitionsFromServer(defs: WorkflowDefinition[]): void;
  addWorkflowDefinitionFromServer(def: WorkflowDefinition): void;
  updateWorkflowDefinitionFromServer(def: WorkflowDefinition): void;
  removeWorkflowDefinitionFromServer(id: string): void;
  createWorkflowDefinition(data: Omit<WorkflowDefinition, 'id' | 'version' | 'createdAt' | 'updatedAt'>): void;
  updateWorkflowDefinition(id: string, updates: Partial<WorkflowDefinition>): void;
  deleteWorkflowDefinition(id: string): void;
  moveWorkflow(id: string, position: { x: number; z: number }): void;

  // Instance management
  setWorkflowInstancesFromServer(instances: WorkflowInstanceRow[]): void;
  updateWorkflowInstanceFromServer(instance: WorkflowInstanceRow): void;
  removeWorkflowInstanceFromServer(id: string): void;
  startWorkflow(workflowDefId: string, initialVariables?: Record<string, unknown>): void;
  pauseWorkflow(instanceId: string): void;
  resumeWorkflow(instanceId: string): void;
  cancelWorkflow(instanceId: string): void;
  manualTransition(instanceId: string, transitionId: string): void;

  // Selection and navigation
  selectWorkflow(workflowId: string | null): void;
  openWorkflowDetail(workflowId: string): void;
  closeWorkflowDetail(): void;
  navigateToExecution(instanceId: string): void;
  navigateToStep(instanceId: string, stepId: string): void;
  navigateBack(): void;

  // Status computation
  getWorkflowModelStatus(workflowId: string): WorkflowModelStatus;

  // Chat
  addWorkflowChatMessage(message: ChatMessage): void;
  setWorkflowChatScope(scope: WorkflowChatScope): void;
  setWorkflowChatLoading(loading: boolean): void;
  clearWorkflowChat(): void;

  // Accessors
  getWorkflowDefinition(id: string): WorkflowDefinition | undefined;
  getWorkflowInstances(workflowDefId: string): WorkflowInstanceRow[];
  getAllWorkflowDefinitions(): WorkflowDefinition[];
}

// ─── Factory ───

export function createWorkflowActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
  getSendMessage: () => ((msg: ClientMessage) => void) | null
): WorkflowActions {

  const getWfState = (): WorkflowStoreState => {
    const state = getState() as StoreState & WorkflowStoreState;
    return {
      workflowDefinitions: state.workflowDefinitions ?? new Map(),
      workflowInstances: state.workflowInstances ?? new Map(),
      selectedWorkflowId: state.selectedWorkflowId ?? null,
      workflowDetailOpen: state.workflowDetailOpen ?? false,
      workflowDetailLevel: state.workflowDetailLevel ?? { level: 'overview' },
      workflowChatMessages: state.workflowChatMessages ?? [],
      workflowChatScope: state.workflowChatScope ?? { level: 'workflow' },
      workflowChatLoading: state.workflowChatLoading ?? false,
    };
  };

  const actions: WorkflowActions = {

    // ═══════════════════════════════════════
    // Definition CRUD
    // ═══════════════════════════════════════

    setWorkflowDefinitionsFromServer(defs: WorkflowDefinition[]): void {
      setState((state) => {
        const map = new Map<string, WorkflowDefinition>();
        for (const def of defs) map.set(def.id, def);
        (state as StoreState & WorkflowStoreState).workflowDefinitions = map;
      });
      notify();
    },

    addWorkflowDefinitionFromServer(def: WorkflowDefinition): void {
      setState((state) => {
        const s = state as StoreState & WorkflowStoreState;
        const map = new Map(s.workflowDefinitions ?? new Map());
        map.set(def.id, def);
        s.workflowDefinitions = map;
      });
      notify();
    },

    updateWorkflowDefinitionFromServer(def: WorkflowDefinition): void {
      setState((state) => {
        const s = state as StoreState & WorkflowStoreState;
        const map = new Map(s.workflowDefinitions ?? new Map());
        map.set(def.id, def);
        s.workflowDefinitions = map;
      });
      notify();
    },

    removeWorkflowDefinitionFromServer(id: string): void {
      setState((state) => {
        const s = state as StoreState & WorkflowStoreState;
        const map = new Map(s.workflowDefinitions ?? new Map());
        map.delete(id);
        s.workflowDefinitions = map;
        if (s.selectedWorkflowId === id) {
          s.selectedWorkflowId = null;
          s.workflowDetailOpen = false;
        }
      });
      notify();
    },

    createWorkflowDefinition(data): void {
      getSendMessage()?.({
        type: 'create_workflow_def',
        payload: data,
      });
    },

    updateWorkflowDefinition(id: string, updates: Partial<WorkflowDefinition>): void {
      getSendMessage()?.({
        type: 'update_workflow_def',
        payload: { id, updates },
      });
    },

    deleteWorkflowDefinition(id: string): void {
      getSendMessage()?.({
        type: 'delete_workflow_def',
        payload: { id },
      });
    },

    moveWorkflow(id: string, position: { x: number; z: number }): void {
      // Update local state immediately
      setState((state) => {
        const s = state as StoreState & WorkflowStoreState;
        const map = new Map(s.workflowDefinitions ?? new Map());
        const def = map.get(id);
        if (def) {
          map.set(id, { ...def, position });
          s.workflowDefinitions = map;
        }
      });
      // Sync to server
      getSendMessage()?.({
        type: 'update_workflow_def',
        payload: { id, updates: { position } },
      });
      notify();
    },

    // ═══════════════════════════════════════
    // Instance Management
    // ═══════════════════════════════════════

    setWorkflowInstancesFromServer(instances: WorkflowInstanceRow[]): void {
      setState((state) => {
        const s = state as StoreState & WorkflowStoreState;
        const map = new Map<string, WorkflowInstanceRow>();
        for (const inst of instances) map.set(inst.id, inst);
        s.workflowInstances = map;
      });
      notify();
    },

    updateWorkflowInstanceFromServer(instance: WorkflowInstanceRow): void {
      setState((state) => {
        const s = state as StoreState & WorkflowStoreState;
        const map = new Map(s.workflowInstances ?? new Map());
        map.set(instance.id, instance);
        s.workflowInstances = map;
      });
      notify();
    },

    removeWorkflowInstanceFromServer(id: string): void {
      setState((state) => {
        const s = state as StoreState & WorkflowStoreState;
        const map = new Map(s.workflowInstances ?? new Map());
        map.delete(id);
        s.workflowInstances = map;
      });
      notify();
    },

    startWorkflow(workflowDefId: string, initialVariables?: Record<string, unknown>): void {
      getSendMessage()?.({
        type: 'start_workflow',
        payload: { workflowDefId, initialVariables },
      });
    },

    pauseWorkflow(instanceId: string): void {
      getSendMessage()?.({
        type: 'pause_workflow',
        payload: { instanceId },
      });
    },

    resumeWorkflow(instanceId: string): void {
      getSendMessage()?.({
        type: 'resume_workflow',
        payload: { instanceId },
      });
    },

    cancelWorkflow(instanceId: string): void {
      getSendMessage()?.({
        type: 'cancel_workflow',
        payload: { instanceId },
      });
    },

    manualTransition(instanceId: string, transitionId: string): void {
      getSendMessage()?.({
        type: 'manual_transition',
        payload: { instanceId, transitionId },
      });
    },

    // ═══════════════════════════════════════
    // Selection and Navigation
    // ═══════════════════════════════════════

    selectWorkflow(workflowId: string | null): void {
      setState((state) => {
        (state as StoreState & WorkflowStoreState).selectedWorkflowId = workflowId;
      });
      notify();
    },

    openWorkflowDetail(workflowId: string): void {
      setState((state) => {
        const s = state as StoreState & WorkflowStoreState;
        s.selectedWorkflowId = workflowId;
        s.workflowDetailOpen = true;
        s.workflowDetailLevel = { level: 'overview' };
        s.workflowChatMessages = [];
        s.workflowChatScope = { level: 'workflow' };
      });
      notify();
    },

    closeWorkflowDetail(): void {
      setState((state) => {
        const s = state as StoreState & WorkflowStoreState;
        s.workflowDetailOpen = false;
        s.workflowDetailLevel = { level: 'overview' };
        s.workflowChatMessages = [];
      });
      notify();
    },

    navigateToExecution(instanceId: string): void {
      setState((state) => {
        const s = state as StoreState & WorkflowStoreState;
        s.workflowDetailLevel = { level: 'execution', instanceId };
        s.workflowChatScope = { level: 'instance', instanceId };
      });
      notify();
    },

    navigateToStep(instanceId: string, stepId: string): void {
      setState((state) => {
        const s = state as StoreState & WorkflowStoreState;
        s.workflowDetailLevel = { level: 'step', instanceId, stepId };
        s.workflowChatScope = { level: 'step', instanceId, stepId };
      });
      notify();
    },

    navigateBack(): void {
      const wf = getWfState();
      const level = wf.workflowDetailLevel;

      setState((state) => {
        const s = state as StoreState & WorkflowStoreState;
        if (level.level === 'step') {
          s.workflowDetailLevel = { level: 'execution', instanceId: level.instanceId };
          s.workflowChatScope = { level: 'instance', instanceId: level.instanceId };
        } else if (level.level === 'execution') {
          s.workflowDetailLevel = { level: 'overview' };
          s.workflowChatScope = { level: 'workflow' };
        }
      });
      notify();
    },

    // ═══════════════════════════════════════
    // Status Computation
    // ═══════════════════════════════════════

    getWorkflowModelStatus(workflowId: string): WorkflowModelStatus {
      const wf = getWfState();
      const instances = Array.from(wf.workflowInstances.values())
        .filter(i => i.workflowDefId === workflowId);

      if (instances.length === 0) return 'idle';

      // Any instance in error → error
      if (instances.some(i => i.status === 'failed')) return 'error';

      // Any instance running or paused → running
      if (instances.some(i => i.status === 'running' || i.status === 'paused')) return 'running';

      // All completed recently (within 5 min) → completed
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      const recentCompleted = instances.filter(
        i => i.status === 'completed' && i.completedAt && i.completedAt > fiveMinAgo
      );
      if (recentCompleted.length > 0) return 'completed';

      return 'idle';
    },

    // ═══════════════════════════════════════
    // Chat
    // ═══════════════════════════════════════

    addWorkflowChatMessage(message: ChatMessage): void {
      setState((state) => {
        const s = state as StoreState & WorkflowStoreState;
        s.workflowChatMessages = [...(s.workflowChatMessages ?? []), message];
      });
      notify();
    },

    setWorkflowChatScope(scope: WorkflowChatScope): void {
      setState((state) => {
        (state as StoreState & WorkflowStoreState).workflowChatScope = scope;
      });
      notify();
    },

    setWorkflowChatLoading(loading: boolean): void {
      setState((state) => {
        (state as StoreState & WorkflowStoreState).workflowChatLoading = loading;
      });
      notify();
    },

    clearWorkflowChat(): void {
      setState((state) => {
        const s = state as StoreState & WorkflowStoreState;
        s.workflowChatMessages = [];
      });
      notify();
    },

    // ═══════════════════════════════════════
    // Accessors
    // ═══════════════════════════════════════

    getWorkflowDefinition(id: string): WorkflowDefinition | undefined {
      return getWfState().workflowDefinitions.get(id);
    },

    getWorkflowInstances(workflowDefId: string): WorkflowInstanceRow[] {
      return Array.from(getWfState().workflowInstances.values())
        .filter(i => i.workflowDefId === workflowDefId);
    },

    getAllWorkflowDefinitions(): WorkflowDefinition[] {
      return Array.from(getWfState().workflowDefinitions.values());
    },
  };

  return actions;
}
