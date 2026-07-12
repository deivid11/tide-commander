/**
 * TerminalEmbed - Direct xterm.js terminal component
 *
 * Replaces the iframe-based ttyd embedding with a direct xterm.js instance
 * connected to ttyd's WebSocket backend. Benefits:
 * - No iframe overhead (no separate document/DOM parsing)
 * - Lazy-loaded xterm.js (only when terminal is visible)
 * - Debounced resize with @xterm/addon-fit
 * - Low scrollback for performance
 * - ttyd binary protocol handled natively
 * - Bundled Nerd Font symbols fallback so prompt/eza icons render on devices
 *   without a system Nerd Font (phones)
 * - Touch devices get a quick-keys bar (Esc/Tab/Ctrl latch/arrows/^C/zoom/
 *   paste) and pinch-to-zoom font sizing (persisted)
 */

import React, { useRef, useEffect, useCallback, useMemo, useState, memo } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { authUrl } from '../utils/storage';
import { Icon } from './Icon';
import nerdSymbolsFontUrl from '../assets/fonts/SymbolsNerdFontMono-Regular.woff2';

/** ttyd binary protocol constants (ASCII char codes) */
const CMD_OUTPUT = 48;      // '0' - server→client: terminal output
const CMD_SET_TITLE = 49;   // '1' - server→client: set title
const CMD_SET_PREFS = 50;   // '2' - server→client: set preferences
const CMD_INPUT = 48;       // '0' - client→server: terminal input
const _CMD_RESIZE = 49;     // '1' - client→server: resize

/** Dracula theme matching the ttyd config */
const DRACULA_THEME = {
  background: '#1a1a2e',
  foreground: '#f8f8f2',
  cursor: '#f8f8f2',
  cursorAccent: '#1a1a2e',
  selectionBackground: '#44475a',
  black: '#21222c',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f8f8f2',
  brightBlack: '#6272a4',
  brightRed: '#ff6e6e',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
};

interface TerminalEmbedProps {
  /** Terminal base URL, e.g. "/api/terminal/{buildingId}/" */
  terminalUrl: string;
  /** Whether this terminal is currently visible */
  visible: boolean;
}

// 'Symbols Nerd Font Mono' last so PUA icon glyphs (eza --icons, starship
// prompts, …) fall through to it on devices without a system Nerd Font
// (phones render them as tofu boxes otherwise).
const TERMINAL_FONT_FAMILY =
  "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', 'Monaco', 'Courier New', 'Symbols Nerd Font Mono', monospace";

// Lazy-loaded once, shared by every terminal instance. Resolves (never
// rejects) so a failed font fetch degrades to tofu icons, not a dead terminal.
let nerdSymbolsFontPromise: Promise<void> | null = null;
function loadNerdSymbolsFont(): Promise<void> {
  if (!nerdSymbolsFontPromise) {
    nerdSymbolsFontPromise = (async () => {
      const face = new FontFace(
        'Symbols Nerd Font Mono',
        `url(${JSON.stringify(nerdSymbolsFontUrl)}) format('woff2')`
      );
      await face.load();
      document.fonts.add(face);
    })().catch((err) => {
      log('Nerd symbols font failed to load (terminal icons may show as boxes):', err);
    });
  }
  return nerdSymbolsFontPromise;
}

const FONT_SIZE_STORAGE_KEY = 'tc-terminal-font-size';
const FONT_SIZE_DEFAULT = 13;
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 24;

function clampFontSize(px: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(px)));
}

function getStoredFontSize(): number {
  try {
    const raw = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) ? clampFontSize(parsed) : FONT_SIZE_DEFAULT;
  } catch {
    return FONT_SIZE_DEFAULT;
  }
}

/**
 * Debounce utility
 */
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => { if (timer) clearTimeout(timer); };
  return debounced as T & { cancel: () => void };
}

const log = (...args: unknown[]) => console.log('[TerminalEmbed]', ...args);

/**
 * Copy text to clipboard with fallback for environments where
 * navigator.clipboard.writeText fails (e.g. no user activation on macOS).
 */
