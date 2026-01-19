import React, { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore, useHideCost, useAgentOutputs, store, ClaudeOutput } from '../store';
import type { Agent, AgentAnalysis, PermissionRequest } from '../../shared/types';
import { BOSS_CONTEXT_START, BOSS_CONTEXT_END } from '../../shared/types';
import { AGENT_CLASS_CONFIG } from '../scene/config';
import { formatIdleTime, getIdleTimerColor, filterCostText } from '../utils/formatting';
import {
  TOOL_ICONS,
  getToolIcon,
  getTodoStatusIcon,
  extractToolKeyParam,
  isErrorResult,
  getStatusColor,
} from '../utils/outputRendering';

// Custom markdown components with inline styles for guaranteed rendering
const markdownComponents: Components = {
  h1: ({ children }) => <h1 style={{ fontSize: '1.4em', color: '#ff79c6', fontWeight: 600, margin: '0.6em 0 0.3em' }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontSize: '1.25em', color: '#bd93f9', fontWeight: 600, margin: '0.6em 0 0.3em' }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontSize: '1.15em', color: '#8be9fd', fontWeight: 600, margin: '0.6em 0 0.3em' }}>{children}</h3>,
  h4: ({ children }) => <h4 style={{ fontSize: '1.1em', color: '#50fa7b', fontWeight: 600, margin: '0.6em 0 0.3em' }}>{children}</h4>,
  h5: ({ children }) => <h5 style={{ fontSize: '1.05em', color: '#f1fa8c', fontWeight: 600, margin: '0.6em 0 0.3em' }}>{children}</h5>,
  h6: ({ children }) => <h6 style={{ fontSize: '1em', color: '#ffb86c', fontWeight: 600, margin: '0.6em 0 0.3em' }}>{children}</h6>,
  p: ({ children }) => <p style={{ margin: '0.4em 0' }}>{children}</p>,
  strong: ({ children }) => <strong style={{ color: '#ffb86c', fontWeight: 600 }}>{children}</strong>,
  em: ({ children }) => <em style={{ color: '#f1fa8c', fontStyle: 'italic' }}>{children}</em>,
  del: ({ children }) => <del style={{ color: '#ff5555', textDecoration: 'line-through' }}>{children}</del>,
  code: ({ children, className }) => {
    // Check if it's a code block (has language class) or inline code
    const isBlock = className?.includes('language-');
    if (isBlock) {
      return <code style={{ background: 'none', padding: 0, color: '#f8f8f2', fontSize: '12px', lineHeight: 1.5 }}>{children}</code>;
    }
    return <code style={{ background: 'rgba(68, 71, 90, 0.6)', color: '#50fa7b', padding: '0.15em 0.4em', borderRadius: '3px', fontSize: '0.9em' }}>{children}</code>;
  },
  pre: ({ children }) => <pre style={{ background: 'rgba(40, 42, 54, 0.9)', border: '1px solid rgba(98, 114, 164, 0.4)', borderRadius: '6px', padding: '12px', margin: '0.6em 0', overflowX: 'auto' }}>{children}</pre>,
  ul: ({ children }) => <ul style={{ margin: '0.5em 0', paddingLeft: '1.5em', lineHeight: 1.5 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0.5em 0', paddingLeft: '1.5em', lineHeight: 1.5 }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '0.2em 0', paddingLeft: '0.3em' }}>{children}</li>,
  blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #bd93f9', margin: '0.5em 0', padding: '0.5em 1em', background: 'rgba(189, 147, 249, 0.1)', borderRadius: '0 4px 4px 0' }}>{children}</blockquote>,
  a: ({ children, href }) => <a href={href} style={{ color: '#8be9fd', textDecoration: 'underline' }}>{children}</a>,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid rgba(98, 114, 164, 0.5)', margin: '1em 0' }} />,
  table: ({ children }) => <table style={{ width: '100%', borderCollapse: 'collapse', margin: '0.6em 0', fontSize: '12px' }}>{children}</table>,
  th: ({ children }) => <th style={{ border: '1px solid rgba(98, 114, 164, 0.4)', padding: '6px 10px', textAlign: 'left', background: 'rgba(68, 71, 90, 0.8)', fontWeight: 600, color: '#ff79c6' }}>{children}</th>,
  td: ({ children }) => <td style={{ border: '1px solid rgba(98, 114, 164, 0.4)', padding: '6px 10px', textAlign: 'left', background: 'rgba(40, 42, 54, 0.5)' }}>{children}</td>,
  input: ({ checked, type }) => type === 'checkbox' ? <input type="checkbox" checked={checked} readOnly style={{ marginRight: '0.5em', accentColor: '#50fa7b' }} /> : null,
};

// Constants for terminal height
const DEFAULT_TERMINAL_HEIGHT = 55; // percentage
const MIN_TERMINAL_HEIGHT = 20; // percentage
const MAX_TERMINAL_HEIGHT = 85; // percentage
const TERMINAL_HEIGHT_KEY = 'guake-terminal-height';

interface HistoryMessage {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  timestamp: string;
  toolName?: string;
}

interface AttachedFile {
  id: number;
  name: string;
  path: string;
  isImage: boolean;
  size: number;
}

// View modes for the terminal: 'simple' shows tools, 'chat' shows only user/final responses, 'advanced' shows everything
type ViewMode = 'simple' | 'chat' | 'advanced';
const VIEW_MODES: ViewMode[] = ['simple', 'chat', 'advanced'];

// Constants for virtualization
const MESSAGES_PER_PAGE = 30;
const SCROLL_THRESHOLD = 100; // px from top to trigger load more

// Helper to determine if output should be shown in simple view
// NOTE: This extends the shared isSimpleViewOutput with additional patterns specific to this component
function isSimpleViewOutput(text: string): boolean {
  // SHOW tool names (will render with nice icons)
  if (text.startsWith('Using tool:')) return true;

  // HIDE tool input/result details
  if (text.startsWith('Tool input:')) return false;
  if (text.startsWith('Tool result:')) return false;

  // HIDE stats and system messages
  if (text.startsWith('Tokens:')) return false;
  if (text.startsWith('Cost:')) return false;
  if (text.startsWith('[thinking]')) return false;
  if (text.startsWith('[raw]')) return false;
  if (text.startsWith('Session started:')) return false;
  if (text.startsWith('Session initialized')) return false;

  // HIDE raw JSON tool parameters (common tool input fields)
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    // Common tool parameter keys
    const toolParamKeys = [
      '"file_path"', '"command"', '"pattern"', '"path"', '"content"',
      '"old_string"', '"new_string"', '"query"', '"url"', '"prompt"',
      '"notebook_path"', '"description"', '"offset"', '"limit"'
    ];
    if (toolParamKeys.some(key => trimmed.includes(key))) {
      return false;
    }
  }

  // SHOW everything else (Claude's text responses)
  return true;
}

// Helper to determine if output should be shown in chat view (only user messages and final responses)
// This aggressively filters out intermediate reasoning/planning messages
function isChatViewOutput(text: string): boolean {
  // HIDE all tool-related messages
  if (text.startsWith('Using tool:')) return false;
  if (text.startsWith('Tool input:')) return false;
  if (text.startsWith('Tool result:')) return false;

  // HIDE stats and system messages
  if (text.startsWith('Tokens:')) return false;
  if (text.startsWith('Cost:')) return false;
  if (text.startsWith('[thinking]')) return false;
  if (text.startsWith('[raw]')) return false;
  if (text.startsWith('Session started:')) return false;
  if (text.startsWith('Session initialized')) return false;

  // HIDE raw JSON tool parameters
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const toolParamKeys = [
      '"file_path"', '"command"', '"pattern"', '"path"', '"content"',
      '"old_string"', '"new_string"', '"query"', '"url"', '"prompt"',
      '"notebook_path"', '"description"', '"offset"', '"limit"'
    ];
    if (toolParamKeys.some(key => trimmed.includes(key))) {
      return false;
    }
  }

  // HIDE intermediate reasoning/planning messages (common patterns)
  const intermediatePatterns = [
    /^(let me|i'll|i will|now i|first,? i|i need to|i should|i'm going to)/i,
    /^(looking at|reading|checking|searching|exploring|examining|investigating)/i,
    /^(based on|from what|according to|it (looks|seems|appears))/i,
    /^(this (shows|indicates|suggests|means|is))/i,
    /^(the (code|file|function|class|component|implementation))/i,
    /^(now (let|i))/i,
  ];

  if (intermediatePatterns.some(pattern => pattern.test(trimmed))) {
    return false;
  }

  // SHOW only what appears to be final responses (summaries, answers, etc.)
  return true;
}

// Helper to format timestamp for display (HH:MM:SS)
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// Helper to parse boss context from content
interface ParsedBossContent {
  hasContext: boolean;
  context: string | null;
  userMessage: string;
}

function parseBossContext(content: string): ParsedBossContent {
  const startIdx = content.indexOf(BOSS_CONTEXT_START);
  const endIdx = content.indexOf(BOSS_CONTEXT_END);

  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
    return { hasContext: false, context: null, userMessage: content };
  }

  const context = content.slice(startIdx + BOSS_CONTEXT_START.length, endIdx).trim();
  const userMessage = content.slice(endIdx + BOSS_CONTEXT_END.length).trim();

  return { hasContext: true, context, userMessage };
}

