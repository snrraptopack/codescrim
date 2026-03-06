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
exports.TerminalRecorder = void 0;
const vscode = __importStar(require("vscode"));
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
class TerminalRecorder {
    constructor() {
        this.disposables = [];
        this.events = [];
        this.terminalIds = new Map();
        this.nextId = 1;
    }
    /** Whether the host VS Code supports terminal data capture. */
    static get isSupported() {
        return typeof vscode.window.onDidWriteTerminalData === 'function';
    }
    // ── lifecycle ─────────────────────────────────────────────────────────────
    start(getTimestamp) {
        this.getTimestamp = getTimestamp;
        this.events = [];
        this.terminalIds = new Map();
        this.nextId = 1;
        const api = vscode.window;
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
            this.disposables.push(api.onDidOpenTerminal((term) => {
                this.events.push({
                    type: 'terminalOpen',
                    timestamp: this.ts(),
                    terminalId: this.idFor(term),
                    name: term.name,
                });
            }));
        }
        // Terminals that are closed during recording
        if (typeof api.onDidCloseTerminal === 'function') {
            this.disposables.push(api.onDidCloseTerminal((term) => {
                const id = this.terminalIds.get(term);
                if (id === undefined) {
                    return;
                }
                this.events.push({
                    type: 'terminalClose',
                    timestamp: this.ts(),
                    terminalId: id,
                });
                this.terminalIds.delete(term);
            }));
        }
        // Raw terminal output (requires VS Code 1.87+)
        if (typeof api.onDidWriteTerminalData === 'function') {
            this.disposables.push(api.onDidWriteTerminalData((e) => {
                this.events.push({
                    type: 'terminal',
                    timestamp: this.ts(),
                    terminalId: this.idFor(e.terminal),
                    data: e.data,
                });
            }));
        }
    }
    /**
     * Stop capturing and return all collected terminal events.
     * The events are sorted by timestamp before being returned so they
     * merge cleanly with the code events array.
     */
    stop() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        return [...this.events].sort((a, b) => a.timestamp - b.timestamp);
    }
    dispose() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
    }
    // ── helpers ───────────────────────────────────────────────────────────────
    idFor(term) {
        let id = this.terminalIds.get(term);
        if (id === undefined) {
            id = this.nextId++;
            this.terminalIds.set(term, id);
        }
        return id;
    }
    ts() {
        return this.getTimestamp ? this.getTimestamp() : 0;
    }
}
exports.TerminalRecorder = TerminalRecorder;
//# sourceMappingURL=terminalRecorder.js.map