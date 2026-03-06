"use strict";
// ─── .scrim file format ─────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTerminalEvent = isTerminalEvent;
/** Type guard — true for any of the three terminal event variants. */
function isTerminalEvent(ev) {
    return ev.type === 'terminalOpen' || ev.type === 'terminal' || ev.type === 'terminalClose';
}
//# sourceMappingURL=types.js.map