// Component for collapsible boss context
interface BossContextProps {
  context: string;
  defaultCollapsed?: boolean;
}

function BossContext({ context, defaultCollapsed = true }: BossContextProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Extract agent count from the "# YOUR TEAM (N agents)" header
  const teamMatch = context.match(/# YOUR TEAM \((\d+) agents?\)/);
  const agentCount = teamMatch ? parseInt(teamMatch[1], 10) : 0;

  return (
    <div className={`boss-context ${collapsed ? 'collapsed' : 'expanded'}`}>
      <div className="boss-context-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="boss-context-icon">👑</span>
        <span className="boss-context-label">
          Team Context ({agentCount} agent{agentCount !== 1 ? 's' : ''})
        </span>
        <span className="boss-context-toggle">{collapsed ? '▶' : '▼'}</span>
      </div>
      {!collapsed && (
        <div className="boss-context-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{context}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Delegation Block Parsing and Display
// ============================================================================

interface ParsedDelegation {
  selectedAgentId: string;
  selectedAgentName: string;
  taskCommand: string;
  reasoning: string;
  alternativeAgents: Array<{ id: string; name: string; reason?: string }>;
  confidence: 'high' | 'medium' | 'low';
}

interface ParsedBossResponse {
  hasDelegation: boolean;
  delegations: ParsedDelegation[];  // Now supports multiple delegations
  contentWithoutBlock: string;  // Response text with the ```delegation block removed
}

function parseDelegationBlock(content: string): ParsedBossResponse {
  // Match ```delegation\n[...]\n``` or ```delegation\n{...}\n``` block
  const delegationMatch = content.match(/```delegation\s*\n([\s\S]*?)\n```/);

  if (!delegationMatch) {
    return { hasDelegation: false, delegations: [], contentWithoutBlock: content };
  }

  try {
    const parsed = JSON.parse(delegationMatch[1].trim());

    // Support both array and single object format
    const delegationArray = Array.isArray(parsed) ? parsed : [parsed];

    const delegations: ParsedDelegation[] = delegationArray.map(delegationJson => ({
      selectedAgentId: delegationJson.selectedAgentId || '',
      selectedAgentName: delegationJson.selectedAgentName || 'Unknown',
      taskCommand: delegationJson.taskCommand || '',
      reasoning: delegationJson.reasoning || '',
      alternativeAgents: delegationJson.alternativeAgents || [],
      confidence: delegationJson.confidence || 'medium',
    }));

    // Remove the delegation block from the content
    const contentWithoutBlock = content.replace(/```delegation\s*\n[\s\S]*?\n```/, '').trim();

    return { hasDelegation: true, delegations, contentWithoutBlock };
  } catch {
    // Failed to parse JSON, return as-is
    return { hasDelegation: false, delegations: [], contentWithoutBlock: content };
  }
}

interface DelegationBlockProps {
  delegation: ParsedDelegation;
}

function DelegationBlock({ delegation }: DelegationBlockProps) {
  const confidenceColors: Record<string, string> = {
    high: '#22c55e',    // green
    medium: '#f59e0b',  // amber
    low: '#ef4444',     // red
  };

  const confidenceEmoji: Record<string, string> = {
    high: '✅',
    medium: '⚠️',
    low: '❓',
  };

  return (
    <div className="delegation-block">
      <div className="delegation-header">
        <span className="delegation-icon">📨</span>
        <span className="delegation-title">Task Delegated</span>
        <span
          className="delegation-confidence"
          style={{ color: confidenceColors[delegation.confidence] }}
        >
          {confidenceEmoji[delegation.confidence]} {delegation.confidence}
        </span>
      </div>
      <div className="delegation-details">
        <div className="delegation-target">
          <span className="delegation-label">To:</span>
          <span className="delegation-agent-name">{delegation.selectedAgentName}</span>
        </div>
        {delegation.taskCommand && (
          <div className="delegation-task-command">
            <span className="delegation-label">Task:</span>
            <span className="delegation-command-text">{delegation.taskCommand}</span>
          </div>
        )}
        {delegation.reasoning && (
          <div className="delegation-reasoning">
            <span className="delegation-label">Why:</span>
            <span className="delegation-reason-text">{delegation.reasoning}</span>
          </div>
        )}
        {delegation.alternativeAgents.length > 0 && (
          <div className="delegation-alternatives">
            <span className="delegation-label">Alternatives:</span>
            <span className="delegation-alt-list">
              {delegation.alternativeAgents.map((alt, i) => (
                <span key={alt.id || i} className="delegation-alt-agent">
                  {alt.name}{alt.reason ? ` (${alt.reason})` : ''}
                </span>
              ))}
            </span>
          </div>
        )}
      </div>
      <div className="delegation-footer">
        <span className="delegation-auto-forward">↗️ Auto-forwarding to {delegation.selectedAgentName}...</span>
      </div>
    </div>
  );
}

// ============================================================================
// Delegated Task Header (shown when an agent receives a task from a boss)
// ============================================================================

interface DelegatedTaskHeaderProps {
  bossName: string;
  taskCommand: string;
}

function DelegatedTaskHeader({ bossName, taskCommand }: DelegatedTaskHeaderProps) {
  return (
    <div className="delegated-task-header">
      <div className="delegated-task-badge">
        <span className="delegated-task-icon">👑</span>
        <span className="delegated-task-label">Delegated from <strong>{bossName}</strong></span>
      </div>
      <div className="delegated-task-command">
        {taskCommand}
      </div>
    </div>
  );
}

export function ClaudeOutputPanel() {
  const state = useStore();
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const isUserScrolledUpRef = useRef(false);
  // Per-agent input state
  const [agentCommands, setAgentCommands] = useState<Map<string, string>>(new Map());
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('guake-view-mode');
    if (saved === 'simple' || saved === 'chat' || saved === 'advanced') {
      return saved;
    }
    // Migrate from old boolean setting
    const oldSaved = localStorage.getItem('guake-advanced-view');
    if (oldSaved === 'true') return 'advanced';
    return 'simple';
  });
  const [agentForceTextarea, setAgentForceTextarea] = useState<Map<string, boolean>>(new Map());
  const [agentPastedTexts, setAgentPastedTexts] = useState<Map<string, Map<number, string>>>(new Map());
  const [agentAttachedFiles, setAgentAttachedFiles] = useState<Map<string, AttachedFile[]>>(new Map());
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HistoryMessage[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  // Image modal state
  const [imageModal, setImageModal] = useState<{ url: string; name: string } | null>(null);
  // Context action confirmation modal
  const [contextConfirm, setContextConfirm] = useState<'collapse' | 'clear' | null>(null);
  const agentPastedCountRef = useRef<Map<string, number>>(new Map());
  const fileCountRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollPositionRef = useRef<number>(0);

  // Terminal height state with localStorage persistence
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const saved = localStorage.getItem(TERMINAL_HEIGHT_KEY);
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= MIN_TERMINAL_HEIGHT && parsed <= MAX_TERMINAL_HEIGHT) {
        return parsed;
      }
    }
    return DEFAULT_TERMINAL_HEIGHT;
  });
  const isResizingRef = useRef(false);
  const resizeStartYRef = useRef(0);
  const resizeStartHeightRef = useRef(0);
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalHeightRef = useRef(terminalHeight); // Track height in ref for event handlers
  terminalHeightRef.current = terminalHeight; // Keep ref in sync

  // Get selected agent's outputs - only show terminal when exactly one agent is selected
  const selectedAgentIds = Array.from(state.selectedAgentIds);
  const isSingleSelection = selectedAgentIds.length === 1;
  const selectedAgentId = isSingleSelection ? selectedAgentIds[0] : null;
  const selectedAgent = selectedAgentId ? state.agents.get(selectedAgentId) : null;
  // Use the reactive hook for outputs instead of direct store access
  const outputs = useAgentOutputs(selectedAgentId);

  // Debug: Log when outputs change
  useEffect(() => {
    console.log(`🖥️ [PANEL] outputs changed for agent ${selectedAgentId}, count=${outputs.length}, lastOutput=${outputs.length > 0 ? outputs[outputs.length - 1].text.substring(0, 50) : 'none'}...`);
  }, [outputs, selectedAgentId]);

  // Get pending permission requests for this agent
  const pendingPermissions = selectedAgentId
    ? store.getPendingPermissionsForAgent(selectedAgentId)
    : [];

  // Per-agent state getters/setters
  const command = selectedAgentId ? (agentCommands.get(selectedAgentId) || '') : '';
  const setCommand = (value: string) => {
    if (!selectedAgentId) return;
    setAgentCommands(prev => new Map(prev).set(selectedAgentId, value));
  };

  const forceTextarea = selectedAgentId ? (agentForceTextarea.get(selectedAgentId) || false) : false;
  const setForceTextarea = (value: boolean) => {
    if (!selectedAgentId) return;
    setAgentForceTextarea(prev => new Map(prev).set(selectedAgentId, value));
  };

  const pastedTexts = selectedAgentId ? (agentPastedTexts.get(selectedAgentId) || new Map()) : new Map<number, string>();
  const setPastedTexts = (value: Map<number, string> | ((prev: Map<number, string>) => Map<number, string>)) => {
    if (!selectedAgentId) return;
    setAgentPastedTexts(prev => {
      const newMap = new Map(prev);
      const currentValue = prev.get(selectedAgentId) || new Map();
      const newValue = typeof value === 'function' ? value(currentValue) : value;
      newMap.set(selectedAgentId, newValue);
      return newMap;
    });
  };

  const attachedFiles = selectedAgentId ? (agentAttachedFiles.get(selectedAgentId) || []) : [];
  const setAttachedFiles = (value: AttachedFile[] | ((prev: AttachedFile[]) => AttachedFile[])) => {
    if (!selectedAgentId) return;
    setAgentAttachedFiles(prev => {
      const newMap = new Map(prev);
      const currentValue = prev.get(selectedAgentId) || [];
      const newValue = typeof value === 'function' ? value(currentValue) : value;
      newMap.set(selectedAgentId, newValue);
      return newMap;
    });
  };

  const getPastedCount = () => selectedAgentId ? (agentPastedCountRef.current.get(selectedAgentId) || 0) : 0;
  const incrementPastedCount = () => {
    if (!selectedAgentId) return 0;
    const current = agentPastedCountRef.current.get(selectedAgentId) || 0;
    const next = current + 1;
    agentPastedCountRef.current.set(selectedAgentId, next);
    return next;
  };
  const resetPastedCount = () => {
    if (!selectedAgentId) return;
    agentPastedCountRef.current.set(selectedAgentId, 0);
  };

  // Use textarea if: forced, has newlines, or text is long
  const hasNewlines = command.includes('\n');
  const useTextarea = forceTextarea || hasNewlines || command.length > 50;

  // Upload file to server
  const uploadFile = async (file: File | Blob, filename?: string): Promise<AttachedFile | null> => {
    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': filename || (file instanceof File ? file.name : ''),
        },
        body: file,
      });

      if (!response.ok) {
        console.error('Upload failed:', await response.text());
        return null;
      }

      const data = await response.json();
      fileCountRef.current += 1;

      return {
        id: fileCountRef.current,
        name: data.filename,
        path: data.absolutePath, // Use absolute filesystem path for Claude Code to read
        isImage: data.isImage,
        size: data.size,
      };
    } catch (err) {
      console.error('Upload error:', err);
      return null;
    }
  };

  // Handle paste event - collapse large pastes into variables or upload images
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;

    // Check for images first
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const attached = await uploadFile(blob);
          if (attached) {
            setAttachedFiles(prev => [...prev, attached]);
          }
        }
        return;
      }
    }

    // Check for files
    const files = e.clipboardData.files;
    if (files.length > 0) {
      e.preventDefault();
      for (const file of files) {
        const attached = await uploadFile(file);
        if (attached) {
          setAttachedFiles(prev => [...prev, attached]);
        }
      }
      return;
    }

    // Handle text paste (collapse large text)
    const pastedText = e.clipboardData.getData('text');
    const lineCount = (pastedText.match(/\n/g) || []).length + 1;

    // If pasting more than 5 lines, collapse into a variable
    if (lineCount > 5) {
      e.preventDefault();
      const pasteId = incrementPastedCount();

      // Store the pasted text
      setPastedTexts(prev => new Map(prev).set(pasteId, pastedText));

      // Insert placeholder in command
      const placeholder = `[Pasted text #${pasteId} +${lineCount} lines]`;
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      const newCommand = command.slice(0, start) + placeholder + command.slice(end);
      setCommand(newCommand);

      // Auto-expand to textarea if needed
      if (!useTextarea) {
        setForceTextarea(true);
      }
    }
  };

  // Handle file input change
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of files) {
      const attached = await uploadFile(file);
      if (attached) {
        setAttachedFiles(prev => [...prev, attached]);
      }
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Remove attached file
  const removeAttachedFile = (id: number) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== id));
  };

  // Expand pasted text placeholders before sending
  const expandPastedTexts = (text: string): string => {
    let expanded = text;
    for (const [id, pastedText] of pastedTexts) {
      const placeholder = new RegExp(`\\[Pasted text #${id} \\+\\d+ lines\\]`, 'g');
      expanded = expanded.replace(placeholder, pastedText);
    }
    return expanded;
  };

  // Use store's terminal state
  const isOpen = state.terminalOpen && selectedAgent !== null;

  // Memoized callbacks to prevent re-renders of child components
  const handleImageClick = useCallback((url: string, name: string) => {
    setImageModal({ url, name });
  }, []);

  const handleFileClick = useCallback((path: string) => {
    store.setFileViewerPath(path);
  }, []);

  // Memoized sorted agents list for the agent links bar
  const sortedAgents = useMemo(() => {
    return Array.from(state.agents.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }, [state.agents]);

  // Memoized filtered history messages based on view mode
  const filteredHistory = useMemo(() => {
    if (viewMode === 'advanced') return history;
    if (viewMode === 'chat') {
      // Only show user messages and the LAST assistant message before each user message
      return history.filter((msg, index, arr) => {
        if (msg.type === 'user') return true;
        if (msg.type === 'assistant') {
          const nextMsg = arr[index + 1];
          return !nextMsg || nextMsg.type === 'user';
        }
        return false;
      });
    }
    // simple mode
    return history.filter(msg => msg.type === 'user' || msg.type === 'assistant' || msg.type === 'tool_use');
  }, [history, viewMode]);

  // Memoized filtered outputs based on view mode
  // For simple view, we enrich 'Using tool:' lines with the key parameter from the following 'Tool input:' line
  const filteredOutputs = useMemo(() => {
    if (viewMode === 'advanced') return outputs;

    if (viewMode === 'chat') {
      return outputs.filter(output => {
        if (output.isUserPrompt) return true;
        return isChatViewOutput(output.text);
      });
    }

    // Simple view: enrich tool lines with key parameters
    const result: (ClaudeOutput & { _toolKeyParam?: string })[] = [];
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i];

      if (output.isUserPrompt) {
        result.push(output);
        continue;
      }

      // Check if this is a "Using tool:" line
      if (output.text.startsWith('Using tool:')) {
        const toolName = output.text.replace('Using tool:', '').trim();

        // Look ahead for the next Tool input: line
        let keyParam: string | null = null;
        for (let j = i + 1; j < outputs.length && j <= i + 3; j++) {
          const nextOutput = outputs[j];
          if (nextOutput.text.startsWith('Tool input:')) {
            const inputJson = nextOutput.text.replace('Tool input:', '').trim();
            keyParam = extractToolKeyParam(toolName, inputJson);
            break;
          }
          // Stop looking if we hit another tool or non-input line
          if (nextOutput.text.startsWith('Using tool:') || nextOutput.text.startsWith('Tool result:')) {
            break;
          }
        }

        // Create enriched output with tool name + key param
        result.push({
          ...output,
          _toolKeyParam: keyParam || undefined,
        });
        continue;
      }

      // Apply normal simple view filter for other outputs
      if (isSimpleViewOutput(output.text)) {
        result.push(output);
      }
    }
    return result;
  }, [outputs, viewMode]);

  // Handle resize drag
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartYRef.current = e.clientY;
    resizeStartHeightRef.current = terminalHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [terminalHeight]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;

      const deltaY = e.clientY - resizeStartYRef.current;
      const windowHeight = window.innerHeight;
      const deltaPercent = (deltaY / windowHeight) * 100;
      const newHeight = Math.min(
        MAX_TERMINAL_HEIGHT,
        Math.max(MIN_TERMINAL_HEIGHT, resizeStartHeightRef.current + deltaPercent)
      );
      setTerminalHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Save to localStorage when done resizing - use ref for current value
        localStorage.setItem(TERMINAL_HEIGHT_KEY, String(terminalHeightRef.current));
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []); // No dependencies - listeners are registered once

  // Focus input when terminal opens or switches to textarea
  useEffect(() => {
    if (isOpen) {
      if (useTextarea && textareaRef.current) {
        textareaRef.current.focus();
        // Move cursor to end of text
        const len = textareaRef.current.value.length;
        textareaRef.current.setSelectionRange(len, len);
      } else if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [isOpen, useTextarea]);

  const handleSendCommand = () => {
    if ((!command.trim() && attachedFiles.length === 0) || !selectedAgentId) return;

    // Build the full command with attachments
    let fullCommand = expandPastedTexts(command.trim());

    // Add file references for Claude to read
    if (attachedFiles.length > 0) {
      const fileRefs = attachedFiles.map(f => {
        if (f.isImage) {
          return `[Image: ${f.path}]`;
        } else {
          return `[File: ${f.path}]`;
        }
      }).join('\n');

      if (fullCommand) {
        fullCommand = `${fullCommand}\n\n${fileRefs}`;
      } else {
        fullCommand = fileRefs;
      }
    }

    store.sendCommand(selectedAgentId, fullCommand);
    setCommand('');
    setForceTextarea(false);
    setPastedTexts(new Map());
    setAttachedFiles([]);
    resetPastedCount();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Shift+Enter: switch to textarea mode (from input) or add newline (in textarea)
    if (e.key === 'Enter' && e.shiftKey) {
      if (!useTextarea) {
        e.preventDefault();
        setForceTextarea(true);
      }
      // In textarea, let default behavior add newline
      return;
    }
    // Regular Enter: send command
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendCommand();
    }
  };

  // Calculate textarea rows based on content
  const getTextareaRows = () => {
    const lineCount = (command.match(/\n/g) || []).length + 1;
    const charRows = Math.ceil(command.length / 60); // ~60 chars per row
    const rows = Math.max(lineCount, charRows, 2); // Minimum 2 rows
    return Math.min(rows, 10); // Maximum 10 rows
  };

  // Load conversation history when agent changes
  useEffect(() => {
    if (!selectedAgentId || !selectedAgent?.sessionId) {
      setHistory([]);
      setHasMore(false);
      setTotalCount(0);
      return;
    }

    setLoadingHistory(true);
    fetch(`/api/agents/${selectedAgentId}/history?limit=${MESSAGES_PER_PAGE}&offset=0`)
      .then(res => res.json())
      .then(data => {
        const messages = data.messages || [];
        setHistory(messages);
        setHasMore(data.hasMore || false);
        setTotalCount(data.totalCount || 0);

        // Clear live outputs when history is loaded to avoid duplicates
        // History contains the definitive record from the transcript file
        // BUT: preserve delegation messages since they're not persisted to the session file
        if (messages.length > 0) {
          const currentOutputs = store.getOutputs(selectedAgentId);
          const delegationMessages = currentOutputs.filter(o => o.isDelegation);
          store.clearOutputs(selectedAgentId);
          // Re-add delegation messages so they're preserved
          for (const delegation of delegationMessages) {
            store.addOutput(selectedAgentId, delegation);
          }
        }

        // Extract last user message and store it as lastPrompt (if not already set)
        if (!state.lastPrompts.get(selectedAgentId)) {
          // Find the last user message (messages are in chronological order, so iterate from end)
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].type === 'user') {
              store.setLastPrompt(selectedAgentId, messages[i].content);
              break;
            }
          }
        }
      })
      .catch(err => {
        console.error('Failed to load history:', err);
        setHistory([]);
        setHasMore(false);
        setTotalCount(0);
      })
      .finally(() => {
        setLoadingHistory(false);
      });
  }, [selectedAgentId, selectedAgent?.sessionId]);

  // Load more history when scrolling to top
  const loadMoreHistory = useCallback(async () => {
    if (!selectedAgentId || !selectedAgent?.sessionId || loadingMore || !hasMore) return;

    const scrollContainer = outputRef.current;
    if (!scrollContainer) return;

    // Save the distance from bottom - this is more stable than tracking from top
    const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop;

    setLoadingMore(true);
    const currentOffset = history.length;

    try {
      const res = await fetch(
        `/api/agents/${selectedAgentId}/history?limit=${MESSAGES_PER_PAGE}&offset=${currentOffset}`
      );
      const data = await res.json();

      if (data.messages && data.messages.length > 0) {
        // Prepend older messages
        setHistory(prev => [...data.messages, ...prev]);
        setHasMore(data.hasMore || false);

        // Use multiple RAF frames to ensure DOM is fully updated
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (outputRef.current) {
              // Restore position by maintaining same distance from bottom
              outputRef.current.scrollTop = outputRef.current.scrollHeight - distanceFromBottom;
            }
            setLoadingMore(false);
          });
        });
      } else {
        setLoadingMore(false);
      }
    } catch (err) {
      console.error('Failed to load more history:', err);
      setLoadingMore(false);
    }
  }, [selectedAgentId, selectedAgent?.sessionId, loadingMore, hasMore, history.length]);

  // Handle scroll to detect when to load more and track if user scrolled up
  const handleScroll = useCallback(() => {
    if (!outputRef.current) return;

    // Check if user is scrolled up (not at bottom)
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    isUserScrolledUpRef.current = !isAtBottom;

    // Load more history if near top
    if (!loadingMore && hasMore && !searchMode && scrollTop < SCROLL_THRESHOLD) {
      loadMoreHistory();
    }
  }, [loadMoreHistory, loadingMore, hasMore, searchMode]);

  // Search conversation
  const handleSearch = useCallback(async () => {
    if (!selectedAgentId || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const res = await fetch(
        `/api/agents/${selectedAgentId}/search?q=${encodeURIComponent(searchQuery)}&limit=100`
      );
      const data = await res.json();
      setSearchResults(data.matches || []);
    } catch (err) {
      console.error('Search failed:', err);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [selectedAgentId, searchQuery]);

  // Focus search input when entering search mode
  useEffect(() => {
    if (searchMode && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchMode]);

  // Toggle search with Ctrl+F
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && isOpen) {
        e.preventDefault();
        setSearchMode(prev => !prev);
        if (!searchMode) {
          setSearchResults([]);
          setSearchQuery('');
        }
      }
      if (e.key === 'Escape') {
        if (imageModal) {
          setImageModal(null);
        } else if (searchMode) {
          setSearchMode(false);
          setSearchResults([]);
          setSearchQuery('');
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, searchMode, imageModal]);

  // Auto-scroll to bottom on new output (but not if user is scrolled up)
  // Uses requestAnimationFrame to batch with browser's paint cycle
  useEffect(() => {
    // Skip auto-scroll if user has scrolled up intentionally
    if (isUserScrolledUpRef.current) return;

    let rafId: number;
    // Use requestAnimationFrame for better performance - batches with browser paint
    rafId = requestAnimationFrame(() => {
      if (outputRef.current && !isUserScrolledUpRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [outputs.length]);

  // Scroll to bottom when switching agents (reset scroll position for new agent)
  useEffect(() => {
    if (loadingHistory) return;

    // Reset scroll state when switching agents
    isUserScrolledUpRef.current = false;

    let rafId: number;
    rafId = requestAnimationFrame(() => {
      if (outputRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [selectedAgentId, loadingHistory]);

  // Keyboard shortcut to toggle (backtick key like Guake)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' && !e.ctrlKey && !e.altKey && selectedAgent) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          store.toggleTerminal();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedAgent]);

  // Close terminal when clicking outside or on interface buttons
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Check if click is outside the terminal
      if (terminalRef.current && !terminalRef.current.contains(target)) {
        // Check if it's an interface button (buttons, clickable elements)
        const isButton = target.closest('button') ||
                         target.closest('[role="button"]') ||
                         target.closest('.clickable') ||
                         target.tagName === 'BUTTON';

        // Close terminal on any click outside (including buttons)
        store.setTerminalOpen(false);
      }
    };

    // Use mousedown for faster response
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Don't render if no agent selected
  if (!selectedAgent) {
    return null;
  }

  return (
    <div
      ref={terminalRef}
      className={`guake-terminal ${isOpen ? 'open' : 'collapsed'}`}
      style={{ '--terminal-height': `${terminalHeight}%` } as React.CSSProperties}
    >
      <div className="guake-content">
        <div className="guake-header">
          <div className="guake-header-left">
            {/* Working indicator animation */}
            {selectedAgent.status === 'working' && (
              <span className="guake-working-indicator">
                <span className="guake-working-dot"></span>
                <span className="guake-working-dot"></span>
                <span className="guake-working-dot"></span>
              </span>
            )}
            <span className="guake-title">
              {selectedAgent.name}
            </span>
            {/* Show last user input + supervisor status */}
            {(() => {
              // Get the last user input
              const lastInput = selectedAgent.currentTask
                || selectedAgent.lastAssignedTask
                || state.lastPrompts.get(selectedAgentId || '')?.text;

              // Get supervisor analysis if available - match by ID first, then by name
              const agentAnalysis = state.supervisor.lastReport?.agentSummaries.find(
                (a: AgentAnalysis) => a.agentId === selectedAgent.id || a.agentName === selectedAgent.name
              );

              // Debug: log supervisor report state
              if (state.supervisor.lastReport) {
                console.log('[DEBUG] Supervisor report summaries:', state.supervisor.lastReport.agentSummaries);
                console.log('[DEBUG] Looking for agent:', { id: selectedAgent.id, name: selectedAgent.name });
                console.log('[DEBUG] Found analysis:', agentAnalysis);
              }

              const progressColors: Record<string, string> = {
                on_track: '#4aff9e',
                stalled: '#ff9e4a',
                blocked: '#ff4a4a',
                completed: '#4a9eff',
                idle: '#888',
              };

              if (!lastInput && !agentAnalysis) return null;

              // NO TRUNCATION - show full content
              const filteredStatus = agentAnalysis?.statusDescription
                ? filterCostText(agentAnalysis.statusDescription, state.settings.hideCost)
                : null;

              return (
                <span
                  className="guake-status-line"
                  title={`${lastInput || 'No task'}${agentAnalysis ? `\n\n🎖️ ${agentAnalysis.statusDescription}\n${agentAnalysis.recentWorkSummary}` : ''}`}
                >
                  {agentAnalysis && (
                    <span
                      className="guake-supervisor-badge"
                      style={{ color: progressColors[agentAnalysis.progress] || '#888' }}
                    >
                      🎖️ {agentAnalysis.progress.replace('_', ' ')}
                    </span>
                  )}
                  {filteredStatus && (
                    <span className="guake-supervisor-summary">{filteredStatus}</span>
                  )}
                  {!filteredStatus && lastInput && (
                    <span className="guake-last-input">{lastInput}</span>
                  )}
                </span>
              );
            })()}
          </div>
          <div className="guake-actions">
            <button
              className={`guake-search-toggle ${searchMode ? 'active' : ''}`}
              onClick={() => {
                setSearchMode(!searchMode);
                if (searchMode) {
                  setSearchResults([]);
                  setSearchQuery('');
                }
              }}
              title="Search (Ctrl+F)"
            >
              🔍
            </button>
            <button
              className={`guake-view-toggle ${viewMode !== 'simple' ? 'active' : ''} view-mode-${viewMode}`}
              onClick={() => {
                const currentIndex = VIEW_MODES.indexOf(viewMode);
                const nextMode = VIEW_MODES[(currentIndex + 1) % VIEW_MODES.length];
                setViewMode(nextMode);
                localStorage.setItem('guake-view-mode', nextMode);
              }}
              title={
                viewMode === 'simple' ? 'Simple: Shows tools and responses' :
                viewMode === 'chat' ? 'Chat: Shows only user messages and final responses' :
                'Advanced: Shows all details including tool inputs/outputs'
              }
            >
              {viewMode === 'simple' ? '○ Simple' : viewMode === 'chat' ? '◐ Chat' : '◉ Advanced'}
            </button>
            {outputs.length > 0 && (
              <button
                className="guake-clear"
                onClick={() => selectedAgentId && store.clearOutputs(selectedAgentId)}
                title="Clear output"
              >
                Clear
              </button>
            )}
            <button
              className="guake-context-btn"
              onClick={() => setContextConfirm('collapse')}
              title="Collapse context - summarize conversation to save tokens"
              disabled={selectedAgent.status !== 'idle'}
            >
              📦 Collapse
            </button>
            <button
              className="guake-context-btn danger"
              onClick={() => setContextConfirm('clear')}
              title="Clear context - start fresh session"
            >
              🗑️ Clear Context
            </button>
            <span className="guake-hint">Press ` to toggle</span>
          </div>
        </div>
        {/* Search bar */}
        {searchMode && (
          <div className="guake-search">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search conversation... (Esc to close)"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSearch();
                if (e.key === 'Escape') {
                  setSearchMode(false);
                  setSearchResults([]);
                  setSearchQuery('');
                }
              }}
            />
            <button onClick={handleSearch} disabled={searchLoading}>
              {searchLoading ? '...' : 'Search'}
            </button>
            {searchResults.length > 0 && (
              <span className="guake-search-count">{searchResults.length} results</span>
            )}
          </div>
        )}
        <div className="guake-output" ref={outputRef} onScroll={handleScroll}>
          {searchMode && searchResults.length > 0 ? (
            // Show search results
            <>
              <div className="guake-search-header">Search Results:</div>
              {searchResults.map((msg, index) => (
                <HistoryLine
                  key={`s-${index}`}
                  message={msg}
                  highlight={searchQuery}
                  onImageClick={(url, name) => setImageModal({ url, name })}
                  onFileClick={(path) => store.setFileViewerPath(path)}
                />
              ))}
            </>
          ) : loadingHistory ? (
            <div className="guake-empty">Loading history...</div>
          ) : history.length === 0 && outputs.length === 0 ? (
            <div className="guake-empty">
              No output yet. Send a command to this agent.
            </div>
          ) : (
            <>
              {/* Load more indicator */}
              {hasMore && !searchMode && (
                <div className="guake-load-more">
                  {loadingMore ? (
                    <span>Loading older messages...</span>
                  ) : (
                    <button onClick={loadMoreHistory}>
                      Load more ({totalCount - history.length} older messages)
                    </button>
                  )}
                </div>
              )}
              {filteredHistory.map((msg, index) => (
                  <HistoryLine
                    key={`h-${index}`}
                    message={msg}
                    simpleView={viewMode !== 'advanced'}
                    onImageClick={handleImageClick}
                    onFileClick={handleFileClick}
                  />
                ))}
              {filteredOutputs.map((output, index) => (
                  <OutputLine
                    key={`o-${index}`}
                    output={output}
                    agentId={selectedAgentId}
                    onImageClick={handleImageClick}
                    onFileClick={handleFileClick}
                  />
                ))}
              {selectedAgent.status === 'working' && (
                <div className="typing-indicator">
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                  <button
                    className="stop-button"
                    onClick={() => store.stopAgent(selectedAgent.id)}
                    title="Stop current operation"
                  >
                    Stop
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        {/* Permission requests bar - compact inline display above input */}
        {pendingPermissions.length > 0 && (
          <div className="permission-bar">
            {pendingPermissions.map((request) => (
              <PermissionRequestInline
                key={request.id}
                request={request}
                onApprove={(remember) => store.respondToPermissionRequest(request.id, true, undefined, remember)}
                onDeny={() => store.respondToPermissionRequest(request.id, false)}
              />
            ))}
          </div>
        )}
        {/* Attached files display */}
        {attachedFiles.length > 0 && (
          <div className="guake-attachments">
            {attachedFiles.map(file => (
              <div
                key={file.id}
                className={`guake-attachment ${file.isImage ? 'is-image clickable' : ''}`}
                onClick={() => {
                  if (file.isImage) {
                    setImageModal({ url: getImageWebUrl(file.path), name: file.name });
                  }
                }}
              >
                <span className="guake-attachment-icon">{file.isImage ? '🖼️' : '📎'}</span>
                <span className="guake-attachment-name" title={file.path}>{file.name}</span>
                <span className="guake-attachment-size">({Math.round(file.size / 1024)}KB)</span>
                <button
                  className="guake-attachment-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAttachedFile(file.id);
                  }}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={`guake-input ${useTextarea ? 'guake-input-expanded' : ''}`}>
          <span className="guake-prompt">&gt;</span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            accept="image/*,.txt,.md,.json,.js,.ts,.tsx,.jsx,.py,.sh,.css,.scss,.html,.xml,.yaml,.yml,.toml,.ini,.cfg,.conf"
          />
          <button
            className="guake-attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Attach file (or paste image)"
          >
            📎
          </button>
          {useTextarea ? (
            <textarea
              ref={textareaRef}
              placeholder={`Command ${selectedAgent.name}... (Shift+Enter for newline, paste image)`}
              value={command}
              onChange={e => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={getTextareaRows()}
            />
          ) : (
            <input
              ref={inputRef}
              type="text"
              placeholder={`Command ${selectedAgent.name}... (Shift+Enter multiline, paste image)`}
              value={command}
              onChange={e => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
            />
          )}
          <button
            onClick={handleSendCommand}
            disabled={!command.trim() && attachedFiles.length === 0}
          >
            Send
          </button>
        </div>
        {/* Agent Links Indicators - at the bottom */}
        <div className="guake-agent-links">
          {sortedAgents.map((agent) => (
              <GuakeAgentLink
                key={agent.id}
                agent={agent}
                isSelected={agent.id === selectedAgentId}
                onClick={() => store.selectAgent(agent.id)}
              />
            ))}
        </div>
      </div>
      {/* Resize handle - only visible when terminal is open */}
      {isOpen && (
        <div
          className="guake-resize-handle"
          onMouseDown={handleResizeStart}
          title="Drag to resize"
        />
      )}
      <div
        className="guake-handle"
        onClick={() => {
          // Single click only hides if terminal is already open
          if (isOpen) {
            store.toggleTerminal();
          }
        }}
        onDoubleClick={() => {
          // Double click shows the terminal if it's hidden
          if (!isOpen) {
            store.toggleTerminal();
          }
        }}
        style={{ top: isOpen ? `${terminalHeight}%` : '0' }}
      >
        <span className="guake-handle-icon">{isOpen ? '▲' : '▼'}</span>
        <span className="guake-handle-text">{selectedAgent.name}</span>
      </div>

      {/* Image Modal */}
      {imageModal && (
        <div
          className="image-modal-overlay"
          onClick={() => setImageModal(null)}
        >
          <div className="image-modal" onClick={(e) => e.stopPropagation()}>
            <div className="image-modal-header">
              <span className="image-modal-title">{imageModal.name}</span>
              <button
                className="image-modal-close"
                onClick={() => setImageModal(null)}
              >
                ×
              </button>
            </div>
            <div className="image-modal-content">
              <img src={imageModal.url} alt={imageModal.name} />
            </div>
          </div>
        </div>
      )}

      {/* Context Action Confirmation Modal */}
      {contextConfirm && (
        <div className="modal-overlay visible" onClick={() => setContextConfirm(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              {contextConfirm === 'collapse' ? 'Collapse Context' : 'Clear Context'}
            </div>
            <div className="modal-body confirm-modal-body">
              {contextConfirm === 'collapse' ? (
                <>
                  <p>Collapse the conversation context?</p>
                  <p className="confirm-modal-note">
                    This will summarize the conversation to save tokens while preserving important information.
                  </p>
                </>
              ) : (
                <>
                  <p>Clear all context for this agent?</p>
                  <p className="confirm-modal-note">
                    This will start a fresh session on the next command. All conversation history will be lost.
                  </p>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setContextConfirm(null)}>
                Cancel
              </button>
              <button
                className={`btn ${contextConfirm === 'clear' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => {
                  if (selectedAgentId) {
                    if (contextConfirm === 'collapse') {
                      store.collapseContext(selectedAgentId);
                    } else {
                      store.clearContext(selectedAgentId);
                      setHistory([]);
                    }
                  }
                  setContextConfirm(null);
                }}
                autoFocus
              >
                {contextConfirm === 'collapse' ? 'Collapse' : 'Clear Context'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface HistoryLineProps {
  message: HistoryMessage;
  highlight?: string;
  simpleView?: boolean;
  onImageClick?: (url: string, name: string) => void;
  onFileClick?: (path: string) => void;
}

// Helper to highlight search terms in text
function highlightText(text: string, query?: string): React.ReactNode {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="search-highlight">{part}</mark>
      : part
  );
}

// Helper to convert image path to web URL for display in browser
// Handles: http URLs, /uploads/ paths, and absolute /tmp/ paths
function getImageWebUrl(imagePath: string): string {
  if (imagePath.startsWith('http')) {
    return imagePath;
  } else if (imagePath.startsWith('/uploads/')) {
    return imagePath;
  } else if (imagePath.includes('tide-commander-uploads')) {
    // Absolute path like /tmp/tide-commander-uploads/image.png - extract filename
    const imageName = imagePath.split('/').pop() || 'image';
    return `/uploads/${imageName}`;
  } else {
    // Default: assume it's a relative path
    return imagePath;
  }
}

// Helper to render content with clickable image references
function renderContentWithImages(
  content: string,
  onImageClick?: (url: string, name: string) => void
): React.ReactNode {
  // Pattern to match [Image: /path/to/image.png]
  const imagePattern = /\[Image:\s*([^\]]+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = imagePattern.exec(content)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      parts.push(
        <div key={`text-${lastIndex}`} className="markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {textBefore}
          </ReactMarkdown>
        </div>
      );
    }

    // Add clickable image placeholder
    const imagePath = match[1].trim();
    const imageName = imagePath.split('/').pop() || 'image';
    const imageUrl = getImageWebUrl(imagePath);

    parts.push(
      <span
        key={`img-${match.index}`}
        className="image-reference clickable"
        onClick={() => onImageClick?.(imageUrl, imageName)}
        title="Click to view image"
      >
        🖼️ {imageName}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < content.length) {
    const textAfter = content.slice(lastIndex);
    parts.push(
      <div key={`text-${lastIndex}`} className="markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {textAfter}
        </ReactMarkdown>
      </div>
    );
  }

  // If no images found, just return markdown wrapped in markdown-content
  if (parts.length === 0) {
    return (
      <div className="markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown>
      </div>
    );
  }

  return <>{parts}</>;
}

// Helper to render Edit tool with diff view
interface EditToolInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}

// Diff line structure for side-by-side view
interface DiffLine {
  num: number;
  text: string;
  type: 'unchanged' | 'added' | 'removed';
}

// Compute side-by-side diff between two strings
function computeSideBySideDiff(oldStr: string, newStr: string): {
  leftLines: DiffLine[];
  rightLines: DiffLine[];
  stats: { added: number; removed: number };
} {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find operations
  type Op = { type: 'equal' | 'delete' | 'insert'; origIdx?: number; modIdx?: number };
  const ops: Op[] = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: 'equal', origIdx: i - 1, modIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'insert', modIdx: j - 1 });
      j--;
    } else if (i > 0) {
      ops.push({ type: 'delete', origIdx: i - 1 });
      i--;
    }
  }

  ops.reverse();

  // Build lines for each side
  const leftLines: DiffLine[] = [];
  const rightLines: DiffLine[] = [];
  let added = 0;
  let removed = 0;

  for (const op of ops) {
    if (op.type === 'equal') {
      const text = oldLines[op.origIdx!];
      leftLines.push({ num: op.origIdx! + 1, text, type: 'unchanged' });
      rightLines.push({ num: op.modIdx! + 1, text, type: 'unchanged' });
    } else if (op.type === 'delete') {
      const text = oldLines[op.origIdx!];
      leftLines.push({ num: op.origIdx! + 1, text, type: 'removed' });
      removed++;
    } else {
      const text = newLines[op.modIdx!];
      rightLines.push({ num: op.modIdx! + 1, text, type: 'added' });
      added++;
    }
  }

  return { leftLines, rightLines, stats: { added, removed } };
}

function EditToolDiffComponent({ content, onFileClick }: { content: string; onFileClick?: (path: string) => void }) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef<'left' | 'right' | null>(null);

  // Synchronized scroll handler
  const handleScroll = useCallback((source: 'left' | 'right') => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    // Prevent feedback loops
    if (isScrollingRef.current && isScrollingRef.current !== source) return;
    isScrollingRef.current = source;

    const sourceEl = source === 'left' ? left : right;
    const targetEl = source === 'left' ? right : left;

    // Sync both vertical and horizontal scroll
    targetEl.scrollTop = sourceEl.scrollTop;
    targetEl.scrollLeft = sourceEl.scrollLeft;

    // Reset scroll lock after animation frame
    requestAnimationFrame(() => {
      isScrollingRef.current = null;
    });
  }, []);

  // Set up scroll listeners
  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    const leftHandler = () => handleScroll('left');
    const rightHandler = () => handleScroll('right');

    left.addEventListener('scroll', leftHandler);
    right.addEventListener('scroll', rightHandler);

    return () => {
      left.removeEventListener('scroll', leftHandler);
      right.removeEventListener('scroll', rightHandler);
    };
  }, [handleScroll]);

  try {
    const input: EditToolInput = JSON.parse(content);
    const { file_path, old_string, new_string, replace_all } = input;

    if (!file_path) {
      return <pre className="output-input-content">{content}</pre>;
    }

    const fileName = file_path.split('/').pop() || file_path;
    const { leftLines, rightLines, stats } = computeSideBySideDiff(old_string || '', new_string || '');

    return (
      <div className="edit-tool-diff">
        <div className="edit-tool-header">
          <span
            className="edit-tool-file clickable"
            onClick={() => onFileClick?.(file_path)}
            title={`Open ${file_path}`}
          >
            📄 {fileName}
          </span>
          <span className="edit-tool-path">{file_path}</span>
          <div className="edit-tool-stats">
            {stats.added > 0 && <span className="edit-stat added">+{stats.added}</span>}
            {stats.removed > 0 && <span className="edit-stat removed">-{stats.removed}</span>}
          </div>
          {replace_all && <span className="edit-tool-badge">Replace All</span>}
        </div>
        <div className="edit-tool-panels">
          {/* Original (Left) */}
          <div className="edit-panel edit-panel-original">
            <div className="edit-panel-header">
              <span className="edit-panel-label">Original</span>
            </div>
            <div className="edit-panel-content" ref={leftRef}>
              {leftLines.map((line, idx) => (
                <div key={idx} className={`edit-line edit-line-${line.type}`}>
                  <span className="edit-line-num">{line.num}</span>
                  <span className="edit-line-content">{line.text || ' '}</span>
                </div>
              ))}
              {leftLines.length === 0 && (
                <div className="edit-line edit-line-empty">
                  <span className="edit-line-num">-</span>
                  <span className="edit-line-content edit-empty-text">(empty)</span>
                </div>
              )}
            </div>
          </div>

          {/* Modified (Right) */}
          <div className="edit-panel edit-panel-modified">
            <div className="edit-panel-header">
              <span className="edit-panel-label">Modified</span>
            </div>
            <div className="edit-panel-content" ref={rightRef}>
              {rightLines.map((line, idx) => (
                <div key={idx} className={`edit-line edit-line-${line.type}`}>
                  <span className="edit-line-num">{line.num}</span>
                  <span className="edit-line-content">{line.text || ' '}</span>
                </div>
              ))}
              {rightLines.length === 0 && (
                <div className="edit-line edit-line-empty">
                  <span className="edit-line-num">-</span>
                  <span className="edit-line-content edit-empty-text">(empty)</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  } catch {
    return <pre className="output-input-content">{content}</pre>;
  }
}

function renderEditToolDiff(content: string, onFileClick?: (path: string) => void): React.ReactNode {
  return <EditToolDiffComponent content={content} onFileClick={onFileClick} />;
}

// Helper to render Read tool with file link
function renderReadToolInput(content: string, onFileClick?: (path: string) => void): React.ReactNode {
  try {
    const input = JSON.parse(content);
    const { file_path, offset, limit } = input;

    if (!file_path) {
      return <pre className="output-input-content">{content}</pre>;
    }

    const fileName = file_path.split('/').pop() || file_path;

    return (
      <div className="read-tool-input">
        <span
          className="read-tool-file clickable"
          onClick={() => onFileClick?.(file_path)}
          title={`Open ${file_path}`}
        >
          📄 {fileName}
        </span>
        <span className="read-tool-path">{file_path}</span>
        {(offset !== undefined || limit !== undefined) && (
          <span className="read-tool-range">
            {offset !== undefined && `offset: ${offset}`}
            {offset !== undefined && limit !== undefined && ', '}
            {limit !== undefined && `limit: ${limit}`}
          </span>
        )}
      </div>
    );
  } catch {
    return <pre className="output-input-content">{content}</pre>;
  }
}

// Helper to render TodoWrite tool with checklist view
interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

function renderTodoWriteInput(content: string): React.ReactNode {
  try {
    const input = JSON.parse(content);
    const todos: TodoItem[] = input.todos;

    if (!Array.isArray(todos) || todos.length === 0) {
      return <pre className="output-input-content">{content}</pre>;
    }

    // Count by status
    const counts = {
      completed: todos.filter(t => t.status === 'completed').length,
      in_progress: todos.filter(t => t.status === 'in_progress').length,
      pending: todos.filter(t => t.status === 'pending').length,
    };

    return (
      <div className="todo-tool-input">
        <div className="todo-tool-header">
          <span className="todo-tool-title">📋 Task List</span>
          <div className="todo-tool-stats">
            {counts.completed > 0 && (
              <span className="todo-stat completed">✓ {counts.completed}</span>
            )}
            {counts.in_progress > 0 && (
              <span className="todo-stat in-progress">► {counts.in_progress}</span>
            )}
            {counts.pending > 0 && (
              <span className="todo-stat pending">○ {counts.pending}</span>
            )}
          </div>
        </div>
        <div className="todo-tool-list">
          {todos.map((todo, idx) => (
            <div key={idx} className={`todo-item todo-${todo.status}`}>
              <span className="todo-status-icon">
                {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '►' : '○'}
              </span>
              <span className="todo-content">{todo.content}</span>
            </div>
          ))}
        </div>
      </div>
    );
  } catch {
    return <pre className="output-input-content">{content}</pre>;
  }
}

const HistoryLine = memo(function HistoryLine({ message, highlight, simpleView, onImageClick, onFileClick }: HistoryLineProps) {
  const hideCost = useHideCost();
  const { type, content: rawContent, toolName, timestamp } = message;
  const content = filterCostText(rawContent, hideCost);

  // Format timestamp for display (HistoryMessage has ISO string timestamp)
  const timeStr = timestamp ? formatTimestamp(new Date(timestamp).getTime()) : '';

  // For user messages, parse boss context BEFORE truncation
  // The boss context can be very long, so we need to extract it first
  const parsedBoss = type === 'user' ? parseBossContext(content) : null;

  // NO TRUNCATION - show full content always
  const truncatedContent = content;

  if (type === 'tool_use') {
    const icon = TOOL_ICONS[toolName || ''] || TOOL_ICONS.default;

    // Simple view: show icon, tool name, and key parameter
    if (simpleView) {
      // Extract key parameter from the content (which contains the tool input JSON)
      const keyParam = toolName && truncatedContent ? extractToolKeyParam(toolName, truncatedContent) : null;
      return (
        <div className="output-line output-tool-use output-tool-simple">
          {timeStr && <span className="output-timestamp">{timeStr}</span>}
          <span className="output-tool-icon">{icon}</span>
          <span className="output-tool-name">{toolName}</span>
          {keyParam && <span className="output-tool-param">{keyParam}</span>}
        </div>
      );
    }

    // Special rendering for Edit tool - show diff view
    if (toolName === 'Edit' && truncatedContent) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp">{timeStr}</span>}
            <span className="output-tool-icon">{icon}</span>
            <span className="output-tool-name">{toolName}</span>
          </div>
          <div className="output-line output-tool-input">
            {renderEditToolDiff(truncatedContent, onFileClick)}
          </div>
        </>
      );
    }

    // Special rendering for Read tool - show file link
    if (toolName === 'Read' && truncatedContent) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp">{timeStr}</span>}
            <span className="output-tool-icon">{icon}</span>
            <span className="output-tool-name">{toolName}</span>
          </div>
          <div className="output-line output-tool-input">
            {renderReadToolInput(truncatedContent, onFileClick)}
          </div>
        </>
      );
    }

    // Special rendering for TodoWrite tool - show checklist
    if (toolName === 'TodoWrite' && truncatedContent) {
      return (
        <>
          <div className="output-line output-tool-use">
            {timeStr && <span className="output-timestamp">{timeStr}</span>}
            <span className="output-tool-icon">{icon}</span>
            <span className="output-tool-name">{toolName}</span>
          </div>
          <div className="output-line output-tool-input">
            {renderTodoWriteInput(truncatedContent)}
          </div>
        </>
      );
    }

    // Default tool rendering
    return (
      <>
        <div className="output-line output-tool-use">
          {timeStr && <span className="output-timestamp">{timeStr}</span>}
          <span className="output-tool-icon">{icon}</span>
          <span className="output-tool-name">{toolName}</span>
        </div>
        {truncatedContent && (
          <div className="output-line output-tool-input">
            <pre className="output-input-content">{highlightText(truncatedContent, highlight)}</pre>
          </div>
        )}
      </>
    );
  }

  if (type === 'tool_result') {
    const isError = truncatedContent.toLowerCase().includes('error') || truncatedContent.toLowerCase().includes('failed');
    return (
      <div className={`output-line output-tool-result ${isError ? 'is-error' : ''}`}>
        {timeStr && <span className="output-timestamp">{timeStr}</span>}
        <span className="output-result-icon">{isError ? '❌' : '✓'}</span>
        <pre className="output-result-content">{highlightText(truncatedContent, highlight)}</pre>
      </div>
    );
  }

  const isUser = type === 'user';
  const className = isUser ? 'history-line history-user' : 'history-line history-assistant';

  // For user messages, check for boss context (use pre-parsed result)
  if (isUser && parsedBoss) {
    // NO TRUNCATION - show full message
    const displayMessage = parsedBoss.userMessage;

    return (
      <div className={className}>
        {timeStr && <span className="output-timestamp">{timeStr}</span>}
        <span className="history-role">You</span>
        <span className="history-content markdown-content">
          {parsedBoss.hasContext && parsedBoss.context && (
            <BossContext context={parsedBoss.context} />
          )}
          {highlight ? (
            <div>{highlightText(displayMessage, highlight)}</div>
          ) : (
            renderContentWithImages(displayMessage, onImageClick)
          )}
        </span>
      </div>
    );
  }

  // For assistant messages, check for delegation blocks
  const delegationParsed = parseDelegationBlock(truncatedContent);
  if (delegationParsed.hasDelegation && delegationParsed.delegations.length > 0) {
    return (
      <div className={className}>
        {timeStr && <span className="output-timestamp">{timeStr}</span>}
        <span className="history-role">Claude</span>
        <span className="history-content markdown-content">
          {highlight ? (
            <div>{highlightText(delegationParsed.contentWithoutBlock, highlight)}</div>
          ) : (
            renderContentWithImages(delegationParsed.contentWithoutBlock, onImageClick)
          )}
          {delegationParsed.delegations.map((delegation, i) => (
            <DelegationBlock key={`del-${i}`} delegation={delegation} />
          ))}
        </span>
      </div>
    );
  }

  return (
    <div className={className}>
      {timeStr && <span className="output-timestamp">{timeStr}</span>}
      <span className="history-role">Claude</span>
      <span className="history-content markdown-content">
        {highlight ? (
          <div>{highlightText(truncatedContent, highlight)}</div>
        ) : (
          renderContentWithImages(truncatedContent, onImageClick)
        )}
      </span>
    </div>
  );
});

