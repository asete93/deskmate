import express from 'express';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { openDb } from './db.js';
import { createBus } from './bus.js';
import { createGitApi } from './gitApi.js';
import { seedWorkspace } from './seedWorkspace.js';
import { createNotifier } from './notify.js';
import { createManager } from './agents/manager.js';
import { createApi } from './api.js';
import { createAuth } from './auth.js';
import { createTerminalHub } from './terminal.js';
import { ensureCert } from './certs.js';
import { createFilesApi } from './files.js';
import { startScheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.env.PORT || 3200);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const WORK_DIR = path.join(DATA_DIR, 'workspace');

// 드라이버 선택: 명시(AGENT_DRIVER) > 인증 존재 여부.
// 인증 = API 키 또는 Claude 구독 OAuth 토큰 (둘 중 하나 있으면 실 SDK).
// 호스트에 Claude Code가 이미 로그인돼 있으면(ambient creds) AGENT_DRIVER=sdk로 명시 권장.
const driverKind = (() => {
  const d = (process.env.AGENT_DRIVER || 'auto').toLowerCase();
  if (d === 'mock' || d === 'sdk') return d;
  const hasAuth = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN;
  return hasAuth ? 'sdk' : 'mock';
})();

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads'); // 워크스페이스 밖 — 구조 분석/git 오염 방지

const db = openDb(DATA_DIR);
seedWorkspace(WORK_DIR);
const gitApi = createGitApi(WORK_DIR);
const bus = createBus(db);
const notify = createNotifier(db);
const manager = createManager({ db, bus, notify, workDir: WORK_DIR, uploadsDir: UPLOADS_DIR, driverKind });
manager.ctx.gitApi = gitApi;
// 서버 기능 감지 — 없으면 해당 메뉴/기능이 UI에서 비활성 안내된다 (기동은 계속)
const hasBin = (cmd) => { try { execSync(`${cmd} --version`, { stdio: 'ignore' }); return true; } catch { return false; } };
manager.ctx.caps = { git: hasBin('git'), codex: hasBin('codex') };
// --no-terminal / --no-files — 설정과 무관한 완전 비활성 (UI 미노출 + API 차단)
const disabledSet = new Set(String(process.env.CC_DISABLE || '').split(',').map(x => x.trim()).filter(Boolean));
manager.ctx.disabled = { terminal: disabledSet.has('terminal'), files: disabledSet.has('files') };
if (disabledSet.size) console.log(`[deskmate] 기능 비활성: ${[...disabledSet].join(', ')}`);
if (!manager.ctx.caps.git) console.warn('[claude-control] git 미설치 — Git 메뉴 비활성 (설치 후 재시작하면 활성화)');
manager.init();
startScheduler({ db, bus, manager });

const auth = createAuth(db, DATA_DIR);
const termHub = createTerminalHub({ cwd: WORK_DIR });

// ── 접근 허용 IP 대역 (ALLOW_CIDR="192.168.0.0/16,127.0.0.1/32") ──
// 0.0.0.0 공개 바인딩 시 신뢰 대역만 통과시키는 1차 방화벽. 미설정이면 전체 허용.
const ALLOW = (process.env.ALLOW_CIDR || '').split(',').map(s => s.trim()).filter(Boolean).map(cidr => {
  const [ip, bits = '32'] = cidr.split('/');
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return null;
  const base = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return { base: base & mask, mask };
}).filter(Boolean);
function ipAllowed(remote) {
  if (!ALLOW.length) return true;
  const ip4 = String(remote || '').replace(/^::ffff:/, ''); // IPv6-mapped IPv4
  if (ip4 === '::1') return ALLOW.some(a => ((0x7f000001 & a.mask) >>> 0) === a.base); // ::1 ≈ 127.0.0.1
  const parts = ip4.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return false; // 그 외 IPv6는 차단(대역 지정 시)
  const v = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  return ALLOW.some(a => ((v & a.mask) >>> 0) === a.base);
}

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS: 서비스 스위처가 다른 포트 인스턴스를 호출한다 (데모 — 신뢰 네트워크 전용)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-auth-token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// IP 대역 게이트 — CIDR 밖 요청은 전부 403 (정적 포함)
app.use((req, res, next) => {
  if (ipAllowed(req.socket.remoteAddress)) return next();
  // 차단된 출발 IP를 로그로 — --allow 대역 설정 실수를 바로 알 수 있게 (IP당 1회)
  const dip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!globalThis.__deniedIps) globalThis.__deniedIps = new Set();
  if (!globalThis.__deniedIps.has(dip) && globalThis.__deniedIps.size < 50) {
    globalThis.__deniedIps.add(dip);
    console.warn(`[deskmate] 접근 차단: ${dip} — --allow 대역(${process.env.ALLOW_CIDR}) 밖입니다. 이 IP를 허용하려면 대역을 추가하세요.`);
  }
  res.status(403).send('forbidden');
});

