import * as vscode from 'vscode';
import * as path from 'path';
import { Recorder } from './recorder';
import { Player } from './player';

let recorder: Recorder | undefined;
let player: Player | undefined;

export function activate(context: vscode.ExtensionContext): void {
  try {
    recorder = new Recorder(context);
    player = new Player(context);

    // ── register commands ────────────────────────────────────────────────────
    context.subscriptions.push(

      vscode.commands.registerCommand('codescrim.startRecording', () => {
        recorder?.startRecording();
      }),

      vscode.commands.registerCommand('codescrim.stopRecording', () => {
        recorder?.stopRecording();
      }),

      vscode.commands.registerCommand('codescrim.addChapter', () => {
        recorder?.addChapter();
      }),

      // Accepts an optional file path argument (used when called programmatically
      // after saving a recording, or from the Explorer context menu).
      vscode.commands.registerCommand(
        'codescrim.playScrim',
        async (uriOrPath?: vscode.Uri | string) => {
          let filePath: string | undefined;

          if (uriOrPath instanceof vscode.Uri) {
            filePath = uriOrPath.fsPath;
          } else if (typeof uriOrPath === 'string') {
            filePath = uriOrPath;
          } else {
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
        },
      ),
    );

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
  } catch (err: any) {
    vscode.window.showErrorMessage('CRITICAL EXTENSION CRASH: ' + (err.stack || err.message || String(err)));
    console.error(err);
  }
}

export function deactivate(): void {
  recorder?.dispose();
  player?.dispose();
}
