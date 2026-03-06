// ─── .scrim file format ─────────────────────────────────────────────────────

import * as vscode from 'vscode';

export interface SerializablePosition {
  line: number;
  character: number;
}

export interface SerializableSelection {
  anchor: SerializablePosition;
  active: SerializablePosition;
}

export interface SerializableRange {
  start: SerializablePosition;
  end: SerializablePosition;
}

export interface SerializableTextChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
  range: SerializableRange;
}

export type WorkspaceStructureEvent =
  | { type: 'createFile'; timestamp: number; file: string; content: string }
  | { type: 'deleteFile'; timestamp: number; file: string }
  | { type: 'createDirectory'; timestamp: number; path: string }
  | { type: 'deleteDirectory'; timestamp: number; path: string };

// ── Terminal events (recorded via TerminalRecorder, replayed by TerminalPlayer) ──
export type TerminalEvent =
  | { type: 'terminalOpen';  timestamp: number; terminalId: number; name: string }
  | { type: 'terminal';      timestamp: number; terminalId: number; data: string }
  | { type: 'terminalClose'; timestamp: number; terminalId: number };

/** Type guard — true for any of the three terminal event variants. */
export function isTerminalEvent(ev: ScrimEvent): ev is TerminalEvent {
  return ev.type === 'terminalOpen' || ev.type === 'terminal' || ev.type === 'terminalClose';
}

export type ScrimEvent =
  | { type: 'setup'; timestamp: number; files: Record<string, string>; directories?: string[] }
  | { type: 'snapshot'; timestamp: number; files: Record<string, string>; activeFile?: string; selections?: SerializableSelection[] }
  | { type: 'edit'; timestamp: number; file: string; changes: SerializableTextChange[] }
  | { type: 'openFile'; timestamp: number; file: string }
  | { type: 'selection'; timestamp: number; file: string; selections: SerializableSelection[] }
  | { type: 'chapter'; timestamp: number; title: string; description?: string }
  | WorkspaceStructureEvent
  | TerminalEvent;

export type VideoType = 'youtube' | 'vimeo' | 'local' | 'generic';

/** Root structure of a .scrim tutorial file (now just metadata, audio is bundled with this in a zip usually) */
export interface ScrimFile {
  version: '1.0';
  title: string;
  description?: string;
  author?: string;
  /** If using old video, otherwise undefined for native playback */
  videoUrl?: string;
  videoType?: VideoType;
  /** Audio URL or local audio path used for native playback */
  audioUrl?: string;
  /** Total duration in seconds */
  duration?: number;
  language?: string;
  events: ScrimEvent[];
  createdAt: string;
}

// ─── Player state ────────────────────────────────────────────────────────────

export interface PlayerState {
  scrim: ScrimFile;
  /** The most recent event index that has been applied */
  currentEventIndex: number;
  /** True while the video is paused and the user can edit freely */
  isEditMode: boolean;
  isPlaying: boolean;
  currentTime: number;
}

// ─── Webview ↔ Extension message protocol ───────────────────────────────────

/** Messages sent FROM the webview TO the extension */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'timeUpdate'; time: number }
  | { type: 'paused'; time: number }
  | { type: 'played'; time: number }
  | { type: 'ended' }
  | { type: 'editRequested'; time: number }
  | { type: 'chapterClick'; timestamp: number };

/** Messages sent FROM the extension TO the webview */
export type ExtensionMessage =
  | { type: 'init'; scrim: ScrimFile }
  | { type: 'syncToTime'; time: number; chapter?: string }
  | { type: 'setEditMode'; active: boolean }
  | { type: 'forcePause' };
