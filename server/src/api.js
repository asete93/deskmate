import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { buildPptx, buildXlsx } from './reportGen.js';
import { platformPromptForDisplay } from './agents/platformPrompt.js';
import { fetchUsage } from './usage.js';
import { computeNextRun } from './scheduler.js';

export function createApi({ db, bus, manager, gitApi, uploadsDir, auth, termHub, filesApi }) {
  const r = express.Router();

  // ---- 파일 업로드 (채팅 첨부) ----
  // 워크스페이스 "밖"(/data/uploads)에 저장 — 에이전트의 구조 분석(Glob/Grep)과
  // git에 참고자료가 쓸려 들어가는 오염 방지. 열람은 additionalDirectories로 허용.
  fs.mkdirSync(uploadsDir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(uploadsDir, { recursive: true }); cb(null, uploadsDir); },
    filename: (req, file, cb) => {
      // multer는 originalname을 latin1로 줌 → utf8 복원 후 안전화
      const orig = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const safe = orig.normalize('NFC').replace(/[^\w.\-가-힣]/g, '_').slice(-80);
      cb(null, `${Date.now().toString(36)}-${safe}`);
    },
  });
  const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024, files: 10 } });
  const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 20 } });
  const ok = (res, data = { ok: true }) => res.json(data);
  const guard = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { res.status(400).json({ error: e.message }); }
  };

  // ---- 로그인 (단일 계정 — 비밀번호만) ----
  r.get('/auth-status', (req, res) => ok(res, { enabled: auth.enabled(), has_password: auth.hasPassword(), lang: db.getSetting('lang', 'ko') }));
  r.post('/login', guard(async (req, res) => {
    // IP는 소켓 기준 — X-Forwarded-For는 직결 공격자가 위조해 IP별 잠금을 우회할 수 있어 신뢰하지 않는다.
    // (리버스 프록시 뒤 배포 시 app.set('trust proxy') + req.ip로 조정)
    const result = await auth.login(req.body?.password, req.socket.remoteAddress || 'unknown');
    if (!result) throw new Error('비밀번호가 올바르지 않습니다');
    if (result.reset) return ok(res, { reset: true });
    res.setHeader('Set-Cookie', auth.cookieFor(result.token));
    ok(res, { token: result.token });
  }));
  // 로그인 기능 on/off + 최초 비밀번호 설정 (게이트가 켜져 있으면 인증된 요청만 도달)
  r.post('/auth/config', guard((req, res) => {
    const result = auth.setConfig({ enabled: !!req.body?.enabled, password: req.body?.password });
    if (result.token) res.setHeader('Set-Cookie', auth.cookieFor(result.token));
    bus.settings();
    bus.event('User', 'user', req.body?.enabled ? '로그인 기능 활성화' : '로그인 기능 비활성화');
    ok(res, result);
  }));

  // ---- 스냅샷 / 서비스 ----
  r.get('/state', (req, res) => ok(res, manager.state()));
  r.get('/models', guard(async (req, res) => ok(res, await manager.listModels())));
  // 구독 사용량 총괄 — 공식 usage API(세션/주간/모델별 %) + 플랜 + 오늘 토큰 합계
  r.get('/usage', guard(async (req, res) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let u = { plan: '', limits: [] };
    try { u = await fetchUsage(); } catch (e) { u = { plan: '', limits: [], error: e.message }; }
    ok(res, { ...u, today: db.sumTokensSince(today.getTime()) });
  }));
  r.get('/service-info', (req, res) => ok(res, {
    name: process.env.SERVICE_NAME || 'Deskmate',
    port: Number(process.env.PORT || 3200),
  }));

  // ---- 채팅 ----
  r.get('/chat-all', guard((req, res) => ok(res, db.listAllMessages(Number(req.query.limit) || 300))));
  r.get('/chat/:channel', guard((req, res) => ok(res, db.listMessages(req.params.channel))));
  r.get('/messages/:id', guard((req, res) => {
    const m = db.getMessage(Number(req.params.id));
    if (!m) throw new Error('메시지 없음');
    ok(res, m);
  }));
  r.post('/chat/:channel', guard((req, res) => ok(res,
    manager.sendChat(req.params.channel, String(req.body.text || '').trim(), Array.isArray(req.body.attachments) ? req.body.attachments : [], req.body.target || null,
      Array.isArray(req.body.pastes) ? req.body.pastes.slice(0, 10).map(x => ({ text: String(x?.text || '').slice(0, 200_000), lines: Number(x?.lines) || String(x?.text || '').split('\n').length })) : []))));
  // 팀원 추가: provider 있으면 외부 AI 연동, 없으면 대표 권한 직접 고용 (둘 다 결재 절차 없음)
  r.post('/agents', guard((req, res) => {
    const { provider, name, role, model, effort, prompt } = req.body || {};
    const id = provider
      ? manager.addExternalAgent({ provider, name, role: role || '', model, effort })
      : manager.hireAgent({ name, role, model, effort, prompt });
    ok(res, { id });
  }));
  r.post('/upload', upload.array('files', 10), (req, res) => {
    res.json((req.files || []).map(f => ({
      name: Buffer.from(f.originalname, 'latin1').toString('utf8'),
      file: f.filename,
      url: `/uploads/${encodeURIComponent(f.filename)}`,
      size: f.size,
      mime: f.mimetype,
    })));
  });
  r.post('/interactions/:id/answer', guard((req, res) => {
    manager.answerInteraction(Number(req.params.id), req.body || {});
    ok(res);
  }));
  // 스냅샷 메시지에는 interaction_id가 없음 → message_id로 응답
  r.post('/interactions/by-message/:msgId/answer', guard((req, res) => {
    const it = db.getInteractionByMessage(Number(req.params.msgId));
    if (!it) throw new Error('해당 메시지의 인터랙션 없음');
    manager.answerInteraction(it.id, req.body || {});
    ok(res);
  }));

  // ---- 웹 터미널 ----
  const termGuard = (req, res, next) => { if (manager.ctx.disabled?.terminal || !db.getSetting('terminal_enabled', false)) throw new Error('터미널 기능이 꺼져 있습니다'); next(); };
  r.get('/terminals', guard((req, res) => { termGuard(req, res, () => ok(res, termHub.list())); }));
  r.post('/terminals/:id/kill', guard((req, res) => { termHub.kill(req.params.id); ok(res); }));
  r.post('/terminals/:id/rename', guard((req, res) => { termHub.rename(req.params.id, req.body?.title); ok(res); }));
  r.post('/settings/terminal', guard((req, res) => {
    if (manager.ctx.disabled?.terminal) throw new Error('서버 기동 옵션(--no-terminal)으로 비활성된 기능입니다');
    db.setSetting('terminal_enabled', !!req.body?.enabled);
    bus.settings();
    bus.event('User', 'user', `터미널 기능 ${req.body?.enabled ? '활성화' : '비활성화'}`);
    ok(res);
  }));

  // ---- 워크스페이스 파일 (탐색기·에디터) ----
  const fmw = (req, res, next) => { if (manager.ctx.disabled?.files || !db.getSetting('files_enabled', false)) return res.status(403).json({ error: '파일 기능이 꺼져 있습니다' }); next(); };
  r.post('/settings/files', guard((req, res) => {
    if (manager.ctx.disabled?.files) throw new Error('서버 기동 옵션(--no-files)으로 비활성된 기능입니다');
    db.setSetting('files_enabled', !!req.body?.enabled);
    bus.settings();
    bus.event('User', 'user', `파일 기능 ${req.body?.enabled ? '활성화' : '비활성화'}`);
    ok(res);
  }));
  r.get('/files', fmw, guard((req, res) => ok(res, filesApi.list(String(req.query.path || '')))));
  r.get('/file', fmw, guard((req, res) => ok(res, filesApi.read(String(req.query.path || '')))));
  r.post('/file', fmw, guard((req, res) => ok(res, filesApi.write(String(req.body.path || ''), req.body.content))));
  r.post('/file/create', fmw, guard((req, res) => ok(res, filesApi.createNode(String(req.body.path || ''), !!req.body.dir))));
  r.post('/file/rename', fmw, guard((req, res) => ok(res, filesApi.rename(String(req.body.path || ''), String(req.body.to || '')))));
  r.delete('/file', fmw, guard((req, res) => ok(res, filesApi.remove(String(req.query.path || '')))));
  r.post('/file/move', fmw, guard((req, res) => ok(res, filesApi.move(String(req.body.path || ''), String(req.body.toDir || '')))));
  r.post('/file/copy', fmw, guard((req, res) => ok(res, filesApi.copy(String(req.body.path || ''), String(req.body.toDir || '')))));
  // 다운로드
  r.get('/file/download', fmw, guard((req, res) => {
    const abs = filesApi.absPath(String(req.query.path || ''));
    res.download(abs);
  }));
  // 업로드 (워크스페이스 dstDir 안으로) — 채팅 첨부와 다른 저장소
  r.post('/file/upload', fmw, memUpload.array('files', 20), guard((req, res) => {
    const dir = String(req.body.dir || '');
    const out = (req.files || []).map(f => filesApi.saveUpload(dir, Buffer.from(f.originalname, 'latin1').toString('utf8'), f.buffer));
    ok(res, out);
  }));
  // 붙여넣기 업로드 (base64 또는 텍스트)
  r.post('/file/paste', fmw, guard((req, res) => {
    const { dir, name, dataBase64, text } = req.body || {};
    const buf = dataBase64 != null ? Buffer.from(String(dataBase64), 'base64') : Buffer.from(String(text ?? ''), 'utf8');
    ok(res, filesApi.saveUpload(String(dir || ''), String(name || 'pasted.txt'), buf));
  }));

  // ---- 목표 / 모드 / 에이전트 설정 ----
  r.post('/goal', guard((req, res) => { manager.setGoal(String(req.body.goal || '')); ok(res); }));
  r.post('/mode', guard((req, res) => { manager.setMode(String(req.body.mode)); ok(res); }));
  r.post('/lang', guard((req, res) => { manager.setLang(String(req.body.lang)); ok(res); }));
  r.post('/agents/:id/config', guard((req, res) => {
    const patch = {};
    for (const k of ['model', 'effort', 'name', 'role', 'prompt', 'avatar']) if (req.body[k] != null) patch[k] = String(req.body[k]).slice(0, k === 'avatar' ? 4 : 4000);
    manager.setAgentConfig(Number(req.params.id), patch);
    ok(res);
  }));
  // 실제 적용 시스템 프롬프트 (Layer 1 + 역할 + 커스텀 지침) — 읽기전용
  r.get('/agents/:id/prompt', guard((req, res) => ok(res, { content: manager.getAgentPrompt(Number(req.params.id)) })));
  // 진행 중 작업 중단 (인터럽트)
  r.post('/agents/:id/interrupt', guard(async (req, res) => { await manager.interruptAgent(Number(req.params.id), req.body?.channel || null); ok(res); }));
  // 새 대화 시작 — 세션 분리 (이력 보존, 기억만 리셋). 팀장은 channel(방) 단위
  r.post('/agents/:id/reset-session', guard((req, res) => { manager.resetAgentSession(Number(req.params.id), req.body?.channel || null); ok(res); }));
  // 채팅방 (팀장 방별 독립 세션)
  r.post('/threads', guard((req, res) => ok(res, manager.createThread(req.body?.title))));
  r.delete('/threads/:channel', guard((req, res) => { manager.deleteThread(req.params.channel); ok(res); }));
  r.post('/threads/:channel/rename', guard((req, res) => { manager.renameThread(req.params.channel, req.body?.title); ok(res); }));
  r.post('/threads/:channel/clear', guard((req, res) => { manager.clearThread(req.params.channel, { memory: req.body?.memory !== false }); ok(res); }));
  // 방별 팀장 model/effort 오버라이드 (빈 값 = 기본값 따름)
  r.post('/threads/:channel/config', guard((req, res) => {
    manager.setThreadConfig(req.params.channel, { model: req.body?.model, effort: req.body?.effort });
    ok(res);
  }));

  // 전체 데이터 초기화 (파괴적) — UI 확인 모달 통과 후에만 호출
  r.post('/reset-memory', guard((req, res) => { manager.resetAllMemory(); ok(res); }));
  r.post('/reset', guard((req, res) => {
    if (req.body.confirm !== 'RESET') throw new Error('confirm 값이 올바르지 않습니다');
    manager.resetAll();
    ok(res);
  }));

  // ---- 예약 작업 ----
  r.get('/schedules', (req, res) => ok(res, db.listSchedules()));
  r.post('/schedules', guard((req, res) => {
    const { title, text, target, repeat, at_time, weekday, run_at } = req.body;
    if (!title || !text) throw new Error('title, text 필수');
    const s = { title, text, target: target || 'main', repeat: repeat || 'once', at_time, weekday, run_at };
    s.next_run_ts = computeNextRun(s);
    if (!s.next_run_ts) throw new Error('실행 시각이 올바르지 않습니다 (과거 시각인지 확인)');
    const id = db.insertSchedule(s);
    bus.broadcast('schedules', db.listSchedules());
    bus.event('User', 'user', `예약 작업 등록 — ${title}`);
    ok(res, { id });
  }));
  r.post('/schedules/:id/toggle', guard((req, res) => {
    const s = db.getSchedule(Number(req.params.id));
    if (!s) throw new Error('스케줄 없음');
    const enabled = !s.enabled;
    db.updateSchedule(s.id, { enabled, next_run_ts: enabled ? computeNextRun(s) : s.next_run_ts });
    bus.broadcast('schedules', db.listSchedules());
    ok(res);
  }));
  r.delete('/schedules/:id', guard((req, res) => {
    db.deleteSchedule(Number(req.params.id));
    bus.broadcast('schedules', db.listSchedules());
    ok(res);
  }));

  // Git 메뉴 표시 여부 — 기능은 유지, 사이드패널 노출만 제어
  r.post('/settings/git-menu', guard((req, res) => {
    db.setSetting('show_git_menu', !!req.body.show);
    bus.settings();
    bus.event('User', 'user', `Git 메뉴 ${req.body.show ? '표시' : '숨김'}`);
    ok(res);
  }));

  // 사이드패널 메뉴 순서 — 서버 저장 (모든 접속 환경에서 동일 순서)
  r.post('/nav-order', guard((req, res) => {
    if (!Array.isArray(req.body.order)) throw new Error('order 배열 필요');
    db.setSetting('nav_order', req.body.order.map(String));
    bus.settings();
    ok(res);
  }));
  r.delete('/agents/:id', guard((req, res) => { manager.removeAgent(Number(req.params.id)); ok(res); }));

  // ---- 승인 ----
  r.post('/approvals/:id/decide', guard((req, res) => {
    const overrides = {};
    for (const k of ['model', 'effort']) if (req.body[k]) overrides[k] = String(req.body[k]);
    manager.decideApproval(Number(req.params.id), !!req.body.approve, overrides);
    ok(res);
  }));

  // ---- 요청 로그 ----
  r.get('/requests/:id/messages', guard((req, res) => ok(res, db.listRequestMessages(Number(req.params.id)))));

  // ---- 보고서 내보내기 (실 파일 스트림) ----
  const sendReportFile = (kind) => guard(async (req, res) => {
    const rq = db.getRequest(Number(req.params.id));
    if (!rq?.report) throw new Error('보고서가 없는 요청입니다');
    const label = `REQ-${rq.id}`;
    const [buf, mime, ext] = kind === 'pptx'
      ? [await buildPptx(rq.report, label), 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx']
      : [await buildXlsx(rq.report, label), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'];
    res.setHeader('content-type', mime);
    res.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(label)}-report.${ext}"`);
    res.send(buf);
    bus.event('User', 'user', `${label} 보고서 ${ext.toUpperCase()} 내보내기`);
  });
  r.get('/requests/:id/report.pptx', sendReportFile('pptx'));
  r.get('/requests/:id/report.xlsx', sendReportFile('xlsx'));
  // 보고서 삭제 (관리 화면)
  r.delete('/requests/:id/report', guard((req, res) => {
    db.clearRequestReport(Number(req.params.id));
    bus.requests();
    bus.event('User', 'user', `REQ-${req.params.id} 보고서 삭제`);
    ok(res);
  }));

  // ---- 티켓 ----
  r.post('/tickets/:id', guard((req, res) => {
    db.updateTicket(Number(req.params.id), req.body, { ts: Date.now(), actor: 'User', text: req.body.note || '사용자 수정' });
    bus.tickets();
    bus.event('User', 'user', `TKT-${req.params.id} 갱신`);
    ok(res);
  }));

  // ---- CLAUDE.md (Layer 2) + 플랫폼 불변 지침 (Layer 1, 읽기전용) ----
  r.get('/claude-md', (req, res) => ok(res, { content: manager.readClaudeMd() }));
  r.get('/platform-prompt', (req, res) => ok(res, { content: platformPromptForDisplay(req.query.lang || db.getSetting('lang', 'ko')) }));
  r.post('/claude-md', guard((req, res) => { manager.saveClaudeMd(String(req.body.content ?? '')); ok(res); }));

  // ---- Git ----
  const gitGate = (req, res, next) => { if (manager.ctx.caps && !manager.ctx.caps.git) return res.status(503).json({ error: '서버에 git이 설치되어 있지 않습니다. git 설치 후 claude-control을 재시작하세요.' }); next(); };
  r.use('/git', gitGate);
  r.get('/git/branches', guard((req, res) => ok(res, gitApi.branches())));
  r.get('/git/graph', guard((req, res) => ok(res, gitApi.graph(req.query.branch || null))));
  r.get('/git/commit/:sha/diff', guard((req, res) => ok(res, gitApi.commitDiff(req.params.sha))));
  r.get('/git/commit/:sha/tree', guard((req, res) => ok(res, gitApi.tree(req.params.sha))));
  r.get('/git/commit/:sha/file', guard((req, res) => ok(res, gitApi.fileAt(req.params.sha, String(req.query.path || '')))));
  // ── 워킹트리 스테이징·커밋 (대시보드에서 대표가 직접) ──
  r.get('/git/status', guard((req, res) => ok(res, gitApi.status())));
  r.get('/git/workdiff', guard((req, res) => ok(res, gitApi.workDiff(String(req.query.path || ''), req.query.staged === '1'))));
  r.post('/git/stage', guard((req, res) => {
    const out = req.body?.all ? gitApi.stageAll() : gitApi.stage(req.body?.paths);
    bus.event('User', 'user', `git 스테이징 — ${req.body?.all ? '전체' : (req.body?.paths || []).length + '개 파일'}`);
    ok(res, out);
  }));
  r.post('/git/unstage', guard((req, res) => ok(res, gitApi.unstage(req.body?.paths))));
  r.get('/git/ignore', guard((req, res) => ok(res, gitApi.readIgnore())));
  r.post('/git/ignore', guard((req, res) => {
    const out = gitApi.writeIgnore(String(req.body?.content ?? ''));
    bus.event('User', 'user', '.gitignore 수정');
    ok(res, out);
  }));
  r.post('/git/suggest-commit', async (req, res) => {
    try {
      const { stat, diff } = gitApi.stagedSummary();
      if (!stat) return res.status(400).json({ error: '스테이징된 변경이 없습니다' });
      let message = '';
      try {
        if (manager.oneShotText) {
          const out = await manager.oneShotText(`아래 git staged 변경을 보고 Conventional Commits 형식의 한국어 커밋 메시지 한 줄만 출력하라 (타입: feat/fix/docs/chore/refactor, 50자 이내, 다른 설명·따옴표 금지).\n\n[stat]\n${stat}\n\n[diff 일부]\n${diff}`);
          message = String(out || '').split('\n')[0].trim().replace(/^["'\`]|["'\`]$/g, '').slice(0, 72);
        }
      } catch { /* LLM 실패 — 휴리스틱 */ }
      if (!message) message = gitApi.heuristicMessage();
      ok(res, { message });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/git/commit', guard((req, res) => {
    const out = gitApi.commitStaged(String(req.body?.message || ''));
    bus.event('User', 'user', `git 커밋 — ${out.sha} "${String(req.body?.message || '').slice(0, 40)}"`);
    ok(res, out);
  }));

  // ---- 알림 채널 ----
  r.get('/notify-channels', (req, res) => ok(res, db.getSetting('notif_channels', [])));
  r.post('/notify-channels', guard((req, res) => {
    const { type, target } = req.body;
    if (!['discord', 'kakao', 'email', 'slack'].includes(type) || !target) throw new Error('type/target 확인');
    const list = db.getSetting('notif_channels', []);
    const id = (list.at(-1)?.id || 0) + 1;
    list.push({ id, type, target, active: true });
    db.setSetting('notif_channels', list);
    bus.settings();
    bus.event('User', 'user', `알림 채널 등록 — ${type}`);
    ok(res, { id });
  }));
  r.post('/notify-channels/:id/toggle', guard((req, res) => {
    const list = db.getSetting('notif_channels', []);
    const ch = list.find(c => c.id === Number(req.params.id));
    if (!ch) throw new Error('채널 없음');
    ch.active = !ch.active;
    db.setSetting('notif_channels', list);
    bus.settings();
    ok(res);
  }));
  r.delete('/notify-channels/:id', guard((req, res) => {
    const list = db.getSetting('notif_channels', []).filter(c => c.id !== Number(req.params.id));
    db.setSetting('notif_channels', list);
    bus.settings();
    bus.event('User', 'user', '알림 채널 해제');
    ok(res);
  }));

  return r;
}
