import * as vscode from 'vscode';
import { TerminalEvent } from './types';

interface PtySession {
  writeEmitter: vscode.EventEmitter<string>;
  closeEmitter: vscode.EventEmitter<number | void>;
  terminal: vscode.Terminal;
  /** Concatenation of all data written so far — used to replay to a seek point */
  cumulativeData: string;
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
   * Closes every existing PTY session first, then recreates them with the
   * cumulative output up to `time`.
   */
  syncToTime(events: TerminalEvent[], time: number): void {
    this.disposeAllSessions();

    // Re-create each terminal that was open at or before `time`
    const opens = events.filter(
      (e) => e.type === 'terminalOpen' && e.timestamp <= time,
    ) as Extract<TerminalEvent, { type: 'terminalOpen' }>[];

    for (const open of opens) {
      const session = this.createSession(open.terminalId, open.name);

      // Replay all output for this terminal up to `time`
      const dataEvents = events.filter(
        (e) =>
          e.type === 'terminal' &&
          (e as Extract<TerminalEvent, { type: 'terminal' }>).terminalId ===
            open.terminalId &&
          e.timestamp <= time,
      ) as Extract<TerminalEvent, { type: 'terminal' }>[];

      const combined = dataEvents.map((e) => e.data).join('');
      if (combined) {
        session.writeEmitter.fire(combined);
        session.cumulativeData = combined;
      }
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
      const session = this.sessions.get(ev.terminalId);
      if (session) {
        session.closeEmitter.fire();
        this.sessions.delete(ev.terminalId);
      }
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
      open: () => {
        writeEmitter.fire(
          '\x1b[90m[CodeScrim] Terminal replay — read-only\x1b[0m\r\n',
        );
      },
      close: () => {
        this.sessions.delete(id);
      },
    };

    const terminal = vscode.window.createTerminal({
      name: `▶ ${name}`,
      pty,
    });

    const session: PtySession = {
      writeEmitter,
      closeEmitter,
      terminal,
      cumulativeData: '',
    };
    this.sessions.set(id, session);
    return session;
  }

  private disposeAllSessions(): void {
    for (const session of this.sessions.values()) {
      try {
        session.writeEmitter.dispose();
        session.closeEmitter.dispose();
        session.terminal.dispose();
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear();
  }
}
