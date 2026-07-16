// 서비스 레지스트리(localStorage) + 현재 서비스 기준 fetch/WS 베이스 URL
const LS_SERVICES = 'cc_services';
const LS_CURRENT = 'cc_current';

export function getServices() {
  try { return JSON.parse(localStorage.getItem(LS_SERVICES)) || []; } catch { return []; }
}
export function saveServices(list) { localStorage.setItem(LS_SERVICES, JSON.stringify(list)); }

export function currentBase() {
  return localStorage.getItem(LS_CURRENT) || location.origin;
}
export function setCurrentBase(url) { localStorage.setItem(LS_CURRENT, url); }

// 로그인 토큰 (로그인 기능이 켜진 서비스용) — 헤더로 전달, 쿠키는 정적 리소스용
export const authToken = () => localStorage.getItem('cc_auth_token') || '';
export const setAuthToken = (t) => { if (t) localStorage.setItem('cc_auth_token', t); else localStorage.removeItem('cc_auth_token'); };

export function wsUrl() {
  const u = new URL(currentBase());
  const tk = authToken();
  return `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/ws${tk ? `?token=${tk}` : ''}`;
}

async function req(method, path, body) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (authToken()) headers['x-auth-token'] = authToken();
  const res = await fetch(currentBase() + '/api' + path, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // 로그인 게이트 — App이 로그인 화면을 띄운다
    window.dispatchEvent(new CustomEvent('cc-auth-required'));
    throw new Error('로그인이 필요합니다');
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b || {}),
  del: (p) => req('DELETE', p),
};

// 최초 접속 시 현재 origin을 레지스트리에 자동 등록
export async function ensureSelfRegistered() {
  const list = getServices();
  if (!list.some(s => s.url === location.origin)) {
    let name = 'Claude Control';
    try { name = (await api.get('/service-info')).name; } catch { /* offline */ }
    const port = new URL(location.origin).port || (location.protocol === 'https:' ? '443' : '80');
    list.push({ url: location.origin, name: `${name} · :${port}` });
    saveServices(list);
  }
  if (!localStorage.getItem(LS_CURRENT)) setCurrentBase(location.origin);
}
