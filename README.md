# CodeScrim — Interactive Coding Tutorials for VSCode

Bring the **Scrimba experience** into VSCode. Record coding tutorials with automatic code snapshots synced to a video, then play them back with live editing — pause the video and the code is yours to explore.

---

## How it works

CodeScrim separates concerns cleanly:

| Phase | What happens |
|-------|-------------|
| **Record** | You code normally in VSCode. The extension silently snapshots your files every few seconds and whenever you save. You record your screen separately (OBS, QuickTime, Loom, etc.). |
| **Save** | When you stop, you paste in the URL of your screen recording. Everything gets packaged into a single `.scrim` JSON file. |
| **Play** | Anyone opens the `.scrim` file in VSCode. The video plays in a side panel; code automatically syncs in the editor at every checkpoint. **Pause** → edit mode activates. **Play** → choose to reset to tutorial code or keep your changes. |

---

## Installation

```bash
# 1. Clone / download the extension folder
cd codescrim

# 2. Install dev dependencies (TypeScript + VS Code types)
npm install

# 3. Compile TypeScript → JavaScript
npm run compile

# 4. (Option A) Run in development
#    Press F5 in VSCode — opens an Extension Development Host window

# 5. (Option B) Package as a .vsix for distribution
npx vsce package --no-dependencies
# Then: Extensions panel → ⋯ → Install from VSIX
```

---

## Recording a Tutorial

1. Open your project in VSCode.
2. **Command Palette** (`Ctrl/Cmd+Shift+P`) → `CodeScrim: Start Recording Tutorial`
3. Enter a title.
4. **Start your screen recorder** (OBS, QuickTime, etc.) at the same time.
5. Code normally — snapshots are taken automatically (every 2 s by default).
6. Use `CodeScrim: Add Chapter Marker` to name key moments.
7. When done: `CodeScrim: Stop Recording & Save`
8. Paste your **video URL** (YouTube, Vimeo, or a direct `.mp4` path/URL).
9. Choose a save location → your `.scrim` file is ready.

---

## Playing a Tutorial

1. **Command Palette** → `CodeScrim: Open Tutorial (.scrim)`  
   *(or run `codescrim.playScrim` with a file URI)*
2. The video opens in a **side panel** (right column).
3. Tutorial files appear in the **main editor** (left column).
4. Press **▶ Play** in the video player.
5. The code in the editor updates automatically at each checkpoint.
6. **Pause the video** → a banner appears: *"Edit Mode Active"*. The code is yours — edit, run, break things.
7. **Resume** → choose:
   - **"Reset to Tutorial Code"** — snaps back to the correct checkpoint.
   - **"Keep My Edits"** — video resumes but your changes stay.

---

## .scrim file format

The `.scrim` format is plain JSON — human-readable and version-control friendly.

```json
{
  "version": "1.0",
  "title": "Building a REST API with Express",
  "author": "Jane Dev",
  "videoUrl": "https://youtube.com/watch?v=dQw4w9WgXcQ",
  "videoType": "youtube",
  "createdAt": "2024-06-01T10:00:00.000Z",
  "snapshots": [
    {
      "timestamp": 0,
      "chapter": "Introduction",
      "files": {
        "server.js": "// Welcome!\nconsole.log('hello');"
      }
    },
    {
      "timestamp": 45.2,
      "chapter": "Setting up Express",
      "files": {
        "server.js": "const express = require('express');\nconst app = express();\n\napp.listen(3000);"
      }
    },
    {
      "timestamp": 120.8,
      "files": {
        "server.js": "const express = require('express');\nconst app = express();\n\napp.get('/', (req, res) => res.send('Hello World'));\n\napp.listen(3000, () => console.log('Listening on :3000'));"
      }
    }
  ]
}
```

**Tips:**
- `timestamp` is **seconds from the start of the video** (not wall-clock time — match it to when you started your screen recorder).
- Snapshots without a `chapter` field are "silent" checkpoints — code still syncs but no label is shown.
- Multiple files are supported — list as many `"path": "content"` pairs as you like.
- Paths are relative to the tutorial's workspace root.

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `codescrim.snapshotIntervalSeconds` | `2` | Min seconds between auto-snapshots |
| `codescrim.autoOpenFiles` | `true` | Auto-open tutorial files in editor |
| `codescrim.maxFileSizeKb` | `500` | Skip files larger than this |

---

## Architecture overview

```
src/
├── extension.ts   — Activation, command registration
├── recorder.ts    — File watching, snapshot capture, .scrim serialisation
├── player.ts      — WebviewPanel HTML, video↔editor sync engine
├── types.ts       — Shared TypeScript interfaces (ScrimFile, CodeSnapshot, …)
└── utils.ts       — URL parsing, time formatting, HTML escaping
```

**Message protocol (Webview ↔ Extension)**

```
Webview → Extension          Extension → Webview
────────────────────         ─────────────────────
ready                        init { scrim }
timeUpdate { time }          syncSnapshot { snapshotIndex, chapter? }
paused { time }              setEditMode { active }
played { time }
ended
chapterClick { snapshotIndex, timestamp }
```

---

## Supported video platforms

| Platform | Embed method | Time sync |
|----------|-------------|-----------|
| YouTube  | IFrame API  | ✅ Polling every 200 ms |
| Vimeo    | IFrame      | ⚠️ Pause/play events only (Vimeo JS API requires a paid plan for origin validation in webviews) |
| Local `.mp4` / `.webm` | HTML5 `<video>` | ✅ `timeupdate` event |
| Any direct video URL | HTML5 `<video>` | ✅ `timeupdate` event |

---

## Roadmap

- [ ] Export to shareable web bundle (HTML + video + snapshots)  
- [ ] Multi-file tab view inside the webview  
- [ ] Vimeo JS API support with token  
- [ ] Speed controls passed through to the editor sync rate  
- [ ] AI-generated chapter summaries from code diffs  

---

## License

MIT
