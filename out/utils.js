"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectVideoType = detectVideoType;
exports.extractYouTubeId = extractYouTubeId;
exports.extractVimeoId = extractVimeoId;
exports.formatTime = formatTime;
exports.escapeHtml = escapeHtml;
exports.shouldIgnorePath = shouldIgnorePath;
/** Detect video platform from a URL string */
function detectVideoType(url) {
    if (!url)
        return 'generic';
    const u = url.toLowerCase();
    if (u.includes('youtube.com') || u.includes('youtu.be'))
        return 'youtube';
    if (u.includes('vimeo.com'))
        return 'vimeo';
    if (u.startsWith('/') || u.startsWith('file://') || /\.(mp4|webm|ogg|mov|mkv)$/.test(u))
        return 'local';
    return 'generic';
}
/** Extract YouTube video ID from any YouTube URL variant */
function extractYouTubeId(url) {
    const patterns = [
        /[?&]v=([^&#]+)/,
        /youtu\.be\/([^?#]+)/,
        /youtube\.com\/embed\/([^?#]+)/,
        /youtube\.com\/shorts\/([^?#]+)/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m)
            return m[1];
    }
    return null;
}
/** Extract Vimeo video ID */
function extractVimeoId(url) {
    const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return m ? m[1] : null;
}
/** Format seconds → MM:SS or H:MM:SS */
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
}
/** Basic HTML escaping for values injected into webview HTML */
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/** Paths that should never be snapshotted */
const IGNORE_PATTERNS = [
    'node_modules',
    '.git',
    '.next',
    'dist',
    'build',
    '__pycache__',
    '.venv',
    'venv',
];
function shouldIgnorePath(relativePath) {
    return IGNORE_PATTERNS.some(p => relativePath.includes(p));
}
//# sourceMappingURL=utils.js.map