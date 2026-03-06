import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ScrimFile, PlayerState, WebviewMessage, isTerminalEvent, TerminalEvent } from './types';
import { buildPlayerHtml } from './webviewHtml';
import { VfsEngine } from './vfsEngine';
import { MessageQueue } from './messageQueue';
import { TerminalPlayer } from './terminalPlayer';

export class Player implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext;

  //  sub-modules 
  private readonly vfs    = new VfsEngine();
  private readonly queue  = new MessageQueue();
  private readonly terms  = new TerminalPlayer();

  //  webview 
  private panel: vscode.WebviewPanel | undefined;

  //  session state 
  private state: PlayerState | undefined;
  private tempDir: string | undefined;

  //  vs code listeners 
  private disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(e => this.onUserEdit(e)),
      vscode.window.onDidChangeTextEditorSelection(e => this.onEditorClick(e)),
      vscode.workspace.onWillSaveTextDocument(e => this.onWillSave(e)),
    );
  }

  //  public API 

  async openScrim(filePath: string): Promise<void> {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const scrim: ScrimFile = JSON.parse(raw);
      if (!scrim.events || !Array.isArray(scrim.events)) {
        vscode.window.showErrorMessage('CodeScrim: Invalid .scrim file  no events found.');
        return;
      }
      // If the audio path is a bare filename, resolve it relative to the .scrim file
      if (scrim.audioUrl && !scrim.audioUrl.startsWith('http') && !path.isAbsolute(scrim.audioUrl)) {
        scrim.audioUrl = path.join(path.dirname(filePath), scrim.audioUrl);
      }
      await this.startPlayback(scrim);
    } catch (err) {
      vscode.window.showErrorMessage(`CodeScrim: Could not open file  ${err}`);
    }
  }

  //  core playback 

  private async startPlayback(scrim: ScrimFile): Promise<void> {
    // Isolated temp directory for tutorial files
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.tempDir = workspaceRoot
      ? path.join(workspaceRoot, '.codescrim', `temp-${Date.now()}`)
      : path.join(os.tmpdir(), `codescrim-${Date.now()}`);
    fs.mkdirSync(this.tempDir, { recursive: true });

    // Reset all sub-modules
    this.vfs.reset();
    this.terms.reset();
    this.queue.clear();

    this.state = {
      scrim,
      currentEventIndex: -1,
      isEditMode: false,
      isPlaying: false,
      currentTime: 0,
    };

    // Seed initial file state
    const setup = scrim.events.find(e => e.type === 'setup') as
      | { type: 'setup'; files: Record<string, string> } | undefined;
    if (setup) {
      await this.vfs.applySetup(setup, this.tempDir);
    }

    // Open the primary file in the editor
    await this.ensureEditorFocus();

    // Create (or reuse) the webview panel
    if (this.panel) {
      this.panel.webview.html = buildPlayerHtml(scrim);
      this.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'codescrim.player',
        ` ${scrim.title}`,
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.file(this.tempDir),
            this.context.extensionUri,
          ],
        },
      );
      this.panel.onDidDispose(() => { this.panel = undefined; this.cleanup(); });
      this.panel.webview.onDidReceiveMessage((msg: WebviewMessage) =>
        this.queue.enqueue(msg, (m) => this.processMessage(m)),
      );
      this.panel.webview.html = buildPlayerHtml(scrim);
    }
  }

  //  message processing 

  private async processMessage(msg: WebviewMessage): Promise<void> {
    if (!this.state) { return; }

    switch (msg.type) {
      case 'ready':
        this.postToWebview({ type: 'init', scrim: this.state.scrim });
        break;

      case 'timeUpdate':
        if (this.state.isEditMode) { break; }
        if (msg.time >= this.state.currentTime && (msg.time - this.state.currentTime) < 15.0) {
          await this.advanceToTime(msg.time);
        } else {
          await this.syncToTime(msg.time);
        }
        this.state.currentTime = msg.time;
        break;

      case 'paused':
        this.state.isPlaying  = false;
        this.state.isEditMode = true;
        this.state.currentTime = msg.time;
        this.postToWebview({ type: 'setEditMode', active: true });
        vscode.window.setStatusBarMessage(
          '$(pencil) CodeScrim: Paused  edit mode active. The code is yours!', 6000,
        );
        break;

      case 'played':
        this.state.isPlaying = true;
        if (this.state.isEditMode || msg.time < this.state.currentTime) {
          // Revert user edits OR replay-from-end
          this.state.isEditMode  = false;
          this.state.currentTime = msg.time;
          this.postToWebview({ type: 'setEditMode', active: false });
          await this.syncToTime(msg.time);
        } else {
          this.state.currentTime = msg.time;
        }
        break;

      case 'ended':
        this.state.isPlaying       = false;
        this.state.isEditMode      = false;
        this.state.currentEventIndex = -1;
        this.state.currentTime     = 0;
        this.postToWebview({ type: 'setEditMode', active: false });
        vscode.window.showInformationMessage(' Tutorial complete! Great job.');
        break;

      case 'editRequested':
        this.state.isPlaying  = false;
        this.state.isEditMode = true;
        this.state.currentTime = msg.time;
        this.postToWebview({ type: 'setEditMode', active: true });
        await this.ensureEditorFocus();
        break;

      case 'chapterClick':
        await this.syncToTime(msg.timestamp);
        break;
    }
  }

  //  VFS + terminal coordination 

  private async syncToTime(time: number): Promise<void> {
    if (!this.state || !this.tempDir) { return; }
    const { scrim } = this.state;

    // VFS: full rebuild of code state
    const result = await this.vfs.syncToTime(
      scrim.events,
      time,
      this.tempDir,
      (title, ts) => {
        vscode.window.setStatusBarMessage(` ${title}`, 4000);
        this.postToWebview({ type: 'syncToTime', time: ts, chapter: title });
      },
    );
    this.state.currentEventIndex = result.lastIndex;

    // Terminals: rebuild PTY state
    const termEvents = scrim.events.filter(isTerminalEvent) as TerminalEvent[];
    this.terms.syncToTime(termEvents, time);
  }

  private async advanceToTime(time: number): Promise<void> {
    if (!this.state || !this.tempDir) { return; }
    const { scrim } = this.state;

    const newIndex = await this.vfs.advanceToTime(
      scrim.events,
      this.state.currentEventIndex,
      time,
      this.tempDir,
      (title, ts) => {
        vscode.window.setStatusBarMessage(` ${title}`, 4000);
        this.postToWebview({ type: 'syncToTime', time: ts, chapter: title });
      },
    );
    this.state.currentEventIndex = newIndex;

    // Incrementally apply any terminal events in the same range
    const from = this.state.currentEventIndex;
    for (let i = Math.max(0, from); i < scrim.events.length; i++) {
      const ev = scrim.events[i];
      if (ev.timestamp > time) { break; }
      if (isTerminalEvent(ev)) { this.terms.applyEvent(ev as TerminalEvent); }
    }
  }

  //  editor interaction guards 

  /** User typed while video was playing  pause immediately. */
  private onUserEdit(e: vscode.TextDocumentChangeEvent): void {
    if (this.vfs.isUpdating) { return; }
    if (!this.state?.isPlaying || !this.tempDir) { return; }
    if (e.contentChanges.length === 0) { return; }
    if (!e.document.uri.fsPath.toLowerCase().startsWith(path.normalize(this.tempDir).toLowerCase())) { return; }
    this.postToWebview({ type: 'forcePause' });
  }

  /** Mouse click in tutorial code while playing  pause + edit mode. */
  private onEditorClick(e: vscode.TextEditorSelectionChangeEvent): void {
    if (this.vfs.isUpdating) { return; }
    if (!this.state?.isPlaying || this.state.isEditMode || !this.tempDir) { return; }
    if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) { return; }
    if (!e.textEditor.document.uri.fsPath.toLowerCase().startsWith(path.normalize(this.tempDir).toLowerCase())) { return; }
    this.postToWebview({ type: 'forcePause' });
  }

  /**
   * Ctrl+S during playback (non-edit mode): restore tutorial content to disk
   * so the file stays clean.  In edit mode, let the save go through normally.
   */
  private onWillSave(e: vscode.TextDocumentWillSaveEvent): void {
    if (!this.state || !this.tempDir) { return; }
    const fsPath = e.document.uri.fsPath;
    if (!fsPath.toLowerCase().startsWith(path.normalize(this.tempDir).toLowerCase())) { return; }
    if (this.state.isEditMode) { return; } // user is intentionally editing

    const rel = path.relative(this.tempDir, fsPath).replace(/\\/g, '/');
    const tutorialContent = this.vfs.snapshot[rel];
    if (tutorialContent === undefined) { return; }

    e.waitUntil(Promise.resolve([
      new vscode.TextEdit(new vscode.Range(0, 0, e.document.lineCount, 0), tutorialContent),
    ]));
  }

  //  editor focus 

  private async ensureEditorFocus(): Promise<void> {
    if (!this.tempDir || !this.state) { return; }
    const cfg = vscode.workspace.getConfiguration('codescrim');
    if (!cfg.get<boolean>('autoOpenFiles', true)) { return; }

    // Prefer the first file a user interacts with; otherwise the first setup file
    const setup = this.state.scrim.events.find(e => e.type === 'setup') as
      | { type: 'setup'; files: Record<string, string> } | undefined;
    if (!setup) { return; }

    const files = Object.keys(setup.files);
    if (files.length === 0) { return; }

    let activeFile = files.find(f => !f.endsWith('.json') && !f.endsWith('.md')) ?? files[0];
    const firstAction = this.state.scrim.events.find(
      e => e.type === 'edit' || e.type === 'selection' || e.type === 'openFile' || e.type === 'snapshot',
    );
    if (firstAction && 'file' in firstAction && firstAction.file) {
      activeFile = firstAction.file;
    } else if (firstAction && firstAction.type === 'snapshot' && firstAction.activeFile) {
      activeFile = firstAction.activeFile;
    }

    try {
      const fullPath = path.join(this.tempDir, activeFile);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
    } catch {
      /* file may not exist yet during initial setup  ignore */
    }
  }

  //  helpers 

  private postToWebview(msg: object): void {
    this.panel?.webview.postMessage(msg);
  }

  private cleanup(): void {
    this.terms.reset();
    this.vfs.reset();
    this.queue.clear();
    if (this.tempDir && fs.existsSync(this.tempDir)) {
      try { fs.rmSync(this.tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    this.tempDir = undefined;
    this.state   = undefined;
  }

  dispose(): void {
    this.panel?.dispose();
    this.cleanup();
    this.terms.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
