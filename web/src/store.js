import { api, wsUrl } from './api.js';

// 전역 스토어: 스냅샷(GET /api/state) + WS 증분. 구독자는 변경 시 재렌더.
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) fn(); }

export const store = {
  ready: false,
  service: { name: 'Deskmate', port: 0 },
  driver: 'mock',
  goal: '', goal_history: [], mode: 'plan', progress: 0,
  lang: 'ko',            // UI·에이전트 동작 언어 ('ko'|'en')
  auth: { enabled: false, has_password: false },
  models: [],            // 실제 사용 가능 모델 [{value,label,desc}] — GET /api/models
  nav_order: null,       // 사이드패널 메뉴 순서 (서버 저장 — 모든 접속 환경 공통)
  show_git_menu: false,  // Git 메뉴 노출 여부 (기본 off — 설정에서 켬)
  terminal_enabled: false, // 웹 터미널 기능 on/off
  files_enabled: false,    // 파일 탐색기 on/off (기본 off)
  caps: { git: true, codex: false }, // 서버 기능 감지 결과
  disabled: { terminal: false, files: false }, // 기동 옵션으로 완전 비활성된 기능
  agents: [], tickets: [], approvals: [], requests: [], events: [],
  threads: [],           // 팀장 채팅방 목록 (방별 독립 세션)
  notif_channels: [],
  pendingCount: 0,
  claude_md: '',
  messages: {},
  chatMore: {},          // channel → 이전 페이지 존재 여부
  allChat: null,         // 통합 팀 채팅 (전 채널 시간순) — 로드 후 배열
  usage: { plan: '', limits: [], today: { tokens_in: 0, tokens_out: 0 } }, // 구독 사용량 (위젯)
  toast: null,
};

let ws = null;
let toastTimer = null;

// 토스트 번역 — 고정문은 사전(t), 서버 템플릿형은 패턴 치환 (EN 모드에서만)
const TOAST_PATTERNS = [
  [/^(.+?)이\(가\) (선택|수정 승인|산출물 검토|입력|응답)을 기다립니다 — 채팅에서 카드를 확인하세요\.$/, (m) => `${m[1]} is waiting for your ${({ '선택': 'choice', '수정 승인': 'edit approval', '산출물 검토': 'artifact review', '입력': 'input', '응답': 'reply' })[m[2]]} — check the card in chat.`],
  [/^팀장이 결재를 요청했습니다 — (.+)$/, (m) => `The Team Lead filed an approval — ${m[1]}`],
  [/^(.+?) 입사 — 바로 업무 지시가 가능합니다\.$/, (m) => `${m[1]} joined — ready for assignments.`],
  [/^(.+?) 에이전트가 연동되었습니다\.$/, (m) => `${m[1]} connected.`],
  [/^(.+?)의 진행 중 작업을 중단했습니다\.$/, (m) => `Interrupted ${m[1]}'s current work.`],
  [/^(.+?) 해고됨\. 진행 중 작업은 팀장이 회수·재분배합니다\.$/, (m) => `${m[1]} dismissed. The Team Lead reclaims and reassigns their work.`],
  [/^Auto Mode 전환 — 대기 중이던 수정 승인 (\d+)건 자동 처리\.$/, (m) => `Auto Mode — ${m[1]} pending edit approvals auto-processed.`],
  [/^커밋 완료 — (.+)$/, (m) => `Committed — ${m[1]}`],
  [/^커밋 메시지 자동 생성 — (.+)$/, (m) => `Auto-generated commit message — ${m[1]}`],
];
function translateToast(text) {
  if (store.lang !== 'en' || !/[가-힣]/.test(text)) return text;
  const { t } = require_i18n();
  const viaDict = t(text);
  if (viaDict !== text) return viaDict;
  for (const [re, fn] of TOAST_PATTERNS) { const m = text.match(re); if (m) return fn(m); }
  return text;
}
let _i18n = null;
function require_i18n() { return _i18n; }
export function __setI18n(mod) { _i18n = mod; } // i18n.js가 로드 시 자기 자신을 주입 (순환 import 회피)

