import * as vscode from 'vscode';
import { TerminalEvent } from './types';

/**
 * Captures terminal I/O events during a recording session.
 *
 * Uses the stable Shell Integration API (VS Code >= 1.93):
 * - `onDidStartTerminalShellExecution` — captures the command line text
 * - `execution.read()` — streams the raw output (including escape sequences)
 * - `onDidEndTerminalShellExecution` — captures exit codes
 *
 * The recording terminal is a normal `vscode.window.createTerminal()` so the
 * user gets full shell interactivity (tab completion, arrow keys, etc.).
 * Shell integration is auto-injected by VS Code for PowerShell, Bash, Zsh, Fish.
 */
export class TerminalRecorder implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private events: TerminalEvent[] = [];
  private getTimestamp: (() => number) | undefined;
  private terminalIds = new Map<vscode.Terminal, number>();
  private nextId = 1;
  private logger: ((message: string) => void) | undefined;

  /** Our recording terminal (if any) */
  private recordingTerminal: vscode.Terminal | undefined;

  // ── lifecycle ─────────────────────────────────────────────────────────────

  start(getTimestamp: () => number, logger?: (message: string) => void): void {
    this.getTimestamp = getTimestamp;
    this.events = [];
    this.terminalIds = new Map();
    this.nextId = 1;
    this.logger = logger;

    // Snapshot already-open terminals
    for (const term of vscode.window.terminals) {
      const terminalId = this.idFor(term);
      this.events.push({
        type: 'terminalOpen',
        timestamp: 0,
        terminalId,
        name: term.name,
      });
      this.logger?.(`[terminal:open] id=${terminalId} name="${term.name}" ts=0 existing=true`);
    }

    // Track new terminals
    this.disposables.push(
      vscode.window.onDidOpenTerminal((term) => {
        if (this.isOurTerminal(term)) { return; } // tracked via createRecordingTerminal
        const terminalId = this.idFor(term);
        this.events.push({
          type: 'terminalOpen',
          timestamp: this.ts(),
          terminalId,
          name: term.name,
        });
        this.logger?.(`[terminal:open] id=${terminalId} name="${term.name}" ts=${this.ts().toFixed(3)}`);
      }),
    );

    // Track terminal close
    this.disposables.push(
      vscode.window.onDidCloseTerminal((term) => {
        const id = this.terminalIds.get(term);
        if (id === undefined) { return; }
        this.events.push({
          type: 'terminalClose',
          timestamp: this.ts(),
          terminalId: id,
        });
        this.logger?.(`[terminal:close] id=${id} name="${term.name}" ts=${this.ts().toFixed(3)}`);
        this.terminalIds.delete(term);
      }),
    );

    // ── Shell Integration: capture commands + output ──────────────────────
    this.disposables.push(
      vscode.window.onDidStartTerminalShellExecution((event) => {
        const terminalId = this.idFor(event.terminal);
        const commandLine = event.execution.commandLine.value;
        const timestamp = this.ts();

        this.logger?.(
          `[terminal:exec:start] id=${terminalId} name="${event.terminal.name}" ts=${timestamp.toFixed(3)} command=${JSON.stringify(commandLine)}`,
        );

        // Record the command itself as a data event
        if (commandLine.trim()) {
          const cmdData = `\x1b[1m$ ${commandLine}\x1b[0m\r\n`;
          this.events.push({
            type: 'terminal',
            timestamp,
            terminalId,
            data: cmdData,
          });
          this.logger?.(
            `[terminal:data] id=${terminalId} ts=${timestamp.toFixed(3)} chars=${cmdData.length} source=shell-command`,
          );
        }

        // Stream the command output
        void this.pipeExecutionOutput(terminalId, event.terminal, event.execution);
      }),
    );

    this.disposables.push(
      vscode.window.onDidEndTerminalShellExecution((event) => {
        const terminalId = this.idFor(event.terminal);
        const exitCode = event.exitCode;
        this.logger?.(
          `[terminal:exec:end] id=${terminalId} name="${event.terminal.name}" ts=${this.ts().toFixed(3)} exit=${exitCode ?? 'undefined'}`,
        );
      }),
    );

    this.logger?.('[terminal] recorder started — capture via shell integration (VS Code >= 1.93)');
  }

  /**
   * Create the recording terminal. This is a normal interactive terminal.
   * Shell integration is auto-injected by VS Code for supported shells.
   */
  createRecordingTerminal(name: string): vscode.Terminal {
    const terminalId = this.nextId++;
    const timestamp = this.ts();
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri;

    const terminal = vscode.window.createTerminal({
      name: `CodeScrim ● ${name}`,
      cwd,
      location: vscode.TerminalLocation.Panel,
    });

    this.terminalIds.set(terminal, terminalId);
    this.recordingTerminal = terminal;

    this.events.push({
      type: 'terminalOpen',
      timestamp,
      terminalId,
      name,
    });
    this.logger?.(`[terminal:open] id=${terminalId} name="${name}" ts=${timestamp.toFixed(3)} recording=true`);

    terminal.show(false);
    return terminal;
  }

  /**
   * Stop capturing and return all collected terminal events.
   */
  stop(): TerminalEvent[] {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.recordingTerminal = undefined;
    this.logger = undefined;
    return [...this.events].sort((a, b) => a.timestamp - b.timestamp);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.recordingTerminal = undefined;
    this.logger = undefined;
  }

  getStats(events: TerminalEvent[] = this.events): { opens: number; data: number; closes: number; bytes: number } {
    let opens = 0;
    let data = 0;
    let closes = 0;
    let bytes = 0;

    for (const event of events) {
      if (event.type === 'terminalOpen') {
        opens += 1;
      } else if (event.type === 'terminalClose') {
        closes += 1;
      } else {
        data += 1;
        bytes += event.data.length;
      }
    }

    return { opens, data, closes, bytes };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async pipeExecutionOutput(
    terminalId: number,
    terminal: vscode.Terminal,
    execution: vscode.TerminalShellExecution,
  ): Promise<void> {
    try {
      for await (const data of execution.read()) {
        const timestamp = this.ts();
        this.events.push({
          type: 'terminal',
          timestamp,
          terminalId,
          data,
        });
        this.logger?.(
          `[terminal:data] id=${terminalId} name="${terminal.name}" ts=${timestamp.toFixed(3)} chars=${data.length} source=shell-stream`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.(
        `[terminal:exec:error] id=${terminalId} name="${terminal.name}" message=${JSON.stringify(message)}`,
      );
    }
  }

  private idFor(term: vscode.Terminal): number {
    let id = this.terminalIds.get(term);
    if (id === undefined) {
      id = this.nextId++;
      this.terminalIds.set(term, id);
    }
    return id;
  }

  private isOurTerminal(term: vscode.Terminal): boolean {
    return term.name.startsWith('CodeScrim ●');
  }

  private ts(): number {
    return this.getTimestamp ? this.getTimestamp() : 0;
  }
}