function copyToClipboard(text: string): void {
  log('copyToClipboard called, text:', text.slice(0, 50));
  log('navigator.clipboard available:', !!navigator.clipboard);
  log('document.hasFocus:', document.hasFocus());

  // Try async clipboard API first
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => log('clipboard.writeText SUCCESS'),
      (err) => {
        log('clipboard.writeText FAILED:', err?.message || err);
        execCommandFallback(text);
      }
    );
  } else {
    log('navigator.clipboard not available, using fallback');
    execCommandFallback(text);
  }
}

function execCommandFallback(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    const ok = document.execCommand('copy');
    log('execCommand fallback:', ok ? 'SUCCESS' : 'FAILED');
  } catch (e) {
    log('execCommand fallback error', e);
  }
  document.body.removeChild(ta);
}

/**
 * Convert a dropped file:// URI to a filesystem path. Returns the input
 * unchanged if it is not a file URI.
 */
function fileUriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  try {
    // URL().pathname drops the (usually empty) host and keeps the decoded path.
    return decodeURIComponent(new URL(uri).pathname);
  } catch {
    return decodeURIComponent(uri.replace(/^file:\/\/[^/]*/, ''));
  }
}

/**
 * Extract dropped file path(s) from a drag event's dataTransfer.
 * Prefers text/uri-list (OS file managers expose the real path there as a
 * file:// URI), then text/plain, then falls back to bare file names.
 */
function extractDroppedPaths(dt: DataTransfer): string[] {
  const paths: string[] = [];

  const uriList = dt.getData('text/uri-list');
  if (uriList) {
    for (const line of uriList.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue; // '#' lines are comments
      paths.push(fileUriToPath(trimmed));
    }
  }

  if (paths.length === 0) {
    const text = dt.getData('text/plain');
    if (text) {
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) paths.push(fileUriToPath(trimmed));
      }
    }
  }

  // Last resort: the browser exposes file names but not real paths for File objects.
  if (paths.length === 0 && dt.files && dt.files.length > 0) {
    for (const file of Array.from(dt.files)) paths.push(file.name);
  }

  return paths;
}

/** Quote a path for the shell when it contains characters that need escaping. */
function shellQuotePath(p: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(p)) return p;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/** True when a drag carries files (so we should treat it as a path drop). */
function dragHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return dt.types.includes('Files') || dt.types.includes('text/uri-list');
}