export function showToast(text) {
  text = _i18n ? translateToast(text) : text;
  store.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { store.toast = null; emit(); }, 2600);
  emit();
}

export async function loadSnapshot() {
  const s = await api.get('/state');
  Object.assign(store, {
    ready: true,
    service: s.service, driver: s.driver,
    goal: s.goal, goal_history: s.goal_history || [], mode: s.mode, progress: s.progress, lang: s.lang || 'ko',
    agents: s.agents, tickets: s.tickets, approvals: s.approvals,
    requests: s.requests, threads: s.threads || [], events: s.events, auth: s.auth || { enabled: false, has_password: false },
    notif_channels: s.notif_channels,
    nav_order: s.nav_order || null,
    show_git_menu: s.show_git_menu === true,
    terminal_enabled: !!s.terminal_enabled,
    files_enabled: s.files_enabled === true,
    caps: s.caps || { git: true, codex: false },
    disabled: s.disabled || { terminal: false, files: false },
    data_dir: s.data_dir || '~/.claude-control/<name>',
    pendingCount: s.pending_interactions,
    claude_md: s.claude_md,
  });
  mergeLastRead(s.last_read || {});
  emit();
}

export async function loadModels() {
  try { store.models = await api.get('/models'); emit(); } catch { /* 폴백: ui.jsx 기본 라벨 */ }
}

const CHAT_PAGE = 80;
export async function loadChannel(channel) {
  const rows = await api.get(`/chat/${encodeURIComponent(channel)}?limit=${CHAT_PAGE}`);
  store.messages[channel] = rows;
  store.chatMore[channel] = rows.length >= CHAT_PAGE;
  emit();
}
// 이전 대화 페이지 — 현재 첫 메시지 이전 CHAT_PAGE건을 앞에 붙인다
export async function loadOlder(channel) {
  const cur = store.messages[channel] || [];
  const before = cur[0]?.id;
  if (!before) return;
  const rows = await api.get(`/chat/${encodeURIComponent(channel)}?limit=${CHAT_PAGE}&before=${before}`);
  store.messages[channel] = [...rows, ...cur];
  store.chatMore[channel] = rows.length >= CHAT_PAGE;
  emit();
}

export async function loadAllChat() {
  store.allChat = await api.get('/chat-all');
  emit();
}

// ---- 안읽은 메시지 추적 ----
// 스코프 키 = 채널: 채팅방('main'/'main:N'/'team') 또는 팀원 1:1('sub:<id>').
// 마지막 열람 시각은 localStorage — 데이터 근원은 allChat(부트 시 로드 + WS 증분).
const lastRead = JSON.parse(localStorage.getItem('cc_last_read') || '{}');
// 서버 동기화 — 부트/재연결 시 서버 값과 병합(max), 다른 기기의 읽음이 실시간 반영된다
export function mergeLastRead(map) {
  let changed = false;
  for (const [k, ts] of Object.entries(map || {})) {
    if (ts > (lastRead[k] || 0)) { lastRead[k] = ts; changed = true; }
  }
  if (changed) { localStorage.setItem('cc_last_read', JSON.stringify(lastRead)); emit(); }
}
const isRoom = (ch) => ch === 'main' || (ch || '').startsWith('main:');
const inScope = (key, m) => m.channel === key;
// 방은 위임 대화 포함 전부, 팀원 1:1은 대표 수신 메시지만 센다
const countable = (key, m) => m.from_actor !== 'User' && (isRoom(key) || m.to_actor === 'User');
export function unreadCount(key) {
  const since = lastRead[key] || 0;
  return (store.allChat || []).filter(m => inScope(key, m) && countable(key, m) && m.ts > since).length;
}
export function markRead(...keys) {
  let changed = false;
  for (const key of keys) {
    const maxTs = (store.allChat || []).reduce((a, m) => (inScope(key, m) && m.ts > a ? m.ts : a), 0);
    if (maxTs > (lastRead[key] || 0)) {
      lastRead[key] = maxTs; changed = true;
      api.post('/read', { channel: key, ts: maxTs }).catch(() => { /* 오프라인이면 다음 markRead에서 재시도 */ });
    }
  }
  if (changed) { localStorage.setItem('cc_last_read', JSON.stringify(lastRead)); emit(); }
}

