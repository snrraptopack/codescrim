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
exports.Recorder = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const utils_1 = require("./utils");
const terminalRecorder_1 = require("./terminalRecorder");
/* ─────────────────────────────────────────────────────────────────────────────
 *  Path helpers — kept dead-simple to avoid cross-case bugs on Windows
 * ─────────────────────────────────────────────────────────────────────────── */
function getWorkspaceRoot() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
/**
 * Compute a stable, **normalised** relative path or `undefined` if the file
 * is outside the workspace.  Uses forward-slashes so keys are consistent
 * across every call site.
 */
function relPath(absPath) {
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
    if (rel.startsWith(path.sep)) {
        rel = rel.slice(1);
    }
    return rel.replace(/\\/g, '/');
}
/* ─────────────────────────────────────────────────────────────────────────────
 *  Recorder
 * ─────────────────────────────────────────────────────────────────────────── */
class Recorder {
    constructor(context) {
        // ── recording state ──────────────────────────────────────────────────────
        this._recording = false;
        this._startTime = 0;
        this._events = [];
        this._lastContent = {}; // rel → latest text
        // ── sub-modules ──────────────────────────────────────────────────────────
        this.terminalRecorder = new terminalRecorder_1.TerminalRecorder();
        this.context = context;
        this.log = vscode.window.createOutputChannel('CodeScrim Recorder');
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 200);
        this.statusBar.command = 'codescrim.stopRecording';
        context.subscriptions.push(this.statusBar, this.log, vscode.workspace.onDidChangeTextDocument(e => this.handleDocChange(e)), vscode.workspace.onDidSaveTextDocument(d => this.handleDocumentSave(d)), vscode.window.onDidChangeActiveTextEditor(e => this.handleEditorSwitch(e)), vscode.window.onDidChangeTextEditorSelection(e => this.handleSelection(e)));
    }
    /* ══════════════════════════════════════════════════════════════════════════
     *  PUBLIC — start / stop / addChapter
     * ══════════════════════════════════════════════════════════════════════════ */
    async startRecording() {
        if (this._recording) {
            vscode.window.showWarningMessage('CodeScrim is already recording.');
            return;
        }
        // ── title ──────────────────────────────────────────────────────────────
        const title = await vscode.window.showInputBox({
            title: 'CodeScrim — New Tutorial',
            prompt: 'Give your tutorial a title',
            placeHolder: 'e.g. "Building a REST API with Express"',
            validateInput: (v) => (v.trim() ? null : 'Title cannot be empty'),
        });
        if (title === undefined) {
            return;
        }
        // Mark recording BEFORE any other async work
        this._recording = true;
        this._events = [];
        this._lastContent = {};
        await this.context.workspaceState.update('codescrim.title', title.trim());
        vscode.commands.executeCommand('setContext', 'codescrim.isRecording', true);
        // ── startTime ──────────────────────────────────────────────────────────
        this._startTime = Date.now();
        // ── capture "frame 0" — the existing codebase ──────────────────────────
        this.captureSetup();
        this.log.appendLine(`[start] title="${title.trim()}" setupFiles=${Object.keys(this._lastContent).length}`);
        console.log(`[CodeScrim] setup captured — ${this._events.length} events, files: ${Object.keys(this._lastContent).join(', ')}`);
        // ── terminal recorder ──────────────────────────────────────────────────
        this.terminalRecorder.start(() => this.ts());
        if (!terminalRecorder_1.TerminalRecorder.isSupported) {
            console.log('[CodeScrim] terminal capture requires VS Code 1.87+ — skipping.');
        }
        // ── status-bar timer ───────────────────────────────────────────────────
        this.updateBar();
        this.statusBar.show();
        this.clockTimer = setInterval(() => {
            if (this._recording) {
                this.updateBar();
            }
        }, 1000);
        vscode.window
            .showInformationMessage(`🎬 Recording "${title.trim()}" — code is being captured.`, 'Add Chapter Marker', 'Stop Recording')
            .then(choice => {
            if (choice === 'Add Chapter Marker') {
                this.addChapter();
            }
            if (choice === 'Stop Recording') {
                this.stopRecording();
            }
        });
    }
    async addChapter() {
        if (!this._recording) {
            return;
        }
        const name = await vscode.window.showInputBox({
            title: 'Add Chapter Marker',
            prompt: 'Chapter name',
            placeHolder: 'e.g. "Setting up the database"',
            validateInput: (v) => (v.trim() ? null : 'Name required'),
        });
        if (name === undefined) {
            return;
        }
        this._events.push({ type: 'chapter', timestamp: this.ts(), title: name.trim() });
        vscode.window.setStatusBarMessage(`📌 Chapter: "${name.trim()}"`, 4000);
    }
    async stopRecording() {
        if (!this._recording) {
            return;
        }
        this._recording = false;
        vscode.commands.executeCommand('setContext', 'codescrim.isRecording', false);
        if (this.clockTimer) {
            clearInterval(this.clockTimer);
            this.clockTimer = undefined;
        }
        const title = this.context.workspaceState.get('codescrim.title') ?? 'untitled';
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
            this.statusBar.hide();
            return;
        }
        // ── merge + sort events ────────────────────────────────────────────────
        const termEvents = this.terminalRecorder.stop();
        const allEvents = [...this._events, ...termEvents].sort((a, b) => a.timestamp - b.timestamp);
        // ── write .scrim ───────────────────────────────────────────────────────
        const scrim = {
            version: '1.0',
            title,
            audioUrl: '',
            events: allEvents,
            createdAt: new Date().toISOString(),
        };
        fs.writeFileSync(saveUri.fsPath, JSON.stringify(scrim, null, 2), 'utf8');
        this.statusBar.hide();
        // ── summary ────────────────────────────────────────────────────────────
        const counts = {
            setup: 0, snapshot: 0, edit: 0, selection: 0, openFile: 0, chapter: 0, other: 0,
        };
        for (const ev of allEvents) {
            if (ev.type in counts) {
                counts[ev.type]++;
            }
            else {
                counts.other++;
            }
        }
        this.log.appendLine(`[stop] saved=${saveUri.fsPath} total=${allEvents.length} setup=${counts.setup} edit=${counts.edit} snap=${counts.snapshot} sel=${counts.selection} open=${counts.openFile}`);
        console.log('[CodeScrim] saved', saveUri.fsPath, counts);
        const msg = `✅ Saved "${title}" — ${allEvents.length} events ` +
            `(setup:${counts.setup} snap:${counts.snapshot} sel:${counts.selection} open:${counts.openFile}) ` +
            `${counts.chapter} chapters.`;
        const choice = await vscode.window.showInformationMessage(msg, 'Play Tutorial', 'Open File');
        if (choice === 'Play Tutorial') {
            vscode.commands.executeCommand('codescrim.playScrim', saveUri.fsPath);
        }
        else if (choice === 'Open File') {
            vscode.window.showTextDocument(saveUri);
        }
    }
    /* ══════════════════════════════════════════════════════════════════════════
     *  EVENT HANDLERS — wrapped in try/catch so errors are never silent
     * ══════════════════════════════════════════════════════════════════════════ */
    handleDocChange(e) {
        try {
            if (!this._recording) {
                return;
            }
            if (e.document.uri.scheme !== 'file') {
                return;
            }
            if (e.contentChanges.length === 0) {
                return;
            }
            const rel = relPath(e.document.uri.fsPath);
            if (!rel) {
                return;
            }
            if ((0, utils_1.shouldIgnorePath)(rel)) {
                return;
            }
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
        }
        catch (err) {
            this.log.appendLine(`[change:error] ${String(err)}`);
            console.error('[CodeScrim] handleDocChange error:', err);
        }
    }
    handleDocumentSave(document) {
        try {
            if (!this._recording) {
                return;
            }
            if (document.uri.scheme !== 'file') {
                return;
            }
            const rel = relPath(document.uri.fsPath);
            if (!rel) {
                return;
            }
            if ((0, utils_1.shouldIgnorePath)(rel)) {
                return;
            }
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
        }
        catch (err) {
            this.log.appendLine(`[save:error] ${String(err)}`);
            console.error('[CodeScrim] handleDocumentSave error:', err);
        }
    }
    handleEditorSwitch(e) {
        try {
            if (!this._recording || !e || e.document.uri.scheme !== 'file') {
                return;
            }
            const rel = relPath(e.document.uri.fsPath);
            if (!rel) {
                return;
            }
            this._events.push({ type: 'openFile', timestamp: this.ts(), file: rel });
        }
        catch (err) {
            console.error('[CodeScrim] handleEditorSwitch error:', err);
        }
    }
    handleSelection(e) {
        try {
            if (!this._recording || e.textEditor.document.uri.scheme !== 'file') {
                return;
            }
            const rel = relPath(e.textEditor.document.uri.fsPath);
            if (!rel) {
                return;
            }
            this._events.push({
                type: 'selection',
                timestamp: this.ts(),
                file: rel,
                selections: e.selections.map(s => serSel(s)),
            });
        }
        catch (err) {
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
    captureSetup() {
        const maxBytes = (vscode.workspace.getConfiguration('codescrim')
            .get('maxFileSizeKb', 500)) * 1024;
        const files = {};
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.uri.scheme !== 'file') {
                continue;
            }
            if (doc.isUntitled) {
                continue;
            }
            if (doc.getText().length > maxBytes) {
                continue;
            }
            const rel = relPath(doc.uri.fsPath);
            if (!rel) {
                continue;
            }
            if ((0, utils_1.shouldIgnorePath)(rel)) {
                continue;
            }
            files[rel] = doc.getText();
        }
        if (Object.keys(files).length === 0) {
            return;
        }
        this._lastContent = { ...files };
        this._events.push({ type: 'setup', timestamp: 0, files });
    }
    /* ══════════════════════════════════════════════════════════════════════════
     *  TINY HELPERS
     * ══════════════════════════════════════════════════════════════════════════ */
    ts() {
        return (Date.now() - this._startTime) / 1000;
    }
    updateBar() {
        const elapsed = this.ts();
        const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const s = Math.floor(elapsed % 60).toString().padStart(2, '0');
        this.statusBar.text =
            `$(record) CodeScrim ${m}:${s}  ·  ${this._events.length} events  —  click to stop`;
        this.statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBar.tooltip = 'Click to stop recording and save tutorial';
    }
    dispose() {
        if (this.clockTimer) {
            clearInterval(this.clockTimer);
        }
        this.terminalRecorder.dispose();
        this.log.dispose();
        this.statusBar.dispose();
    }
}
exports.Recorder = Recorder;
/* ─────────────────────────────────────────────────────────────────────────────
 *  Pure helpers (no instance state)
 * ─────────────────────────────────────────────────────────────────────────── */
function serSel(s) {
    return {
        anchor: { line: s.anchor.line, character: s.anchor.character },
        active: { line: s.active.line, character: s.active.character },
    };
}
function getSelectionsForDocument(document) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return undefined;
    }
    if (activeEditor.document.uri.toString() !== document.uri.toString()) {
        return undefined;
    }
    return activeEditor.selections.map(s => serSel(s));
}
function applyRecordedChanges(text, changes) {
    const sorted = [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
    let next = text;
    for (const ch of sorted) {
        next = next.slice(0, ch.rangeOffset) + ch.text + next.slice(ch.rangeOffset + ch.rangeLength);
    }
    return next;
}
function endPositionForText(text) {
    if (text.length === 0) {
        return { line: 0, character: 0 };
    }
    const lines = text.split('\n');
    return {
        line: lines.length - 1,
        character: lines[lines.length - 1].length,
    };
}
//# sourceMappingURL=recorder.js.map