import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'control.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'sub',      -- main | sub
      role TEXT DEFAULT '',
      model TEXT DEFAULT 'sonnet-4.5',
      effort TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'idle',            -- working | idle | waiting
      provider TEXT,                          -- 외부 AI: openai | google | xai
      current_task TEXT DEFAULT '',
      session_id TEXT,
      deleted INTEGER DEFAULT 0,
      created_ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,                  -- main | sub:<agentId> | req
      request_id INTEGER,
      from_actor TEXT NOT NULL,               -- User | Main | <서브명>
      to_actor TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text',      -- text | choice | diff | artifact | form | system
      content TEXT NOT NULL DEFAULT '{}',     -- JSON
      answered INTEGER DEFAULT 0,
      answer TEXT,                            -- JSON
      ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      agent_id INTEGER NOT NULL,
      type TEXT NOT NULL,                     -- choice | diff | artifact | form
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT DEFAULT 'pending',          -- pending | answered
      created_ts INTEGER,
      answered_ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'active',           -- active | review | done | approval
      created_ts INTEGER,
      updated_ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'backlog',          -- backlog | in_progress | review | done
      priority TEXT DEFAULT 'P2',
      assignee TEXT DEFAULT '',
      history TEXT DEFAULT '[]',              -- JSON [{ts, actor, text}]
      created_ts INTEGER,
      updated_ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,                   -- add | remove
      target TEXT NOT NULL DEFAULT '{}',      -- JSON {name, model, effort, role, agentId?}
      reason TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',          -- pending | approved | rejected
      created_ts INTEGER,
      decided_ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER,
      actor TEXT NOT NULL,
      actor_type TEXT NOT NULL,               -- user | main | sub
      text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT UNIQUE NOT NULL,           -- 'main' | 'main:<id>' | 'team' (팀장 방별 독립 세션)
      title TEXT DEFAULT '',
      session_id TEXT,
      created_ts INTEGER,
      last_ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      text TEXT NOT NULL,                     -- 실행 시 보낼 요청 내용
      target TEXT DEFAULT 'main',             -- main | sub:<id>
      repeat TEXT DEFAULT 'once',             -- once | daily | weekly
      at_time TEXT DEFAULT '09:00',           -- HH:MM
      weekday INTEGER,                        -- weekly: 0(일)~6(토)
      run_at INTEGER,                         -- once: 실행 시각(ms)
      enabled INTEGER DEFAULT 1,
      next_run_ts INTEGER,
      last_run_ts INTEGER,
      created_ts INTEGER
    );
  `);
  // 마이그레이션: 기존 DB에 report 컬럼 추가
  try { db.exec('ALTER TABLE requests ADD COLUMN report TEXT'); } catch { /* 이미 존재 */ }
  // 마이그레이션: 요청별 사용 토큰 집계
  try { db.exec('ALTER TABLE requests ADD COLUMN tokens_in INTEGER DEFAULT 0'); } catch { /* 이미 존재 */ }
  try { db.exec('ALTER TABLE requests ADD COLUMN tokens_out INTEGER DEFAULT 0'); } catch { /* 이미 존재 */ }
  // 마이그레이션: 팀원별 커스텀 프롬프트(관리자 지정 추가 지침)
  try { db.exec("ALTER TABLE agents ADD COLUMN prompt TEXT DEFAULT ''"); } catch { /* 이미 존재 */ }
  try { db.exec("ALTER TABLE agents ADD COLUMN work_channel TEXT DEFAULT ''"); } catch { /* 이미 존재 */ }
  try { db.exec("ALTER TABLE agents ADD COLUMN avatar TEXT DEFAULT ''"); } catch { /* 이미 존재 */ }
  try { db.exec("ALTER TABLE tickets ADD COLUMN request_id INTEGER"); } catch { /* 이미 존재 */ }
  try { db.exec("ALTER TABLE threads ADD COLUMN model TEXT"); } catch { /* 이미 존재 */ }
  try { db.exec("ALTER TABLE threads ADD COLUMN effort TEXT"); } catch { /* 이미 존재 */ }
  try { db.exec("ALTER TABLE requests ADD COLUMN channel TEXT DEFAULT 'main'"); } catch { /* 이미 존재 */ }
  // 구조 개편: req/team 특수 채널 폐지 — 이력을 기본 방(main)으로 흡수, 방은 main + 사용자 생성 방만
  try { db.exec("UPDATE messages SET channel='main' WHERE channel IN ('req','team')"); } catch { /* noop */ }
  try { db.exec("DELETE FROM threads WHERE channel='team'"); } catch { /* noop */ }
  try { db.exec("UPDATE threads SET title='메인 채팅' WHERE channel='main' AND title IN ('기본 대화','팀 채팅')"); } catch { /* noop */ }
  return wrap(db);
}

const J = (v) => JSON.stringify(v);
const P = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };

function wrap(db) {
  const now = () => Date.now();
  return {
    raw: db,
    now,
    // ---- settings ----
    getSetting(key, def = null) {
      const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
      return r ? P(r.value, def) : def;
    },
    setSetting(key, value) {
      db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, J(value));
    },
    // ---- agents ----
    listAgents(includeDeleted = false) {
      const rows = db.prepare(`SELECT * FROM agents ${includeDeleted ? '' : 'WHERE deleted=0'} ORDER BY (kind='main') DESC, id`).all();
      return rows.map(a => ({ ...a, deleted: !!a.deleted }));
    },
    getAgent(id) {
      const a = db.prepare('SELECT * FROM agents WHERE id=?').get(id);
      return a ? { ...a, deleted: !!a.deleted } : null;
    },
    getMainAgent() {
      return db.prepare("SELECT * FROM agents WHERE kind='main' AND deleted=0").get() || null;
    },
    insertAgent(a) {
      const r = db.prepare(`INSERT INTO agents(name,kind,role,model,effort,status,provider,current_task,created_ts)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(a.name, a.kind || 'sub', a.role || '', a.model || 'sonnet-4.5',
        a.effort || 'medium', a.status || 'idle', a.provider || null, a.current_task || '', now());
      return Number(r.lastInsertRowid);
    },
    updateAgent(id, patch) {
      const cols = ['name', 'role', 'model', 'effort', 'status', 'provider', 'current_task', 'session_id', 'prompt', 'work_channel', 'avatar'];
      const keys = Object.keys(patch).filter(k => cols.includes(k));
      if (!keys.length) return;
      db.prepare(`UPDATE agents SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map(k => patch[k]), id);
    },
    deleteAgent(id) { db.prepare('UPDATE agents SET deleted=1 WHERE id=?').run(id); },
    // ---- messages ----
    insertMessage(m) {
      const r = db.prepare(`INSERT INTO messages(channel,request_id,from_actor,to_actor,kind,content,answered,ts)
        VALUES(?,?,?,?,?,?,?,?)`).run(m.channel, m.request_id ?? null, m.from_actor, m.to_actor,
        m.kind || 'text', J(m.content || {}), m.answered ? 1 : 0, m.ts || now());
      return Number(r.lastInsertRowid);
    },
    getMessage(id) {
      const m = db.prepare('SELECT * FROM messages WHERE id=?').get(id);
      return m ? hydrateMsg(m) : null;
    },
    listMessages(channel, limit = 80, beforeId = null) {
      const rows = beforeId
        ? db.prepare('SELECT * FROM messages WHERE channel=? AND id<? ORDER BY id DESC LIMIT ?').all(channel, beforeId, limit)
        : db.prepare('SELECT * FROM messages WHERE channel=? ORDER BY id DESC LIMIT ?').all(channel, limit);
      return rows.map(hydrateMsg).reverse(); // 최신 창을 시간순으로
    },
    // 전 채널 통합 (팀 채팅) — 최근 limit건 시간순
    // 전 채널 메시지 (안읽음 집계 근원 데이터)
    listAllMessages(limit = 400) {
      return db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?').all(limit).map(hydrateMsg).reverse();
    },
    // 기간 내 토큰 사용 합계 (요청 단위 집계 기반)
    sumTokensSince(sinceTs) {
      const r = db.prepare('SELECT COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout FROM requests WHERE updated_ts >= ?').get(sinceTs);
      return { tokens_in: Number(r.tin), tokens_out: Number(r.tout) };
    },
    listRequestMessages(requestId) {
      return db.prepare('SELECT * FROM messages WHERE request_id=? ORDER BY id').all(requestId).map(hydrateMsg);
    },
    answerMessage(id, answer) {
      db.prepare('UPDATE messages SET answered=1, answer=? WHERE id=?').run(J(answer), id);
    },
    setMessageContent(id, content) {
      db.prepare('UPDATE messages SET content=? WHERE id=?').run(J(content), id);
    },
    // ---- interactions ----
    insertInteraction(i) {
      const r = db.prepare(`INSERT INTO interactions(message_id,agent_id,type,payload,status,created_ts)
        VALUES(?,?,?,?,'pending',?)`).run(i.message_id, i.agent_id, i.type, J(i.payload || {}), now());
      return Number(r.lastInsertRowid);
    },
    getInteraction(id) {
      const r = db.prepare('SELECT * FROM interactions WHERE id=?').get(id);
      return r ? { ...r, payload: P(r.payload, {}) } : null;
    },
    getInteractionByMessage(messageId) {
      const r = db.prepare('SELECT * FROM interactions WHERE message_id=? ORDER BY id DESC').get(messageId);
      return r ? { ...r, payload: P(r.payload, {}) } : null;
    },
    listPendingInteractions() {
      return db.prepare("SELECT * FROM interactions WHERE status='pending' ORDER BY id").all()
        .map(r => ({ ...r, payload: P(r.payload, {}) }));
    },
    answerInteraction(id) {
      db.prepare("UPDATE interactions SET status='answered', answered_ts=? WHERE id=?").run(now(), id);
    },
    // ---- requests ----
    insertRequest(title, status = 'active', channel = 'main') {
      const r = db.prepare('INSERT INTO requests(title,status,channel,created_ts,updated_ts) VALUES(?,?,?,?,?)').run(title, status, channel, now(), now());
      return Number(r.lastInsertRowid);
    },
    updateRequest(id, status) {
      db.prepare('UPDATE requests SET status=?, updated_ts=? WHERE id=?').run(status, now(), id);
    },
    // REQ 분류가 사후에 결정될 때(팀장 open_request) 트리거 메시지를 새 REQ에 귀속
    updateMessageRequest(id, requestId) {
      db.prepare('UPDATE messages SET request_id=? WHERE id=?').run(requestId, id);
    },
    getRequest(id) {
      const r = db.prepare('SELECT * FROM requests WHERE id=?').get(id);
      return r ? { ...r, report: P(r.report, null) } : null;
    },
    setRequestReport(id, report) {
      db.prepare('UPDATE requests SET report=?, updated_ts=? WHERE id=?').run(J(report), now(), id);
    },
    clearRequestReport(id) {
      db.prepare('UPDATE requests SET report=NULL, updated_ts=? WHERE id=?').run(now(), id);
    },
    addRequestUsage(id, tokensIn, tokensOut) {
      db.prepare('UPDATE requests SET tokens_in=tokens_in+?, tokens_out=tokens_out+?, updated_ts=? WHERE id=?')
        .run(Math.round(tokensIn || 0), Math.round(tokensOut || 0), now(), id);
    },
    listRequests() {
      return db.prepare(`SELECT r.*,
        (SELECT COUNT(*) FROM messages m WHERE m.request_id=r.id) AS msg_count
        FROM requests r ORDER BY r.id DESC`).all()
        .map(r => ({ ...r, report: P(r.report, null) }));
    },
    // ---- tickets ----
    insertTicket(t) {
      const r = db.prepare(`INSERT INTO tickets(title,description,status,priority,assignee,history,request_id,created_ts,updated_ts)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(t.title, t.description || '', t.status || 'backlog', t.priority || 'P2',
        t.assignee || '', J(t.history || []), t.request_id ?? null, now(), now());
      return Number(r.lastInsertRowid);
    },
    // REQ에 연결된 미완료 티켓 일괄 완료 (보고서 제출/REQ 종료 시 자동 전이)
    completeTicketsForRequest(requestId, note) {
      const rows = db.prepare("SELECT id FROM tickets WHERE request_id=? AND status!='done'").all(requestId);
      for (const r of rows) this.updateTicket(r.id, { status: 'done' }, { ts: now(), actor: 'System', text: note || 'REQ 완료 — 자동 종결' });
      return rows.length;
    },
    listTickets() {
      return db.prepare('SELECT * FROM tickets ORDER BY id').all().map(t => ({ ...t, history: P(t.history, []) }));
    },
    getTicket(id) {
      const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(id);
      return t ? { ...t, history: P(t.history, []) } : null;
    },
    updateTicket(id, patch, historyEntry) {
      const t = this.getTicket(id);
      if (!t) return;
      const history = t.history.concat(historyEntry ? [historyEntry] : []);
      db.prepare(`UPDATE tickets SET title=?, description=?, status=?, priority=?, assignee=?, history=?, updated_ts=? WHERE id=?`)
        .run(patch.title ?? t.title, patch.description ?? t.description, patch.status ?? t.status,
          patch.priority ?? t.priority, patch.assignee ?? t.assignee, J(history), now(), id);
    },
    // ---- approvals ----
    insertApproval(a) {
      const r = db.prepare(`INSERT INTO approvals(action,target,reason,status,created_ts) VALUES(?,?,?,'pending',?)`)
        .run(a.action, J(a.target || {}), a.reason || '', now());
      return Number(r.lastInsertRowid);
    },
    getApproval(id) {
      const r = db.prepare('SELECT * FROM approvals WHERE id=?').get(id);
      return r ? { ...r, target: P(r.target, {}) } : null;
    },
    listApprovals() {
      return db.prepare('SELECT * FROM approvals ORDER BY id DESC').all().map(r => ({ ...r, target: P(r.target, {}) }));
    },
    decideApproval(id, status) {
      db.prepare('UPDATE approvals SET status=?, decided_ts=? WHERE id=?').run(status, now(), id);
    },
    // ---- 전체 초기화 ----
    wipeAll() {
      for (const t of ['agents', 'messages', 'interactions', 'requests', 'tickets', 'approvals', 'events', 'settings', 'schedules', 'threads']) {
        db.prepare(`DELETE FROM ${t}`).run();
      }
      try { db.prepare('DELETE FROM sqlite_sequence').run(); } catch { /* 시퀀스 테이블 없음 */ }
    },
    // ---- threads (팀장 채팅방 — 방별 독립 세션) ----
    getThread(channel) {
      return db.prepare('SELECT * FROM threads WHERE channel=?').get(channel) || null;
    },
    ensureThread(channel, title = '') {
      const t = db.prepare('SELECT * FROM threads WHERE channel=?').get(channel);
      if (t) return t;
      db.prepare('INSERT INTO threads(channel,title,created_ts,last_ts) VALUES(?,?,?,?)').run(channel, title, now(), now());
      return db.prepare('SELECT * FROM threads WHERE channel=?').get(channel);
    },
    createThread(title) {
      const r = db.prepare('INSERT INTO threads(channel,title,created_ts,last_ts) VALUES(?,?,?,?)').run(`tmp-${now()}`, title, now(), now());
      const id = Number(r.lastInsertRowid);
      const channel = `main:${id}`;
      db.prepare('UPDATE threads SET channel=? WHERE id=?').run(channel, id);
      return db.prepare('SELECT * FROM threads WHERE id=?').get(id);
    },
    updateThread(channel, patch) {
      const t = db.prepare('SELECT * FROM threads WHERE channel=?').get(channel);
      if (!t) return;
      db.prepare('UPDATE threads SET title=?, session_id=?, model=?, effort=?, last_ts=? WHERE channel=?')
        .run(patch.title !== undefined ? patch.title : t.title,
          patch.session_id !== undefined ? patch.session_id : t.session_id,
          patch.model !== undefined ? patch.model : t.model,
          patch.effort !== undefined ? patch.effort : t.effort,
          now(), channel);
    },
    // 채팅방 목록 — 모든 방은 대표+팀장+팀원 공용 공간 (방마다 팀장 세션 독립)
    listThreads() {
      return db.prepare("SELECT * FROM threads ORDER BY (channel='main') DESC, id").all();
    },
    // 방 삭제 — 대화 이력도 함께 제거. 기본 방(main)은 삭제 불가(내용 초기화만 가능)
    deleteThread(channel) {
      if (channel === 'main') throw new Error('기본 방은 삭제할 수 없습니다 — 대화 초기화를 사용하세요');
      db.prepare('DELETE FROM threads WHERE channel=?').run(channel);
      db.prepare('DELETE FROM messages WHERE channel=?').run(channel);
    },
    // 방 대화 내용 초기화 — 이력 삭제 (세션 리셋은 manager에서)
    // 내용만 지우기 — 미답변 카드 메시지는 남긴다 (지우면 답변 불가 고아 카드가 됨)
    clearThreadMessagesKeepPending(channel) {
      db.prepare(`DELETE FROM messages WHERE channel=? AND id NOT IN (SELECT message_id FROM interactions WHERE status='pending')`).run(channel);
    },
    clearThreadMessages(channel) {
      db.prepare('DELETE FROM messages WHERE channel=?').run(channel);
    },
    // 전 채널 이력 검색 — search_history 툴 (방별 기억의 온디맨드 공유 창구)
    searchMessages(query, limit = 10) {
      const rows = db.prepare('SELECT * FROM messages WHERE content LIKE ? ORDER BY id DESC LIMIT ?')
        .all(`%${query.replace(/[%_]/g, '')}%`, limit).map(hydrateMsg);
      return rows;
    },
    // ---- schedules (예약 작업) ----
    insertSchedule(s) {
      const r = db.prepare(`INSERT INTO schedules(title,text,target,repeat,at_time,weekday,run_at,enabled,next_run_ts,created_ts)
        VALUES(?,?,?,?,?,?,?,1,?,?)`).run(s.title, s.text, s.target || 'main', s.repeat || 'once',
        s.at_time || '09:00', s.weekday ?? null, s.run_at ?? null, s.next_run_ts ?? null, now());
      return Number(r.lastInsertRowid);
    },
    listSchedules() {
      return db.prepare('SELECT * FROM schedules ORDER BY id DESC').all().map(s => ({ ...s, enabled: !!s.enabled }));
    },
    getSchedule(id) { return db.prepare('SELECT * FROM schedules WHERE id=?').get(id) || null; },
    updateSchedule(id, patch) {
      const cols = ['enabled', 'next_run_ts', 'last_run_ts'];
      const keys = Object.keys(patch).filter(k => cols.includes(k));
      if (!keys.length) return;
      db.prepare(`UPDATE schedules SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`)
        .run(...keys.map(k => typeof patch[k] === 'boolean' ? (patch[k] ? 1 : 0) : patch[k]), id);
    },
    deleteSchedule(id) { db.prepare('DELETE FROM schedules WHERE id=?').run(id); },
    dueSchedules(nowTs) {
      return db.prepare('SELECT * FROM schedules WHERE enabled=1 AND next_run_ts IS NOT NULL AND next_run_ts <= ?').all(nowTs);
    },

    // ---- events (timeline) ----
    insertEvent(actor, actorType, text, ts) {
      const r = db.prepare('INSERT INTO events(ts,actor,actor_type,text) VALUES(?,?,?,?)').run(ts || now(), actor, actorType, text);
      return Number(r.lastInsertRowid);
    },
    listEvents(limit = 200) {
      return db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit);
    },
  };
}

function hydrateMsg(m) {
  return { ...m, content: P(m.content, {}), answer: P(m.answer, null), answered: !!m.answered };
}