export async function loadUsage() {
  try { store.usage = await api.get('/usage'); emit(); } catch { /* 서버 미지원/오프라인 */ }
}

export function connectWs() {
  if (ws) { try { ws.close(); } catch { /* noop */ } }
  ws = new WebSocket(wsUrl());
  // 재연결 시 스냅샷 재동기화 — 끊겨 있던 동안의 상태 변경(에이전트 status 등) 유실 방지
  ws.onopen = () => {
    if (!store.ready) return;
    loadSnapshot().catch(() => { /* 다음 이벤트로 복구 */ });
    if (store.allChat) loadAllChat().catch(() => { /* 재연결 후 증분으로 복구 */ }); // 끊긴 동안 메시지 유실 방지
  };
  ws.onmessage = (ev) => {
    const { type, payload } = JSON.parse(ev.data);
    if (type === 'message') {
      const ch = store.messages[payload.channel];
      if (ch) {
        // 신규 push 또는 답변으로 갱신된 메시지 교체
        const idx = ch.findIndex(m => m.id === payload.id);
        if (idx !== -1) ch[idx] = payload; else ch.push(payload);
      }
      // 전 채널 피드(안읽음 집계 근원)에 반영
      if (store.allChat) {
        const idx = store.allChat.findIndex(m => m.id === payload.id);
        if (idx !== -1) store.allChat[idx] = payload; else store.allChat.push(payload);
      }
    } else if (type === 'interaction') {
      store.pendingCount += payload.status === 'pending' ? 1 : -1;
      if (store.pendingCount < 0) store.pendingCount = 0;
    } else if (type === 'event') {
      store.events.unshift(payload);
    } else if (type === 'agents') {
      store.agents = payload;
    } else if (type === 'tickets') {
      store.tickets = payload;
    } else if (type === 'approvals') {
      store.approvals = payload;
    } else if (type === 'requests') {
      store.requests = payload;
    } else if (type === 'read') {
      mergeLastRead(payload);
    } else if (type === 'threads') {
      store.threads = payload;
    } else if (type === 'thread_cleared') {
      if (payload.keepPending) {
        // 내용만 지우기 — 미답변 카드는 남으므로 서버에서 다시 로드
        api.get(`/chat/${encodeURIComponent(payload.channel)}`).then(ms => { store.messages[payload.channel] = ms; emit(); }).catch(() => {});
        if (store.allChat) store.allChat = store.allChat.filter(m => m.channel !== payload.channel || !m.answered && ['choice', 'form', 'artifact', 'diff'].includes(m.kind));
      } else {
        // 방 대화 초기화 — 로컬 캐시도 비움
        store.messages[payload.channel] = [];
        if (store.allChat) store.allChat = store.allChat.filter(m => m.channel !== payload.channel);
      }
    } else if (type === 'settings') {
      Object.assign(store, { goal: payload.goal, goal_history: payload.goal_history || store.goal_history, mode: payload.mode, lang: payload.lang || store.lang, progress: payload.progress, notif_channels: payload.notif_channels, nav_order: payload.nav_order ?? store.nav_order, show_git_menu: payload.show_git_menu === true, terminal_enabled: !!payload.terminal_enabled, files_enabled: payload.files_enabled === true, ...(payload.auth ? { auth: payload.auth } : {}) });
    } else if (type === 'claude_md') {
      store.claude_md = payload.content;
    } else if (type === 'rate_limit') {
      loadUsage(); // 세션의 사용량 변동 신호 → 공식 usage API 재조회
    } else if (type === 'toast') {
      showToast(payload.text);
      return;
    }
    emit();
  };
  ws.onclose = () => setTimeout(() => connectWs(), 2000);
}

// 서비스 전환: 이전 서비스 대화 캐시 제거 + 스냅샷 재로딩 + WS 재연결
export async function switchService() {
  store.ready = false;
  Object.assign(store, { messages: {}, allChat: null });
  emit();
  await loadSnapshot();
  connectWs();
}
