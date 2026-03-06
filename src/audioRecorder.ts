import { spawn, ChildProcess, execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

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
export class AudioRecorder implements vscode.Disposable {
  private ffmpeg: ChildProcess | undefined;
  private outputPath: string | undefined;
  private _isRecording = false;
  private onLevel: ((level: number) => void) | undefined;
  private levelTimer: ReturnType<typeof setInterval> | undefined;
  private stopResolve: ((buf: Buffer | null) => void) | undefined;
  private lastSizeKb = 0;

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  get isRecording(): boolean {
    return this._isRecording;
  }

  /** Check whether ffmpeg is on the system PATH. */
  static async isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      execFile('ffmpeg', ['-version'], { timeout: 4000 }, err => resolve(!err));
    });
  }

  /**
   * List available audio input device names (Windows only via DirectShow).
   * Returns ['default'] on macOS/Linux where no selection is needed.
   */
  static async listDevices(): Promise<string[]> {
    const platform = os.platform();

    if (platform !== 'win32') {
      return [platform === 'darwin' ? ':0' : 'default'];
    }

    return new Promise(resolve => {
      const proc = spawn('ffmpeg', ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
        windowsHide: true,
      });
      let stderr = '';
      proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
      proc.on('close', () => {
        const devices: string[] = [];
        const re = /"([^"]+)"\s*\(audio\)/g;
        let m: RegExpExecArray | null;
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
  static async pickDevice(): Promise<string | undefined> {
    const platform = os.platform();

    if (platform === 'darwin') {
      return ':0';         // AVFoundation: ":0" = default mic
    }
    if (platform !== 'win32') {
      return 'default';    // PulseAudio/ALSA default
    }

    // Windows — enumerate DirectShow mics
    const vscode_ = vscode;
    await vscode_.window.withProgress(
      { location: vscode_.ProgressLocation.Notification, title: 'Detecting microphones…', cancellable: false },
      async () => { /* just shows spinner while listDevices runs */ },
    );

    const devices = await AudioRecorder.listDevices();
    if (devices.length === 0) {
      vscode_.window.showWarningMessage(
        'CodeScrim: No audio input devices detected by ffmpeg (DirectShow). ' +
        'Check that a microphone is connected and drivers are installed.',
      );
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
  async start(onLevel?: (level: number) => void): Promise<boolean> {
    if (this._isRecording) {
      return true;
    }

    if (!await AudioRecorder.isAvailable()) {
      vscode.window.showErrorMessage(
        'CodeScrim: ffmpeg not found on PATH. ' +
        'Install ffmpeg (https://ffmpeg.org/download.html) and restart VS Code to enable audio recording.',
      );
      return false;
    }

    const deviceArg = await AudioRecorder.pickDevice();
    if (deviceArg === undefined) {
      return false;   // user cancelled mic selection
    }

    this.outputPath = path.join(os.tmpdir(), `codescrim-audio-${Date.now()}.webm`);
    this.onLevel = onLevel;
    this.lastSizeKb = 0;

    const args = AudioRecorder.buildArgs(deviceArg, this.outputPath);

    return new Promise<boolean>(resolve => {
      this.ffmpeg = spawn('ffmpeg', args, { windowsHide: true });

      let started = false;
      let stderrBuf = '';

      const startTimeout = setTimeout(() => {
        if (!started) {
          this.ffmpeg?.kill();
          resolve(false);
        }
      }, 6000);

      this.ffmpeg.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderrBuf += text;

        if (!started && (
          stderrBuf.includes('Press [q]') ||
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

      this.ffmpeg.on('error', (err: Error) => {
        console.error('CodeScrim AudioRecorder ffmpeg error:', err.message);
        clearTimeout(startTimeout);
        if (!started) {
          resolve(false);
        } else {
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
  async stop(): Promise<Buffer | null> {
    if (!this._isRecording || !this.ffmpeg) {
      return this.readAndClean();
    }

    return new Promise<Buffer | null>(resolve => {
      this.stopResolve = resolve;

      try {
        this.ffmpeg!.stdin?.write('q\n');
        this.ffmpeg!.stdin?.end();
      } catch {
        this.ffmpeg!.kill('SIGTERM');
      }

      // Hard kill after 8 s
      setTimeout(() => {
        if (this.stopResolve) {
          this.ffmpeg?.kill('SIGKILL');
        }
      }, 8000);
    });
  }

  dispose(): void {
    this._isRecording = false;
    clearInterval(this.levelTimer);
    this.levelTimer = undefined;

    if (this.ffmpeg) {
      try { this.ffmpeg.stdin?.end(); } catch { /* ignore */ }
      this.ffmpeg.kill('SIGTERM');
      this.ffmpeg = undefined;
    }

    this.cleanOutput();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private static buildArgs(deviceArg: string, outputPath: string): string[] {
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
  private emitSyntheticLevel(text: string): void {
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
    const delta  = Math.max(0, sizeKb - this.lastSizeKb);
    this.lastSizeKb = sizeKb;
    this.onLevel?.(Math.min(1, delta > 0 ? delta / 8 : 0.1));
  }

  private readAndClean(): Buffer | null {
    if (!this.outputPath) { return null; }
    try {
      if (!fs.existsSync(this.outputPath)) { return null; }
      const buf = fs.readFileSync(this.outputPath);
      return buf.length > 0 ? buf : null;
    } catch { return null; }
    finally { this.cleanOutput(); }
  }

  private cleanOutput(): void {
    if (this.outputPath) {
      try { fs.unlinkSync(this.outputPath); } catch { /* already gone */ }
      this.outputPath = undefined;
    }
    this.lastSizeKb = 0;
  }
}
