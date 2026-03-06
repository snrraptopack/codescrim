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
exports.AudioRecorder = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
/**
 * Records microphone audio by spawning ffmpeg in the Node.js extension-host
 * process.  This avoids the VS Code webview security sandbox which blocks
 * navigator.mediaDevices.getUserMedia() in Electron.
 *
 * Platform audio capture drivers:
 *   Windows  – DirectShow (dshow)
 *   macOS    – AVFoundation
 *   Linux    – PulseAudio (falls back to ALSA)
 *
 * Usage:
 *   const rec = new AudioRecorder();
 *   const ok  = await rec.start(level => statusBar.tooltip = `🎙 ${(level*100).toFixed(0)}%`);
 *   // ... recording ...
 *   const buf = await rec.stop();   // Buffer | null
 *   if (buf) fs.writeFileSync('audio.webm', buf);
 */
class AudioRecorder {
    constructor() {
        this._isRecording = false;
        this.lastSizeKb = 0;
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────
    get isRecording() {
        return this._isRecording;
    }
    /** Check whether ffmpeg is on the system PATH. */
    static async isAvailable() {
        return new Promise(resolve => {
            (0, child_process_1.execFile)('ffmpeg', ['-version'], { timeout: 4000 }, err => resolve(!err));
        });
    }
    /**
     * List available audio input device names (Windows only via DirectShow).
     * Returns ['default'] on macOS/Linux where no selection is needed.
     */
    static async listDevices() {
        const platform = os.platform();
        if (platform !== 'win32') {
            return [platform === 'darwin' ? ':0' : 'default'];
        }
        return new Promise(resolve => {
            const proc = (0, child_process_1.spawn)('ffmpeg', ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
                windowsHide: true,
            });
            let stderr = '';
            proc.stderr?.on('data', (d) => (stderr += d.toString()));
            proc.on('close', () => {
                const devices = [];
                const re = /"([^"]+)"\s*\(audio\)/g;
                let m;
                while ((m = re.exec(stderr)) !== null) {
                    devices.push(m[1]);
                }
                resolve(devices.length > 0 ? devices : []);
            });
            setTimeout(() => { proc.kill(); resolve([]); }, 5000);
        });
    }
    /**
     * Show a QuickPick so the user can choose an audio input, then return the
     * ffmpeg `-i` argument string.  Returns `undefined` if the user cancels.
     */
    static async pickDevice() {
        const platform = os.platform();
        if (platform === 'darwin') {
            return ':0'; // AVFoundation: ":0" = default mic
        }
        if (platform !== 'win32') {
            return 'default'; // PulseAudio/ALSA default
        }
        // Windows — enumerate DirectShow mics
        const vscode_ = vscode;
        await vscode_.window.withProgress({ location: vscode_.ProgressLocation.Notification, title: 'Detecting microphones…', cancellable: false }, async () => { });
        const devices = await AudioRecorder.listDevices();
        if (devices.length === 0) {
            vscode_.window.showWarningMessage('CodeScrim: No audio input devices detected by ffmpeg (DirectShow). ' +
                'Check that a microphone is connected and drivers are installed.');
            return undefined;
        }
        if (devices.length === 1) {
            return `audio="${devices[0]}"`;
        }
        const items = devices.map(d => ({ label: `$(mic) ${d}`, device: d }));
        const picked = await vscode_.window.showQuickPick(items, {
            title: 'Select Microphone',
            placeHolder: 'Choose the audio input device for this recording',
        });
        return picked ? `audio="${picked.device}"` : undefined;
    }
    /**
     * Start recording.  Spawns ffmpeg and waits up to 6 s for it to confirm
     * audio input is open, then resolves `true`.
     * Resolves `false` on any error or if the user cancels device selection.
     *
     * @param onLevel  Optional ~4 Hz callback receiving normalised level (0–1).
     */
    async start(onLevel) {
        if (this._isRecording) {
            return true;
        }
        if (!await AudioRecorder.isAvailable()) {
            vscode.window.showErrorMessage('CodeScrim: ffmpeg not found on PATH. ' +
                'Install ffmpeg (https://ffmpeg.org/download.html) and restart VS Code to enable audio recording.');
            return false;
        }
        const deviceArg = await AudioRecorder.pickDevice();
        if (deviceArg === undefined) {
            return false; // user cancelled mic selection
        }
        this.outputPath = path.join(os.tmpdir(), `codescrim-audio-${Date.now()}.webm`);
        this.onLevel = onLevel;
        this.lastSizeKb = 0;
        const args = AudioRecorder.buildArgs(deviceArg, this.outputPath);
        return new Promise(resolve => {
            this.ffmpeg = (0, child_process_1.spawn)('ffmpeg', args, { windowsHide: true });
            let started = false;
            let stderrBuf = '';
            const startTimeout = setTimeout(() => {
                if (!started) {
                    this.ffmpeg?.kill();
                    resolve(false);
                }
            }, 6000);
            this.ffmpeg.stderr?.on('data', (chunk) => {
                const text = chunk.toString();
                stderrBuf += text;
                if (!started && (stderrBuf.includes('Press [q]') ||
                    stderrBuf.includes('size=') ||
                    stderrBuf.includes('time='))) {
                    started = true;
                    this._isRecording = true;
                    clearTimeout(startTimeout);
                    resolve(true);
                }
                if (started) {
                    this.emitSyntheticLevel(text);
                }
            });
            this.ffmpeg.on('error', (err) => {
                console.error('CodeScrim AudioRecorder ffmpeg error:', err.message);
                clearTimeout(startTimeout);
                if (!started) {
                    resolve(false);
                }
                else {
                    this._isRecording = false;
                    this.stopResolve?.(null);
                    this.stopResolve = undefined;
                }
            });
            this.ffmpeg.on('exit', () => {
                this._isRecording = false;
                clearInterval(this.levelTimer);
                this.levelTimer = undefined;
                if (this.stopResolve) {
                    const buf = this.readAndClean();
                    const cb = this.stopResolve;
                    this.stopResolve = undefined;
                    cb(buf);
                }
            });
        });
    }
    /**
     * Gracefully stop ffmpeg, wait for it to flush, and return the audio Buffer.
     * Returns `null` if nothing was captured.
     */
    async stop() {
        if (!this._isRecording || !this.ffmpeg) {
            return this.readAndClean();
        }
        return new Promise(resolve => {
            this.stopResolve = resolve;
            try {
                this.ffmpeg.stdin?.write('q\n');
                this.ffmpeg.stdin?.end();
            }
            catch {
                this.ffmpeg.kill('SIGTERM');
            }
            // Hard kill after 8 s
            setTimeout(() => {
                if (this.stopResolve) {
                    this.ffmpeg?.kill('SIGKILL');
                }
            }, 8000);
        });
    }
    dispose() {
        this._isRecording = false;
        clearInterval(this.levelTimer);
        this.levelTimer = undefined;
        if (this.ffmpeg) {
            try {
                this.ffmpeg.stdin?.end();
            }
            catch { /* ignore */ }
            this.ffmpeg.kill('SIGTERM');
            this.ffmpeg = undefined;
        }
        this.cleanOutput();
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────
    static buildArgs(deviceArg, outputPath) {
        const platform = os.platform();
        const outputArgs = ['-c:a', 'libopus', '-b:a', '64k', '-vn', '-y', outputPath];
        if (platform === 'win32') {
            return ['-f', 'dshow', '-i', deviceArg, ...outputArgs];
        }
        if (platform === 'darwin') {
            return ['-f', 'avfoundation', '-i', deviceArg, ...outputArgs];
        }
        return ['-f', 'pulse', '-i', deviceArg, ...outputArgs];
    }
    /** Parse ffmpeg size= stats to emit a approximate level (0–1) */
    emitSyntheticLevel(text) {
        const m = text.match(/size=\s*(\d+)kB/);
        if (!m) {
            if (!this.levelTimer) {
                let phase = 0;
                this.levelTimer = setInterval(() => {
                    phase = (phase + 0.25) % (2 * Math.PI);
                    this.onLevel?.(0.3 + 0.2 * Math.sin(phase));
                }, 250);
            }
            return;
        }
        clearInterval(this.levelTimer);
        this.levelTimer = undefined;
        const sizeKb = parseInt(m[1], 10);
        const delta = Math.max(0, sizeKb - this.lastSizeKb);
        this.lastSizeKb = sizeKb;
        this.onLevel?.(Math.min(1, delta > 0 ? delta / 8 : 0.1));
    }
    readAndClean() {
        if (!this.outputPath) {
            return null;
        }
        try {
            if (!fs.existsSync(this.outputPath)) {
                return null;
            }
            const buf = fs.readFileSync(this.outputPath);
            return buf.length > 0 ? buf : null;
        }
        catch {
            return null;
        }
        finally {
            this.cleanOutput();
        }
    }
    cleanOutput() {
        if (this.outputPath) {
            try {
                fs.unlinkSync(this.outputPath);
            }
            catch { /* already gone */ }
            this.outputPath = undefined;
        }
        this.lastSizeKb = 0;
    }
}
exports.AudioRecorder = AudioRecorder;
//# sourceMappingURL=audioRecorder.js.map