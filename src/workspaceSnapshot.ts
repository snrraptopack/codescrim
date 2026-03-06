import * as fs from 'fs';
import * as path from 'path';
import { shouldIgnorePath } from './utils';

export interface WorkspaceSnapshot {
  files: Record<string, string>;
  directories: string[];
}

export function scanWorkspaceSnapshot(root: string | undefined, maxBytes: number): WorkspaceSnapshot {
  if (!root || !fs.existsSync(root)) {
    return { files: {}, directories: [] };
  }

  const files: Record<string, string> = {};
  const directories = new Set<string>();

  walk(root, root, maxBytes, files, directories);

  return {
    files,
    directories: [...directories].sort((a, b) => a.localeCompare(b)),
  };
}

function walk(
  currentPath: string,
  root: string,
  maxBytes: number,
  files: Record<string, string>,
  directories: Set<string>,
): void {
  const entries = safeReadDir(currentPath);
  for (const entry of entries) {
    const fullPath = path.join(currentPath, entry.name);
    const rel = path.relative(root, fullPath).replace(/\\/g, '/');
    if (!rel || shouldIgnorePath(rel)) {
      continue;
    }

    if (entry.isDirectory()) {
      directories.add(rel);
      walk(fullPath, root, maxBytes, files, directories);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const stat = safeStat(fullPath);
    if (!stat || stat.size > maxBytes) {
      continue;
    }

    try {
      files[rel] = fs.readFileSync(fullPath, 'utf8');
      addParentDirectories(rel, directories);
    } catch {
      // ignore unreadable files
    }
  }
}

function addParentDirectories(relativeFilePath: string, directories: Set<string>): void {
  const parts = relativeFilePath.split('/');
  parts.pop();
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    directories.add(current);
  }
}

function safeReadDir(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeStat(filePath: string): fs.Stats | undefined {
  try {
    return fs.statSync(filePath);
  } catch {
    return undefined;
  }
}
