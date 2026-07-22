import { spawn, execSync } from 'node:child_process';

// 웹 터미널 허브 — 서버 셸 세션 관리 (WS /term).
// 백엔드 우선순위:
//   1) tmux — 세션이 tmux 서버(독립 프로세스)에 살아 **claude-control 재기동에도 유지**. 재접속 시 tmux가 화면 복원.
//   2) node-pty — 세션은 WS와 독립적으로 영속하나 서버 재기동 시 소실. 리사이즈가 ioctl이라 화면 잔상 없음.
//   3) script(util-linux) — 의존성 0 폴백.
const MAX_BUFFER = 256 * 1024;
// 고아 세션 GC: 마지막 클라이언트가 끊긴 뒤 이 시간 동안 아무도 재접속하지 않으면 종료.
// (새로고침·잠깐 이탈은 재접속으로 타이머가 풀리고, X로 버려진 세션은 찌꺼기로 안 남는다)
const IDLE_TTL = Number(process.env.CC_TERM_IDLE_MS) || 30 * 60_000;

let nodePty = null;
try { nodePty = (await import('node-pty')).default || (await import('node-pty')); } catch { nodePty = null; }

// tmux 백엔드 비활성 — node-pty 고정 (사용자 선택: 세션은 서버 프로세스 수명 동안 유지,
// 서버 재시작 시 소실. 대신 단일 프로세스로 단순하고 tmux 의존성이 없다.)
let hasTmux = false;
const TMUX_PREFIX = 'cc-';

function tmuxList() {
  try {
    const out = execSync(`tmux ls -F '#{session_name}' 2>/dev/null || true`, { encoding: 'utf8' });
    return out.split('\n').map(s => s.trim()).filter(n => n.startsWith(TMUX_PREFIX)).map(n => n.slice(TMUX_PREFIX.length));
  } catch { return []; }
}

// PTY 추상화 — { write, resize, onData, onExit, kill }
function openPty({ cwd, cols, rows, tmuxName }) {
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  // 데몬 환경엔 로케일이 없어 zsh 라인 에디터가 한글 입력을 <00xx> 바이트로 표시한다 — UTF-8 강제
  const env = { ...process.env, TERM: 'xterm-256color', LANG: process.env.LANG || 'ko_KR.UTF-8', LC_ALL: process.env.LC_ALL || 'ko_KR.UTF-8' };
  if (tmuxName && hasTmux) {
    // 세션이 없으면 detached로 먼저 만들고(옵션 적용) attach — race·상태바 노출 없이 깔끔.
    let exists = false;
    try { exists = execSync(`tmux has-session -t ${tmuxName} 2>/dev/null && echo y || echo n`, { encoding: 'utf8' }).trim() === 'y'; } catch { exists = false; }
    if (!exists) {
      try {
        execSync(`tmux new-session -d -s ${tmuxName} -x ${cols} -y ${rows} -c ${JSON.stringify(cwd)}`);
        // mouse off — 우클릭/선택을 tmux가 가로채지 않고 브라우저(xterm)로 넘겨 자체 복사·붙여넣기가 동작하게.
        execSync(`tmux set-option -t ${tmuxName} status off \\; set-option -t ${tmuxName} history-limit 20000 \\; set-option -t ${tmuxName} mouse off`);
      } catch { /* noop */ }
    }
    // smcup/rmcup 제거: attach가 alternate screen을 쓰지 않게 해 tmux 출력이
    // 브라우저 xterm의 스크롤백에 쌓인다 → 마우스 휠로 과거 출력 스크롤 가능.
    try { execSync(`tmux set-option -g terminal-overrides 'xterm*:smcup@:rmcup@' 2>/dev/null || true`); } catch { /* tmux 서버 없음 */ }
    const p = nodePty.spawn('tmux', ['attach-session', '-t', tmuxName], { name: 'xterm-256color', cols, rows, cwd, env });
    return {
      kind: 'tmux',
      write: (d) => p.write(typeof d === 'string' ? d : d.toString()),
      resize: (c, r) => { try { p.resize(c, r); } catch { /* noop */ } },
      onData: (cb) => p.onData(cb),
      onExit: (cb) => p.onExit(() => cb()),
      detach: () => { try { p.write('\x02d'); } catch { /* noop */ } try { p.kill(); } catch { /* noop */ } }, // client detach, 세션 유지
      kill: () => { try { execSync(`tmux kill-session -t ${tmuxName} 2>/dev/null || true`); } catch { /* noop */ } try { p.kill(); } catch { /* noop */ } },
    };
  }
  if (nodePty) {
    const p = nodePty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd, env });
    return { kind: 'node-pty', write: (d) => p.write(typeof d === 'string' ? d : d.toString()), resize: (c, r) => { try { p.resize(c, r); } catch { /* noop */ } }, onData: (cb) => p.onData(cb), onExit: (cb) => p.onExit(() => cb()), detach: () => {}, kill: () => { try { p.kill(); } catch { /* noop */ } } };
  }
  const sh = spawn('script', ['-qfc', shell, '/dev/null'], { cwd, env });
  return { kind: 'script', write: (d) => { try { sh.stdin.write(d); } catch { /* noop */ } }, resize: (c, r) => { try { sh.stdin.write(`\x15stty rows ${r} cols ${c} 2>/dev/null\r\x15`); } catch { /* noop */ } }, onData: (cb) => { sh.stdout.on('data', cb); sh.stderr.on('data', cb); }, onExit: (cb) => sh.on('exit', cb), detach: () => {}, kill: () => { try { sh.kill('SIGHUP'); } catch { /* noop */ } } };
}