const TerminalEmbed = memo(function TerminalEmbed({ terminalUrl, visible }: TerminalEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const initRef = useRef(false);
  const encoderRef = useRef(new TextEncoder());

  // Touch-device extras: quick-keys bar (Esc/Tab/Ctrl/arrows aren't reachable
  // from a soft keyboard) + pinch/button font zoom.
  const showKeyBar = useMemo(() => window.matchMedia('(pointer: coarse)').matches, []);
  const [ctrlLatched, setCtrlLatched] = useState(false);
  const ctrlLatchRef = useRef(false);

  /** Send input to ttyd via binary protocol */
  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const encoded = encoderRef.current.encode(data);
    const msg = new Uint8Array(encoded.length + 1);
    msg[0] = CMD_INPUT;
    msg.set(encoded, 1);
    ws.send(msg);
  }, []);

  /** Send resize to ttyd */
  const sendResize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send('1' + JSON.stringify({ columns: cols, rows: rows }));
  }, []);

  /** Change the terminal font size (persisted), refit and notify the pty */
  const applyFontSize = useCallback((px: number) => {
    const size = clampFontSize(px);
    try { localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(size)); } catch { /* private mode */ }
    const term = termRef.current;
    const fit = fitRef.current;
    if (term && fit && term.options.fontSize !== size) {
      term.options.fontSize = size;
      fit.fit();
      sendResize(term.cols, term.rows);
    }
    return size;
  }, [sendResize]);

  const setCtrlLatch = useCallback((on: boolean) => {
    ctrlLatchRef.current = on;
    setCtrlLatched(on);
  }, []);

  /** Arrow keys honor DECCKM (application cursor keys) so TUIs behave */
  const sendArrow = useCallback((dir: 'A' | 'B' | 'C' | 'D') => {
    const app = termRef.current?.modes.applicationCursorKeysMode;
    sendInput((app ? '\x1bO' : '\x1b[') + dir);
  }, [sendInput]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) termRef.current?.paste(text);
    } catch (err) {
      log('clipboard read failed:', err);
    }
  }, []);

  /** Initialize terminal when visible */
  useEffect(() => {
    log('useEffect fired', { visible, init: initRef.current, hasContainer: !!containerRef.current, terminalUrl });
    if (!visible || initRef.current || !containerRef.current) return;
    initRef.current = true;

    // File drop → insert the dropped path(s) into the shell, like a normal
    // terminal. Capture-phase listeners on the container intercept the drop
    // before xterm's internal handlers and before the event can bubble up to
    // the Guake panel's file-upload handler, so dropping on the shell terminal
    // types the path instead of attaching the file to the agent.
    const dropEl = containerRef.current;
    const handleDropDragOver = (ev: DragEvent) => {
      if (!dragHasFiles(ev.dataTransfer)) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    };
    const handleFileDrop = (ev: DragEvent) => {
      if (!ev.dataTransfer) return;
      const paths = extractDroppedPaths(ev.dataTransfer);
      if (paths.length === 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      sendInput(paths.map(shellQuotePath).join(' ') + ' ');
      termRef.current?.focus();
    };
    dropEl.addEventListener('dragenter', handleDropDragOver, true);
    dropEl.addEventListener('dragover', handleDropDragOver, true);
    dropEl.addEventListener('drop', handleFileDrop, true);

    // Two-finger pinch → terminal font zoom (mobile). Native non-passive
    // listeners because React's root touchmove handlers can't preventDefault.
    let pinchStart: { dist: number; fontSize: number } | null = null;
    const touchDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const handleTouchStart = (ev: TouchEvent) => {
      if (ev.touches.length !== 2) { pinchStart = null; return; }
      pinchStart = {
        dist: touchDist(ev.touches),
        fontSize: termRef.current?.options.fontSize ?? getStoredFontSize(),
      };
    };
    const handleTouchMove = (ev: TouchEvent) => {
      if (!pinchStart || ev.touches.length !== 2) return;
      ev.preventDefault(); // keep the browser from page-zooming instead
      applyFontSize(pinchStart.fontSize * (touchDist(ev.touches) / pinchStart.dist));
    };
    const handleTouchEnd = () => { pinchStart = null; };
    dropEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    dropEl.addEventListener('touchmove', handleTouchMove, { passive: false });
    dropEl.addEventListener('touchend', handleTouchEnd, { passive: true });
    dropEl.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    let destroyed = false;
    let term: Terminal | null = null;
    let fit: FitAddon | null = null;
    let ws: WebSocket | null = null;
    let debouncedFit: ReturnType<typeof debounce> | null = null;
    let resizeObs: ResizeObserver | null = null;
    let handleContextMenu: ((e: Event) => void) | null = null;

    (async () => {
      log('Lazy-loading xterm.js modules...');
      // Lazy-load xterm.js and addons in parallel (+ the Nerd Font symbols so
      // icon glyphs measure correctly from the first render)
      const [xtermMod, fitMod, clipboardMod, webLinksMod] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-clipboard'),
        import('@xterm/addon-web-links'),
        loadNerdSymbolsFont(),
      ]);

      if (destroyed) { log('Destroyed after module load, aborting'); return; }

      // Also load the CSS (vite handles this)
      await import('@xterm/xterm/css/xterm.css');
      log('Modules loaded, xterm exports:', Object.keys(xtermMod));

      if (destroyed || !containerRef.current) return;

      // Create terminal with performance-tuned settings
      const Terminal = xtermMod.Terminal;
      const FitAddon = fitMod.FitAddon;
      const ClipboardAddon = clipboardMod.ClipboardAddon;
      const WebLinksAddon = webLinksMod.WebLinksAddon;

      term = new Terminal({
        theme: DRACULA_THEME,
        fontSize: getStoredFontSize(),
        scrollback: 5000,
        fontFamily: TERMINAL_FONT_FAMILY,
        cursorBlink: true,
        allowProposedApi: true,
        disableStdin: false,
        rightClickSelectsWord: false,
      });
      termRef.current = term;

      fit = new FitAddon();
      fitRef.current = fit;
      term.loadAddon(fit);

      // Clipboard addon for system clipboard copy/paste
      term.loadAddon(new ClipboardAddon());

      // Web links addon for clickable URLs
      term.loadAddon(new WebLinksAddon());

      // Custom key handler: let browser handle copy/paste instead of terminal
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        // Ctrl+C with active selection → copy (let browser handle)
        if (e.ctrlKey && e.key === 'c' && term!.hasSelection()) return false;
        // Ctrl+V → paste (let browser handle)
        if (e.ctrlKey && e.key === 'v') return false;
        // Ctrl+Shift+C → always copy
        if (e.ctrlKey && e.shiftKey && e.key === 'C') return false;
        // Ctrl+Shift+V → always paste
        if (e.ctrlKey && e.shiftKey && e.key === 'V') return false;
        return true;
      });

      // Open terminal on container (only when visible to avoid wasted layout work)
      const containerRect = containerRef.current.getBoundingClientRect();
      log('Container dimensions before open:', { w: containerRect.width, h: containerRect.height });
      term.open(containerRef.current);
      fit.fit();
      log('Terminal opened, cols:', term.cols, 'rows:', term.rows);

      // Selection behavior:
      // With tmux mouse mode active, hold Shift+click+drag to use xterm.js native selection.
      // xterm.js handles auto-scroll at viewport edges natively when Shift is held.
      // Without tmux (direct shell), click+drag works normally.

      // Copy selection to clipboard via xterm's onSelectionChange
      // (for Shift+click native xterm.js selection)
      term.onSelectionChange(() => {
        log('>>> onSelectionChange FIRED', { hasSelection: term!.hasSelection() });
        const text = term!.hasSelection() ? term!.getSelection() : '';
        if (!text) return;
        log('onSelectionChange copying text:', text.slice(0, 50));
        copyToClipboard(text);
      });

      // Log mouse events on the terminal container to diagnose trackpad selection issues
      containerRef.current.addEventListener('mousedown', (e) => {
        log('mousedown', { button: e.button, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
      });
      containerRef.current.addEventListener('mouseup', (e) => {
        log('mouseup', { button: e.button, shiftKey: e.shiftKey, hasSel: term!.hasSelection() });
      });

      // Handle OSC 52 clipboard sequences from tmux
      // When tmux copies text (yellow selection), it sends OSC 52 with base64-encoded text
      log('Registering OSC 52 handler');
      term.parser.registerOscHandler(52, (data: string) => {
        log('>>> OSC 52 received', { dataLength: data.length, data: data.slice(0, 80) });
        const parts = data.split(';');
        const b64 = parts.length > 1 ? parts.slice(1).join(';') : parts[0];
        if (b64) {
          try {
            // Decode base64 as UTF-8 (atob only handles Latin-1, corrupts multi-byte chars like ❯)
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const text = new TextDecoder().decode(bytes);
            log('OSC 52 decoded:', text.slice(0, 50));
            copyToClipboard(text);
          } catch { /* invalid base64 */ }
        }
        return false;
      });

      // Prevent browser context menu natively (not via React synthetic events
      // which can interfere with clipboard user activation)
      handleContextMenu = (e: Event) => e.preventDefault();
      containerRef.current.addEventListener('contextmenu', handleContextMenu);


      // Handle input → ttyd. When the key bar's Ctrl latch is armed, the next
      // single soft-keyboard character is converted to its control code
      // (a → ^A) — phones have no physical Ctrl key.
      term.onData((data) => {
        if (ctrlLatchRef.current && data.length === 1) {
          setCtrlLatch(false);
          const code = data.toUpperCase().charCodeAt(0);
          if (code >= 0x40 && code <= 0x5f) { // @ A-Z [ \ ] ^ _
            sendInput(String.fromCharCode(code & 0x1f));
            return;
          }
        }
        sendInput(data);
      });

      // Handle binary input (for paste, etc.)
      term.onBinary((data) => {
        const ws2 = wsRef.current;
        if (!ws2 || ws2.readyState !== WebSocket.OPEN) return;
        const bytes = new Uint8Array(data.length + 1);
        bytes[0] = CMD_INPUT;
        for (let i = 0; i < data.length; i++) bytes[i + 1] = data.charCodeAt(i);
        ws2.send(bytes);
      });

      // Debounced fit on resize
      debouncedFit = debounce(() => {
        if (fit && term) {
          fit.fit();
          sendResize(term.cols, term.rows);
        }
      }, 100);

      // ResizeObserver for container size changes
      resizeObs = new ResizeObserver(() => debouncedFit!());
      resizeObs.observe(containerRef.current);

      // Fetch ttyd's credential token before connecting WebSocket
      const basePath = terminalUrl.endsWith('/') ? terminalUrl.slice(0, -1) : terminalUrl;
      const tokenUrl = authUrl(`${basePath}/token`);
      log('Fetching ttyd token from:', tokenUrl);
      let ttydToken = '';
      try {
        const tokenRes = await fetch(tokenUrl);
        log('Token response status:', tokenRes.status, 'content-type:', tokenRes.headers.get('content-type'));
        if (tokenRes.ok) {
          const tokenText = await tokenRes.text();
          log('Token raw response:', tokenText);
          try {
            const tokenData = JSON.parse(tokenText);
            ttydToken = tokenData.token || '';
          } catch {
            // Some ttyd versions return plain text token
            ttydToken = tokenText.trim();
          }
          log('Parsed ttyd token:', ttydToken ? (ttydToken.slice(0, 16) + '...') : '(empty)');
        } else {
          log('Token fetch failed:', tokenRes.status, tokenRes.statusText);
        }
      } catch (err) {
        log('Token fetch error:', err);
      }

      if (destroyed) return;

      // Connect WebSocket to ttyd
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsPath = authUrl(`${basePath}/ws`);
      const wsUrl = `${wsProtocol}//${window.location.host}${wsPath}`;
      log('Connecting WebSocket to:', wsUrl);

      ws = new WebSocket(wsUrl, ['tty']);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        log('WebSocket OPEN');
        // ttyd requires an initialization JSON message sent as binary (Uint8Array)
        if (term && fit) {
          fit.fit();
          const initMsg = JSON.stringify({
            AuthToken: ttydToken,
            columns: term.cols,
            rows: term.rows,
          });
          log('Sending init message (as binary):', initMsg);
          ws!.send(encoderRef.current.encode(initMsg));
        }
      };

      let msgCount = 0;
      ws.onmessage = (event) => {
        if (!term) return;
        msgCount++;
        if (msgCount <= 5) {
          const dataType = event.data instanceof ArrayBuffer ? 'ArrayBuffer' : typeof event.data;
          const size = event.data instanceof ArrayBuffer ? event.data.byteLength : (event.data as string).length;
          log(`WS message #${msgCount}: type=${dataType} size=${size}`);
          if (event.data instanceof ArrayBuffer) {
            const preview = new Uint8Array(event.data).slice(0, 20);
            log(`  First bytes: [${Array.from(preview).join(', ')}]`);
          }
        }

        if (event.data instanceof ArrayBuffer) {
          const data = new Uint8Array(event.data);
          if (data.length < 1) return;
          const cmd = data[0];
          if (cmd === CMD_OUTPUT) {
            // Terminal output - write directly (batched by ttyd)
            term.write(data.subarray(1));
          } else if (cmd === CMD_SET_TITLE) {
            log('Received SET_TITLE');
          } else if (cmd === CMD_SET_PREFS) {
            log('Received SET_PREFS:', new TextDecoder().decode(data.subarray(1)));
          } else {
            log('Unknown binary cmd:', cmd, 'char:', String.fromCharCode(cmd));
          }
        } else if (typeof event.data === 'string') {
          // String messages (some ttyd versions)
          if (msgCount <= 5) log('String message, first char code:', event.data.charCodeAt(0));
          const cmd = event.data.charCodeAt(0);
          if (cmd === CMD_OUTPUT) {
            term.write(event.data.slice(1));
          }
        }
      };

      ws.onclose = (ev) => {
        log('WebSocket CLOSED, code:', ev.code, 'reason:', ev.reason, 'wasClean:', ev.wasClean, 'totalMessages:', msgCount);
        if (term && !destroyed) {
          term.write('\r\n\x1b[90m[Terminal disconnected]\x1b[0m\r\n');
        }
      };

      ws.onerror = (ev) => {
        log('WebSocket ERROR:', ev);
      };

      // Handle resize from terminal (e.g. font size change)
      term.onResize(({ cols, rows }) => sendResize(cols, rows));
    })();

    return () => {
      destroyed = true;
      initRef.current = false;
      debouncedFit?.cancel();
      resizeObs?.disconnect();
      dropEl.removeEventListener('dragenter', handleDropDragOver, true);
      dropEl.removeEventListener('dragover', handleDropDragOver, true);
      dropEl.removeEventListener('drop', handleFileDrop, true);
      dropEl.removeEventListener('touchstart', handleTouchStart);
      dropEl.removeEventListener('touchmove', handleTouchMove);
      dropEl.removeEventListener('touchend', handleTouchEnd);
      dropEl.removeEventListener('touchcancel', handleTouchEnd);
      if (handleContextMenu) containerRef.current?.removeEventListener('contextmenu', handleContextMenu);
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
      wsRef.current = null;
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [visible, terminalUrl, sendInput, sendResize, applyFontSize, setCtrlLatch]);

  // Re-fit when visibility changes
  useEffect(() => {
    if (visible && fitRef.current && termRef.current) {
      // Defer fit to next frame to ensure container has correct dimensions
      requestAnimationFrame(() => {
        fitRef.current?.fit();
        if (termRef.current) {
          sendResize(termRef.current.cols, termRef.current.rows);
        }
      });
    }
  }, [visible, sendResize]);

  // Prevent key-bar taps from stealing focus (keeps xterm's hidden textarea
  // focused so the soft keyboard stays open).
  const keepFocus = useCallback((e: React.PointerEvent | React.MouseEvent) => e.preventDefault(), []);

  return (
    <div
      className="guake-bottom-terminal-embed"
      style={{ display: visible ? undefined : 'none' }}
    >
      <div ref={containerRef} className="terminal-embed-mount" />
      {showKeyBar && (
        <div className="terminal-key-bar">
          <button className="terminal-key-btn" onPointerDown={keepFocus} onClick={() => sendInput('\x1b')} title="Escape">Esc</button>
          <button className="terminal-key-btn" onPointerDown={keepFocus} onClick={() => sendInput('\t')} title="Tab">Tab</button>
          <button
            className={`terminal-key-btn ${ctrlLatched ? 'latched' : ''}`}
            onPointerDown={keepFocus}
            onClick={() => setCtrlLatch(!ctrlLatchRef.current)}
            title="Ctrl — arms the next typed key as a control key"
          >
            Ctrl
          </button>
          <button className="terminal-key-btn" onPointerDown={keepFocus} onClick={() => sendInput('\x03')} title="Interrupt (Ctrl+C)">^C</button>
          <button className="terminal-key-btn" onPointerDown={keepFocus} onClick={() => sendArrow('D')} title="Left">←</button>
          <button className="terminal-key-btn" onPointerDown={keepFocus} onClick={() => sendArrow('B')} title="Down">↓</button>
          <button className="terminal-key-btn" onPointerDown={keepFocus} onClick={() => sendArrow('A')} title="Up">↑</button>
          <button className="terminal-key-btn" onPointerDown={keepFocus} onClick={() => sendArrow('C')} title="Right">→</button>
          <button
            className="terminal-key-btn"
            onPointerDown={keepFocus}
            onClick={() => applyFontSize((termRef.current?.options.fontSize ?? FONT_SIZE_DEFAULT) - 1)}
            title="Smaller text"
          >
            A−
          </button>
          <button
            className="terminal-key-btn"
            onPointerDown={keepFocus}
            onClick={() => applyFontSize((termRef.current?.options.fontSize ?? FONT_SIZE_DEFAULT) + 1)}
            title="Larger text"
          >
            A+
          </button>
          <button className="terminal-key-btn" onPointerDown={keepFocus} onClick={pasteFromClipboard} title="Paste from clipboard">
            <Icon name="clipboard" size={14} />
          </button>
        </div>
      )}
    </div>
  );
});

export default TerminalEmbed;