// 로그인 게이트 (설정에서 on/off) — API·업로드·워크스페이스·WS 보호. 정적 웹 자산은 허용(로그인 화면).
app.use((req, res, next) => {
  if (!auth.enabled()) return next();
  const p = req.path;
  const open = p === '/api/login' || p === '/api/auth-status' || p === '/healthz'
    || (!p.startsWith('/api') && !p.startsWith('/uploads') && !p.startsWith('/workspace'));
  if (open || auth.isAuthed(req)) return next();
  res.status(401).json({ error: 'auth required' });
});

app.use('/api', createApi({ db, bus, manager, gitApi, uploadsDir: UPLOADS_DIR, auth, termHub, filesApi: createFilesApi(WORK_DIR) }));
app.use('/uploads', express.static(UPLOADS_DIR));
// 아티팩트 미리보기: 워크스페이스 정적 서빙 — 상대경로 CSS/JS가 그대로 동작
app.use('/workspace', express.static(WORK_DIR));
// 채팅 본문의 파일명-만 참조 지원 — /workspace/<basename> 404면 워크스페이스에서 탐색해 리다이렉트
app.use('/workspace', (req, res) => {
  const base = path.basename(decodeURIComponent(req.path));
  if (!/\.(png|jpe?g|gif|webp|svg|html?)$/i.test(base)) return res.status(404).end();
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
  const queue = [WORK_DIR];
  let found = null;
  for (let depth = 0; queue.length && depth < 400 && !found; depth++) {
    const dir = queue.shift();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.isFile() && e.name === base) { found = path.join(dir, e.name); break; }
      if (e.isDirectory() && !skip.has(e.name) && !e.name.startsWith('.')) queue.push(path.join(dir, e.name));
    }
  }
  if (!found) return res.status(404).end();
  res.redirect(302, '/workspace/' + path.relative(WORK_DIR, found).split(path.sep).join('/'));
});
app.use(express.static(path.join(ROOT, 'web')));
app.get('/healthz', (req, res) => res.json({ ok: true, service: process.env.SERVICE_NAME || 'Deskmate', driver: driverKind }));
// SPA 폴백 — 정적 자원 경로(workspace/uploads/dist)는 제외해 미존재 파일이 404로 떨어지게
app.get(/^\/(?!api|ws|workspace|uploads|dist).*/, (req, res) => res.sendFile(path.join(ROOT, 'web/index.html')));

// HTTPS 옵션(HTTPS=1): 자체 서명 인증서로 secure context 확보 (클립보드 붙여넣기 등)
const useHttps = ['1', 'true'].includes(String(process.env.HTTPS || '').toLowerCase());
const tls = useHttps ? ensureCert(DATA_DIR) : null;
const server = tls ? https.createServer(tls, app) : http.createServer(app);
const scheme = tls ? 'https' : 'http';
const wss = new WebSocketServer({ noServer: true });      // 실시간 상태 (/ws)
const termWss = new WebSocketServer({ noServer: true });  // 웹 터미널 (/term)

