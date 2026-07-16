import express from 'express';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
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
app.use(express.static(path.join(ROOT, 'web')));
app.get('/healthz', (req, res) => res.json({ ok: true, service: process.env.SERVICE_NAME || 'Claude Control', driver: driverKind }));
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
server.on('upgrade', (req, socket, head) => {
  const pathname = (() => { try { return new URL(req.url, 'http://x').pathname; } catch { return ''; } })();
  const target = pathname === '/ws' ? wss : pathname === '/term' ? termWss : null;
  if (!target) { socket.destroy(); return; }
  if (!ipAllowed(req.socket.remoteAddress) || (auth.enabled() && !auth.isAuthed(req))) { socket.destroy(); return; }
  if (pathname === '/term' && !db.getSetting('terminal_enabled', false)) { socket.destroy(); return; }
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});
wss.on('connection', (ws) => bus.addClient(ws));
// 웹 터미널 — 세션 허브에 연결 (세션은 WS와 독립적으로 영속)
termWss.on('connection', (ws, req) => termHub.attach(ws, req));

// HOST 기본 0.0.0.0 (IPv4). 미지정 시 Node가 ::(IPv6)에만 바인딩돼
// localhost가 127.0.0.1로 풀리는 환경에서 접속 거부되는 문제 방지.
// 로컬 전용으로 묶으려면 HOST=127.0.0.1.
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  const actualPort = server.address().port; // PORT=0(auto)이면 OS가 할당한 실제 포트
  const shownHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log('');
  console.log('┌──────────────────────────────────────────────────');
  console.log(`│  ${process.env.SERVICE_NAME || 'Claude Control'}`);
  console.log(`│  ▶ ${scheme}://${shownHost}:${actualPort}  (bind ${HOST}:${actualPort})`);
  if (tls) console.log('│  (자체 서명 인증서 — 브라우저 최초 경고는 "계속 진행"으로 통과)');
  if (useHttps && !tls) console.log('│  ⚠ HTTPS 요청됐으나 openssl 없어 HTTP로 폴백');
  console.log(`│  driver=${driverKind}  data=${DATA_DIR}`);
  if (ALLOW.length) console.log(`│  allow=${process.env.ALLOW_CIDR}`);
  console.log('└──────────────────────────────────────────────────');
});
