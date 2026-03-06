import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export type AudioLevelCallback = (level: number) => void;

/**
 * Records microphone audio via a bundled Rust sidecar process.
 * The sidecar owns the OS-level microphone capture and writes a WAV file
 * that is read back into the extension when recording stops.
 */
export class AudioRecorder implements vscode.Disposable {
  private child: ChildProcessWithoutNullStreams | undefined;
  private outputPath: string | undefined;
  private _isRecording = false;
  private onLevel: AudioLevelCallback | undefined;
  private stopResolve: ((buf: Buffer | null) => void) | undefined;
  private startResolve: ((ok: boolean) => void) | undefined;
  private startTimeout: ReturnType<typeof setTimeout> | undefined;
  private stopTimeout: ReturnType<typeof setTimeout> | undefined;
  private pendingBuffer: Buffer | null = null;
  private lastErrorMessage = '';

  get isRecording(): boolean {
    return this._isRecording;
  }

  get lastError(): string {
    return this.lastErrorMessage;
  }

  async start(onLevel?: AudioLevelCallback): Promise<boolean> {
    if (this._isRecording) {
      return true;
    }

    this.onLevel = onLevel;
    this.pendingBuffer = null;
    this.lastErrorMessage = '';
    this.cleanOutput();
    this.killChild();

    const binaryPath = this.resolveBinaryPath();
    if (!binaryPath) {
      this.lastErrorMessage =
        'Rust recorder sidecar binary was not found. Run "npm run build:native" first.';
      return false;
    }

    this.outputPath = path.join(os.tmpdir(), `codescrim-audio-${Date.now()}.wav`);

    return new Promise<boolean>(resolve => {
      this.startResolve = resolve;
      this.startTimeout = setTimeout(() => {
        this.lastErrorMessage = 'Timed out waiting for the Rust recorder sidecar to start.';
        this.resolveStart(false);
        this.killChild();
      }, 15000);

      this.child = spawn(binaryPath, [this.outputPath!], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.child.stdout.setEncoding('utf8');
      this.child.stderr.setEncoding('utf8');

      let stdoutBuffer = '';
      let stderrBuffer = '';

      this.child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        stdoutBuffer = this.consumeLines(stdoutBuffer, line => this.handleStdoutLine(line));
      });

      this.child.stderr.on('data', (chunk: string) => {
        stderrBuffer += chunk;
        stderrBuffer = this.consumeLines(stderrBuffer, line => {
          const trimmed = line.trim();
          if (!trimmed) {
            return;
          }
          this.lastErrorMessage = trimmed.replace(/^ERROR\s*/i, '');
        });
      });

      this.child.on('error', err => {
        this.lastErrorMessage = `Failed to launch Rust recorder sidecar: ${err.message}`;
        this.resolveStart(false);
        if (this.stopResolve) {
          const cb = this.stopResolve;
          this.stopResolve = undefined;
          cb(null);
        }
        this.killChild();
      });

      this.child.on('exit', code => {
        this._isRecording = false;
        this.onLevel?.(0);
        if (this.startResolve) {
          if (!this.lastErrorMessage && code !== 0) {
            this.lastErrorMessage = `Rust recorder sidecar exited before start (code ${code ?? 'unknown'}).`;
          }
          this.resolveStart(false);
        }
        if (this.stopTimeout) {
          clearTimeout(this.stopTimeout);
          this.stopTimeout = undefined;
        }
        if (this.stopResolve) {
          const cb = this.stopResolve;
          this.stopResolve = undefined;
          cb(this.readAndClean());
        }
        this.child = undefined;
      });
    });
  }

  async stop(): Promise<Buffer | null> {
    if (!this._isRecording || !this.child) {
      return this.readAndClean();
    }

    return new Promise<Buffer | null>(resolve => {
      this.stopResolve = resolve;
      try {
        this.child?.stdin.end();
      } catch {
        this.killChild();
      }

      this.stopTimeout = setTimeout(() => {
        if (!this.stopResolve) {
          return;
        }
        const cb = this.stopResolve;
        this.stopResolve = undefined;
        this._isRecording = false;
        cb(this.readAndClean());
        this.killChild();
      }, 8000);
    });
  }

  dispose(): void {
    this.resolveStart(false);
    if (this.stopResolve) {
      const cb = this.stopResolve;
      this.stopResolve = undefined;
      cb(this.readAndClean());
    }
    this._isRecording = false;
    this.onLevel?.(0);
    this.killChild();
    this.cleanOutput();
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    if (trimmed === 'STARTED') {
      this.lastErrorMessage = '';
      this._isRecording = true;
      this.resolveStart(true);
      return;
    }

    if (trimmed.startsWith('LEVEL ')) {
      const value = Number.parseFloat(trimmed.slice(6));
      this.onLevel?.(clamp01(value));
      return;
    }

    if (trimmed.startsWith('ERROR ')) {
      this.lastErrorMessage = trimmed.slice(6).trim();
    }
  }

  private resolveStart(ok: boolean): void {
    if (this.startTimeout) {
      clearTimeout(this.startTimeout);
      this.startTimeout = undefined;
    }
    if (this.startResolve) {
      const cb = this.startResolve;
      this.startResolve = undefined;
      cb(ok);
    }
  }

  private killChild(): void {
    if (this.startTimeout) {
      clearTimeout(this.startTimeout);
      this.startTimeout = undefined;
    }
    if (this.stopTimeout) {
      clearTimeout(this.stopTimeout);
      this.stopTimeout = undefined;
    }
    if (!this.child) {
      return;
    }

    try {
      this.child.stdin.end();
    } catch {
      // ignore
    }
    this.child.kill();
    this.child = undefined;
  }

  private resolveBinaryPath(): string | undefined {
    const configuredPath = process.env.CODESCRIM_RECORDER_PATH;
    if (configuredPath && fs.existsSync(configuredPath)) {
      return configuredPath;
    }

    const exe = process.platform === 'win32'
      ? 'codescrim-recorder-sidecar.exe'
      : 'codescrim-recorder-sidecar';

    const candidates = [
      path.resolve(__dirname, '..', 'native', 'codescrim-recorder-sidecar', 'target', 'release', exe),
      path.resolve(__dirname, '..', 'native', 'codescrim-recorder-sidecar', 'target', 'debug', exe),
    ];

    return candidates.find(candidate => fs.existsSync(candidate));
  }

  private consumeLines(buffer: string, onLine: (line: string) => void): string {
    const lines = buffer.split(/\r?\n/);
    const remainder = lines.pop() ?? '';
    for (const line of lines) {
      onLine(line);
    }
    return remainder;
  }

  private readAndClean(): Buffer | null {
    if (!this.outputPath) {
      return this.pendingBuffer;
    }
    try {
      if (!fs.existsSync(this.outputPath)) {
        return null;
      }
      const buf = fs.readFileSync(this.outputPath);
      this.pendingBuffer = buf.length > 0 ? buf : null;
      return this.pendingBuffer;
    } catch {
      return null;
    } finally {
      this.cleanOutput();
    }
  }

  private cleanOutput(): void {
    if (this.outputPath) {
      try {
        fs.unlinkSync(this.outputPath);
      } catch {
        // ignore
      }
      this.outputPath = undefined;
    }
  }
}

function clamp01(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}