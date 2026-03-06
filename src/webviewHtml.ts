import { ScrimFile } from './types';
import { escapeHtml, formatTime } from './utils';

export function buildPlayerHtml(scrim: ScrimFile, mediaUrl?: string, cspSource?: string): string {
    const chapters = scrim.events
        .map((s, i) => (s.type === 'chapter' ? { title: s.title, timestamp: s.timestamp, index: i } : null))
        .filter((c): c is NonNullable<typeof c> => c !== null);

    const videoBlock = buildVideoBlock(scrim, mediaUrl);
    const chaptersHtml = buildChaptersHtml(chapters);
    const totalEvents = scrim.events.length;
    const safeCspSource = cspSource ?? '';

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'unsafe-inline' ${safeCspSource} https://www.youtube.com https://www.youtube-nocookie.com;
  frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com;
  style-src 'unsafe-inline' ${safeCspSource};
  media-src ${safeCspSource} https: data: blob:;
  img-src ${safeCspSource} https: data:;
">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CodeScrim</title>
<style>
/* ── reset & variables ─────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg: var(--vscode-editor-background, #0d0f18);
  --surface: var(--vscode-sideBar-background, #13161f);
  --surface2: var(--vscode-editorWidget-background, #1c1f2e);
  --border: var(--vscode-widget-border, #252840);
  --accent: var(--vscode-button-background, #7c6dfa);
  --accent-glow: var(--vscode-button-hoverBackground, #7c6dfa44);
  --accent-dim: var(--vscode-button-secondaryBackground, #4e42b0);
  --text: var(--vscode-editor-foreground, #dde1f0);
  --muted: var(--vscode-descriptionForeground, #6b7290);
  --radius: 4px;
}
html,body{overflow:hidden;}
body{
  background:var(--bg);
  color:var(--text);
  font-family: var(--vscode-font-family, -apple-system, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  display:flex;
  flex-direction:column;
  height: 100vh;
}

/* ── header ─────────────────────────────────────────────────── */
.header{
  display:flex;align-items:center;gap:10px;
  padding:9px 14px;
  background:var(--surface);
  border-bottom:1px solid var(--border);
  flex-shrink:0;
}
.logo{
  width:26px;height:26px;border-radius:6px;
  background:linear-gradient(135deg,var(--accent),#a78bfa);
  display:flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:700;color:#fff;flex-shrink:0;
}
.header-title{flex:1;font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.badge{
  background:var(--surface2);border:1px solid var(--border);
  color:var(--muted);padding:2px 8px;border-radius:20px;font-size:11px;white-space:nowrap;
}

/* ── control area ──────────────────────────────────────────────── */
.controls-wrap{
  flex: 0 0 auto;
  background:var(--surface2);
  border-bottom: 1px solid var(--border);
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.transport{
  width:100%;
  max-width:640px;
  display:flex;
  align-items:center;
  gap:12px;
}
.transport-btn{
  appearance:none;
  border:none;
  background:transparent;
  color:var(--accent);
  font-size:20px;
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center;
  width:32px;
  height:32px;
  border-radius:50%;
}
.transport-time{
  font-family:monospace;
  font-size:13px;
  color:var(--muted);
  min-width:92px;
  text-align:center;
  font-variant-numeric:tabular-nums;
}
.transport-slider{
  flex:1;
  cursor:pointer;
}
.transport-note{
  margin-top:8px;
  color:var(--muted);
  font-size:11px;
  align-self:center;
}
.transport-error{
  margin-top:8px;
  color:#ff8f8f;
  font-size:11px;
  align-self:center;
}

/* ── edit banner ─────────────────────────────────────────────── */
.edit-banner{
  display:none;flex-shrink:0;
  padding:8px 16px;
  background:linear-gradient(90deg,#7c6dfa18,#a78bfa18);
  border-top:1px solid var(--accent-dim);
  border-bottom:1px solid var(--accent-dim);
  color:#c4baff;
  font-size:12px;
  text-align:center;
  line-height:1.5;
}
.edit-banner.active{display:block;}
.edit-banner strong{color:var(--accent);}

/* ── chapters ────────────────────────────────────────────────── */
.chapters-panel{
  flex:0 0 auto;
  background:var(--surface);
  border-top:1px solid var(--border);
  display:flex;flex-direction:column;
  max-height:220px;overflow:hidden;
}
.chapters-head{
  display:flex;align-items:center;justify-content:space-between;
  padding:7px 14px;
  border-bottom:1px solid var(--border);
  flex-shrink:0;
}
.chapters-head-label{
  font-size:10px;font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;color:var(--muted);
}
.active-chapter-label{font-size:11px;color:var(--accent);font-style:italic;}
.chapters-list{overflow-y:auto;padding:6px 6px;}
.chapter-item{
  display:flex;align-items:center;gap:10px;
  padding:7px 8px;border-radius:6px;cursor:pointer;
  transition:background .12s;
}
.chapter-item:hover{background:var(--surface2);}
.chapter-item.active{
  background:var(--accent-glow);
  color:#c4baff;
}
.dot{
  width:7px;height:7px;border-radius:50%;background:var(--border);flex-shrink:0;
  transition:background .2s;
}
.chapter-item.active .dot,.dot.recording{background:var(--accent);}
.ch-name{flex:1;font-size:12px;}
.ch-time{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;flex-shrink:0;}
.no-chapters{padding:18px;text-align:center;color:var(--muted);font-size:12px;}

/* ── footer / status bar ─────────────────────────────────────── */
.status-bar{
  display:flex;align-items:center;gap:10px;
  padding:7px 14px;
  background:var(--surface);
  border-top:1px solid var(--border);
  flex-shrink:0;
  font-size:11px;color:var(--muted);
}
.status-dot{
  width:6px;height:6px;border-radius:50%;background:var(--muted);flex-shrink:0;
  transition:background .3s;
}
.status-dot.playing{background:var(--green);animation:blink 1.8s infinite;}
.status-dot.paused{background:var(--accent);}
.status-dot.edit{background:var(--amber);animation:blink 1.2s infinite;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.status-text{flex:1;}
.snapshot-pill{
  background:var(--surface2);border:1px solid var(--border);
  padding:2px 8px;border-radius:12px;font-size:10px;
  font-variant-numeric:tabular-nums;
}

/* ── scrollbar ───────────────────────────────────────────────── */
::-webkit-scrollbar{width:4px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;}
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div class="logo">CS</div>
  <div class="header-title" title="${escapeHtml(scrim.title)}">${escapeHtml(scrim.title)}</div>
  <div class="badge">Native Replay</div>
</div>

<!-- CONTROL BAR -->
<div class="controls-wrap">
${videoBlock}
</div>

<!-- EDIT MODE BANNER -->
<div class="edit-banner" id="editBanner">
  ✏️ <strong>Edit Mode Active</strong> — The code is yours to explore and modify in the editor.
  Press <kbd style="background:#1c1f2e;padding:1px 5px;border-radius:3px;border:1px solid #333">▶</kbd> to resume the tutorial.
</div>

<!-- CHAPTERS -->
<div class="chapters-panel">
  <div class="chapters-head">
    <span class="chapters-head-label">Chapters &amp; Checkpoints</span>
    <span class="active-chapter-label" id="activeChapterLabel"></span>
  </div>
  <div class="chapters-list" id="chaptersList">
${chaptersHtml}
  </div>
</div>

<!-- STATUS BAR -->
<div class="status-bar">
  <div class="status-dot" id="statusDot"></div>
  <span class="status-text" id="statusText">Waiting for audio…</span>
</div>

<script>
// ── VS Code API ──────────────────────────────────────────────────────────────
const vscode = acquireVsCodeApi();

// ── state ────────────────────────────────────────────────────────────────────
let isEditMode   = false;
let syncInterval = null;
let ytPlayer     = null;
let currentEventIndex = 0;
const totalEvents = ${totalEvents};
let lastLocalSyncSentAt = -1;
let localPlaybackUnlocked = false;
let pendingLocalTransportAction = null;

// Notify extension that the webview DOM + JS is ready
vscode.postMessage({ type: 'ready' });

// ── YouTube IFrame API ───────────────────────────────────────────────────────
window.onYouTubeIframeAPIReady = function () {
  const el = document.getElementById('ytPlayer');
  if (!el) return;
  ytPlayer = new YT.Player('ytPlayer', {
    events: {
      onReady: () => setStatus('idle', 'Ready — press ▶ to start'),
      onStateChange: onYtStateChange,
      onError: (e) => setStatus('idle', 'Video error: ' + e.data),
    },
  });
};

function onYtStateChange(ev) {
  const S = YT.PlayerState;
  if (ev.data === S.PLAYING)  onVideoPlay(ytPlayer.getCurrentTime());
  if (ev.data === S.PAUSED)   onVideoPause(ytPlayer.getCurrentTime());
  if (ev.data === S.ENDED)    onVideoEnd();
}

// ── HTML5 video ──────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  const vid = document.getElementById('localVideo');
  if (!vid) return;
  const playBtn = document.getElementById('localPlayBtn');
  const transport = document.getElementById('localTransport');
  vid.addEventListener('play',       () => onVideoPlay(vid.currentTime));
  vid.addEventListener('pause',      () => onVideoPause(vid.currentTime));
  vid.addEventListener('ended',      onVideoEnd);
  const refreshDuration = () => {
    const duration = Number.isFinite(vid.duration) ? vid.duration : 0;
    updateLocalTransport(vid.currentTime, duration);
    setStatus('idle', 'Ready — press ▶ to start');
  };
  vid.addEventListener('loadedmetadata', refreshDuration);
  vid.addEventListener('durationchange', refreshDuration);
  vid.addEventListener('canplay', refreshDuration);
  vid.addEventListener('seeking', () => {
    updateLocalTransport(vid.currentTime, vid.duration);
  });
  vid.addEventListener('error', () => {
    const err = document.getElementById('localMediaError');
    if (err) err.textContent = 'Media failed to load in the webview.';
    setStatus('idle', 'Replay media failed to load');
  });
  vid.addEventListener('timeupdate', () => {
    updateLocalTransport(vid.currentTime, vid.duration);
  });
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      localPlaybackUnlocked = true;
      if (vid.paused) {
        void vid.play();
      } else {
        vid.pause();
      }
    });
  }
  if (transport) {
    transport.addEventListener('click', () => {
      if (!pendingLocalTransportAction) {
        return;
      }
      localPlaybackUnlocked = true;
      const action = pendingLocalTransportAction;
      pendingLocalTransportAction = null;
      executeLocalTransportAction(action);
    });
    transport.addEventListener('dblclick', (event) => {
      localPlaybackUnlocked = true;
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (target.id === 'localScrubber' || target.id === 'localPlayBtn') {
        return;
      }
      if (!vid.paused) {
        vid.pause();
      }
    });
  }
  vid.load();
  setTimeout(refreshDuration, 0);
});

// ── video event handlers ─────────────────────────────────────────────────────
function onVideoPlay(t) {
  const playBtn = document.getElementById('localPlayBtn');
  if (playBtn) playBtn.textContent = '⏸';
  lastLocalSyncSentAt = -1;
  setStatus('playing', 'Playing…');
  vscode.postMessage({ type: 'played', time: t });
  startSyncLoop();
  if (!isEditMode) hideEditBanner();
}

function onVideoPause(t) {
  const playBtn = document.getElementById('localPlayBtn');
  if (playBtn) playBtn.textContent = '▶';
  setStatus('paused', 'Paused — edit mode active');
  vscode.postMessage({ type: 'paused', time: t });
  stopSyncLoop();
  showEditBanner();
}

function onVideoEnd() {
  const playBtn = document.getElementById('localPlayBtn');
  const vid = document.getElementById('localVideo');
  if (playBtn) playBtn.textContent = '▶';
  if (vid) vid.currentTime = 0;
  updateLocalTransport(0, vid ? vid.duration : 0);
  setStatus('idle', 'Tutorial complete 🏁');
  vscode.postMessage({ type: 'ended' });
  stopSyncLoop();
  hideEditBanner();
}

// ── time sync loop ───────────────────────────────────────────────────────────
let customTimerStart = 0;
let customTimePausedAt = 0;

function startSyncLoop() {
  stopSyncLoop();
  
  const vid = document.getElementById('localVideo');
  if (!vid && !ytPlayer) {
    // Custom timeline logic (no audio/video)
    customTimerStart = Date.now() - (customTimePausedAt * 1000);
    const scrubber = document.getElementById('customScrubber');
    const timeDisplay = document.getElementById('customTimeDisplay');
    const MAX_TIME = scrubber ? parseFloat(scrubber.max) : 0;
    
    syncInterval = setInterval(() => {
      let t = (Date.now() - customTimerStart) / 1000;
      if (t > MAX_TIME) {
        t = MAX_TIME;
        onVideoEnd();
        document.getElementById('customPlayBtn').innerHTML = '▶';
        if (scrubber) scrubber.value = t;
        if (timeDisplay) timeDisplay.textContent = formatTime(t) + ' / ' + formatTime(MAX_TIME);
        sendTime(t + 0.1); // add trailing epsilon so JS floating point doesn't truncate the very last stroke
        return;
      }
      if (scrubber) scrubber.value = t;
      if (timeDisplay) timeDisplay.textContent = formatTime(t) + ' / ' + formatTime(MAX_TIME);
      sendTime(t);
    }, 100);
  } else {
    // Native audio/video logic
    syncInterval = setInterval(() => {
      if (vid) {
        updateLocalTransport(vid.currentTime, vid.duration);
        if (!isEditMode && (lastLocalSyncSentAt < 0 || Math.abs(vid.currentTime - lastLocalSyncSentAt) >= 0.2)) {
          lastLocalSyncSentAt = vid.currentTime;
          sendTime(vid.currentTime);
        }
      }
    }, 150);
  }
}

function stopSyncLoop() {
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
  
  const vid = document.getElementById('localVideo');
  if (!vid && !ytPlayer) {
    // Custom timeline pause
    customTimePausedAt = document.getElementById('customScrubber') ? parseFloat(document.getElementById('customScrubber').value) : 0;
  }
}

function sendTime(t) {
  vscode.postMessage({ type: 'timeUpdate', time: t });
}
function jumpToChapter(timestamp) {
  vscode.postMessage({ type: 'chapterClick', timestamp });

  const vid = document.getElementById('localVideo');
  if (vid) {
    vid.currentTime = timestamp;
    if (timestamp === 0) vid.play();
  } else {
    // Custom timeline
    customTimePausedAt = timestamp;
    customTimerStart = Date.now() - (timestamp * 1000);
    const scrubber = document.getElementById('customScrubber');
    if (scrubber) scrubber.value = timestamp;
    const timeDisplay = document.getElementById('customTimeDisplay');
    const MAX_TIME = scrubber ? parseFloat(scrubber.max) : 0;
    if (timeDisplay) timeDisplay.textContent = formatTime(timestamp) + ' / ' + formatTime(MAX_TIME);
  }
}

function highlightChapter(timestamp) {
  // Can be optimized to find nearest chapter
}

function formatTime(secs) {
  if (!secs || isNaN(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// Custom player play/pause toggle
window.toggleCustomPlay = function() {
  const btn = document.getElementById('customPlayBtn');
  const scrubber = document.getElementById('customScrubber');
  const MAX_TIME = scrubber ? parseFloat(scrubber.max) : 0;
  
  if (btn.innerHTML.includes('▶')) {
    btn.innerHTML = '⏸';
    if (customTimePausedAt >= MAX_TIME - 0.1) {
       customTimePausedAt = 0;
       if (scrubber) scrubber.value = '0';
    }
    onVideoPlay(customTimePausedAt);
  } else {
    btn.innerHTML = '▶';
    onVideoPause(customTimePausedAt);
  }
};

window.onCustomScrubInput = function(val) {
  // Only update visuals while dragging to prevent lag and infinity loops
  const t = parseFloat(val);
  const MAX_TIME = parseFloat(document.getElementById('customScrubber').max);
  document.getElementById('customTimeDisplay').textContent = formatTime(t) + ' / ' + formatTime(MAX_TIME);
  stopSyncLoop();
};

window.onCustomScrubDrop = function(val) {
  // Actually send sync API message ONLY when mouse is finally dropped
  const t = parseFloat(val);
  customTimePausedAt = t;
  customTimerStart = Date.now() - (t * 1000);
  vscode.postMessage({ type: 'chapterClick', timestamp: t });
};

window.onLocalScrubInput = function(val) {
  const vid = document.getElementById('localVideo');
  const t = parseFloat(val);
  const duration = vid && Number.isFinite(vid.duration) ? vid.duration : 0;
  updateLocalTransport(t, duration);
};

window.onLocalScrubDrop = function(val) {
  const vid = document.getElementById('localVideo');
  if (!vid) return;
  const t = parseFloat(val);
  vid.currentTime = t;
  lastLocalSyncSentAt = t;
  updateLocalTransport(t, vid.duration);
  sendTime(t);
};

function updateLocalTransport(currentTime, duration) {
  const scrubber = document.getElementById('localScrubber');
  const timeDisplay = document.getElementById('localTimeDisplay');
  const safeCurrentTime = Number.isFinite(currentTime) ? currentTime : 0;
  const safeDuration = Number.isFinite(duration) ? duration : 0;

  if (scrubber) {
    scrubber.max = String(safeDuration);
    scrubber.value = String(Math.min(safeCurrentTime, safeDuration || safeCurrentTime));
  }

  if (timeDisplay) {
    timeDisplay.textContent = formatTime(safeCurrentTime) + ' / ' + formatTime(safeDuration);
  }
}

function setStatus(state, text) {
  const dot  = document.getElementById('statusDot');
  const span = document.getElementById('statusText');
  dot.className  = 'status-dot ' + (state === 'idle' ? '' : state);
  span.textContent = text;
}

function showEditBanner() {
  const banner = document.getElementById('editBanner');
  if (banner) banner.classList.add('active');
}

function hideEditBanner() {
  const banner = document.getElementById('editBanner');
  if (banner) banner.classList.remove('active');
}

// ── messages from extension ───────────────────────────────────────────────────
window.addEventListener('message', ev => {
  const msg = ev.data;

  if (msg.type === 'forcePause') {
    const vid = document.getElementById('localVideo');
    if (vid && !vid.paused) {
      vid.pause();
    } else if (ytPlayer && typeof ytPlayer.getPlayerState === 'function' && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
      ytPlayer.pauseVideo();
    } else {
      const btn = document.getElementById('customPlayBtn');
      if (btn && btn.innerHTML.includes('⏸')) {
        toggleCustomPlay();
      }
    }
  }

  if (msg.type === 'transportControl') {
    const vid = document.getElementById('localVideo');
    if (vid) {
      if (!localPlaybackUnlocked && (msg.action === 'togglePlayback' || msg.action === 'restart')) {
        pendingLocalTransportAction = msg.action;
        setStatus('idle', 'Click once in the player to start replay');
        const note = document.getElementById('localMediaError');
        if (note) {
          note.textContent = 'Playback is armed. Click once in the player controls area to begin.';
        }
      } else {
        executeLocalTransportAction(msg.action);
      }
      return;
    }

    if (ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
      const state = ytPlayer.getPlayerState();
      if (msg.action === 'togglePlayback') {
        if (state === YT.PlayerState.PLAYING) {
          ytPlayer.pauseVideo();
        } else {
          ytPlayer.playVideo();
        }
      } else if (msg.action === 'restart') {
        ytPlayer.seekTo(0, true);
        ytPlayer.playVideo();
      } else if (msg.action === 'requestEditMode') {
        if (state === YT.PlayerState.PLAYING) {
          ytPlayer.pauseVideo();
        } else {
          const currentTime = typeof ytPlayer.getCurrentTime === 'function' ? ytPlayer.getCurrentTime() : 0;
          vscode.postMessage({ type: 'editRequested', time: currentTime });
        }
      }
      return;
    }

    if (msg.action === 'restart') {
      customTimePausedAt = 0;
      customTimerStart = Date.now();
      const scrubber = document.getElementById('customScrubber');
      if (scrubber) scrubber.value = '0';
      const timeDisplay = document.getElementById('customTimeDisplay');
      const maxTime = scrubber ? parseFloat(scrubber.max) : 0;
      if (timeDisplay) timeDisplay.textContent = formatTime(0) + ' / ' + formatTime(maxTime);
    }

    if (msg.action === 'requestEditMode') {
      const btn = document.getElementById('customPlayBtn');
      if (btn && btn.innerHTML.includes('⏸')) {
        toggleCustomPlay();
      } else {
        vscode.postMessage({ type: 'editRequested', time: customTimePausedAt });
      }
      return;
    }

    toggleCustomPlay();
  }

  if (msg.type === 'syncToTime') {
    if (msg.chapter) {
      document.getElementById('activeChapterLabel').textContent = msg.chapter;
    }
  }

  if (msg.type === 'setEditMode') {
    isEditMode = msg.active;
    if (msg.active) {
      setStatus('edit', 'Edit mode — code is yours');
      showEditBanner();
    } else {
      setStatus('idle', 'Ready');
      hideEditBanner();
    }
  }

  if (msg.type === 'init') {
    setStatus('idle', 'Ready — press ▶ to start');
  }
});

function executeLocalTransportAction(action) {
  const vid = document.getElementById('localVideo');
  if (!vid) {
    return;
  }

  const note = document.getElementById('localMediaError');
  if (note) {
    note.textContent = '';
  }

  if (action === 'togglePlayback') {
    if (vid.paused) {
      void vid.play();
    } else {
      vid.pause();
    }
    return;
  }

  if (action === 'restart') {
    vid.currentTime = 0;
    updateLocalTransport(0, vid.duration);
    void vid.play();
    return;
  }

  if (!vid.paused) {
    vid.pause();
  } else {
    vscode.postMessage({ type: 'editRequested', time: vid.currentTime });
  }
}
</script>
</body>
</html>`;
}

// ── HTML sub-builders ──────────────────────────────────────────────────────

function buildVideoBlock(scrim: ScrimFile, mediaUrl?: string): string {
  const url = mediaUrl || scrim.audioUrl?.trim() || scrim.videoUrl?.trim();

    if (!url) {
        // Find duration of the scrim
        const maxTime = scrim.events.length > 0 ? scrim.events[scrim.events.length - 1].timestamp : 0;

        return `
      <div style="display:flex; flex-direction:row; align-items:center; width: 100%; gap: 12px;">
        <button id="customPlayBtn" onclick="toggleCustomPlay()" style="background: transparent; color: var(--accent); border: none; font-size: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%;">
          ▶
        </button>
        <span id="customTimeDisplay" style="font-family: monospace; font-size: 13px; color: var(--muted); min-width: 80px; text-align: center;">
          0:00 / ${formatTime(maxTime)}
        </span>
        <input type="range" id="customScrubber" min="0" max="${maxTime}" step="0.1" value="0" style="flex: 1; cursor: pointer;" oninput="onCustomScrubInput(this.value)" onchange="onCustomScrubDrop(this.value)">
      </div>
      <p style="margin-top: 8px; color: var(--muted); font-size: 11px; align-self: center;">(No audio track attached, silent replay)</p>
    `;
    }

    return `<div style="display:flex; flex-direction:column; align-items:center; width:100%; padding:20px;">
    <audio id="localVideo" preload="metadata" style="display:none;">
      <source src="${escapeHtml(url)}">
    </audio>
    <div id="localTransport" class="transport">
      <button id="localPlayBtn" class="transport-btn" type="button">▶</button>
      <span id="localTimeDisplay" class="transport-time">0:00 / 0:00</span>
      <input id="localScrubber" class="transport-slider" type="range" min="0" max="0" step="0.1" value="0" oninput="onLocalScrubInput(this.value)" onchange="onLocalScrubDrop(this.value)">
    </div>
    <p class="transport-note">Attached replay audio loaded through the VS Code player.</p>
    <p id="localMediaError" class="transport-error"></p>
  </div>`;
}

function buildChaptersHtml(
    chapters: Array<{ title: string; timestamp: number; index: number }>,
): string {
    if (chapters.length === 0) {
        return `<div class="no-chapters">No chapters defined in this tutorial.<br>
      <span style="font-size:11px;">Add chapter markers while recording to see them here.</span>
    </div>`;
    }

    return chapters
        .map(
            ch => `<div class="chapter-item"
        onclick="jumpToChapter(${ch.timestamp})">
        <div class="dot"></div>
        <span class="ch-name">${escapeHtml(ch.title)}</span>
        <span class="ch-time">${formatTime(ch.timestamp)}</span>
      </div>`,
        )
        .join('\n');
}
