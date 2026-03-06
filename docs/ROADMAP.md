# CodeScrim — Improvement Roadmap

All findings from the initial codebase audit. Work through these in priority order — test each one before moving on.

## Status Key
- `[ ]` Not started
- `[~]` In progress
- `[x]` Done

---

## 🔴 High Priority

### 1. Built-in Audio Recording `[x]`
**Goal:** Capture mic audio during recording using the VS Code WebView MediaRecorder API. Bundle the resulting `.webm` file alongside the `.scrim` file so no external tool is needed.

**Key files:** `src/audioRecorder.ts` _(new)_, `src/recorder.ts`, `src/webviewHtml.ts`

**Approach:**
- A small hidden WebView panel calls `getUserMedia({ audio: true })` and starts `MediaRecorder`
- On stop, audio is sent back to the extension as base64 chunks → reassembled as a `Buffer`
- Saved as `<tutorial-name>.webm` next to the `.scrim` file
- `scrim.audioUrl` is set to the filename; player resolves it via `webview.asWebviewUri()`
- `startTime` is reset **after** the mic is confirmed live to ensure perfect A/V sync

**Test plan:**
1. `Start Recording Tutorial` → choose 🎙 Yes
2. Check the side panel shows level meter + "Recording audio…"
3. Type some code, add a chapter, stop
4. Check `.webm` file is created next to `.scrim`
5. Play back — audio should be in sync with code replay

---

### 2. Terminal Command Recording `[x]`
**Goal:** Capture terminal I/O via `onDidWriteTerminalData` and replay it read-only through a Pseudo-Terminal during playback.

**Key files:** `src/terminalPlayer.ts` _(new)_, `src/types.ts`, `src/recorder.ts`, `src/player.ts`

**New event types added to `ScrimEvent`:**
```
terminalOpen  — a terminal was opened
terminal      — raw terminal output data chunk
terminalClose — a terminal was closed
```

**Approach:**
- Recorder listens to `onDidWriteTerminalData`, `onDidOpenTerminal`, `onDidCloseTerminal`
- Already-open terminals at recording start are captured as `terminalOpen` events
- Playback creates PTY terminals (`vscode.Pseudoterminal`) and fires recorded data at the correct timestamps
- Seeking (`syncToTime`) resets all PTY terminals and replays cumulative data to that point

**Test plan:**
1. Open a terminal in VS Code before recording
2. Run a few commands (e.g. `npm install`, `ls`)
3. Stop recording and play back
4. Check that `▶ Terminal Name` panels appear and replay the commands

---

### 3. Batch VFS Edit Performance `[ ]`
**Goal:** During `advanceToTime`, batch all edits for the same file within one 100ms tick into a single `WorkspaceEdit` to eliminate per-keystroke re-renders and reduce stuttering on fast-typist recordings.

**Key files:** `src/player.ts`

**Approach:**
- Accumulate edits per file into a `Map<string, vscode.TextEdit[]>` inside the advance loop
- Apply one `WorkspaceEdit` at the end of the loop interval instead of calling `applyEdit` per event

---

## 🟡 Medium Priority

### 4. `.scrim` Bundle Format (zip) `[ ]`
**Goal:** Package the JSON manifest + `.webm` audio + any binary assets into a single `.scrim` zip archive for easy sharing and versioning.

**Approach:** Use Node's `zlib` streams or bundle a small zero-dep library (`fflate`) to zip/unzip on save/load. The current plain-JSON format can serve as a migration step.

---

### 5. Playback Speed Controls `[ ]`
**Goal:** Add 0.5×, 1×, 1.5×, 2× buttons to the player webview.

**Key files:** `src/webviewHtml.ts`

**Approach:** The custom timer-based sync loop uses `Date.now() - customTimerStart`. Multiply the elapsed time by a `speedMultiplier` factor — that's the only change needed.

---

### 6. Edit Mode Idle Timeout Hint `[ ]`
**Goal:** After 30 seconds of inactivity in edit mode, show a gentle "Press ▶ to resume" flash in the webview.

**Key files:** `src/webviewHtml.ts`

**Approach:** A `setTimeout` started when the edit banner appears; cleared on any `keydown`/`mousemove`. On timeout, pulse the banner briefly and show a tooltip.

---

### 7. Chapter Progress Auto-Highlight `[ ]`
**Goal:** As the video plays, the active chapter item in the chapters panel should update live. `highlightChapter()` is currently a stub.

**Key files:** `src/webviewHtml.ts`

**Approach:**
- In `sendTime(t)`, also call `highlightChapter(t)`
- `highlightChapter` finds the last chapter whose `timestamp ≤ t` and adds `.active` class to it

---

## 🟢 Quick Wins

### 8. `.scrim` Explorer Icon + Play Button `[ ]`
**Goal:** Register a custom file icon and a tree-item decorator so `.scrim` files show a ▶ button in the Explorer sidebar without needing the status bar.

**Key files:** `package.json`, `src/extension.ts`

---

### 9. Recorder Undo Awareness `[ ]`
**Goal:** Detect `Ctrl+Z` during recording (the change event has `reason: TextDocumentChangeReason.Undo`) and record it as a snapshot, not an inverse edit, to prevent replay corruption.

**Key files:** `src/recorder.ts`

---

### 10. `currentEventIndex` Drift Recovery `[ ]`
**Goal:** If `applyEvent` throws for a malformed event, the index still advances so playback doesn't freeze permanently at one bad event.

**Key files:** `src/player.ts` _(try/catch in `advanceToTime` already logs, but index isn't always advanced on failure)_

---

## ✅ Already Completed

| Modular refactor (VfsEngine, MessageQueue, TerminalPlayer, AudioRecorder, TerminalRecorder) | `player.ts` / `recorder.ts` fully delegating to focused single-responsibility modules |
|-----|---------|
| Video freezes midway | `isEngineUpdating` boolean → `engineUpdateDepth` ref-count |
| Continue button opens new tab | All `showTextDocument` calls pinned to `ViewColumn.One` |
| `showEditBanner` / `hideEditBanner` missing | Added both functions to webview JS |
| Replay after end broken | `ended` resets `currentEventIndex = -1`, `currentTime = 0` |
| Ctrl+S blocked during playback | `onWillSaveTextDocument` hook restores tutorial content |
| Click-to-pause from editor | `onDidChangeTextEditorSelection` with `kind === Mouse` |
| Edit reverted on resume | `played` handler calls `syncToTime` when resuming from edit mode |
| `currentVfs` tracking | In-memory VFS maintained for save-blocker and future use |
