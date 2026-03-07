import { ScrimFile } from './types';
import { escapeHtml, formatTime } from './utils';

export function buildPlayerHtml(scrim: ScrimFile, mediaUrl?: string, cspSource?: string): string {
    const chapters = scrim.events
        .map((s, i) => (s.type === 'chapter' ? { title: s.title, timestamp: s.timestamp, index: i } : null))
        .filter((c): c is NonNullable<typeof c> => c !== null);

    const videoBlock = buildVideoBlock(scrim, mediaUrl);
    const chaptersHtml = buildChaptersHtml(chapters);
  const replayDuration = scrim.duration ?? (scrim.events.length > 0 ? scrim.events[scrim.events.length - 1].timestamp : 0);
  const replayMode = mediaUrl || scrim.audioUrl?.trim() || scrim.videoUrl?.trim()
    ? 'Audio-Synced Replay'
    : 'Silent Replay';
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
  --bg: #07111f;
  --bg-accent: rgba(36, 206, 255, 0.12);
  --surface: rgba(10, 21, 38, 0.9);
  --surface-strong: rgba(9, 18, 31, 0.98);
  --surface-soft: rgba(15, 28, 48, 0.82);
  --border: rgba(130, 171, 214, 0.16);
  --border-strong: rgba(130, 171, 214, 0.28);
  --accent: #42d0ff;
  --accent-strong: #7ce7ff;
  --accent-soft: rgba(66, 208, 255, 0.18);
  --warm: #ffbd66;
  --warm-soft: rgba(255, 189, 102, 0.16);
  --text: #ecf6ff;
  --muted: #96acc3;
  --muted-strong: #c7d8ea;
  --success: #55e2a6;
  --danger: #ff8a80;
  --radius: 18px;
  --shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
}
html,body{
  min-height:100%;
  overflow-x:hidden;
}
body{
  background:
    radial-gradient(circle at top left, rgba(66, 208, 255, 0.14), transparent 34%),
    radial-gradient(circle at top right, rgba(255, 189, 102, 0.12), transparent 28%),
    linear-gradient(180deg, #081220 0%, #09111b 100%);
  color:var(--text);
  font-family: var(--vscode-font-family, 'Segoe UI', 'Aptos', sans-serif);
  font-size: var(--vscode-font-size, 13px);
  min-height:100vh;
  overflow-y:auto;
}
.shell{
  display:flex;
  flex-direction:column;
  gap:14px;
  min-height:100vh;
  padding:16px;
}

/* ── header ─────────────────────────────────────────────────── */
.header{
  display:flex;align-items:flex-start;gap:12px;
  padding:16px 18px;
  background:linear-gradient(180deg, rgba(15, 30, 50, 0.92), rgba(9, 18, 31, 0.96));
  border:1px solid var(--border);
  border-radius:var(--radius);
  box-shadow:var(--shadow);
  flex-shrink:0;
  position:relative;
  overflow:hidden;
}
.header::after{
  content:'';
  position:absolute;
  inset:auto -18% -45% auto;
  width:180px;
  height:180px;
  background:radial-gradient(circle, rgba(66, 208, 255, 0.16), transparent 70%);
  pointer-events:none;
}
.logo{
  width:40px;height:40px;border-radius:12px;
  background:linear-gradient(135deg, var(--accent), #1399da 58%, var(--warm));
  display:flex;align-items:center;justify-content:center;
  font-size:13px;font-weight:800;color:#051019;flex-shrink:0;
  box-shadow:0 10px 30px rgba(14, 158, 213, 0.35);
}
.header-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;}
.header-kicker{
  font-size:10px;
  text-transform:uppercase;
  letter-spacing:.16em;
  color:var(--accent-strong);
  font-weight:700;
}
.header-title{
  font-weight:700;
  font-size:15px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.header-subtitle{
  color:var(--muted);
  font-size:12px;
  line-height:1.45;
  max-width:56ch;
}
.badge{
  background:rgba(10, 24, 42, 0.86);
  border:1px solid var(--border-strong);
  color:var(--accent-strong);
  padding:6px 10px;
  border-radius:999px;
  font-size:11px;
  font-weight:700;
  white-space:nowrap;
  backdrop-filter:blur(10px);
}

/* ── hero + controls ───────────────────────────────────────────── */
.hero{
  display: flex;
  flex-direction:column;
  gap:14px;
  padding:18px;
  border-radius:var(--radius);
  border:1px solid var(--border);
  background:
    linear-gradient(180deg, rgba(18, 33, 53, 0.94), rgba(8, 18, 32, 0.96)),
    linear-gradient(135deg, rgba(66, 208, 255, 0.08), transparent 60%);
  box-shadow:var(--shadow);
}
.hero-top{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:14px;
}
.hero-copy-block{display:flex;flex-direction:column;gap:8px;min-width:0;}
.hero-label{
  width:max-content;
  padding:5px 9px;
  border-radius:999px;
  background:var(--accent-soft);
  border:1px solid rgba(66, 208, 255, 0.24);
  color:var(--accent-strong);
  font-size:10px;
  font-weight:700;
  letter-spacing:.12em;
  text-transform:uppercase;
}
.hero-title{
  font-size:20px;
  font-weight:800;
  line-height:1.1;
  letter-spacing:-0.03em;
}
.hero-summary{
  color:var(--muted);
  font-size:12px;
  line-height:1.55;
  max-width:60ch;
}
.hero-grid{
  display:grid;
  grid-template-columns:repeat(2, minmax(0, 1fr));
  gap:10px;
}
.hero-stat{
  padding:12px 13px;
  border-radius:14px;
  background:rgba(255, 255, 255, 0.03);
  border:1px solid var(--border);
}
.hero-stat-label{
  display:block;
  color:var(--muted);
  font-size:10px;
  font-weight:700;
  letter-spacing:.11em;
  text-transform:uppercase;
  margin-bottom:6px;
}
.hero-stat-value{
  display:block;
  color:var(--text);
  font-size:14px;
  font-weight:700;
}
.controls-wrap{
  flex: 0 0 auto;
  background:var(--surface-soft);
  border:1px solid var(--border);
  border-radius:16px;
  padding:16px;
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:12px;
}
.transport{
  width:100%;
  max-width:640px;
  display:flex;
  align-items:center;
  gap:12px;
  padding:12px;
  border-radius:14px;
  background:rgba(5, 13, 24, 0.42);
  border:1px solid rgba(130, 171, 214, 0.12);
}
.transport-btn{
  appearance:none;
  border:1px solid rgba(66, 208, 255, 0.22);
  background:linear-gradient(180deg, rgba(66, 208, 255, 0.18), rgba(16, 44, 67, 0.35));
  color:var(--accent-strong);
  font-size:20px;
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center;
  width:42px;
  height:42px;
  border-radius:50%;
  box-shadow:0 10px 24px rgba(0, 0, 0, 0.2);
}
.transport-time{
  font-family:monospace;
  font-size:13px;
  color:var(--muted-strong);
  min-width:104px;
  text-align:center;
  font-variant-numeric:tabular-nums;
  font-weight:700;
}
.transport-slider{
  flex:1;
  cursor:pointer;
  accent-color:var(--accent);
}
.transport-note{
  color:var(--muted);
  font-size:11px;
  align-self:flex-start;
}
.transport-error{
  color:var(--danger);
  font-size:11px;
  align-self:flex-start;
}

input[type="range"]{
  -webkit-appearance:none;
  appearance:none;
  background:transparent;
}
input[type="range"]::-webkit-slider-runnable-track{
  height:8px;
  border-radius:999px;
  background:linear-gradient(90deg, rgba(66, 208, 255, 0.8), rgba(255,255,255,0.12));
}
input[type="range"]::-webkit-slider-thumb{
  -webkit-appearance:none;
  appearance:none;
  width:18px;
  height:18px;
  margin-top:-5px;
  border-radius:50%;
  background:linear-gradient(180deg, #dcf8ff, #74dfff);
  border:2px solid #103246;
  box-shadow:0 0 0 4px rgba(66, 208, 255, 0.16);
}

/* ── edit banner ─────────────────────────────────────────────── */
.edit-banner{
  display:none;flex-shrink:0;
  padding:13px 16px;
  background:linear-gradient(90deg, rgba(255, 189, 102, 0.16), rgba(66, 208, 255, 0.1));
  border:1px solid rgba(255, 189, 102, 0.22);
  border-radius:14px;
  color:var(--muted-strong);
  font-size:12px;
  text-align:left;
  line-height:1.5;
  box-shadow:var(--shadow);
}
.edit-banner.active{display:block;}
.edit-banner strong{color:var(--warm);}
.edit-banner-row{display:flex;gap:10px;align-items:flex-start;}
.edit-icon{
  width:24px;
  height:24px;
  border-radius:8px;
  display:flex;
  align-items:center;
  justify-content:center;
  background:var(--warm-soft);
  color:var(--warm);
  flex-shrink:0;
}
.kbd{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:22px;
  height:22px;
  padding:0 6px;
  border-radius:6px;
  border:1px solid rgba(255,255,255,0.12);
  background:rgba(7, 17, 31, 0.6);
  color:var(--text);
  font-size:11px;
  font-weight:700;
}

/* ── chapters ────────────────────────────────────────────────── */
.chapters-panel{
  flex:0 0 auto;
  min-height:180px;
  background:linear-gradient(180deg, rgba(9, 18, 31, 0.97), rgba(6, 14, 26, 0.98));
  border:1px solid var(--border);
  border-radius:var(--radius);
  display:flex;flex-direction:column;
  overflow:hidden;
  box-shadow:var(--shadow);
}
.chapters-head{
  display:flex;align-items:center;justify-content:space-between;
  padding:14px 16px;
  border-bottom:1px solid var(--border);
  flex-shrink:0;
}
.chapters-head-label{
  font-size:10px;font-weight:700;letter-spacing:.14em;
  text-transform:uppercase;color:var(--muted);
}
.active-chapter-label{font-size:11px;color:var(--accent-strong);font-style:italic;max-width:50%;text-align:right;}
.chapters-list{padding:10px;display:flex;flex-direction:column;gap:8px;}
.chapter-item{
  display:grid;
  grid-template-columns:auto 1fr auto;
  align-items:center;
  gap:12px;
  padding:12px;
  border-radius:14px;
  cursor:pointer;
  transition:transform .12s, background .12s, border-color .12s;
  border:1px solid transparent;
  background:rgba(255,255,255,0.02);
}
.chapter-item:hover{background:rgba(255,255,255,0.05);border-color:rgba(130, 171, 214, 0.16);transform:translateY(-1px);}
.chapter-item.active{
  background:linear-gradient(90deg, rgba(66, 208, 255, 0.14), rgba(255, 189, 102, 0.08));
  border-color:rgba(66, 208, 255, 0.22);
  color:var(--text);
}
.dot{
  width:10px;height:10px;border-radius:50%;background:rgba(130, 171, 214, 0.28);flex-shrink:0;
  transition:background .2s, transform .2s, box-shadow .2s;
}
.chapter-item.active .dot,.dot.recording{background:var(--accent);transform:scale(1.15);box-shadow:0 0 0 5px rgba(66, 208, 255, 0.12);}
.chapter-meta{display:flex;flex-direction:column;gap:4px;min-width:0;}
.chapter-kicker{font-size:10px;color:var(--muted);letter-spacing:.11em;text-transform:uppercase;font-weight:700;}
.ch-name{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ch-time{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;flex-shrink:0;padding:4px 8px;border-radius:999px;background:rgba(255,255,255,0.04);border:1px solid rgba(130, 171, 214, 0.12);}
.no-chapters{padding:26px 18px;text-align:center;color:var(--muted);font-size:12px;line-height:1.65;display:flex;flex-direction:column;gap:6px;align-items:center;justify-content:center;min-height:180px;}
.no-chapters-badge{padding:5px 10px;border-radius:999px;border:1px solid rgba(130, 171, 214, 0.16);background:rgba(255,255,255,0.03);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted-strong);}

/* ── footer / status bar ─────────────────────────────────────── */
.status-bar{
  display:flex;align-items:center;gap:12px;
  padding:12px 14px;
  background:rgba(9, 18, 31, 0.92);
  border:1px solid var(--border);
  border-radius:16px;
  flex-shrink:0;
  font-size:11px;color:var(--muted);
  box-shadow:var(--shadow);
}
.status-dot{
  width:8px;height:8px;border-radius:50%;background:var(--muted);flex-shrink:0;
  transition:background .3s;
}
.status-dot.playing{background:var(--success);animation:blink 1.8s infinite;}
.status-dot.paused{background:var(--accent);}
.status-dot.edit{background:var(--warm);animation:blink 1.2s infinite;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.status-text{flex:1;}
.snapshot-pill{
  background:rgba(255,255,255,0.04);border:1px solid var(--border);
  padding:4px 8px;border-radius:999px;font-size:10px;
  font-variant-numeric:tabular-nums;
  color:var(--muted-strong);
}

/* ── scrollbar ───────────────────────────────────────────────── */
::-webkit-scrollbar{width:4px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;}

@media (max-width: 640px) {
  .shell{padding:12px;gap:12px;}
  .hero-top{flex-direction:column;}
  .hero-grid{grid-template-columns:1fr;}
  .transport{flex-wrap:wrap;}
  .transport-time{order:3;width:100%;text-align:left;}
  .active-chapter-label{max-width:none;}
}
</style>
</head>
<body>

<div class="shell">

<!-- HEADER -->
<div class="header">
  <div class="logo">CS</div>
  <div class="header-copy">
    <div class="header-kicker">Code Replay Studio</div>
    <div class="header-title" title="${escapeHtml(scrim.title)}">${escapeHtml(scrim.title)}</div>
    <div class="header-subtitle">A tighter playback workspace for narrated coding lessons, synced directly into your editor.</div>
  </div>
  <div class="badge">Native Replay</div>
</div>

<!-- HERO + CONTROL BAR -->
<div class="hero">
  <div class="hero-top">
    <div class="hero-copy-block">
      <div class="hero-label">${escapeHtml(replayMode)}</div>
      <div class="hero-title">Stay with the lesson, then branch when you want.</div>
      <div class="hero-summary">Follow the narrated flow, pause into edit mode when you want to experiment, and jump through checkpoints without losing the tutorial state.</div>
    </div>
    <div class="badge">${chapters.length} chapters</div>
  </div>
  <div class="hero-grid">
    <div class="hero-stat">
      <span class="hero-stat-label">Duration</span>
      <span class="hero-stat-value">${formatTime(replayDuration)}</span>
    </div>
    <div class="hero-stat">
      <span class="hero-stat-label">Mode</span>
      <span class="hero-stat-value">${escapeHtml(replayMode)}</span>
    </div>
  </div>
  <div class="controls-wrap">
${videoBlock}
  </div>
</div>

<!-- EDIT MODE BANNER -->
<div class="edit-banner" id="editBanner">
  <div class="edit-banner-row">
    <div class="edit-icon">✎</div>
    <div>
      <strong>Edit Mode Active</strong> — The code is yours to explore and modify in the editor.
      Press <span class="kbd">▶</span> to resume the tutorial.
    </div>
  </div>
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
  <span class="snapshot-pill">${chapters.length} checkpoints</span>
</div>

</div>

<script>
// ── VS Code API ──────────────────────────────────────────────────────────────
const vscode = acquireVsCodeApi();

// ── state ────────────────────────────────────────────────────────────────────
let isEditMode   = false;
let syncInterval = null;
let ytPlayer     = null;
let currentEventIndex = 0;
const chapterMarkers = ${JSON.stringify(chapters.map(ch => ({ title: ch.title, timestamp: ch.timestamp, index: ch.index })))};
let lastLocalSyncSentAt = -1;
let localPlaybackUnlocked = false;
let pendingLocalTransportAction = null;
let localAudioContext = null;
let localGainNode = null;
let localMediaSource = null;
const localPlaybackGain = 3;

// Notify extension that the webview DOM + JS is ready
vscode.postMessage({ type: 'ready' });

async function ensureLocalAudioBoost() {
  const vid = document.getElementById('localVideo');
  if (!vid || typeof AudioContext === 'undefined') {
    return;
  }

  if (!localAudioContext) {
    localAudioContext = new AudioContext();
    localMediaSource = localAudioContext.createMediaElementSource(vid);
    localGainNode = localAudioContext.createGain();
    localGainNode.gain.value = localPlaybackGain;
    localMediaSource.connect(localGainNode);
    localGainNode.connect(localAudioContext.destination);
  }

  if (localAudioContext.state === 'suspended') {
    try {
      await localAudioContext.resume();
    } catch {
      // Ignore resume failures and fall back to default element playback.
    }
  }
}

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
        void ensureLocalAudioBoost().finally(() => {
          void vid.play();
        });
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
        if (!isEditMode && (lastLocalSyncSentAt < 0 || Math.abs(vid.currentTime - lastLocalSyncSentAt) >= 0.05)) {
          lastLocalSyncSentAt = vid.currentTime;
          sendTime(vid.currentTime);
        }
      }
    }, 75);
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
  highlightChapter(t);
  vscode.postMessage({ type: 'timeUpdate', time: t });
}
function jumpToChapter(timestamp) {
  highlightChapter(timestamp);
  vscode.postMessage({ type: 'chapterClick', timestamp });

  const vid = document.getElementById('localVideo');
  if (vid) {
    vid.currentTime = timestamp;
    if (timestamp === 0) {
      void ensureLocalAudioBoost().finally(() => {
        void vid.play();
      });
    }
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
  const items = Array.from(document.querySelectorAll('.chapter-item'));
  if (items.length === 0 || chapterMarkers.length === 0) {
    return;
  }

  let activeIndex = -1;
  for (let i = 0; i < chapterMarkers.length; i++) {
    if (chapterMarkers[i].timestamp <= timestamp + 0.05) {
      activeIndex = i;
    } else {
      break;
    }
  }

  const activeLabel = document.getElementById('activeChapterLabel');
  items.forEach((item, index) => {
    item.classList.toggle('active', index === activeIndex);
  });

  if (activeLabel) {
    activeLabel.textContent = activeIndex >= 0 ? chapterMarkers[activeIndex].title : '';
  }
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
    highlightChapter(msg.time);
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
    highlightChapter(0);
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
      void ensureLocalAudioBoost().finally(() => {
        void vid.play();
      });
    } else {
      vid.pause();
    }
    return;
  }

  if (action === 'restart') {
    vid.currentTime = 0;
    updateLocalTransport(0, vid.duration);
    void ensureLocalAudioBoost().finally(() => {
      void vid.play();
    });
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
      <div class="transport">
        <button id="customPlayBtn" class="transport-btn" onclick="toggleCustomPlay()">
          ▶
        </button>
        <span id="customTimeDisplay" class="transport-time">
          0:00 / ${formatTime(maxTime)}
        </span>
        <input type="range" id="customScrubber" class="transport-slider" min="0" max="${maxTime}" step="0.1" value="0" oninput="onCustomScrubInput(this.value)" onchange="onCustomScrubDrop(this.value)">
      </div>
      <p class="transport-note">No audio track is attached to this lesson, so replay runs on the silent tutorial timeline.</p>
    `;
    }

    return `<div style="display:flex; flex-direction:column; align-items:center; width:100%; gap:12px;">
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
        return `<div class="no-chapters">
      <div class="no-chapters-badge">No checkpoints yet</div>
      <div>No chapters are defined in this tutorial.</div>
      <div style="font-size:11px;">Add chapter markers while recording to make navigation feel richer and easier to scan.</div>
    </div>`;
    }

    return chapters
        .map(
            ch => `<div class="chapter-item" data-timestamp="${ch.timestamp}"
        onclick="jumpToChapter(${ch.timestamp})">
        <div class="dot"></div>
        <div class="chapter-meta">
          <span class="chapter-kicker">Checkpoint ${ch.index + 1}</span>
          <span class="ch-name">${escapeHtml(ch.title)}</span>
        </div>
        <span class="ch-time">${formatTime(ch.timestamp)}</span>
      </div>`,
        )
        .join('\n');
}
