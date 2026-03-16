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
 */

import React, { useRef, useEffect, useCallback, memo } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { authUrl } from '../utils/storage';

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

const TerminalEmbed = memo(function TerminalEmbed({ terminalUrl, visible }: TerminalEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const initRef = useRef(false);
  const encoderRef = useRef(new TextEncoder());

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

  /** Initialize terminal when visible */
  useEffect(() => {
    log('useEffect fired', { visible, init: initRef.current, hasContainer: !!containerRef.current, terminalUrl });
    if (!visible || initRef.current || !containerRef.current) return;
    initRef.current = true;

    let destroyed = false;
    let term: Terminal | null = null;
    let fit: FitAddon | null = null;
    let ws: WebSocket | null = null;
    let debouncedFit: ReturnType<typeof debounce> | null = null;
    let resizeObs: ResizeObserver | null = null;
    let handleContextMenu: ((e: Event) => void) | null = null;

    (async () => {
      log('Lazy-loading xterm.js modules...');
      // Lazy-load xterm.js and addons in parallel
      const [xtermMod, fitMod, clipboardMod, webLinksMod] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-clipboard'),
        import('@xterm/addon-web-links'),
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
        fontSize: 13,
        scrollback: 5000,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', 'Monaco', 'Courier New', monospace",
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
        const text = term!.hasSelection() ? term!.getSelection() : '';
        if (!text) return;
        navigator.clipboard.writeText(text).catch(() => {});
      });

      // Handle OSC 52 clipboard sequences from tmux
      // When tmux copies text (yellow selection), it sends OSC 52 with base64-encoded text
      term.parser.registerOscHandler(52, (data: string) => {
        const parts = data.split(';');
        const b64 = parts.length > 1 ? parts.slice(1).join(';') : parts[0];
        if (b64) {
          try {
            // Decode base64 as UTF-8 (atob only handles Latin-1, corrupts multi-byte chars like ❯)
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const text = new TextDecoder().decode(bytes);
            navigator.clipboard.writeText(text).catch(() => {});
          } catch { /* invalid base64 */ }
        }
        return false;
      });

      // Prevent browser context menu natively (not via React synthetic events
      // which can interfere with clipboard user activation)
      handleContextMenu = (e: Event) => e.preventDefault();
      containerRef.current.addEventListener('contextmenu', handleContextMenu);


      // Handle input → ttyd
      term.onData((data) => sendInput(data));

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
      if (handleContextMenu) containerRef.current?.removeEventListener('contextmenu', handleContextMenu);
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
      wsRef.current = null;
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [visible, terminalUrl, sendInput, sendResize]);

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

  return (
    <div
      ref={containerRef}
      className="guake-bottom-terminal-embed"
      style={{ display: visible ? undefined : 'none' }}
    />
  );
});

export default TerminalEmbed;