interface OutputLineProps {
  output: ClaudeOutput & { _toolKeyParam?: string };
  agentId: string | null;
  onImageClick?: (url: string, name: string) => void;
  onFileClick?: (path: string) => void;
}

const OutputLine = memo(function OutputLine({ output, agentId, onImageClick, onFileClick }: OutputLineProps) {
  const hideCost = useHideCost();
  const { text: rawText, isStreaming, isUserPrompt, timestamp, _toolKeyParam } = output as ClaudeOutput & { _toolKeyParam?: string };
  const text = filterCostText(rawText, hideCost);

  // Format timestamp for display
  const timeStr = formatTimestamp(timestamp || Date.now());

  // Check if this agent has a pending delegated task
  const delegation = agentId ? store.getLastDelegationReceived(agentId) : null;

  // Handle user prompts separately
  if (isUserPrompt) {
    const parsed = parseBossContext(text);

    // Check if this user prompt matches a delegated task (text matches taskCommand)
    const isDelegatedTask = delegation && text.trim() === delegation.taskCommand.trim();

    return (
      <div className="output-line output-user">
        <span className="output-timestamp">{timeStr}</span>
        {isDelegatedTask ? (
          <DelegatedTaskHeader bossName={delegation.bossName} taskCommand={delegation.taskCommand} />
        ) : (
          <>
            <span className="output-role">You</span>
            {parsed.hasContext && parsed.context && (
              <BossContext context={parsed.context} />
            )}
            {renderContentWithImages(parsed.userMessage, onImageClick)}
          </>
        )}
      </div>
    );
  }

  // Handle tool usage with nice formatting
  if (text.startsWith('Using tool:')) {
    const toolName = text.replace('Using tool:', '').trim();
    const icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;
    return (
      <div className={`output-line output-tool-use ${isStreaming ? 'output-streaming' : ''}`}>
        <span className="output-timestamp">{timeStr}</span>
        <span className="output-tool-icon">{icon}</span>
        <span className="output-tool-name">{toolName}</span>
        {_toolKeyParam && (
          <span className="output-tool-param">{_toolKeyParam}</span>
        )}
        {isStreaming && <span className="output-tool-loading">...</span>}
      </div>
    );
  }

  // Handle tool input with nice formatting
  if (text.startsWith('Tool input:')) {
    const inputText = text.replace('Tool input:', '').trim();

    // Check if it's an Edit tool input (has file_path, old_string, new_string)
    try {
      const parsed = JSON.parse(inputText);
      if (parsed.file_path && (parsed.old_string !== undefined || parsed.new_string !== undefined)) {
        // Render Edit tool with diff view
        return (
          <div className="output-line output-tool-input">
            <span className="output-timestamp">{timeStr}</span>
            {renderEditToolDiff(inputText, onFileClick)}
          </div>
        );
      }
      // Check if it's a Read tool input (has file_path but not edit fields)
      if (parsed.file_path && parsed.old_string === undefined && parsed.new_string === undefined) {
        return (
          <div className="output-line output-tool-input">
            <span className="output-timestamp">{timeStr}</span>
            {renderReadToolInput(inputText, onFileClick)}
          </div>
        );
      }
      // Check if it's a TodoWrite input (has todos array)
      if (Array.isArray(parsed.todos)) {
        return (
          <div className="output-line output-tool-input">
            <span className="output-timestamp">{timeStr}</span>
            {renderTodoWriteInput(inputText)}
          </div>
        );
      }
    } catch {
      // Not JSON, render as plain text
    }

    return (
      <div className="output-line output-tool-input">
        <span className="output-timestamp">{timeStr}</span>
        <pre className="output-input-content">{inputText}</pre>
      </div>
    );
  }

  // Handle tool result with nice formatting
  if (text.startsWith('Tool result:')) {
    const resultText = text.replace('Tool result:', '').trim();
    const isError = resultText.toLowerCase().includes('error') || resultText.toLowerCase().includes('failed');
    return (
      <div className={`output-line output-tool-result ${isError ? 'is-error' : ''}`}>
        <span className="output-timestamp">{timeStr}</span>
        <span className="output-result-icon">{isError ? '❌' : '✓'}</span>
        <pre className="output-result-content">{resultText}</pre>
      </div>
    );
  }

  // Categorize other output types
  let className = 'output-line';
  let useMarkdown = true;
  let isClaudeMessage = false;

  if (text.startsWith('Session started:') || text.startsWith('Session initialized')) {
    className += ' output-session';
    useMarkdown = false;
  } else if (text.startsWith('Tokens:') || text.startsWith('Cost:')) {
    className += ' output-stats';
    useMarkdown = false;
  } else if (text.startsWith('[thinking]')) {
    className += ' output-thinking';
    useMarkdown = false;
  } else if (text.startsWith('[raw]')) {
    className += ' output-raw';
    useMarkdown = false;
  } else {
    className += ' output-text output-claude markdown-content';
    isClaudeMessage = true;
  }

  if (isStreaming) {
    className += ' output-streaming';
  }

  // For Claude messages, check for delegation blocks
  if (isClaudeMessage && !isStreaming) {
    const parsed = parseDelegationBlock(text);
    if (parsed.hasDelegation && parsed.delegations.length > 0) {
      return (
        <div className={className}>
          <span className="output-timestamp">{timeStr}</span>
          <span className="output-role">Claude</span>
          <div className="markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{parsed.contentWithoutBlock}</ReactMarkdown>
          </div>
          {parsed.delegations.map((delegation, i) => (
            <DelegationBlock key={`del-${i}`} delegation={delegation} />
          ))}
        </div>
      );
    }
  }

  return (
    <div className={className}>
      <span className="output-timestamp">{timeStr}</span>
      {isClaudeMessage && <span className="output-role">Claude</span>}
      {useMarkdown ? (
        <div className="markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{text}</ReactMarkdown>
        </div>
      ) : text}
    </div>
  );
});

