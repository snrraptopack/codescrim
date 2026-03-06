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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const recorder_1 = require("./recorder");
const player_1 = require("./player");
let recorder;
let player;
function activate(context) {
    try {
        recorder = new recorder_1.Recorder(context);
        player = new player_1.Player(context);
        // ── register commands ────────────────────────────────────────────────────
        context.subscriptions.push(vscode.commands.registerCommand('codescrim.startRecording', () => {
            recorder?.startRecording();
        }), vscode.commands.registerCommand('codescrim.stopRecording', () => {
            recorder?.stopRecording();
        }), vscode.commands.registerCommand('codescrim.addChapter', () => {
            recorder?.addChapter();
        }), 
        // Accepts an optional file path argument (used when called programmatically
        // after saving a recording, or from the Explorer context menu).
        vscode.commands.registerCommand('codescrim.playScrim', async (uriOrPath) => {
            let filePath;
            if (uriOrPath instanceof vscode.Uri) {
                filePath = uriOrPath.fsPath;
            }
            else if (typeof uriOrPath === 'string') {
                filePath = uriOrPath;
            }
            else {
                // No argument — show open dialog
                const uris = await vscode.window.showOpenDialog({
                    title: 'Open CodeScrim Tutorial',
                    filters: { 'Scrim Tutorial': ['scrim'], 'All Files': ['*'] },
                    canSelectMany: false,
                });
                filePath = uris?.[0]?.fsPath;
            }
            if (filePath) {
                player?.openScrim(filePath);
            }
        }));
        // ── global status bar items ────────────────────────────────────────────────
        const recordSb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        recordSb.command = 'codescrim.startRecording';
        recordSb.text = '$(record-keys) Record Scrim';
        recordSb.tooltip = 'Start recording a new CodeScrim tutorial';
        recordSb.show();
        context.subscriptions.push(recordSb);
        const playSb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        playSb.command = 'codescrim.playScrim';
        playSb.text = '$(play-circle) Open Scrim';
        playSb.tooltip = 'Open and play a CodeScrim tutorial';
        playSb.show();
        context.subscriptions.push(playSb);
        console.log('CodeScrim: extension activated');
    }
    catch (err) {
        vscode.window.showErrorMessage('CRITICAL EXTENSION CRASH: ' + (err.stack || err.message || String(err)));
        console.error(err);
    }
}
function deactivate() {
    recorder?.dispose();
    player?.dispose();
}
//# sourceMappingURL=extension.js.map