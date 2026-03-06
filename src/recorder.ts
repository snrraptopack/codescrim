import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ScrimEvent, ScrimFile, SerializableSelection } from './types';
import { shouldIgnorePath } from './utils';
import { TerminalRecorder } from './terminalRecorder';
import { scanWorkspaceSnapshot } from './workspaceSnapshot';
import { WorkspaceStructureRecorder } from './workspaceStructureRecorder';
import { AudioRecorder } from './audioRecorder';

/* ─────────────────────────────────────────────────────────────────────────────
 *  Path helpers — kept dead-simple to avoid cross-case bugs on Windows
 * ─────────────────────────────────────────────────────────────────────────── */

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Compute a stable, **normalised** relative path or `undefined` if the file
 * is outside the workspace.  Uses forward-slashes so keys are consistent
 * across every call site.
 */
function relPath(absPath: string): string | undefined {
  const root = getWorkspaceRoot();
  if (!root) {
    return path.basename(absPath);
  }
  // Normalise both to the platform path-sep, then lowercase on Windows.
  const a = path.normalize(root).toLowerCase();
  const b = path.normalize(absPath).toLowerCase();
  if (!b.startsWith(a)) {
    return undefined;
  }
  // Slice off the root + separator, then convert to forward-slash.
  let rel = b.slice(a.length);
  if (rel.startsWith(path.sep)) { rel = rel.slice(1); }
  return rel.replace(/\\/g, '/');
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Recorder
 * ─────────────────────────────────────────────────────────────────────────── */

export class Recorder implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext;
  private readonly log: vscode.OutputChannel;

  // ── recording state ──────────────────────────────────────────────────────
  private _recording = false;
  private _startTime = 0;
  private _events: ScrimEvent[] = [];
  private _lastContent: Record<string, string> = {};   // rel → latest text
  private _knownDirectories = new Set<string>();

  // ── sub-modules ──────────────────────────────────────────────────────────
  private terminalRecorder = new TerminalRecorder();
  private structureRecorder = new WorkspaceStructureRecorder();
  private audioRecorder = new AudioRecorder();
  private audioLevel = 0;
  private hasAudio = false;
  private recordingTerminal: vscode.Terminal | undefined;

  // ── ui ───────────────────────────────────────────────────────────────────
  private statusBar: vscode.StatusBarItem;
  private recordingBadge: vscode.StatusBarItem;
  private clockTimer: ReturnType<typeof setInterval> | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.log = vscode.window.createOutputChannel('CodeScrim Recorder');
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right, 1000,
    );
    this.statusBar.name = 'CodeScrim Recording Timer';
    this.statusBar.command = 'codescrim.stopRecording';
    this.recordingBadge = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left, 1000,
    );
    this.recordingBadge.name = 'CodeScrim Recording Badge';
    this.recordingBadge.command = 'codescrim.stopRecording';
    context.subscriptions.push(
      this.statusBar,
      this.recordingBadge,
      this.log,
      this.structureRecorder,
      vscode.workspace.onDidChangeTextDocument(e => this.handleDocChange(e)),
      vscode.workspace.onDidSaveTextDocument(d => this.handleDocumentSave(d)),
      vscode.window.onDidChangeActiveTextEditor(e => this.handleEditorSwitch(e)),
      vscode.window.onDidChangeTextEditorSelection(e => this.handleSelection(e)),
    );
  }

  /* ══════════════════════════════════════════════════════════════════════════
   *  PUBLIC — start / stop / addChapter
   * ══════════════════════════════════════════════════════════════════════════ */

  async startRecording(): Promise<void> {
    if (this._recording) {
      vscode.window.showWarningMessage('CodeScrim is already recording.');
      return;
    }

    // ── title ──────────────────────────────────────────────────────────────
    const title = await vscode.window.showInputBox({
      title: 'CodeScrim — New Tutorial',
      prompt: 'Give your tutorial a title',
      placeHolder: 'e.g. "Building a REST API with Express"',
      validateInput: (v: string) => (v.trim() ? null : 'Title cannot be empty'),
    });
    if (title === undefined) { return; }

    let shouldRecordAudio = false;
    const recordAudioByDefault = vscode.workspace
      .getConfiguration('codescrim')
      .get<boolean>('recordAudio', true);

    if (recordAudioByDefault) {
      const micChoice = await vscode.window.showQuickPick(
        [
          { label: '$(mic) Yes, record microphone', value: 'yes' },
          { label: '$(mute) No, record code only', value: 'no' },
        ],
        {
          title: 'CodeScrim — Microphone Recording',
          placeHolder: 'Choose whether to attach microphone audio to this tutorial',
          ignoreFocusOut: true,
        },
      );

      if (!micChoice) {
        return;
      }

      shouldRecordAudio = micChoice.value === 'yes';
    }

    this._events = [];
    this._lastContent = {};
    this._knownDirectories = new Set<string>();
    this.audioLevel = 0;
    this.hasAudio = false;

    if (shouldRecordAudio) {
      this.statusBar.text = '$(loading~spin) CodeScrim: starting recorder…';
      this.statusBar.tooltip = 'CodeScrim is waiting for the Rust recorder sidecar to start.';
      this.statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.statusBar.color = new vscode.ThemeColor('statusBarItem.warningForeground');
      this.statusBar.show();

      while (true) {
        const audioStarted = await this.audioRecorder.start((level: number) => {
          this.audioLevel = level;
          if (this._recording) {
            this.updateBar();
          }
        });

        if (audioStarted) {
          this.hasAudio = true;
          vscode.window.setStatusBarMessage('$(mic) CodeScrim recorder sidecar is ON', 5000);
          break;
        }

        const choice = await vscode.window.showWarningMessage(
          `CodeScrim: Recorder sidecar did not start. ${this.audioRecorder.lastError || 'Check your microphone device and native recorder build.'}`,
          'Retry Microphone',
          'Continue Without Audio',
          'Cancel Recording',
        );

        if (choice === 'Retry Microphone') {
          continue;
        }

        this.statusBar.hide();
        if (choice === 'Continue Without Audio') {
          shouldRecordAudio = false;
          break;
        }

        return;
      }
    } else {
      vscode.window.setStatusBarMessage('$(mute) CodeScrim recording code only (no microphone)', 4000);
    }

    this._recording = true;
    await this.context.workspaceState.update('codescrim.title', title.trim());
    vscode.commands.executeCommand('setContext', 'codescrim.isRecording', true);

    // ── startTime ──────────────────────────────────────────────────────────
    this._startTime = Date.now();

    // ── capture "frame 0" — the existing codebase ──────────────────────────
    this.captureSetup();
    this.structureRecorder.start({
      root: getWorkspaceRoot(),
      timestamp: () => this.ts(),
      pushEvent: ev => this._events.push(ev),
      readKnownContent: rel => this._lastContent[rel],
      writeKnownContent: (rel, content) => {
        if (content === undefined) {
          delete this._lastContent[rel];
          return;
        }
        this._lastContent[rel] = content;
      },
      knownDirectories: this._knownDirectories,
      log: message => this.log.appendLine(message),
    });
    this.log.appendLine(`[start] title="${title.trim()}" setupFiles=${Object.keys(this._lastContent).length}`);
    console.log(`[CodeScrim] setup captured — ${this._events.length} events, files: ${Object.keys(this._lastContent).join(', ')}`);

    // ── terminal recorder ──────────────────────────────────────────────────
    this.terminalRecorder.start(() => this.ts(), message => this.log.appendLine(message));
    this.log.appendLine('[terminal] capture enabled via shell integration');
    this.ensureRecordingTerminal();

    // ── status-bar timer ───────────────────────────────────────────────────
    this.updateBar();
    this.statusBar.show();
    this.clockTimer = setInterval(() => {
      if (this._recording) { this.updateBar(); }
    }, 1000);

    vscode.window
      .showInformationMessage(
        this.hasAudio
          ? `🎬 Recording "${title.trim()}" — code + microphone audio are being captured.`
          : `🎬 Recording "${title.trim()}" — code is being captured (no microphone).`,
        'Add Chapter Marker', 'Stop Recording',
      )
      .then(choice => {
        if (choice === 'Add Chapter Marker') { this.addChapter(); }
        if (choice === 'Stop Recording') { this.stopRecording(); }
      });
  }

  async addChapter(): Promise<void> {
    if (!this._recording) { return; }
    const name = await vscode.window.showInputBox({
      title: 'Add Chapter Marker',
      prompt: 'Chapter name',
      placeHolder: 'e.g. "Setting up the database"',
      validateInput: (v: string) => (v.trim() ? null : 'Name required'),
    });
    if (name === undefined) { return; }
    this._events.push({ type: 'chapter', timestamp: this.ts(), title: name.trim() });
    vscode.window.setStatusBarMessage(`📌 Chapter: "${name.trim()}"`, 4000);
  }

  async stopRecording(): Promise<void> {
    if (!this._recording) { return; }
    this._recording = false;
    vscode.commands.executeCommand('setContext', 'codescrim.isRecording', false);
    if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = undefined; }
    this.structureRecorder.stop();

    const audioBuffer = this.hasAudio ? await this.audioRecorder.stop() : null;
    this.hasAudio = false;
    this.audioLevel = 0;

    const title = this.context.workspaceState.get<string>('codescrim.title') ?? 'untitled';
    this.statusBar.text = '$(check) CodeScrim: Saving…';

    // ── pick save location ─────────────────────────────────────────────────
    const defaultName = title.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.scrim';
    const root = getWorkspaceRoot() ?? os.homedir();
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(root, defaultName)),
      filters: { 'Scrim Tutorial': ['scrim'] },
      title: 'Save Tutorial',
    });

    if (!saveUri) {
      this.terminalRecorder.stop();
      this.statusBar.hide();
      this.recordingBadge.hide();
      return;
    }

    // ── merge + sort events ────────────────────────────────────────────────
    const termEvents = this.terminalRecorder.stop();
    const terminalStats = this.terminalRecorder.getStats(termEvents);
    const allEvents = [...this._events, ...termEvents].sort((a, b) => a.timestamp - b.timestamp);

    let savedAudioFileName = '';
    if (audioBuffer && audioBuffer.length > 0) {
      const ext = '.wav';
      const base = path.basename(saveUri.fsPath, path.extname(saveUri.fsPath));
      savedAudioFileName = `${base}${ext}`;
      const audioPath = path.join(path.dirname(saveUri.fsPath), savedAudioFileName);
      fs.writeFileSync(audioPath, audioBuffer);
      this.log.appendLine(`[audio] saved=${audioPath} bytes=${audioBuffer.length}`);
    } else {
      this.log.appendLine('[audio] no audio track captured');
    }

    // ── write .scrim ───────────────────────────────────────────────────────
    const scrim: ScrimFile = {
      version: '1.0',
      title,
      events: allEvents,
      createdAt: new Date().toISOString(),
    };
    if (savedAudioFileName) {
      scrim.audioUrl = savedAudioFileName;
    }
    fs.writeFileSync(saveUri.fsPath, JSON.stringify(scrim, null, 2), 'utf8');
    this.statusBar.hide();
    this.recordingBadge.hide();

    // ── summary ────────────────────────────────────────────────────────────
    const counts = {
      setup: 0, snapshot: 0, edit: 0, selection: 0, openFile: 0, chapter: 0, other: 0,
    };
    for (const ev of allEvents) {
      if (ev.type in counts) { (counts as any)[ev.type]++; } else { counts.other++; }
    }
    this.log.appendLine(
      `[stop] saved=${saveUri.fsPath} total=${allEvents.length} setup=${counts.setup} edit=${counts.edit} snap=${counts.snapshot} sel=${counts.selection} open=${counts.openFile} termOpen=${terminalStats.opens} termData=${terminalStats.data} termClose=${terminalStats.closes} termChars=${terminalStats.bytes}`,
    );
    console.log('[CodeScrim] saved', saveUri.fsPath, counts, terminalStats);

    const msg =
      `✅ Saved "${title}" — ${allEvents.length} events ` +
      `(setup:${counts.setup} snap:${counts.snapshot} sel:${counts.selection} open:${counts.openFile}) ` +
      `(term open:${terminalStats.opens} data:${terminalStats.data} close:${terminalStats.closes}) ` +
      `${counts.chapter} chapters.`;

    if (terminalStats.opens > 0 && terminalStats.data === 0) {
      this.log.appendLine(
        '[terminal] warning: terminals opened during recording but no terminal output was captured. Prefer the dedicated CodeScrim recording terminal and a shell with VS Code shell integration enabled.',
      );
      vscode.window.showWarningMessage(
        'CodeScrim saved the tutorial, but no terminal output was captured. Use the dedicated CodeScrim recording terminal for terminal steps.',
      );
    }

    const choice = await vscode.window.showInformationMessage(msg, 'Play Tutorial', 'Open File');
    if (choice === 'Play Tutorial') {
      vscode.commands.executeCommand('codescrim.playScrim', saveUri.fsPath);
    } else if (choice === 'Open File') {
      vscode.window.showTextDocument(saveUri);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
   *  EVENT HANDLERS — wrapped in try/catch so errors are never silent
   * ══════════════════════════════════════════════════════════════════════════ */

  private handleDocChange(e: vscode.TextDocumentChangeEvent): void {
    try {
      if (!this._recording) { return; }
      if (e.document.uri.scheme !== 'file') { return; }
      if (e.contentChanges.length === 0) { return; }

      const rel = relPath(e.document.uri.fsPath);
      if (!rel) { return; }
      if (shouldIgnorePath(rel)) { return; }

      this.rememberParentDirectories(rel);

      const currentText = e.document.getText();
      const previousText = this._lastContent[rel];

      if (previousText === currentText) {
        this.log.appendLine(`[change:dedup] ${rel} version=${e.document.version}`);
        return;
      }

      if (typeof previousText !== 'string') {
        this._lastContent[rel] = currentText;
        this._events.push({
          type: 'snapshot',
          timestamp: this.ts(),
          files: { [rel]: currentText },
          activeFile: rel,
          selections: getSelectionsForDocument(e.document),
        });
        this.log.appendLine(`[change:snapshot] ${rel} version=${e.document.version} reason=untracked`);
        return;
      }

      const changes = e.contentChanges.map(ch => ({
        rangeOffset: ch.rangeOffset,
        rangeLength: ch.rangeLength,
        text: ch.text,
        range: {
          start: { line: ch.range.start.line, character: ch.range.start.character },
          end: { line: ch.range.end.line, character: ch.range.end.character },
        },
      }));

      this._events.push({
        type: 'edit',
        timestamp: this.ts(),
        file: rel,
        changes,
      });

      this._lastContent[rel] = applyRecordedChanges(previousText, changes);
      this.log.appendLine(`[change:edit] ${rel} version=${e.document.version} chunks=${changes.length} events=${this._events.length}`);
    } catch (err) {
      this.log.appendLine(`[change:error] ${String(err)}`);
      console.error('[CodeScrim] handleDocChange error:', err);
    }
  }

  private handleDocumentSave(document: vscode.TextDocument): void {
    try {
      if (!this._recording) { return; }
      if (document.uri.scheme !== 'file') { return; }

      const rel = relPath(document.uri.fsPath);
      if (!rel) { return; }
      if (shouldIgnorePath(rel)) { return; }

      this.rememberParentDirectories(rel);

      const currentText = document.getText();
      const previousText = this._lastContent[rel];
      if (previousText === currentText) {
        this.log.appendLine(`[save:noop] ${rel} version=${document.version}`);
        return;
      }

      const end = endPositionForText(previousText ?? '');
      this._events.push({
        type: 'edit',
        timestamp: this.ts(),
        file: rel,
        changes: [{
          rangeOffset: 0,
          rangeLength: (previousText ?? '').length,
          text: currentText,
          range: {
            start: { line: 0, character: 0 },
            end,
          },
        }],
      });
      this._lastContent[rel] = currentText;
      this.log.appendLine(`[save:repair] ${rel} version=${document.version} events=${this._events.length}`);
    } catch (err) {
      this.log.appendLine(`[save:error] ${String(err)}`);
      console.error('[CodeScrim] handleDocumentSave error:', err);
    }
  }

  private handleEditorSwitch(e: vscode.TextEditor | undefined): void {
    try {
      if (!this._recording || !e || e.document.uri.scheme !== 'file') { return; }
      const rel = relPath(e.document.uri.fsPath);
      if (!rel) { return; }
      this._events.push({ type: 'openFile', timestamp: this.ts(), file: rel });
    } catch (err) {
      console.error('[CodeScrim] handleEditorSwitch error:', err);
    }
  }

  private handleSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    try {
      if (!this._recording || e.textEditor.document.uri.scheme !== 'file') { return; }
      const rel = relPath(e.textEditor.document.uri.fsPath);
      if (!rel) { return; }
      this._events.push({
        type: 'selection',
        timestamp: this.ts(),
        file: rel,
        selections: e.selections.map(s => serSel(s)),
      });
    } catch (err) {
      console.error('[CodeScrim] handleSelection error:', err);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
   *  SNAPSHOT HELPERS
   * ══════════════════════════════════════════════════════════════════════════ */

  /**
   * Record "frame 0" — the full content of every open text document.
   * Synchronous on purpose (no `findFiles`), so there is ZERO chance of
   * events arriving before the setup is captured.
   */
  private captureSetup(): void {
    const maxBytes = (vscode.workspace.getConfiguration('codescrim')
      .get<number>('maxFileSizeKb', 500)) * 1024;

    const snapshot = scanWorkspaceSnapshot(getWorkspaceRoot(), maxBytes);

    this._lastContent = { ...snapshot.files };
    this._knownDirectories = new Set(snapshot.directories);

    if (Object.keys(snapshot.files).length === 0 && snapshot.directories.length === 0) {
      return;
    }

    this._events.push({
      type: 'setup',
      timestamp: 0,
      files: snapshot.files,
      directories: snapshot.directories,
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
   *  TINY HELPERS
   * ══════════════════════════════════════════════════════════════════════════ */

  private ts(): number {
    return (Date.now() - this._startTime) / 1000;
  }

  private updateBar(): void {
    const elapsed = this.ts();
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = Math.floor(elapsed % 60).toString().padStart(2, '0');
    const audioPct = Math.round(this.audioLevel * 100);
    const audioTag = this.audioRecorder.isRecording
      ? `  ·  $(mic) ${audioPct}%`
      : '  ·  $(unmute) off';
    this.statusBar.text =
      `$(primitive-dot) REC ${m}:${s}  ·  ${this._events.length}${audioTag}`;
    this.statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.statusBar.color = new vscode.ThemeColor('statusBarItem.errorForeground');
    this.statusBar.tooltip = this.audioRecorder.isRecording
      ? 'CodeScrim is recording code and microphone audio. Click to stop and save.'
      : 'CodeScrim is recording code only. Click to stop and save.';

    const blink = Math.floor(elapsed) % 2 === 0 ? '$(primitive-dot)' : '$(record)';
    const micState = this.audioRecorder.isRecording ? 'MIC ON' : 'MIC OFF';
    this.recordingBadge.text = `${blink} REC  ${micState}`;
    this.recordingBadge.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.recordingBadge.color = new vscode.ThemeColor('statusBarItem.errorForeground');
    this.recordingBadge.tooltip = 'CodeScrim recording in progress. Click to stop recording.';
    this.recordingBadge.show();
  }

  private ensureRecordingTerminal(): void {
    const shouldOpen = vscode.workspace
      .getConfiguration('codescrim')
      .get<boolean>('openRecordingTerminal', true);

    if (!shouldOpen) {
      return;
    }

    // Create a normal interactive terminal — shell integration captures I/O
    this.recordingTerminal = this.terminalRecorder.createRecordingTerminal('Recording');

    this.log.appendLine(
      `[terminal] recording proxy terminal ready name="${this.recordingTerminal.name}"`,
    );
    vscode.window.setStatusBarMessage(
      '$(terminal) Use the CodeScrim Recording Terminal for commands you want recorded.',
      6000,
    );
  }

  dispose(): void {
    if (this.clockTimer) { clearInterval(this.clockTimer); }
    this.audioRecorder.dispose();
    this.terminalRecorder.dispose();
    this.structureRecorder.dispose();
    this.statusBar.dispose();
    this.recordingBadge.dispose();
  }

  private rememberParentDirectories(relativePath: string): void {
    const parts = relativePath.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      this._knownDirectories.add(current);
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Pure helpers (no instance state)
 * ─────────────────────────────────────────────────────────────────────────── */

function serSel(s: vscode.Selection): SerializableSelection {
  return {
    anchor: { line: s.anchor.line, character: s.anchor.character },
    active: { line: s.active.line, character: s.active.character },
  };
}

function getSelectionsForDocument(document: vscode.TextDocument): SerializableSelection[] | undefined {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) { return undefined; }
  if (activeEditor.document.uri.toString() !== document.uri.toString()) { return undefined; }
  return activeEditor.selections.map(s => serSel(s));
}

function applyRecordedChanges(
  text: string,
  changes: Array<{ rangeOffset: number; rangeLength: number; text: string }>,
): string {
  const sorted = [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
  let next = text;
  for (const ch of sorted) {
    next = next.slice(0, ch.rangeOffset) + ch.text + next.slice(ch.rangeOffset + ch.rangeLength);
  }
  return next;
}

function endPositionForText(text: string): { line: number; character: number } {
  if (text.length === 0) {
    return { line: 0, character: 0 };
  }
  const lines = text.split('\n');
  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
  };
}
