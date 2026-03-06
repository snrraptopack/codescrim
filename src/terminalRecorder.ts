import * as vscode from 'vscode';
import { TerminalEvent } from './types';

/**
 * Captures terminal I/O events during a recording session.
 *
 * Uses `vscode.window.onDidWriteTerminalData` (stable since VS Code 1.87).
 * On older versions the API silently falls back to no-op so the extension
 * continues to work — just without terminal capture.
 *
 * Already-open terminals at `start()` time are recorded as `terminalOpen`
 * events at timestamp 0.
 */
export class TerminalRecorder implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private events: TerminalEvent[] = [];
  private getTimestamp: (() => number) | undefined;
  private terminalIds = new Map<vscode.Terminal, number>();
  private nextId = 1;

  /** Whether the host VS Code supports terminal data capture. */
  static get isSupported(): boolean {
    return typeof (vscode.window as any).onDidWriteTerminalData === 'function';
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  start(getTimestamp: () => number): void {
    this.getTimestamp = getTimestamp;
    this.events = [];
    this.terminalIds = new Map();
    this.nextId = 1;

    const api = vscode.window as any;

    // Snapshot already-open terminals as timestamp-0 open events
    for (const term of vscode.window.terminals) {
      this.events.push({
        type: 'terminalOpen',
        timestamp: 0,
        terminalId: this.idFor(term),
        name: term.name,
      });
    }

    // New terminals opened after recording starts
    if (typeof api.onDidOpenTerminal === 'function') {
      this.disposables.push(
        api.onDidOpenTerminal((term: vscode.Terminal) => {
          this.events.push({
            type: 'terminalOpen',
            timestamp: this.ts(),
            terminalId: this.idFor(term),
            name: term.name,
          });
        }),
      );
    }

    // Terminals that are closed during recording
    if (typeof api.onDidCloseTerminal === 'function') {
      this.disposables.push(
        api.onDidCloseTerminal((term: vscode.Terminal) => {
          const id = this.terminalIds.get(term);
          if (id === undefined) { return; }
          this.events.push({
            type: 'terminalClose',
            timestamp: this.ts(),
            terminalId: id,
          });
          this.terminalIds.delete(term);
        }),
      );
    }

    // Raw terminal output (requires VS Code 1.87+)
    if (typeof api.onDidWriteTerminalData === 'function') {
      this.disposables.push(
        api.onDidWriteTerminalData(
          (e: { terminal: vscode.Terminal; data: string }) => {
            this.events.push({
              type: 'terminal',
              timestamp: this.ts(),
              terminalId: this.idFor(e.terminal),
              data: e.data,
            });
          },
        ),
      );
    }
  }

  /**
   * Stop capturing and return all collected terminal events.
   * The events are sorted by timestamp before being returned so they
   * merge cleanly with the code events array.
   */
  stop(): TerminalEvent[] {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    return [...this.events].sort((a, b) => a.timestamp - b.timestamp);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private idFor(term: vscode.Terminal): number {
    let id = this.terminalIds.get(term);
    if (id === undefined) {
      id = this.nextId++;
      this.terminalIds.set(term, id);
    }
    return id;
  }

  private ts(): number {
    return this.getTimestamp ? this.getTimestamp() : 0;
  }
}