// WS 공통 게이트: IP 대역 + 로그인 — 통과 못 하면 핸드셰이크 자체를 거부
const onUpgrade = (req, socket, head) => {
  const pathname = (() => { try { return new URL(req.url, 'http://x').pathname; } catch { return ''; } })();
  const target = pathname === '/ws' ? wss : pathname === '/term' ? termWss : null;
  if (!target) { socket.destroy(); return; }
  if (!ipAllowed(req.socket.remoteAddress) || (auth.enabled() && !auth.isAuthed(req))) { socket.destroy(); return; }
  if (pathname === '/term' && (manager.ctx.disabled?.terminal || !db.getSetting('terminal_enabled', false))) { socket.destroy(); return; }
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
};
server.on('upgrade', onUpgrade);
wss.on('connection', (ws) => bus.addClient(ws));
// 웹 터미널 — 세션 허브에 연결 (세션은 WS와 독립적으로 영속)
termWss.on('connection', (ws, req) => termHub.attach(ws, req));

// HOST 기본 0.0.0.0 (IPv4). 미지정 시 Node가 ::(IPv6)에만 바인딩돼
// localhost가 127.0.0.1로 풀리는 환경에서 접속 거부되는 문제 방지.
// 로컬 전용으로 묶으려면 HOST=127.0.0.1.
const HOST = process.env.HOST || '0.0.0.0';
// HTTPS 모드에서 HTTP 병행 리슨 — 모바일 앱(자체 서명 미지원)·구형 클라이언트용.
// 기본: HTTPS 포트+1. HTTP_PORT=off 로 끄거나 HTTP_PORT=<n> 로 지정.
const httpPortEnv = String(process.env.HTTP_PORT || '').toLowerCase();
// HTTP 포트는 모바일 앱 전용 — 앱이 보내는 식별 헤더 없으면 403 (브라우저 평문 접속 차단).
// 주의: 위장 가능한 헤더라 보안 경계는 아님 — 실제 보호는 로그인 + 내부망/VPN.
const isAppClient = (req) => req.headers['x-deskmate-client'] === 'app'
  // 정적 산출물(이미지·HTML 미리보기)은 예외 — RN Image/WebView가 커스텀 헤더를 못 보낸다.
  // 로그인 켠 서버는 auth 게이트가 토큰 쿼리로 별도 보호.
  || (['GET', 'HEAD'].includes(req.method) && (req.url.startsWith('/workspace/') || req.url.startsWith('/uploads/')));
const httpServer = (tls && httpPortEnv !== 'off') ? http.createServer((req, res) => {
  if (!isAppClient(req)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('This HTTP port is for the Deskmate mobile app only. Use HTTPS in a browser.');
    return;
  }
  app(req, res);
}) : null;
if (httpServer) httpServer.on('upgrade', (req, socket, head) => {
  if (!isAppClient(req)) { socket.destroy(); return; }
  onUpgrade(req, socket, head);
});

server.listen(PORT, HOST, () => {
  const actualPort = server.address().port; // PORT=0(auto)이면 OS가 할당한 실제 포트
  const shownHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  const banner = (httpPort) => {
    console.log('');
    console.log('┌──────────────────────────────────────────────────');
    console.log(`│  ${process.env.SERVICE_NAME || 'Deskmate'}`);
    console.log(`│  ▶ ${scheme}://${shownHost}:${actualPort}  (bind ${HOST}:${actualPort})`);
    if (httpPort) console.log(`│  ▶ http://${shownHost}:${httpPort}  (모바일 앱 전용 — 브라우저 403)`);
    if (tls) console.log('│  (자체 서명 인증서 — 브라우저 최초 경고는 "계속 진행"으로 통과)');
    if (useHttps && !tls) console.log('│  ⚠ HTTPS 요청됐으나 openssl 없어 HTTP로 폴백');
    console.log(`│  driver=${driverKind}  data=${DATA_DIR}`);
    if (ALLOW.length) console.log(`│  allow=${process.env.ALLOW_CIDR}`);
    console.log('└──────────────────────────────────────────────────');
  };
  if (!httpServer) { banner(null); return; }
  const wantHttp = /^\d+$/.test(httpPortEnv) ? Number(httpPortEnv) : actualPort + 1;
  httpServer.once('error', (e) => { console.warn(`[deskmate] HTTP 병행 리슨 실패(${e.code}) — HTTPS 단독으로 계속`); banner(null); });
  httpServer.listen(wantHttp, HOST, () => banner(httpServer.address().port));
});
