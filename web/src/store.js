import { api, wsUrl } from './api.js';

// 전역 스토어: 스냅샷(GET /api/state) + WS 증분. 구독자는 변경 시 재렌더.
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(); }

export const store = {
  ready: false,
  service: { name: 'Claude Control', port: 0 },
  driver: 'mock',
  goal: '', goal_history: [], mode: 'plan', progress: 0,
  lang: 'ko',            // UI·에이전트 동작 언어 ('ko'|'en')
  auth: { enabled: false, has_password: false },
  models: [],            // 실제 사용 가능 모델 [{value,label,desc}] — GET /api/models
  nav_order: null,       // 사이드패널 메뉴 순서 (서버 저장 — 모든 접속 환경 공통)
  show_git_menu: true,   // Git 메뉴 노출 여부 (기능은 유지)
  terminal_enabled: false, // 웹 터미널 기능 on/off
  agents: [], tickets: [], approvals: [], requests: [], events: [],
  threads: [],           // 팀장 채팅방 목록 (방별 독립 세션)
  notif_channels: [],
  pendingCount: 0,
  claude_md: '',
  messages: {},          // channel → [msg]
  allChat: null,         // 통합 팀 채팅 (전 채널 시간순) — 로드 후 배열
  usage: { plan: '', limits: [], today: { tokens_in: 0, tokens_out: 0 } }, // 구독 사용량 (위젯)
  toast: null,
};

let ws = null;
let toastTimer = null;

export function showToast(text) {
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
    show_git_menu: s.show_git_menu !== false,
    terminal_enabled: !!s.terminal_enabled,
    pendingCount: s.pending_interactions,
    claude_md: s.claude_md,
  });
  emit();
}

export async function loadModels() {
  try { store.models = await api.get('/models'); emit(); } catch { /* 폴백: ui.jsx 기본 라벨 */ }
}

export async function loadChannel(channel) {
  store.messages[channel] = await api.get(`/chat/${encodeURIComponent(channel)}`);
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
    if (maxTs > (lastRead[key] || 0)) { lastRead[key] = maxTs; changed = true; }
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
    } else if (type === 'threads') {
      store.threads = payload;
    } else if (type === 'thread_cleared') {
      // 방 대화 초기화 — 로컬 캐시도 비움
      store.messages[payload.channel] = [];
      if (store.allChat) store.allChat = store.allChat.filter(m => m.channel !== payload.channel);
    } else if (type === 'settings') {
      Object.assign(store, { goal: payload.goal, goal_history: payload.goal_history || store.goal_history, mode: payload.mode, lang: payload.lang || store.lang, progress: payload.progress, notif_channels: payload.notif_channels, nav_order: payload.nav_order ?? store.nav_order, show_git_menu: payload.show_git_menu !== false, terminal_enabled: !!payload.terminal_enabled });
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
