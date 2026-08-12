'use client';

import { useEffect, useRef, useState } from 'react';
import { useTerminalSession } from '@/hooks/useTerminalSession';
// Type-only, so it is erased at compile time and doesn't pull xterm into the
// SSR bundle — the runtime import below stays dynamic.
import type { ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  sessionId: string;
  className?: string;
  rows?: number;
  cols?: number;
  fontSize?: number;
  onClose?: () => void;
}

/**
 * xterm.js terminal component with WebSocket integration
 *
 * Lazily imports xterm packages to avoid SSR issues. Applies theme from
 * CSS variables (--qt-terminal-bg, --qt-terminal-fg, etc).
 * Manages ResizeObserver for responsive resizing.
 */
export function Terminal({
  sessionId,
  className = '',
  rows = 24,
  cols = 80,
  fontSize = 13,
  onClose,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const initStartedRef = useRef(false);

  const session = useTerminalSession(sessionId);
  const [initialized, setInitialized] = useState(false);

  // Keep a ref to the latest session so closures inside long-lived xterm
  // listeners always reach the current callbacks.
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Initialize xterm on mount (lazy import to avoid SSR).
  // Ref-guarded so React StrictMode's double-invoke (and any in-flight render)
  // can't double-attach two xterm instances into the same container.
  useEffect(() => {
    if (initStartedRef.current || !containerRef.current) {
      return;
    }
    initStartedRef.current = true;

    let cancelled = false;
    let createdTerm: any = null;
    let createdObserver: ResizeObserver | null = null;

    (async () => {
      const { Terminal: XTermTerminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');
      const { SerializeAddon } = await import('@xterm/addon-serialize');

      if (cancelled || !containerRef.current) return;

      const theme = getTerminalTheme();

      const term = new XTermTerminal({
        rows,
        cols,
        fontSize,
        theme,
        scrollback: 1000,
        rightClickSelectsWord: true,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      const serializeAddon = new SerializeAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.loadAddon(serializeAddon);

      // xterm 6 removed the canvas renderer, and @xterm/addon-canvas was
      // retired with it (its last release still peers on xterm ^5). The DOM
      // renderer is the supported default now.

      if (cancelled || !containerRef.current) {
        try { term.dispose(); } catch { /* noop */ }
        return;
      }

      term.open(containerRef.current);
      try { fitAddon.fit(); } catch { /* noop */ }
      try { term.focus(); } catch { /* noop */ }

      termRef.current = term;
      fitAddonRef.current = fitAddon;
      createdTerm = term;

      // Setup ResizeObserver for responsive fitting. We avoid closing over
      // `session` here so its identity changes don't matter; the resize call
      // routes through the latest send via the ref-stable callback.
      const observer = new ResizeObserver(() => {
        if (fitAddonRef.current && termRef.current) {
          try {
            fitAddonRef.current.fit();
            sessionRef.current?.resize(termRef.current.cols, termRef.current.rows);
          } catch {
            // Ignore resize errors during layout thrashing
          }
        }
      });
      observer.observe(containerRef.current);
      resizeObserverRef.current = observer;
      createdObserver = observer;

      setInitialized(true);
    })().catch(() => {
      // Swallow init errors — the next mount can retry by clearing the ref
      initStartedRef.current = false;
    });

    return () => {
      cancelled = true;
      if (createdObserver) {
        try { createdObserver.disconnect(); } catch { /* noop */ }
      }
      if (createdTerm) {
        try { createdTerm.dispose(); } catch { /* noop */ }
      }
      if (resizeObserverRef.current === createdObserver) {
        resizeObserverRef.current = null;
      }
      if (termRef.current === createdTerm) {
        termRef.current = null;
      }
      initStartedRef.current = false;
    };
  }, [rows, cols, fontSize]);

  // Wire session output → terminal. Stable: reads the live session via ref.
  useEffect(() => {
    if (!initialized || !termRef.current) return;

    const unsubscribe = sessionRef.current.onData((chunk) => {
      termRef.current?.write(chunk);
    });

    return unsubscribe;
  }, [initialized]);

  // Wire xterm input → session. Stable: reads the live session via ref.
  useEffect(() => {
    if (!initialized || !termRef.current) return;

    const disposable = termRef.current.onData((data: string) => {
      sessionRef.current.send(data);
    });

    return () => {
      try { disposable.dispose(); } catch { /* noop */ }
    };
  }, [initialized]);

  // Refocus xterm once we know it's live so the user can type without an
  // extra click after the prompt streams in.
  useEffect(() => {
    if (initialized && session.state === 'live' && termRef.current) {
      try { termRef.current.focus(); } catch { /* noop */ }
    }
  }, [initialized, session.state]);

  // Handle session exit
  useEffect(() => {
    if (session.state !== 'exited' || !termRef.current) {
      return;
    }

    const code = session.exitInfo?.code ?? 'unknown';
    const signal = session.exitInfo?.signal;
    const line = signal ? `\r\n[session ended — signal ${signal}]\r\n` : `\r\n[session ended — exit code ${code}]\r\n`;

    termRef.current.write(line);

    // Disable input after exit. This used to poke at `_input`, which is not an
    // xterm field in any version — the guard always short-circuited, so exited
    // sessions stayed typeable. `textarea` is the documented handle.
    const textarea = termRef.current.textarea as HTMLTextAreaElement | undefined;
    if (textarea) {
      textarea.disabled = true;
    }
  }, [session.state, session.exitInfo]);

  return (
    <div className={`relative qt-terminal-surface ${className}`}>
      <div
        ref={containerRef}
        className="w-full h-full"
        data-testid="terminal-container"
      />

      {session.state === 'exited' && onClose && (
        <div className="qt-terminal-closed-badge">
          Closed
        </div>
      )}
    </div>
  );
}

// The ITheme annotation is load-bearing. Without it the returned object is
// inferred, assigned to a variable, and only then handed to the Terminal
// constructor — and TypeScript skips excess-property checks on variables. That
// is how the pre-6.0 `selection` key survived here silently after xterm renamed
// it. Annotating the return type makes any unknown key a build error.
function getTerminalTheme(): ITheme {
  if (typeof document === 'undefined') {
    // SSR fallback
    return {};
  }

  const root = document.documentElement;
  const style = getComputedStyle(root);

  const getColor = (variable: string): string => {
    const val = style.getPropertyValue(variable).trim();
    return val || '#000000';
  };

  // Optional keys must stay undefined when a theme doesn't set them: xterm
  // derives sensible values from our themed background/foreground (the slider
  // colors default to foreground at 20/40/50% opacity), whereas getColor's
  // black fallback would paint them a hard #000.
  const optionalColor = (variable: string): string | undefined => {
    return style.getPropertyValue(variable).trim() || undefined;
  };

  return {
    background: getColor('--qt-terminal-bg'),
    foreground: getColor('--qt-terminal-fg'),
    cursor: getColor('--qt-terminal-cursor'),
    // xterm 6 renamed `selection` to `selectionBackground`. The old key is
    // silently ignored, which drops every theme's selection color.
    selectionBackground: getColor('--qt-terminal-selection'),
    cursorAccent: optionalColor('--qt-terminal-cursor-accent'),
    selectionForeground: optionalColor('--qt-terminal-selection-fg'),
    selectionInactiveBackground: optionalColor('--qt-terminal-selection-inactive'),
    scrollbarSliderBackground: optionalColor('--qt-terminal-scrollbar'),
    scrollbarSliderHoverBackground: optionalColor('--qt-terminal-scrollbar-hover'),
    scrollbarSliderActiveBackground: optionalColor('--qt-terminal-scrollbar-active'),
    black: getColor('--qt-terminal-ansi-black'),
    red: getColor('--qt-terminal-ansi-red'),
    green: getColor('--qt-terminal-ansi-green'),
    yellow: getColor('--qt-terminal-ansi-yellow'),
    blue: getColor('--qt-terminal-ansi-blue'),
    magenta: getColor('--qt-terminal-ansi-magenta'),
    cyan: getColor('--qt-terminal-ansi-cyan'),
    white: getColor('--qt-terminal-ansi-white'),
    brightBlack: getColor('--qt-terminal-ansi-bright-black'),
    brightRed: getColor('--qt-terminal-ansi-bright-red'),
    brightGreen: getColor('--qt-terminal-ansi-bright-green'),
    brightYellow: getColor('--qt-terminal-ansi-bright-yellow'),
    brightBlue: getColor('--qt-terminal-ansi-bright-blue'),
    brightMagenta: getColor('--qt-terminal-ansi-bright-magenta'),
    brightCyan: getColor('--qt-terminal-ansi-bright-cyan'),
    brightWhite: getColor('--qt-terminal-ansi-bright-white'),
  };
}

