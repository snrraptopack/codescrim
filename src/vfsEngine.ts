import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ScrimEvent, SerializableSelection } from './types';

// ── helpers ───────────────────────────────────────────────────────────────────

function norm(p: string): string {
  return path.normalize(p).toLowerCase();
}

/**
 * Pure string-level application of a list of text changes sorted descending
 * by rangeOffset (so earlier insertions don't shift later offsets).
 */
function applyChanges(
  text: string,
  changes: Array<{ rangeOffset: number; rangeLength: number; text: string }>,
): string {
  const sorted = [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
  for (const ch of sorted) {
    text = text.slice(0, ch.rangeOffset) + ch.text + text.slice(ch.rangeOffset + ch.rangeLength);
  }
  return text;
}

function toSelection(s: SerializableSelection): vscode.Selection {
  return new vscode.Selection(
    s.anchor.line,
    s.anchor.character,
    s.active.line,
    s.active.character,
  );
}

// ── public surface ────────────────────────────────────────────────────────────

export interface SyncResult {
  lastIndex: number;
  activeFile: string | null;
  selections: vscode.Selection[];
}

/**
 * Single-responsibility module that owns the in-memory Virtual File System
 * (VFS) and keeps it synchronised with the real VS Code workspace.
 *
 * All workspace write operations increment/decrement `_depth` so callers
 * can test `isUpdating` to distinguish engine writes from user edits.
 */
export class VfsEngine {
  /** Ground-truth in-memory content of every temp tutorial file */
  private _snapshot: Record<string, string> = {};
  /** Known directory tree for the tutorial workspace */
  private _directories = new Set<string>();
  /** Last file intentionally revealed in the editor during playback. */
  private _activeFile: string | null = null;
  /** Ref-count: >0 means the engine is currently writing to the workspace */
  private _depth = 0;

  get isUpdating(): boolean {
    return this._depth > 0;
  }

  /** Read-only access to the current file snapshot (used by the save blocker). */
  get snapshot(): Readonly<Record<string, string>> {
    return this._snapshot;
  }

  get activeFile(): string | null {
    return this._activeFile;
  }

  reset(): void {
    this._snapshot = {};
    this._directories = new Set<string>();
    this._activeFile = null;
    this._depth = 0;
  }

  // ── setup ─────────────────────────────────────────────────────────────────

  /**
   * Write the initial tutorial files to `tempDir` and seed the in-memory
   * snapshot.  Patches open TextDocuments if they're already visible.
   */
  async applySetup(
    ev: { type: 'setup'; files: Record<string, string>; directories?: string[] },
    tempDir: string,
  ): Promise<void> {
    this._directories = new Set(ev.directories ?? []);

    for (const dir of [...this._directories].sort((a, b) => a.length - b.length)) {
      const fullPath = path.join(tempDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }

    for (const [rel, content] of Object.entries(ev.files)) {
      const fullPath = path.join(tempDir, rel);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.writeFileToDisk(fullPath, content);
      this._snapshot[rel] = content;

      const openDoc = vscode.workspace.textDocuments.find(
        (d) => norm(d.uri.fsPath) === norm(fullPath),
      );
      if (openDoc && openDoc.getText() !== content) {
        const wsEdit = new vscode.WorkspaceEdit();
        wsEdit.replace(openDoc.uri, new vscode.Range(0, 0, openDoc.lineCount, 0), content);
        await vscode.workspace.applyEdit(wsEdit);
      }
    }

    this._activeFile = null;
  }

  // ── full rebuild sync ─────────────────────────────────────────────────────

  /**
   * Rebuild the VFS completely by replaying all code events up to `time`.
   *
   * Use this for: seeking, scrubbing the timeline, resuming from edit mode.
   * Terminal events are skipped here — TerminalPlayer handles those.
   */
  async syncToTime(
    events: ScrimEvent[],
    time: number,
    tempDir: string,
    onChapter?: (title: string, ts: number) => void,
  ): Promise<SyncResult> {
    // 1. Build VFS in memory
    const vfs: Record<string, string> = {};
    const setup = events.find((e) => e.type === 'setup') as
      | { type: 'setup'; files: Record<string, string>; directories?: string[] }
      | undefined;
    const directories = new Set<string>(setup?.directories ?? []);
    if (setup) {
      for (const [rel, content] of Object.entries(setup.files)) {
        vfs[rel] = content;
        addParentDirectories(rel, directories);
      }
    }

    let lastIndex = 0;
    let activeFile: string | null = null;
    let selections: vscode.Selection[] = [];

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'setup') {
        continue;
      }
      if (ev.timestamp > time) {
        break;
      }

      if (ev.type === 'edit' && ev.file && typeof vfs[ev.file] === 'string') {
        vfs[ev.file] = applyChanges(vfs[ev.file], ev.changes);
        activeFile = ev.file;
      } else if (ev.type === 'snapshot') {
        for (const [rel, content] of Object.entries(ev.files)) {
          vfs[rel] = content;
          addParentDirectories(rel, directories);
        }
        if (ev.activeFile) {
          activeFile = ev.activeFile;
        }
        if (ev.selections && ev.selections.length > 0) {
          selections = ev.selections.map(toSelection);
        }
      } else if (ev.type === 'createFile') {
        vfs[ev.file] = ev.content;
        addParentDirectories(ev.file, directories);
      } else if (ev.type === 'deleteFile') {
        delete vfs[ev.file];
      } else if (ev.type === 'createDirectory') {
        addDirectoryChain(ev.path, directories);
      } else if (ev.type === 'deleteDirectory') {
        deleteDirectoryTree(ev.path, vfs, directories);
      } else if (ev.type === 'openFile') {
        activeFile = ev.file;
      } else if (ev.type === 'selection') {
        activeFile = ev.file;
        selections = ev.selections.map(toSelection);
      } else if (ev.type === 'chapter') {
        onChapter?.(ev.title, ev.timestamp);
      }

      lastIndex = i;
    }

    // 2. Persist snapshot
    this._snapshot = { ...vfs };
    this._directories = new Set(directories);

    // 3. Commit to workspace
    this._depth++;
    try {
      const disk = collectDiskState(tempDir);

      for (const rel of [...disk.files].sort((a, b) => b.length - a.length)) {
        if (vfs[rel] !== undefined) { continue; }
        const fullPath = path.join(tempDir, rel);
        try { fs.rmSync(fullPath, { force: true }); } catch { /* ignore */ }
      }

      for (const rel of [...disk.directories].sort((a, b) => b.length - a.length)) {
        if (directories.has(rel)) { continue; }
        const fullPath = path.join(tempDir, rel);
        try { fs.rmSync(fullPath, { recursive: true, force: true }); } catch { /* ignore */ }
      }

      for (const rel of [...directories].sort((a, b) => a.length - b.length)) {
        const fullPath = path.join(tempDir, rel);
        if (!fs.existsSync(fullPath)) {
          fs.mkdirSync(fullPath, { recursive: true });
        }
      }

      const wsEdit = new vscode.WorkspaceEdit();
      for (const [rel, content] of Object.entries(vfs)) {
        const fullPath = path.join(tempDir, rel);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const openDoc = vscode.workspace.textDocuments.find(
          (d) => norm(d.uri.fsPath) === norm(fullPath),
        );
        if (openDoc) {
          if (openDoc.getText() !== content) {
            wsEdit.replace(openDoc.uri, new vscode.Range(0, 0, openDoc.lineCount, 0), content);
          }
        } else {
          this.writeFileToDisk(fullPath, content);
        }
      }
      await vscode.workspace.applyEdit(wsEdit);

      if (activeFile) {
        const fullPath = path.join(tempDir, activeFile);
        const openDoc = vscode.workspace.textDocuments.find(
          (d) => norm(d.uri.fsPath) === norm(fullPath),
        );
        const doc = await vscode.workspace.openTextDocument(
          openDoc ? openDoc.uri : vscode.Uri.file(fullPath),
        );
        const editor = await vscode.window.showTextDocument(doc, {
          preserveFocus: true,
          preview: false,
          viewColumn: vscode.ViewColumn.One,
        });
        if (selections.length > 0) {
          editor.selections = selections;
        }
      }

      this._activeFile = activeFile;
    } finally {
      this._depth--;
    }

    return { lastIndex, activeFile, selections };
  }

  // ── incremental advance ───────────────────────────────────────────────────

  /**
   * Apply events one-by-one from `fromIndex + 1` up to `time`.
   * Faster than `syncToTime`; used during normal 1× playback.
   *
   * Returns the new last applied event index.
   */
  async advanceToTime(
    events: ScrimEvent[],
    fromIndex: number,
    time: number,
    tempDir: string,
    onChapter?: (title: string, ts: number) => void,
  ): Promise<number> {
    let lastIndex = fromIndex;
    const touchedFiles = new Set<string>();
    const deletedFiles = new Set<string>();
    let activeFile = this._activeFile;
    let selections: vscode.Selection[] = [];

    this._depth++;
    try {
      for (let i = Math.max(0, fromIndex + 1); i < events.length; i++) {
        const ev = events[i];
        if (ev.type === 'setup') {
          continue;
        }
        if (ev.timestamp > time) {
          break;
        }
        try {
          if (
            ev.type === 'terminalOpen' ||
            ev.type === 'terminal' ||
            ev.type === 'terminalClose'
          ) {
            lastIndex = i;
            continue;
          }

          if (ev.type === 'openFile') {
            activeFile = ev.file;
            selections = [];
          } else if (ev.type === 'edit') {
            if (typeof this._snapshot[ev.file] === 'string') {
              this._snapshot[ev.file] = applyChanges(this._snapshot[ev.file], ev.changes);
            } else {
              this._snapshot[ev.file] = applyChanges('', ev.changes);
              addParentDirectories(ev.file, this._directories);
            }
            touchedFiles.add(ev.file);
            deletedFiles.delete(ev.file);
          } else if (ev.type === 'createFile') {
            this._snapshot[ev.file] = ev.content;
            addParentDirectories(ev.file, this._directories);
            touchedFiles.add(ev.file);
            deletedFiles.delete(ev.file);
          } else if (ev.type === 'deleteFile') {
            delete this._snapshot[ev.file];
            deletedFiles.add(ev.file);
            touchedFiles.delete(ev.file);
            if (activeFile === ev.file) {
              activeFile = null;
              selections = [];
            }
          } else if (ev.type === 'createDirectory') {
            addDirectoryChain(ev.path, this._directories);
          } else if (ev.type === 'deleteDirectory') {
            deleteDirectoryTree(ev.path, this._snapshot, this._directories);
            for (const rel of [...touchedFiles]) {
              if (rel.startsWith(`${ev.path}/`)) {
                touchedFiles.delete(rel);
              }
            }
            for (const rel of Object.keys(this._snapshot)) {
              if (rel.startsWith(`${ev.path}/`)) {
                deletedFiles.add(rel);
              }
            }
            if (activeFile && (activeFile === ev.path || activeFile.startsWith(`${ev.path}/`))) {
              activeFile = null;
              selections = [];
            }
            try { fs.rmSync(path.join(tempDir, ev.path), { recursive: true, force: true }); } catch { /* ignore */ }
          } else if (ev.type === 'snapshot') {
            for (const [rel, content] of Object.entries(ev.files)) {
              this._snapshot[rel] = content;
              addParentDirectories(rel, this._directories);
              touchedFiles.add(rel);
              deletedFiles.delete(rel);
            }
            if (ev.activeFile) {
              activeFile = ev.activeFile;
            }
            if (ev.selections && ev.selections.length > 0) {
              selections = ev.selections.map(toSelection);
            }
          } else if (ev.type === 'selection') {
            activeFile = ev.file;
            selections = ev.selections.map(toSelection);
          } else if (ev.type === 'chapter') {
            onChapter?.(ev.title, ev.timestamp);
          }
        } catch (err) {
          console.error(`CodeScrim VfsEngine: event[${i}] failed`, err);
        }
        lastIndex = i;
      }

      for (const dir of [...this._directories].sort((a, b) => a.length - b.length)) {
        const fullPath = path.join(tempDir, dir);
        if (!fs.existsSync(fullPath)) {
          fs.mkdirSync(fullPath, { recursive: true });
        }
      }

      for (const rel of deletedFiles) {
        const fullPath = path.join(tempDir, rel);
        try { fs.rmSync(fullPath, { force: true }); } catch { /* ignore */ }
      }

      const wsEdit = new vscode.WorkspaceEdit();
      for (const rel of touchedFiles) {
        const content = this._snapshot[rel];
        if (typeof content !== 'string') {
          continue;
        }
        const fullPath = path.join(tempDir, rel);
        const parentDir = path.dirname(fullPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        const openDoc = vscode.workspace.textDocuments.find(
          (d) => norm(d.uri.fsPath) === norm(fullPath),
        );
        if (openDoc) {
          if (openDoc.getText() !== content) {
            wsEdit.replace(openDoc.uri, new vscode.Range(0, 0, openDoc.lineCount, 0), content);
          }
        }
        this.writeFileToDisk(fullPath, content);
      }

      await vscode.workspace.applyEdit(wsEdit);

      if (activeFile) {
        const editor = await this.revealFile(tempDir, activeFile);
        if (editor && selections.length > 0) {
          editor.selections = selections;
        }
      }

      this._activeFile = activeFile;
    } finally {
      this._depth--;
    }
    return lastIndex;
  }

  // ── single event ──────────────────────────────────────────────────────────

  /**
   * Apply a single code event to both the in-memory snapshot and the workspace.
   * Terminal events (`terminalOpen`, `terminal`, `terminalClose`) are silently
   * skipped — they belong to TerminalPlayer.
   */
  async applyEvent(
    ev: ScrimEvent,
    tempDir: string,
    onChapter?: (title: string, ts: number) => void,
  ): Promise<void> {
    // Skip terminal events — handled by TerminalPlayer
    if (
      ev.type === 'terminalOpen' ||
      ev.type === 'terminal' ||
      ev.type === 'terminalClose'
    ) {
      return;
    }

    if (ev.type === 'openFile') {
      const editor = await this.revealFile(tempDir, ev.file);
      if (editor) {
        this._activeFile = ev.file;
      }
    } else if (ev.type === 'edit') {
      // Keep snapshot in sync
      if (typeof this._snapshot[ev.file] === 'string') {
        this._snapshot[ev.file] = applyChanges(this._snapshot[ev.file], ev.changes);
      } else {
        this._snapshot[ev.file] = applyChanges('', ev.changes);
        addParentDirectories(ev.file, this._directories);
      }

      const fullPath = path.join(tempDir, ev.file);
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      const openDoc = vscode.workspace.textDocuments.find(
        (d) => norm(d.uri.fsPath) === norm(fullPath),
      );
      const uri = openDoc ? openDoc.uri : vscode.Uri.file(fullPath);
      const wsEdit = new vscode.WorkspaceEdit();

      // Apply bottom-to-top so earlier offsets don't shift later ones
      const sorted = [...ev.changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
      for (const ch of sorted) {
        const r = ch.range;
        wsEdit.replace(
          uri,
          new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character),
          ch.text,
        );
      }
      await vscode.workspace.applyEdit(wsEdit);
      this.writeFileToDisk(fullPath, this._snapshot[ev.file]);

      if (this._activeFile === null && norm(uri.fsPath).startsWith(norm(tempDir))) {
        const editor = await this.revealFile(tempDir, ev.file);
        if (editor) {
          this._activeFile = ev.file;
        }
      }
    } else if (ev.type === 'createFile') {
      this._snapshot[ev.file] = ev.content;
      addParentDirectories(ev.file, this._directories);

      const fullPath = path.join(tempDir, ev.file);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      this.writeFileToDisk(fullPath, ev.content);
    } else if (ev.type === 'deleteFile') {
      delete this._snapshot[ev.file];
      const fullPath = path.join(tempDir, ev.file);
      try { fs.rmSync(fullPath, { force: true }); } catch { /* ignore */ }
    } else if (ev.type === 'createDirectory') {
      addDirectoryChain(ev.path, this._directories);
      fs.mkdirSync(path.join(tempDir, ev.path), { recursive: true });
    } else if (ev.type === 'deleteDirectory') {
      deleteDirectoryTree(ev.path, this._snapshot, this._directories);
      try { fs.rmSync(path.join(tempDir, ev.path), { recursive: true, force: true }); } catch { /* ignore */ }
    } else if (ev.type === 'snapshot') {
      const wsEdit = new vscode.WorkspaceEdit();
      for (const [rel, content] of Object.entries(ev.files)) {
        this._snapshot[rel] = content;
        addParentDirectories(rel, this._directories);
        const fullPath = path.join(tempDir, rel);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const openDoc = vscode.workspace.textDocuments.find(
          (d) => norm(d.uri.fsPath) === norm(fullPath),
        );
        if (openDoc) {
          wsEdit.replace(openDoc.uri, new vscode.Range(0, 0, openDoc.lineCount, 0), content);
        }
        this.writeFileToDisk(fullPath, content);
      }
      await vscode.workspace.applyEdit(wsEdit);

      if (ev.activeFile) {
        const fullPath = path.join(tempDir, ev.activeFile);
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
        const editor = await vscode.window.showTextDocument(doc, {
          preserveFocus: true,
          preview: false,
          viewColumn: vscode.ViewColumn.One,
        });
        if (ev.selections && ev.selections.length > 0) {
          editor.selections = ev.selections.map(toSelection);
        }
        this._activeFile = ev.activeFile;
      }
    } else if (ev.type === 'selection') {
      const editor = await this.revealFile(tempDir, ev.file);
      if (editor) {
        this._activeFile = ev.file;
        editor.selections = ev.selections.map(toSelection);
      }
    } else if (ev.type === 'chapter') {
      onChapter?.(ev.title, ev.timestamp);
    }
  }

  private async revealFile(tempDir: string, relativePath: string): Promise<vscode.TextEditor | undefined> {
    const fullPath = path.join(tempDir, relativePath);
    try {
      const openDoc = vscode.workspace.textDocuments.find(
        (d) => norm(d.uri.fsPath) === norm(fullPath),
      );
      const doc = await vscode.workspace.openTextDocument(
        openDoc ? openDoc.uri : vscode.Uri.file(fullPath),
      );
      return await vscode.window.showTextDocument(doc, {
        preserveFocus: true,
        preview: false,
        viewColumn: vscode.ViewColumn.One,
      });
    } catch (e) {
      console.error('CodeScrim VfsEngine: revealFile failed', e);
      return undefined;
    }
  }

  private writeFileToDisk(fullPath: string, content: string): void {
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf8');
  }
}

function addDirectoryChain(relativeDir: string, directories: Set<string>): void {
  if (!relativeDir || relativeDir === '.') { return; }
  const parts = relativeDir.split('/');
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    directories.add(current);
  }
}

function addParentDirectories(relativeFilePath: string, directories: Set<string>): void {
  const dir = path.posix.dirname(relativeFilePath);
  addDirectoryChain(dir, directories);
}

function deleteDirectoryTree(
  relativeDir: string,
  files: Record<string, string>,
  directories: Set<string>,
): void {
  for (const file of Object.keys(files)) {
    if (file.startsWith(`${relativeDir}/`)) {
      delete files[file];
    }
  }
  for (const dir of [...directories]) {
    if (dir === relativeDir || dir.startsWith(`${relativeDir}/`)) {
      directories.delete(dir);
    }
  }
}

function collectDiskState(root: string): { files: Set<string>; directories: Set<string> } {
  const files = new Set<string>();
  const directories = new Set<string>();

  if (!fs.existsSync(root)) {
    return { files, directories };
  }

  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(root, fullPath).replace(/\\/g, '/');
      if (!rel) { continue; }
      if (entry.isDirectory()) {
        directories.add(rel);
        walk(fullPath);
      } else if (entry.isFile()) {
        files.add(rel);
      }
    }
  };

  walk(root);
  return { files, directories };
}
