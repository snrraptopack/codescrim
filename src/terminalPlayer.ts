import * as vscode from 'vscode';
import { TerminalEvent } from './types';

const REPLAY_BANNER =
  '\x1b[90m[CodeScrim] Tutorial terminal replay — read-only\x1b[0m\r\n';

interface PtySession {
  writeEmitter: vscode.EventEmitter<string>;
  closeEmitter: vscode.EventEmitter<number | void>;
  terminal: vscode.Terminal;
  name: string;
  /** Concatenation of all data written so far — used to replay to a seek point */
  cumulativeData: string;
}

interface TerminalReplayState {
  name: string;
  cumulativeData: string;
  isOpen: boolean;
  openOrder: number;
}

/**
 * Replays recorded terminal events by creating read-only Pseudo-Terminals.
 *
 * Each recorded terminal gets its own `▶ <name>` PTY panel in the editor.
 * The terminal is read-only from the user's perspective (they cannot type in
 * it); all content is driven by the playback engine.
 */
export class TerminalPlayer implements vscode.Disposable {
  private sessions = new Map<number, PtySession>();

  // ── playback API ──────────────────────────────────────────────────────────

  /**
   * Rebuild all terminal state from scratch for a seek/scrub to `time`.
   * Reconciles the active PTY sessions and redraws their contents to match
   * the cumulative output up to `time`.
   */
  syncToTime(events: TerminalEvent[], time: number): void {
    const states = new Map<number, TerminalReplayState>();
    let openOrder = 0;

    for (const event of events) {
      if (event.timestamp > time) {
        break;
      }

      if (event.type === 'terminalOpen') {
        states.set(event.terminalId, {
          name: event.name,
          cumulativeData: '',
          isOpen: true,
          openOrder: openOrder++,
        });
        continue;
      }

      if (event.type === 'terminal') {
        const state = states.get(event.terminalId);
        if (state?.isOpen) {
          state.cumulativeData += event.data;
        }
        continue;
      }

      const state = states.get(event.terminalId);
      if (state) {
        state.isOpen = false;
      }
    }

    const openStates = [...states.entries()]
      .filter(([, state]) => state.isOpen)
      .sort((a, b) => a[1].openOrder - b[1].openOrder);

    const openIds = new Set(openStates.map(([terminalId]) => terminalId));

    for (const [terminalId] of this.sessions) {
      if (!openIds.has(terminalId)) {
        this.disposeSession(terminalId);
      }
    }

    for (const [terminalId, state] of openStates) {
      const session = this.sessions.get(terminalId) ?? this.createSession(terminalId, state.name);
      this.renderSession(session, state.cumulativeData);
    }
  }

  /**
   * Apply a single terminal event incrementally during normal playback.
   * No-op for event types that aren't terminal-related.
   */
  applyEvent(ev: TerminalEvent): void {
    if (ev.type === 'terminalOpen') {
      if (!this.sessions.has(ev.terminalId)) {
        this.createSession(ev.terminalId, ev.name);
      }
    } else if (ev.type === 'terminal') {
      const session = this.sessions.get(ev.terminalId);
      if (session) {
        session.writeEmitter.fire(ev.data);
        session.cumulativeData += ev.data;
      }
    } else if (ev.type === 'terminalClose') {
      this.disposeSession(ev.terminalId);
    }
  }

  reset(): void {
    this.disposeAllSessions();
  }

  dispose(): void {
    this.disposeAllSessions();
  }

  // ── private helpers ───────────────────────────────────────────────────────

  private createSession(id: number, name: string): PtySession {
    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<number | void>();

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      onDidClose: closeEmitter.event,
      open: () => {},
      close: () => {
        this.sessions.delete(id);
      },
    };

    const terminal = vscode.window.createTerminal({
      name: `CodeScrim ▶ ${name}`,
      location: vscode.TerminalLocation.Panel,
      pty,
    });
    terminal.show(true);

    const session: PtySession = {
      writeEmitter,
      closeEmitter,
      terminal,
      name,
      cumulativeData: '',
    };
    this.sessions.set(id, session);
    this.renderSession(session, '');
    return session;
  }

  private renderSession(session: PtySession, data: string): void {
    session.writeEmitter.fire('\x1b[2J\x1b[3J\x1b[H');
    session.writeEmitter.fire(REPLAY_BANNER);
    if (data) {
      session.writeEmitter.fire(data);
    }
    session.cumulativeData = data;
  }

  private disposeSession(id: number): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }

    try {
      session.closeEmitter.fire();
      session.writeEmitter.dispose();
      session.closeEmitter.dispose();
      session.terminal.dispose();
    } catch {
      /* ignore */
    }

    this.sessions.delete(id);
  }

  private disposeAllSessions(): void {
    for (const id of [...this.sessions.keys()]) {
      this.disposeSession(id);
    }
  }
}
