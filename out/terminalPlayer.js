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
exports.TerminalPlayer = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Replays recorded terminal events by creating read-only Pseudo-Terminals.
 *
 * Each recorded terminal gets its own `▶ <name>` PTY panel in the editor.
 * The terminal is read-only from the user's perspective (they cannot type in
 * it); all content is driven by the playback engine.
 */
class TerminalPlayer {
    constructor() {
        this.sessions = new Map();
    }
    // ── playback API ──────────────────────────────────────────────────────────
    /**
     * Rebuild all terminal state from scratch for a seek/scrub to `time`.
     * Closes every existing PTY session first, then recreates them with the
     * cumulative output up to `time`.
     */
    syncToTime(events, time) {
        this.disposeAllSessions();
        // Re-create each terminal that was open at or before `time`
        const opens = events.filter((e) => e.type === 'terminalOpen' && e.timestamp <= time);
        for (const open of opens) {
            const session = this.createSession(open.terminalId, open.name);
            // Replay all output for this terminal up to `time`
            const dataEvents = events.filter((e) => e.type === 'terminal' &&
                e.terminalId ===
                    open.terminalId &&
                e.timestamp <= time);
            const combined = dataEvents.map((e) => e.data).join('');
            if (combined) {
                session.writeEmitter.fire(combined);
                session.cumulativeData = combined;
            }
        }
    }
    /**
     * Apply a single terminal event incrementally during normal playback.
     * No-op for event types that aren't terminal-related.
     */
    applyEvent(ev) {
        if (ev.type === 'terminalOpen') {
            if (!this.sessions.has(ev.terminalId)) {
                this.createSession(ev.terminalId, ev.name);
            }
        }
        else if (ev.type === 'terminal') {
            const session = this.sessions.get(ev.terminalId);
            if (session) {
                session.writeEmitter.fire(ev.data);
                session.cumulativeData += ev.data;
            }
        }
        else if (ev.type === 'terminalClose') {
            const session = this.sessions.get(ev.terminalId);
            if (session) {
                session.closeEmitter.fire();
                this.sessions.delete(ev.terminalId);
            }
        }
    }
    reset() {
        this.disposeAllSessions();
    }
    dispose() {
        this.disposeAllSessions();
    }
    // ── private helpers ───────────────────────────────────────────────────────
    createSession(id, name) {
        const writeEmitter = new vscode.EventEmitter();
        const closeEmitter = new vscode.EventEmitter();
        const pty = {
            onDidWrite: writeEmitter.event,
            onDidClose: closeEmitter.event,
            open: () => {
                writeEmitter.fire('\x1b[90m[CodeScrim] Terminal replay — read-only\x1b[0m\r\n');
            },
            close: () => {
                this.sessions.delete(id);
            },
        };
        const terminal = vscode.window.createTerminal({
            name: `▶ ${name}`,
            pty,
        });
        const session = {
            writeEmitter,
            closeEmitter,
            terminal,
            cumulativeData: '',
        };
        this.sessions.set(id, session);
        return session;
    }
    disposeAllSessions() {
        for (const session of this.sessions.values()) {
            try {
                session.writeEmitter.dispose();
                session.closeEmitter.dispose();
                session.terminal.dispose();
            }
            catch {
                /* ignore */
            }
        }
        this.sessions.clear();
    }
}
exports.TerminalPlayer = TerminalPlayer;
//# sourceMappingURL=terminalPlayer.js.map