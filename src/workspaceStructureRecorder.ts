import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceStructureEvent } from './types';
import { shouldIgnorePath } from './utils';

export interface WorkspaceStructureRecorderOptions {
  root: string | undefined;
  timestamp: () => number;
  pushEvent: (event: WorkspaceStructureEvent) => void;
  readKnownContent: (relativePath: string) => string | undefined;
  writeKnownContent: (relativePath: string, content: string | undefined) => void;
  knownDirectories: Iterable<string>;
  log?: (message: string) => void;
}

export class WorkspaceStructureRecorder implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
  private knownDirectories = new Set<string>();
  private options: WorkspaceStructureRecorderOptions | undefined;
  private suspendedUntil = 0;

  start(options: WorkspaceStructureRecorderOptions): void {
    this.stop();
    this.options = options;
    this.knownDirectories = new Set(options.knownDirectories);

    if (!options.root) {
      return;
    }

    const pattern = new vscode.RelativePattern(options.root, '**/*');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false);
    this.watcher.onDidCreate(uri => this.onCreate(uri));
    this.watcher.onDidDelete(uri => this.onDelete(uri));
  }

  stop(): void {
    this.suspendedUntil = Date.now() + 250;
    this.watcher?.dispose();
    this.watcher = undefined;
    this.options = undefined;
  }

  dispose(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    this.options = undefined;
  }

  replaceKnownDirectories(directories: Iterable<string>): void {
    this.knownDirectories = new Set(directories);
  }

  private onCreate(uri: vscode.Uri): void {
    const opts = this.options;
    if (!opts || Date.now() < this.suspendedUntil) { return; }

    const rel = this.toRelativePath(uri.fsPath, opts.root);
    if (!rel || shouldIgnorePath(rel)) { return; }

    const stat = safeStat(uri.fsPath);
    if (!stat) { return; }

    if (stat.isDirectory()) {
      this.rememberDirectoryChain(rel);
      opts.pushEvent({ type: 'createDirectory', timestamp: opts.timestamp(), path: rel });
      opts.log?.(`[fs:create-dir] ${rel}`);
      return;
    }

    if (!stat.isFile()) {
      return;
    }

    const content = safeReadText(uri.fsPath);
    if (content === undefined) { return; }

    this.rememberDirectoryChain(path.posix.dirname(rel));
    opts.writeKnownContent(rel, content);
    opts.pushEvent({ type: 'createFile', timestamp: opts.timestamp(), file: rel, content });
    opts.log?.(`[fs:create-file] ${rel}`);
  }

  private onDelete(uri: vscode.Uri): void {
    const opts = this.options;
    if (!opts || Date.now() < this.suspendedUntil) { return; }

    const rel = this.toRelativePath(uri.fsPath, opts.root);
    if (!rel || shouldIgnorePath(rel)) { return; }

    if (this.knownDirectories.has(rel)) {
      this.deleteKnownDirectory(rel);
      opts.pushEvent({ type: 'deleteDirectory', timestamp: opts.timestamp(), path: rel });
      opts.log?.(`[fs:delete-dir] ${rel}`);
      return;
    }

    opts.writeKnownContent(rel, undefined);
    opts.pushEvent({ type: 'deleteFile', timestamp: opts.timestamp(), file: rel });
    opts.log?.(`[fs:delete-file] ${rel}`);
  }

  private toRelativePath(absPath: string, root: string | undefined): string | undefined {
    if (!root) { return undefined; }
    const a = path.normalize(root).toLowerCase();
    const b = path.normalize(absPath).toLowerCase();
    if (!b.startsWith(a)) {
      return undefined;
    }
    let rel = b.slice(a.length);
    if (rel.startsWith(path.sep)) {
      rel = rel.slice(1);
    }
    return rel.replace(/\\/g, '/');
  }

  private rememberDirectoryChain(relativeDirPath: string): void {
    if (!relativeDirPath || relativeDirPath === '.') { return; }
    const parts = relativeDirPath.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      this.knownDirectories.add(current);
    }
  }

  private deleteKnownDirectory(relativeDirPath: string): void {
    for (const dir of [...this.knownDirectories]) {
      if (dir === relativeDirPath || dir.startsWith(`${relativeDirPath}/`)) {
        this.knownDirectories.delete(dir);
      }
    }
  }
}

function safeStat(filePath: string): fs.Stats | undefined {
  try {
    return fs.statSync(filePath);
  } catch {
    return undefined;
  }
}

function safeReadText(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}
