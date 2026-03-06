"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.VfsEngine = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// ── helpers ───────────────────────────────────────────────────────────────────
function norm(p) {
    return path.normalize(p).toLowerCase();
}
/**
 * Pure string-level application of a list of text changes sorted descending
 * by rangeOffset (so earlier insertions don't shift later offsets).
 */
function applyChanges(text, changes) {
    const sorted = [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
    for (const ch of sorted) {
        text = text.slice(0, ch.rangeOffset) + ch.text + text.slice(ch.rangeOffset + ch.rangeLength);
    }
    return text;
}
function toSelection(s) {
    return new vscode.Selection(s.anchor.line, s.anchor.character, s.active.line, s.active.character);
}
/**
 * Single-responsibility module that owns the in-memory Virtual File System
 * (VFS) and keeps it synchronised with the real VS Code workspace.
 *
 * All workspace write operations increment/decrement `_depth` so callers
 * can test `isUpdating` to distinguish engine writes from user edits.
 */
class VfsEngine {
    constructor() {
        /** Ground-truth in-memory content of every temp tutorial file */
        this._snapshot = {};
        /** Ref-count: >0 means the engine is currently writing to the workspace */
        this._depth = 0;
    }
    get isUpdating() {
        return this._depth > 0;
    }
    /** Read-only access to the current file snapshot (used by the save blocker). */
    get snapshot() {
        return this._snapshot;
    }
    reset() {
        this._snapshot = {};
        this._depth = 0;
    }
    // ── setup ─────────────────────────────────────────────────────────────────
    /**
     * Write the initial tutorial files to `tempDir` and seed the in-memory
     * snapshot.  Patches open TextDocuments if they're already visible.
     */
    async applySetup(ev, tempDir) {
        for (const [rel, content] of Object.entries(ev.files)) {
            const fullPath = path.join(tempDir, rel);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(fullPath, content, 'utf8');
            this._snapshot[rel] = content;
            const openDoc = vscode.workspace.textDocuments.find((d) => norm(d.uri.fsPath) === norm(fullPath));
            if (openDoc && openDoc.getText() !== content) {
                const wsEdit = new vscode.WorkspaceEdit();
                wsEdit.replace(openDoc.uri, new vscode.Range(0, 0, openDoc.lineCount, 0), content);
                await vscode.workspace.applyEdit(wsEdit);
            }
        }
    }
    // ── full rebuild sync ─────────────────────────────────────────────────────
    /**
     * Rebuild the VFS completely by replaying all code events up to `time`.
     *
     * Use this for: seeking, scrubbing the timeline, resuming from edit mode.
     * Terminal events are skipped here — TerminalPlayer handles those.
     */
    async syncToTime(events, time, tempDir, onChapter) {
        // 1. Build VFS in memory
        const vfs = {};
        const setup = events.find((e) => e.type === 'setup');
        if (setup) {
            for (const [rel, content] of Object.entries(setup.files)) {
                vfs[rel] = content;
            }
        }
        let lastIndex = 0;
        let activeFile = null;
        let selections = [];
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
            }
            else if (ev.type === 'snapshot') {
                for (const [rel, content] of Object.entries(ev.files)) {
                    vfs[rel] = content;
                }
                if (ev.activeFile) {
                    activeFile = ev.activeFile;
                }
                if (ev.selections && ev.selections.length > 0) {
                    selections = ev.selections.map(toSelection);
                }
            }
            else if (ev.type === 'openFile') {
                activeFile = ev.file;
            }
            else if (ev.type === 'selection') {
                activeFile = ev.file;
                selections = ev.selections.map(toSelection);
            }
            else if (ev.type === 'chapter') {
                onChapter?.(ev.title, ev.timestamp);
            }
            lastIndex = i;
        }
        // 2. Persist snapshot
        this._snapshot = { ...vfs };
        // 3. Commit to workspace
        this._depth++;
        try {
            const wsEdit = new vscode.WorkspaceEdit();
            for (const [rel, content] of Object.entries(vfs)) {
                const fullPath = path.join(tempDir, rel);
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                const openDoc = vscode.workspace.textDocuments.find((d) => norm(d.uri.fsPath) === norm(fullPath));
                if (openDoc) {
                    if (openDoc.getText() !== content) {
                        wsEdit.replace(openDoc.uri, new vscode.Range(0, 0, openDoc.lineCount, 0), content);
                    }
                }
                else {
                    fs.writeFileSync(fullPath, content, 'utf8');
                }
            }
            await vscode.workspace.applyEdit(wsEdit);
            if (activeFile) {
                const fullPath = path.join(tempDir, activeFile);
                const openDoc = vscode.workspace.textDocuments.find((d) => norm(d.uri.fsPath) === norm(fullPath));
                const doc = await vscode.workspace.openTextDocument(openDoc ? openDoc.uri : vscode.Uri.file(fullPath));
                const editor = await vscode.window.showTextDocument(doc, {
                    preserveFocus: true,
                    preview: false,
                    viewColumn: vscode.ViewColumn.One,
                });
                if (selections.length > 0) {
                    editor.selections = selections;
                }
            }
        }
        finally {
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
    async advanceToTime(events, fromIndex, time, tempDir, onChapter) {
        let lastIndex = fromIndex;
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
                    await this.applyEvent(ev, tempDir, onChapter);
                }
                catch (err) {
                    console.error(`CodeScrim VfsEngine: event[${i}] failed`, err);
                }
                lastIndex = i;
            }
        }
        finally {
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
    async applyEvent(ev, tempDir, onChapter) {
        // Skip terminal events — handled by TerminalPlayer
        if (ev.type === 'terminalOpen' ||
            ev.type === 'terminal' ||
            ev.type === 'terminalClose') {
            return;
        }
        if (ev.type === 'openFile') {
            const fullPath = path.join(tempDir, ev.file);
            try {
                const openDoc = vscode.workspace.textDocuments.find((d) => norm(d.uri.fsPath) === norm(fullPath));
                const doc = await vscode.workspace.openTextDocument(openDoc ? openDoc.uri : vscode.Uri.file(fullPath));
                await vscode.window.showTextDocument(doc, {
                    preserveFocus: true,
                    preview: false,
                    viewColumn: vscode.ViewColumn.One,
                });
            }
            catch (e) {
                console.error('CodeScrim VfsEngine: openFile failed', e);
            }
        }
        else if (ev.type === 'edit') {
            // Keep snapshot in sync
            if (typeof this._snapshot[ev.file] === 'string') {
                this._snapshot[ev.file] = applyChanges(this._snapshot[ev.file], ev.changes);
            }
            const fullPath = path.join(tempDir, ev.file);
            const openDoc = vscode.workspace.textDocuments.find((d) => norm(d.uri.fsPath) === norm(fullPath));
            const uri = openDoc ? openDoc.uri : vscode.Uri.file(fullPath);
            const wsEdit = new vscode.WorkspaceEdit();
            // Apply bottom-to-top so earlier offsets don't shift later ones
            const sorted = [...ev.changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
            for (const ch of sorted) {
                const r = ch.range;
                wsEdit.replace(uri, new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character), ch.text);
            }
            await vscode.workspace.applyEdit(wsEdit);
        }
        else if (ev.type === 'snapshot') {
            const wsEdit = new vscode.WorkspaceEdit();
            for (const [rel, content] of Object.entries(ev.files)) {
                this._snapshot[rel] = content;
                const fullPath = path.join(tempDir, rel);
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                const openDoc = vscode.workspace.textDocuments.find((d) => norm(d.uri.fsPath) === norm(fullPath));
                if (openDoc) {
                    wsEdit.replace(openDoc.uri, new vscode.Range(0, 0, openDoc.lineCount, 0), content);
                }
                else {
                    fs.writeFileSync(fullPath, content, 'utf8');
                }
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
            }
        }
        else if (ev.type === 'selection') {
            const fullPath = path.join(tempDir, ev.file);
            const editor = vscode.window.visibleTextEditors.find((e) => norm(e.document.uri.fsPath) === norm(fullPath));
            if (editor) {
                editor.selections = ev.selections.map(toSelection);
            }
        }
        else if (ev.type === 'chapter') {
            onChapter?.(ev.title, ev.timestamp);
        }
    }
}
exports.VfsEngine = VfsEngine;
//# sourceMappingURL=vfsEngine.js.map