export function createTerminalHub({ cwd }) {
  const sessions = new Map(); // id → session (현재 attach 상태를 가진 것)
  let seq = 0;

  function open(id, { ephemeral = false, title, cols = 80, rows = 24 } = {}) {
    const tmuxName = (hasTmux && !ephemeral) ? TMUX_PREFIX + id : null;
    const pty = openPty({ cwd, cols, rows, tmuxName });
    const s = { id, pty, tmux: !!tmuxName, title: title || '터미널', ephemeral, clients: new Set(), buffer: [], bytes: 0, cols, rows, ready: pty.kind !== 'script', created: Date.now() };
    const push = (d) => {
      const buf = Buffer.isBuffer(d) ? d : Buffer.from(d);
      if (!s.ready) return;
      // tmux는 재접속 시 자체 redraw로 화면을 복원하므로 스크롤백 버퍼는 유지하지 않는다(이중 출력 방지).
      if (!s.tmux) { s.buffer.push(buf); s.bytes += buf.length; while (s.bytes > MAX_BUFFER && s.buffer.length > 1) s.bytes -= s.buffer.shift().length; }
      for (const ws of s.clients) if (ws.readyState === 1) ws.send(buf);
    };
    pty.onData(push);
    pty.onExit(() => { for (const ws of s.clients) { try { ws.close(); } catch { /* noop */ } } sessions.delete(id); });
    if (pty.kind === 'script') setTimeout(() => { pty.write('clear\n'); setTimeout(() => { s.ready = true; }, 60); }, 120);
    sessions.set(id, s);
    return s;
  }

  function create(opts) { return open(`t${Date.now().toString(36)}${(seq++).toString(36)}`, opts); }

  function setSize(s, cols, rows) {
    cols = Math.round(cols); rows = Math.round(rows);
    if (!cols || !rows || (s.cols === cols && s.rows === rows)) return;
    s.cols = cols; s.rows = rows;
    s.pty.resize(cols, rows);
  }

  function attach(ws, req) {
    const q = (() => { try { return new URL(req.url, 'http://x').searchParams; } catch { return new URLSearchParams(); } })();
    const cols = Number(q.get('cols')) || 80;
    const rows = Number(q.get('rows')) || 24;
    const ephemeral = q.get('ephemeral') === '1';
    const reqId = q.get('id');
    let s = reqId && sessions.get(reqId);
    // 서버 재기동 후: 메모리엔 없지만 tmux 세션은 살아있을 수 있음 → 그 id로 재개(attach)
    if (!s && reqId && hasTmux && !ephemeral && tmuxList().includes(reqId)) s = open(reqId, { cols, rows });
    if (!s) s = create({ ephemeral, cols, rows });
    else setSize(s, cols, rows);
    clearTimeout(s.gcTimer); // 재접속 — 유휴 GC 취소
    if (!s.tmux) { const replay = Buffer.concat(s.buffer.map(b => (Buffer.isBuffer(b) ? b : Buffer.from(b)))); if (replay.length && ws.readyState === 1) ws.send(replay); }
    s.clients.add(ws);
    if (ws.readyState === 1) ws.send('\x00' + JSON.stringify({ type: 'ready', id: s.id, title: s.title, tmux: !!s.tmux }));
    // tmux는 attach 시 화면을 다시 그리도록 refresh 요청
    if (s.tmux) setTimeout(() => { try { execSync(`tmux refresh-client -t ${TMUX_PREFIX + s.id} 2>/dev/null || true`); } catch { /* noop */ } }, 50);

    ws.on('message', (m) => {
      const str = m.toString();
      if (str.startsWith('\x00')) {
        try { const c = JSON.parse(str.slice(1)); if (c.type === 'resize') setSize(s, c.cols, c.rows); else if (c.type === 'rename' && c.title) s.title = String(c.title).slice(0, 40); } catch { /* noop */ }
        return;
      }
      s.pty.write(m);
    });
    ws.on('close', () => {
      s.clients.delete(ws);
      if (s.clients.size === 0) {
        if (s.ephemeral) { s.pty.kill(); sessions.delete(s.id); }
        else if (s.tmux) { s.pty.detach(); sessions.delete(s.id); } // tmux 세션은 살려두고 메모리만 정리
        else {
          // node-pty: 유휴 GC 예약 — TTL 안에 재접속 없으면 프로세스 종료
          clearTimeout(s.gcTimer);
          s.gcTimer = setTimeout(() => {
            if (s.clients.size === 0) { try { s.pty.kill(); } catch { /* noop */ } sessions.delete(s.id); }
          }, IDLE_TTL);
          if (s.gcTimer.unref) s.gcTimer.unref();
        }
      }
    });
  }

  return {
    ptyMode: hasTmux ? 'tmux' : nodePty ? 'node-pty' : 'script',
    attach,
    list: () => {
      const mem = new Map([...sessions.values()].filter(s => !s.ephemeral).map(s => [s.id, { id: s.id, title: s.title, clients: s.clients.size, created: s.created }]));
      // tmux 모드: 메모리에 없어도(재기동 후) 살아있는 세션 포함
      if (hasTmux) for (const id of tmuxList()) if (!mem.has(id)) mem.set(id, { id, title: '터미널', clients: 0, created: 0 });
      return [...mem.values()];
    },
    kill: (id) => { const s = sessions.get(id); if (s) { s.pty.kill(); sessions.delete(id); } else if (hasTmux) { try { execSync(`tmux kill-session -t ${TMUX_PREFIX + id} 2>/dev/null || true`); } catch { /* noop */ } } },
    rename: (id, title) => { const s = sessions.get(id); if (s) s.title = String(title || '').slice(0, 40) || s.title; },
  };
}
