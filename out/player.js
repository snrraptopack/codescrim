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
exports.Player = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const types_1 = require("./types");
const webviewHtml_1 = require("./webviewHtml");
const vfsEngine_1 = require("./vfsEngine");
const messageQueue_1 = require("./messageQueue");
const terminalPlayer_1 = require("./terminalPlayer");
class Player {
    constructor(context) {
        //  sub-modules 
        this.vfs = new vfsEngine_1.VfsEngine();
        this.queue = new messageQueue_1.MessageQueue();
        this.terms = new terminalPlayer_1.TerminalPlayer();
        //  vs code listeners 
        this.disposables = [];
        this.context = context;
        this.disposables.push(vscode.workspace.onDidChangeTextDocument(e => this.onUserEdit(e)), vscode.window.onDidChangeTextEditorSelection(e => this.onEditorClick(e)), vscode.workspace.onWillSaveTextDocument(e => this.onWillSave(e)));
    }
    //  public API 
    async openScrim(filePath) {
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            const scrim = JSON.parse(raw);
            if (!scrim.events || !Array.isArray(scrim.events)) {
                vscode.window.showErrorMessage('CodeScrim: Invalid .scrim file  no events found.');
                return;
            }
            // If the audio path is a bare filename, resolve it relative to the .scrim file
            if (scrim.audioUrl && !scrim.audioUrl.startsWith('http') && !path.isAbsolute(scrim.audioUrl)) {
                scrim.audioUrl = path.join(path.dirname(filePath), scrim.audioUrl);
            }
            await this.startPlayback(scrim);
        }
        catch (err) {
            vscode.window.showErrorMessage(`CodeScrim: Could not open file  ${err}`);
        }
    }
    //  core playback 
    async startPlayback(scrim) {
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
        const setup = scrim.events.find(e => e.type === 'setup');
        if (setup) {
            await this.vfs.applySetup(setup, this.tempDir);
        }
        // Open the primary file in the editor
        await this.ensureEditorFocus();
        // Create (or reuse) the webview panel
        if (this.panel) {
            this.panel.webview.html = (0, webviewHtml_1.buildPlayerHtml)(scrim);
            this.panel.reveal(vscode.ViewColumn.Beside);
        }
        else {
            this.panel = vscode.window.createWebviewPanel('codescrim.player', ` ${scrim.title}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(this.tempDir),
                    this.context.extensionUri,
                ],
            });
            this.panel.onDidDispose(() => { this.panel = undefined; this.cleanup(); });
            this.panel.webview.onDidReceiveMessage((msg) => this.queue.enqueue(msg, (m) => this.processMessage(m)));
            this.panel.webview.html = (0, webviewHtml_1.buildPlayerHtml)(scrim);
        }
    }
    //  message processing 
    async processMessage(msg) {
        if (!this.state) {
            return;
        }
        switch (msg.type) {
            case 'ready':
                this.postToWebview({ type: 'init', scrim: this.state.scrim });
                break;
            case 'timeUpdate':
                if (this.state.isEditMode) {
                    break;
                }
                if (msg.time >= this.state.currentTime && (msg.time - this.state.currentTime) < 15.0) {
                    await this.advanceToTime(msg.time);
                }
                else {
                    await this.syncToTime(msg.time);
                }
                this.state.currentTime = msg.time;
                break;
            case 'paused':
                this.state.isPlaying = false;
                this.state.isEditMode = true;
                this.state.currentTime = msg.time;
                this.postToWebview({ type: 'setEditMode', active: true });
                vscode.window.setStatusBarMessage('$(pencil) CodeScrim: Paused  edit mode active. The code is yours!', 6000);
                break;
            case 'played':
                this.state.isPlaying = true;
                if (this.state.isEditMode || msg.time < this.state.currentTime) {
                    // Revert user edits OR replay-from-end
                    this.state.isEditMode = false;
                    this.state.currentTime = msg.time;
                    this.postToWebview({ type: 'setEditMode', active: false });
                    await this.syncToTime(msg.time);
                }
                else {
                    this.state.currentTime = msg.time;
                }
                break;
            case 'ended':
                this.state.isPlaying = false;
                this.state.isEditMode = false;
                this.state.currentEventIndex = -1;
                this.state.currentTime = 0;
                this.postToWebview({ type: 'setEditMode', active: false });
                vscode.window.showInformationMessage(' Tutorial complete! Great job.');
                break;
            case 'editRequested':
                this.state.isPlaying = false;
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
    async syncToTime(time) {
        if (!this.state || !this.tempDir) {
            return;
        }
        const { scrim } = this.state;
        // VFS: full rebuild of code state
        const result = await this.vfs.syncToTime(scrim.events, time, this.tempDir, (title, ts) => {
            vscode.window.setStatusBarMessage(` ${title}`, 4000);
            this.postToWebview({ type: 'syncToTime', time: ts, chapter: title });
        });
        this.state.currentEventIndex = result.lastIndex;
        // Terminals: rebuild PTY state
        const termEvents = scrim.events.filter(types_1.isTerminalEvent);
        this.terms.syncToTime(termEvents, time);
    }
    async advanceToTime(time) {
        if (!this.state || !this.tempDir) {
            return;
        }
        const { scrim } = this.state;
        const newIndex = await this.vfs.advanceToTime(scrim.events, this.state.currentEventIndex, time, this.tempDir, (title, ts) => {
            vscode.window.setStatusBarMessage(` ${title}`, 4000);
            this.postToWebview({ type: 'syncToTime', time: ts, chapter: title });
        });
        this.state.currentEventIndex = newIndex;
        // Incrementally apply any terminal events in the same range
        const from = this.state.currentEventIndex;
        for (let i = Math.max(0, from); i < scrim.events.length; i++) {
            const ev = scrim.events[i];
            if (ev.timestamp > time) {
                break;
            }
            if ((0, types_1.isTerminalEvent)(ev)) {
                this.terms.applyEvent(ev);
            }
        }
    }
    //  editor interaction guards 
    /** User typed while video was playing  pause immediately. */
    onUserEdit(e) {
        if (this.vfs.isUpdating) {
            return;
        }
        if (!this.state?.isPlaying || !this.tempDir) {
            return;
        }
        if (e.contentChanges.length === 0) {
            return;
        }
        if (!e.document.uri.fsPath.toLowerCase().startsWith(path.normalize(this.tempDir).toLowerCase())) {
            return;
        }
        this.postToWebview({ type: 'forcePause' });
    }
    /** Mouse click in tutorial code while playing  pause + edit mode. */
    onEditorClick(e) {
        if (this.vfs.isUpdating) {
            return;
        }
        if (!this.state?.isPlaying || this.state.isEditMode || !this.tempDir) {
            return;
        }
        if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) {
            return;
        }
        if (!e.textEditor.document.uri.fsPath.toLowerCase().startsWith(path.normalize(this.tempDir).toLowerCase())) {
            return;
        }
        this.postToWebview({ type: 'forcePause' });
    }
    /**
     * Ctrl+S during playback (non-edit mode): restore tutorial content to disk
     * so the file stays clean.  In edit mode, let the save go through normally.
     */
    onWillSave(e) {
        if (!this.state || !this.tempDir) {
            return;
        }
        const fsPath = e.document.uri.fsPath;
        if (!fsPath.toLowerCase().startsWith(path.normalize(this.tempDir).toLowerCase())) {
            return;
        }
        if (this.state.isEditMode) {
            return;
        } // user is intentionally editing
        const rel = path.relative(this.tempDir, fsPath).replace(/\\/g, '/');
        const tutorialContent = this.vfs.snapshot[rel];
        if (tutorialContent === undefined) {
            return;
        }
        e.waitUntil(Promise.resolve([
            new vscode.TextEdit(new vscode.Range(0, 0, e.document.lineCount, 0), tutorialContent),
        ]));
    }
    //  editor focus 
    async ensureEditorFocus() {
        if (!this.tempDir || !this.state) {
            return;
        }
        const cfg = vscode.workspace.getConfiguration('codescrim');
        if (!cfg.get('autoOpenFiles', true)) {
            return;
        }
        // Prefer the first file a user interacts with; otherwise the first setup file
        const setup = this.state.scrim.events.find(e => e.type === 'setup');
        if (!setup) {
            return;
        }
        const files = Object.keys(setup.files);
        if (files.length === 0) {
            return;
        }
        let activeFile = files.find(f => !f.endsWith('.json') && !f.endsWith('.md')) ?? files[0];
        const firstAction = this.state.scrim.events.find(e => e.type === 'edit' || e.type === 'selection' || e.type === 'openFile' || e.type === 'snapshot');
        if (firstAction && 'file' in firstAction && firstAction.file) {
            activeFile = firstAction.file;
        }
        else if (firstAction && firstAction.type === 'snapshot' && firstAction.activeFile) {
            activeFile = firstAction.activeFile;
        }
        try {
            const fullPath = path.join(this.tempDir, activeFile);
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
        }
        catch {
            /* file may not exist yet during initial setup  ignore */
        }
    }
    //  helpers 
    postToWebview(msg) {
        this.panel?.webview.postMessage(msg);
    }
    cleanup() {
        this.terms.reset();
        this.vfs.reset();
        this.queue.clear();
        if (this.tempDir && fs.existsSync(this.tempDir)) {
            try {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
            }
            catch { /* ignore */ }
        }
        this.tempDir = undefined;
        this.state = undefined;
    }
    dispose() {
        this.panel?.dispose();
        this.cleanup();
        this.terms.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
exports.Player = Player;
//# sourceMappingURL=player.js.map