// Compact idle time format for small spaces (e.g., "2m", "1h", "3d")
function formatIdleTimeCompact(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// Guake Agent Link with live updating idle timer
interface GuakeAgentLinkProps {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
}

function GuakeAgentLink({ agent, isSelected, onClick }: GuakeAgentLinkProps) {
  const [, setTick] = useState(0);
  const config = AGENT_CLASS_CONFIG[agent.class];

  // Update timer every second when agent is idle
  useEffect(() => {
    if (agent.status === 'idle' && agent.lastActivity > 0) {
      const interval = setInterval(() => {
        setTick(t => t + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [agent.status, agent.lastActivity]);

  const showIdleTimer = agent.status === 'idle' && agent.lastActivity > 0;

  return (
    <div
      className={`guake-agent-link ${isSelected ? 'selected' : ''} ${agent.status}`}
      onClick={onClick}
      title={`${agent.name} - ${agent.status}${agent.currentTool ? ` (${agent.currentTool})` : ''}${agent.lastActivity ? ` • Idle: ${formatIdleTime(agent.lastActivity)}` : ''}${agent.lastAssignedTask ? `\n📋 ${agent.lastAssignedTask}` : ''}`}
    >
      <span className="guake-agent-link-icon">{config.icon}</span>
      <span
        className="guake-agent-link-status"
        style={{ backgroundColor: getStatusColor(agent.status) }}
      />
      {showIdleTimer && (
        <span
          className="guake-agent-link-idle"
          style={{ color: getIdleTimerColor(agent.lastActivity) }}
        >
          {formatIdleTimeCompact(agent.lastActivity)}
        </span>
      )}
      {agent.currentTool && (
        <span className="guake-agent-link-tool">
          {TOOL_ICONS[agent.currentTool] || TOOL_ICONS.default}
        </span>
      )}
    </div>
  );
}

// Permission Request Card Component
interface PermissionRequestCardProps {
  request: PermissionRequest;
  onApprove: () => void;
  onDeny: () => void;
}

function PermissionRequestCard({ request, onApprove, onDeny }: PermissionRequestCardProps) {
  const toolIcon = TOOL_ICONS[request.tool] || TOOL_ICONS.default;

  // Format tool input for display - NO TRUNCATION
  const formatToolInput = (input: Record<string, unknown>): string => {
    if (request.tool === 'Bash' && input.command) {
      return String(input.command);
    }
    if ((request.tool === 'Write' || request.tool === 'Edit' || request.tool === 'Read') && input.file_path) {
      return String(input.file_path);
    }
    if (request.tool === 'WebFetch' && input.url) {
      return String(input.url);
    }
    // Default: stringify all keys - no truncation
    const keys = Object.keys(input);
    return keys.map(k => `${k}: ${JSON.stringify(input[k])}`).join(', ');
  };

  const isPending = request.status === 'pending';
  const isApproved = request.status === 'approved';
  const isDenied = request.status === 'denied';

  return (
    <div className={`permission-request-card ${request.status}`}>
      <div className="permission-request-header">
        <span className="permission-request-icon">{toolIcon}</span>
        <span className="permission-request-tool">{request.tool}</span>
        {isPending && <span className="permission-request-badge">Waiting for approval</span>}
        {isApproved && <span className="permission-request-badge approved">Approved</span>}
        {isDenied && <span className="permission-request-badge denied">Denied</span>}
      </div>
      <div className="permission-request-details">
        <code>{formatToolInput(request.toolInput)}</code>
      </div>
      {isPending && (
        <div className="permission-request-actions">
          <button className="permission-btn permission-btn-approve" onClick={onApprove}>
            ✓ Approve
          </button>
          <button className="permission-btn permission-btn-deny" onClick={onDeny}>
            ✕ Deny
          </button>
        </div>
      )}
    </div>
  );
}

// Compact inline permission request for the bottom bar
interface PermissionRequestInlineProps {
  request: PermissionRequest;
  onApprove: (remember?: boolean) => void;
  onDeny: () => void;
}

function PermissionRequestInline({ request, onApprove, onDeny }: PermissionRequestInlineProps) {
  const toolIcon = TOOL_ICONS[request.tool] || TOOL_ICONS.default;

  // Format tool input for display - NO TRUNCATION
  const formatToolInputCompact = (input: Record<string, unknown>): string => {
    if (request.tool === 'Bash' && input.command) {
      return String(input.command); // Full command
    }
    if ((request.tool === 'Write' || request.tool === 'Edit' || request.tool === 'Read') && input.file_path) {
      return String(input.file_path); // Full path
    }
    if (request.tool === 'WebFetch' && input.url) {
      return String(input.url); // Full URL
    }
    return request.tool;
  };

  // Get remember hint text based on tool
  const getRememberHint = (): string => {
    if (request.tool === 'Write' || request.tool === 'Edit') {
      const filePath = String(request.toolInput.file_path || '');
      const dir = filePath.split('/').slice(0, -1).join('/');
      return `Remember: Allow all files in ${dir}/`;
    }
    if (request.tool === 'Bash') {
      const cmd = String(request.toolInput.command || '');
      const firstWord = cmd.split(/\s+/)[0];
      return `Remember: Allow "${firstWord}" commands`;
    }
    return `Remember: Allow all ${request.tool} operations`;
  };

  if (request.status !== 'pending') return null;

  return (
    <div className="permission-inline">
      <span className="permission-inline-icon">{toolIcon}</span>
      <span className="permission-inline-tool">{request.tool}</span>
      <span className="permission-inline-target">{formatToolInputCompact(request.toolInput)}</span>
      <button
        className="permission-inline-btn approve-remember"
        onClick={() => onApprove(true)}
        title={getRememberHint()}
      >
        ✓+
      </button>
      <button className="permission-inline-btn approve" onClick={() => onApprove(false)} title="Approve once">
        ✓
      </button>
      <button className="permission-inline-btn deny" onClick={onDeny} title="Deny">
        ✕
      </button>
    </div>
  );
}
