import { h, render, Fragment } from 'preact';
import { useEffect, useState, useReducer } from 'preact/hooks';
import { store, subscribe, loadSnapshot, loadModels, loadUsage, loadAllChat, connectWs, showToast, unreadCount, markRead } from './store.js';
import { t, isEn } from './i18n.js';
import { api, ensureSelfRegistered, getServices, saveServices, currentBase, setCurrentBase, setAuthToken } from './api.js';
import { C, Btn, Modal, Input, dotStyle, modelLabel, card, fmtDateTime, SegPill, providerModelOptions, providerEffortOptions } from './ui.jsx';
import { I } from './icons.jsx';
import { Dashboard } from './screens/dashboard.jsx';
import { ChatScreen, RoomList } from './screens/chat.jsx';
import { SubsScreen } from './screens/subs.jsx';
import { GitScreen } from './screens/git.jsx';
import { TicketsScreen } from './screens/tickets.jsx';
import { ApprovalsScreen } from './screens/approvals.jsx';
import { ReportsScreen } from './screens/reports.jsx';
import { SettingsScreen } from './screens/settings.jsx';
import { ReviewScreen } from './screens/review.jsx';
import { TerminalScreen, TerminalPopup } from './screens/terminal.jsx';
import { FilesScreen } from './screens/files.jsx';

const NAV = [
  { key: 'dashboard', label: '대시보드', mLabel: '대시보드', icon: I.dash, title: '대시보드' },
  { key: 'chat', label: '채팅', mLabel: '채팅', icon: I.req, title: '채팅', badge: 'chat' },
  { key: 'subs', label: '조직도', mLabel: '조직도', icon: I.org, title: '조직도', badge: 'subs' },
  { key: 'git', label: 'Git', mLabel: 'Git', icon: I.git, title: 'Git' },
  { key: 'files', label: '파일', mLabel: '파일', icon: I.files, title: '파일' },
  { key: 'terminal', label: '터미널', mLabel: '터미널', icon: I.terminal, title: '터미널' },
  { key: 'tickets', label: '티켓 보드', mLabel: '티켓', icon: I.tickets, title: '티켓 보드' },
  { key: 'reports', label: '보고서', mLabel: '보고서', icon: I.report, title: '보고서 관리' },
  { key: 'approvals', label: '결재 요청', mLabel: '결재', icon: I.check, title: '결재 요청', badge: 'approvals' },
];
// Settings는 메뉴 목록이 아니라 사이드패널 하단 아이콘 (모바일 탭에는 유지)
const SETTINGS_ITEM = { key: 'settings', label: 'Settings', mLabel: '설정', icon: I.settings, title: 'Settings' };

// 서버 저장 순서(nav_order) 적용 — 미지정/신규 키는 기본 순서 뒤에 유지.
// Git 메뉴는 설정에서 숨김 가능 (기능·라우트는 유지).
function orderedNav() {
  const order = store.nav_order;
  let items = NAV;
  if (order?.length) {
    const byKey = Object.fromEntries(NAV.map(n => [n.key, n]));
    items = order.map(k => byKey[k]).filter(Boolean);
    for (const n of NAV) if (!items.includes(n)) items.push(n);
  }
  if (!store.show_git_menu || store.caps?.git === false) items = items.filter(n => n.key !== 'git');
  if (!store.terminal_enabled || store.disabled?.terminal) items = items.filter(n => n.key !== 'terminal');
  if (!store.files_enabled || store.disabled?.files) items = items.filter(n => n.key !== 'files');
  return items;
}

function route() {
  const hashPart = location.hash.replace(/^#\/?/, '');
  let [screen, param] = hashPart.split('/');
  if (screen === 'requests') { screen = 'chat'; param = null; } // 구 팀 채팅 메뉴 URL 호환
  const valid = NAV.some(n => n.key === screen) || screen === 'settings' || screen === 'review';
  return { screen: valid ? screen : 'dashboard', param: param || null };
}
export function nav(screen, param) {
  location.hash = param != null ? `#/${screen}/${param}` : `#/${screen}`;
}

// gold = 답변/승인 대기(행동 필요), green = 안읽은 메시지
function Badge({ n, tone = 'gold', style = {} }) {
  if (!n) return null;
  const c = tone === 'green' ? { background: C.cta, color: '#fff' } : { background: C.gold, color: C.dark };
  return <span style={{ ...c, fontSize: '11.5px', fontWeight: 700, borderRadius: '50px', padding: '1px 8px', ...style }}>{n}</span>;
}

// 메뉴별 배지 — 행동 필요(골드)가 안읽음(그린)보다 우선 표시
function navBadge(n, b) {
  if (n.badge === 'chat') return b.chatPending ? { n: b.chatPending, tone: 'gold' } : { n: b.chatUnread, tone: 'green' };
  if (n.badge === 'approvals') return { n: b.approvals, tone: 'gold' };
  if (n.badge === 'subs') return { n: b.subsUnread, tone: 'green' };
  return { n: 0 };
}

// 사이드패널 상단 CONNECTED SERVICE 스위처 (모바일은 헤더 필)
function ServiceSwitcher({ mobile }) {
  const [open, setOpen] = useState(false);
  const services = getServices();
  const cur = services.find(s => s.url === currentBase()) || { name: store.service.name, url: currentBase() };
  const doSwitch = (url) => {
    setOpen(false);
    if (url === currentBase()) return;
    setCurrentBase(url);
    location.reload();
  };
  const menu = open && (
    <div style={{ position: 'absolute', top: 'calc(100% + 6px)', ...(mobile ? { right: 0, width: '250px' } : { left: 0, right: 0 }), background: '#fff', borderRadius: '12px', boxShadow: C.popShadow, padding: '8px', zIndex: 60 }}>
      {services.map(sv => (
        <div key={sv.url} onClick={() => doSwitch(sv.url)} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 10px', borderRadius: '8px', cursor: 'pointer' }}>
          <span style={dotStyle(sv.url === cur.url ? C.cta : C.border, 7)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: C.t87, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sv.name}</div>
            <div style={{ fontSize: '11.5px', color: C.t58, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sv.url}</div>
          </div>
          {sv.url === cur.url && <span style={{ fontSize: '11px', fontWeight: 700, color: C.heading, flexShrink: 0 }}>연결됨</span>}
        </div>
      ))}
    </div>
  );
  if (mobile) {
    return (
      <div style={{ position: 'relative', marginLeft: 'auto' }}>
        <div onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: '6px', border: `1px solid ${C.border}`, borderRadius: '50px', padding: '5px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: C.t58, whiteSpace: 'nowrap' }}>
          <span style={dotStyle(C.cta, 6)} />
          <span>:{new URL(cur.url).port || '80'}</span>
          {I.chevron(11)}
        </div>
        {menu}
      </div>
    );
  }
  return (
    <div style={{ position: 'relative', margin: '0 0 16px 0' }}>
      <div onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: '9px', background: 'rgba(255,255,255,0.10)', borderRadius: '8px', padding: '9px 12px', cursor: 'pointer' }}>
        <span style={dotStyle(C.mint, 7)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.7)' }}>CONNECTED SERVICE</div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cur.name}</div>
        </div>
        {I.chevron(12, 'rgba(255,255,255,0.7)')}
      </div>
      {menu}
    </div>
  );
}

function Sidebar({ screen, badges }) {
  const main = store.agents.find(a => a.kind === 'main');
  const [dragKey, setDragKey] = useState(null);
  const [overKey, setOverKey] = useState(null);
  const items = orderedNav();

  const drop = async (targetKey) => {
    if (!dragKey || dragKey === targetKey) { setDragKey(null); setOverKey(null); return; }
    const keys = items.map(n => n.key);
    const from = keys.indexOf(dragKey);
    keys.splice(from, 1);
    keys.splice(keys.indexOf(targetKey) + (from <= keys.indexOf(targetKey) ? 1 : 0), 0, dragKey);
    setDragKey(null); setOverKey(null);
    store.nav_order = keys; // 낙관적 반영
    try { await api.post('/nav-order', { order: keys }); } catch (e) { showToast(e.message); }
  };

  return (
    <aside style={{ width: '236px', flexShrink: 0, background: C.dark, color: '#fff', position: 'sticky', top: 0, height: '100vh', display: 'flex', flexDirection: 'column', padding: '24px 14px', overflow: 'hidden' }}>
      <div style={{ padding: '0 14px 18px 14px', flexShrink: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.7)' }}>AI TEAM PLATFORM</div>
        <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginTop: '4px' }}>Deskmate</div>
      </div>
      <div style={{ flexShrink: 0 }}><ServiceSwitcher /></div>
      {/* 메뉴 순서는 드래그로 변경 — 서버 저장이라 모든 접속 환경에서 유지. nav만 스크롤(짤림 방지). */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minHeight: 0, overflowY: 'auto', margin: '0 -6px', padding: '0 6px' }}>
        {items.map(n => {
          const active = screen === n.key;
          const badge = navBadge(n, badges);
          return (
            <div key={n.key} onClick={() => nav(n.key)}
              draggable
              onDragStart={(e) => { setDragKey(n.key); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { e.preventDefault(); setOverKey(n.key); }}
              onDragLeave={() => setOverKey(k => (k === n.key ? null : k))}
              onDrop={(e) => { e.preventDefault(); drop(n.key); }}
              onDragEnd={() => { setDragKey(null); setOverKey(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '8px', cursor: 'pointer',
                fontSize: '14.5px', fontWeight: 600,
                color: active ? '#fff' : 'rgba(255,255,255,0.72)',
                background: active ? 'rgba(255,255,255,0.14)' : 'transparent',
                opacity: dragKey === n.key ? 0.4 : 1,
                boxShadow: overKey === n.key && dragKey && dragKey !== n.key ? `inset 0 2px 0 ${C.gold}` : 'none',
              }}>
              {n.icon(17)}
              <span style={{ flex: 1 }}>{t(n.label)}</span>
              {n.key === 'terminal' && (
                <span onClick={(e) => { e.stopPropagation(); window.open(currentBase() + '/?termpopup=1', '_blank', 'width=920,height=580,noopener'); }}
                  title={isEn() ? 'Open in new window' : '새 창으로 열기'}
                  style={{ display: 'inline-flex', padding: '3px', borderRadius: '6px', color: 'rgba(255,255,255,0.6)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.16)'; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
                </span>
              )}
              <Badge n={badge.n} tone={badge.tone} />
            </div>
          );
        })}
      </nav>
      <div style={{ flexShrink: 0, marginTop: '12px' }}>
        <div style={{ padding: '14px', borderRadius: '12px', background: 'rgba(255,255,255,0.10)' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.7)' }}>{t('팀장')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
            <span style={dotStyle(C.mint, 8, main?.status === 'working')} />
            <span style={{ fontSize: '14px', fontWeight: 600 }}>{main?.name || '팀장'}</span>
            {/* Settings — 하단 아이콘 */}
            <span onClick={(e) => { e.stopPropagation(); nav('settings'); }} title="Settings"
              style={{ marginLeft: 'auto', cursor: 'pointer', display: 'inline-flex', padding: '5px', borderRadius: '8px', color: screen === 'settings' ? '#fff' : 'rgba(255,255,255,0.6)', background: screen === 'settings' ? 'rgba(255,255,255,0.16)' : 'transparent' }}>
              {I.settings(17)}
            </span>
          </div>
          <div style={{ fontSize: '12.5px', color: 'rgba(255,255,255,0.7)', marginTop: '2px' }}>
            {main ? `${modelLabel(main.model)} · effort: ${main.effort}` : ''}
          </div>
        </div>
      </div>
    </aside>
  );
}

function MobileTabs({ screen, badges }) {
  // 항목이 넘치면 좌우 스와이프(가로 스크롤)로 확장
  const items = [...orderedNav(), SETTINGS_ITEM];
  return (
    <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50, background: '#fff', boxShadow: '0 -1px 3px rgba(0,0,0,0.10), 0 -2px 2px rgba(0,0,0,0.06)', display: 'flex', padding: '6px 4px calc(6px + env(safe-area-inset-bottom)) 4px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
      {items.map(n => {
        const active = screen === n.key;
        const badge = navBadge(n, badges);
        return (
          <div key={n.key} onClick={() => nav(n.key)} style={{ flex: `1 0 ${Math.max(58, Math.floor(100 / (items.length + 1)))}px`, minWidth: '58px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', padding: '6px 0', cursor: 'pointer', fontSize: '10.5px', fontWeight: 600, color: active ? C.heading : C.t58, position: 'relative' }}>
            {n.icon(20)}
            <span style={{ whiteSpace: 'nowrap' }}>{t(n.mLabel)}</span>
            {badge.n > 0 && <Badge n={badge.n} tone={badge.tone} style={{ position: 'absolute', top: 0, right: 'calc(50% - 20px)', fontSize: '9.5px', padding: '0 5px' }} />}
          </div>
        );
      })}
      {/* 사용량 — 플로팅 아이콘 대신 탭으로 */}
      <div onClick={() => window.dispatchEvent(new CustomEvent('cc-usage-toggle'))} style={{ flex: '1 0 58px', minWidth: '58px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', padding: '6px 0', cursor: 'pointer', fontSize: '10.5px', fontWeight: 600, color: C.t58 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" /></svg>
        <span style={{ whiteSpace: 'nowrap' }}>{t('사용량')}</span>
      </div>
    </nav>
  );
}

// 사용량 위젯 — 우측하단 플로팅. 활성화 시 화면 이동과 무관하게 지속 표시, 닫기(✕)로만 아이콘 복귀.
function fmtReset(iso) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  const en = isEn();
  if (ms <= 0) return en ? 'resets soon' : '곧 리셋';
  const totalMin = Math.round(ms / 60000);
  const d = Math.floor(totalMin / 1440), hh = Math.floor((totalMin % 1440) / 60), mm = totalMin % 60;
  return en
    ? `resets in ${d ? `${d}d ` : ''}${hh ? `${hh}h ` : ''}${mm}m`
    : `${d ? `${d}일 ` : ''}${hh ? `${hh}시간 ` : ''}${mm}분 후 리셋`;
}
const fmtTok2 = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));

function UsageWidget() {
  const [on, setOn] = useState(localStorage.getItem('cc_usage_widget') === '1');
  const [, tick] = useReducer(x => x + 1, 0);
  useEffect(() => {
    if (!on) return; // 위젯이 열려 있을 때만 폴링 — 불필요한 호출 제거
    loadUsage();
    const t = setInterval(() => { loadUsage(); tick(); }, 60_000);
    return () => clearInterval(t);
  }, [on]);
  const setOpen = (v) => { setOn(v); localStorage.setItem('cc_usage_widget', v ? '1' : '0'); if (v) loadUsage(); };
  // 모바일 하단 탭의 "사용량" 버튼 → 토글
  useEffect(() => {
    const onToggle = () => setOpen(!(localStorage.getItem('cc_usage_widget') === '1'));
    window.addEventListener('cc-usage-toggle', onToggle);
    return () => window.removeEventListener('cc-usage-toggle', onToggle);
  }, []);
  const limits = Array.isArray(store.usage.limits) ? store.usage.limits : [];
  const today = store.usage.today || {};
  const plan = store.usage.plan;
  const barColor = (p, sev) => (sev !== 'normal' || p >= 90) ? '#e0705f' : p >= 70 ? C.gold : C.mint;
  // 모바일: 하단 탭바를 덮지 않게 그 위로 띄운다
  const fixedBottom = window.innerWidth < 840 ? 'calc(72px + env(safe-area-inset-bottom))' : '18px';

  if (!on) {
    if (window.innerWidth < 840) return null; // 모바일: 플로팅 아이콘 없음 — 하단 탭에서 열기
    // 비활성: 아이콘만
    return (
      <div onClick={() => setOpen(true)} title="Claude 사용량 모니터"
        style={{ position: 'fixed', right: '18px', bottom: fixedBottom, zIndex: 119, width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.dark, color: '#fff', boxShadow: '0 3px 8px rgba(0,0,0,0.3)' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
        </svg>
      </div>
    );
  }

  // 활성: 위젯만 (아이콘 숨김) — 닫기 ✕로 복귀
  return (
    <div style={{ position: 'fixed', right: '18px', bottom: fixedBottom, zIndex: 119, width: '284px', maxWidth: 'calc(100vw - 36px)', background: C.dark, color: '#fff', borderRadius: '14px', boxShadow: '0 4px 10px rgba(0,0,0,0.28), 0 12px 32px rgba(0,0,0,0.22)', padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={dotStyle(C.mint, 7, true)} />
        <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.8)' }}>{isEn() ? 'CLAUDE USAGE' : 'CLAUDE 사용량'}</span>
        {plan && <span style={{ fontSize: '10.5px', fontWeight: 700, background: C.gold, color: C.dark, borderRadius: '50px', padding: '1px 9px' }}>{plan}</span>}
        {store.usage.stale && <span title="일시적 조회 제한 — 마지막 값 표시 중" style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>지연</span>}
        <span onClick={() => setOpen(false)} title="닫기"
          style={{ marginLeft: 'auto', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', fontSize: '14px', lineHeight: 1, padding: '2px 4px' }}>✕</span>
      </div>
      {limits.length === 0 ? (
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginTop: '10px', lineHeight: 1.5 }}>
          {store.usage.error
            ? (isEn() ? 'Usage API temporarily rate-limited — retrying automatically.' : '사용량 API가 일시적으로 제한되었습니다 — 자동으로 재시도합니다.')
            : (isEn() ? 'Loading usage…' : '사용량 정보를 불러오는 중입니다…')}
        </div>
      ) : limits.map((li) => (
        <div key={li.kind + li.label} style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: '12px', fontWeight: 600 }}>{!isEn() ? li.label : li.label === '현재 세션' ? 'Current session' : li.label.startsWith('주간 · ') ? `Weekly · ${li.label.slice(5) === '모든 모델' ? 'all models' : li.label.slice(5)}` : li.label}</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: (li.percent || 0) >= 90 ? '#f0a89e' : '#fff' }}>
              {li.percent != null ? `${li.percent}% ${isEn() ? 'used' : '사용'}` : '—'}
            </span>
          </div>
          <div style={{ height: '6px', borderRadius: '50px', background: 'rgba(255,255,255,0.18)', overflow: 'hidden', marginTop: '5px' }}>
            <div style={{ height: '100%', width: `${Math.min(100, li.percent || 0)}%`, borderRadius: '50px', background: barColor(li.percent || 0, li.severity), transition: 'width 0.4s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'rgba(255,255,255,0.55)', marginTop: '4px' }}>
            <span>{li.percent != null ? `${isEn() ? 'left' : '남은'} ${Math.max(0, 100 - li.percent)}%` : ''}</span>
            <span>{fmtReset(li.resets_at)}</span>
          </div>
        </div>
      ))}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.14)', marginTop: '12px', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'rgba(255,255,255,0.65)' }}>
        <span>{isEn() ? 'Today' : '오늘 토큰'}</span>
        <span style={{ fontWeight: 600, color: '#fff' }}>in {fmtTok2(today.tokens_in)} · out {fmtTok2(today.tokens_out)}</span>
      </div>
    </div>
  );
}

// 목표 수정 모달 (대시보드·채팅 공용)
export function GoalModal({ onClose }) {
  const [draft, setDraft] = useState(store.goal);
  const save = async () => {
    await api.post('/goal', { goal: draft });
    onClose();
  };
  const history = [...(store.goal_history || [])].reverse(); // 최신 먼저
  return (
    <Modal onClose={onClose}>
      <div style={{ fontSize: '18px', fontWeight: 600, color: C.heading }}>팀장 목표 수정</div>
      <div style={{ fontSize: '13px', color: C.t58, marginTop: '4px' }}>저장 시 팀장이 계획을 재수립합니다.</div>
      <textarea value={draft} onInput={e => setDraft(e.target.value)} rows={4}
        style={{ width: '100%', marginTop: '16px', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '14px', fontSize: '14.5px', lineHeight: 1.6, outlineColor: C.cta, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
        <Btn variant="darkOutline" onClick={onClose}>{t('취소')}</Btn>
        <Btn variant="primary" onClick={save}>저장</Btn>
      </div>

      {/* 목표 수정 이력 */}
      <div style={{ marginTop: '22px', borderTop: `1px solid ${C.line}`, paddingTop: '16px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58, marginBottom: '10px' }}>수정 이력</div>
        {history.length === 0 ? (
          <div style={{ fontSize: '13px', color: C.t58 }}>아직 수정 이력이 없습니다.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '240px', overflowY: 'auto' }}>
            {history.map((gh, i) => (
              <div key={gh.ts + '-' + i} style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flexShrink: 0, width: '4px', borderRadius: '4px', background: i === 0 ? C.cta : C.border }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                    <span style={{ fontSize: '12px', color: C.t58 }}>{fmtDateTime(gh.ts)}</span>
                    {i === 0 && <span style={{ fontSize: '10.5px', fontWeight: 700, color: C.heading, background: C.mint, borderRadius: '50px', padding: '1px 8px' }}>현재</span>}
                  </div>
                  <div style={{ fontSize: '13.5px', lineHeight: 1.5, color: C.t87 }}>{gh.goal || <span style={{ color: C.t58, fontStyle: 'italic' }}>(빈 목표)</span>}</div>
                  {gh.prev != null && gh.prev !== '' && (
                    <div style={{ fontSize: '12px', color: C.t58, marginTop: '2px', textDecoration: 'line-through', opacity: 0.7 }}>{gh.prev}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// 외부 AI 연동 모달 (서브·조직도 공용)
export function ExternalAiModal({ onClose }) {
  const noCodex = store.caps?.codex === false;
  const providers = [
    { key: 'openai', label: 'Codex · OpenAI', live: true },
  ];
  const [prov, setProv] = useState('openai');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [model, setModel] = useState(providerModelOptions('openai')[0]?.value || '');
  const [effort, setEffort] = useState('medium');
  const pickProv = (key) => {
    setProv(key);
    setModel(providerModelOptions(key)[0]?.value || '');
    const efs = providerEffortOptions(key);
    if (!efs.includes(effort)) setEffort(efs.includes('medium') ? 'medium' : efs[0]);
  };
  const connect = async () => {
    if (!name.trim()) { showToast(t('에이전트 이름을 입력하세요.')); return; }
    await api.post('/agents', { provider: prov, name: name.trim(), role: role.trim(), model, effort });
    onClose();
  };
  const lbl = { fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58 };
  return (
    <Modal onClose={onClose} maxWidth="520px">
      <div style={{ fontSize: '18px', fontWeight: 600, color: C.heading }}>{t('외부 AI 팀원 연동')}</div>
      <div style={{ fontSize: '13px', color: C.t58, marginTop: '4px' }}>{t('연동된 AI는 팀장의 지휘 아래 팀원으로 동작합니다.')}</div>
      {noCodex && (
        <div style={{ marginTop: '10px', background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderRadius: '10px', padding: '10px 14px', fontSize: '12.5px', lineHeight: 1.6, color: C.goldText, fontWeight: 600 }}>
          {t('⚠ 서버에 Codex CLI가 설치되어 있지 않습니다. 연동은 등록되지만 실제 응답은 설치 후부터 동작합니다.')}<br />
          {t('설치')}: <code style={{ background: '#fff', borderRadius: '4px', padding: '1px 6px' }}>npm i -g @openai/codex</code> 후 <code style={{ background: '#fff', borderRadius: '4px', padding: '1px 6px' }}>codex login</code>
        </div>
      )}
      <div style={{ ...lbl, margin: '18px 0 8px' }}>PROVIDER</div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {providers.map(p => (
          <div key={p.key} onClick={() => pickProv(p.key)} style={{
            borderRadius: '50px', padding: '7px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${prov === p.key ? C.cta : C.border}`,
            background: prov === p.key ? C.cta : '#fff', color: prov === p.key ? '#fff' : C.t58,
          }}>{p.label}</div>
        ))}
      </div>
      {!providers.find(p => p.key === prov)?.live && (
        <div style={{ fontSize: '12px', color: C.goldText, background: C.goldLight, borderRadius: '8px', padding: '8px 12px', marginTop: '8px' }}>
          이 provider는 아직 실행 어댑터가 없습니다 — 등록만 되고 작업은 수행하지 못합니다. (OpenAI Codex만 실연동)
        </div>
      )}
      <div style={{ ...lbl, margin: '16px 0 6px' }}>MODEL</div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {providerModelOptions(prov).map(mo => (
          <SegPill key={mo.value} active={model === mo.value} onClick={() => setModel(mo.value)}>{mo.label}</SegPill>
        ))}
      </div>
      <div style={{ ...lbl, margin: '14px 0 6px' }}>EFFORT</div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {providerEffortOptions(prov).map(ef => (
          <SegPill key={ef} active={effort === ef} onClick={() => setEffort(ef)}>{ef}</SegPill>
        ))}
      </div>
      <div style={{ ...lbl, margin: '16px 0 6px' }}>AGENT NAME</div>
      <Input value={name} onInput={e => setName(e.target.value)} placeholder={t("예: Codex-Reviewer")} />
      <div style={{ ...lbl, margin: '14px 0 6px' }}>ROLE</div>
      <Input value={role} onInput={e => setRole(e.target.value)} placeholder={t("예: 코드 리뷰 · 보조 구현")} />
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
        <Btn variant="darkOutline" onClick={onClose}>{t('취소')}</Btn>
        <Btn variant="primary" onClick={connect}>{t('연동하기')}</Btn>
      </div>
    </Modal>
  );
}

// 로그인 게이트 — 단일 계정(비밀번호만). 분실 시 서버 로컬에서 reset-password 파일로 초기화.
function LoginGate() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(currentBase() + '/api/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || '로그인 실패');
      if (d.reset) { setErr(isEn() ? 'Password was reset — login is now off.' : '초기화 파일이 감지되어 로그인 기능이 해제되었습니다.'); setTimeout(() => location.reload(), 1200); return; }
      setAuthToken(d.token);
      location.reload();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: C.dark, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ width: 'min(400px, 100%)', background: '#fff', borderRadius: '16px', padding: '32px 28px', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.14em', color: C.t58 }}>AI TEAM PLATFORM</div>
        <div style={{ fontSize: '20px', fontWeight: 700, color: C.heading, marginTop: '4px' }}>Deskmate</div>
        <div style={{ fontSize: '13px', color: C.t58, marginTop: '10px' }}>{isEn() ? 'Enter the password to continue.' : '비밀번호를 입력해 주세요.'}</div>
        <input type="password" value={pw} onInput={e => setPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          autoFocus placeholder={isEn() ? 'Password' : '비밀번호'}
          style={{ width: '100%', boxSizing: 'border-box', marginTop: '16px', border: `1px solid ${C.line}`, borderRadius: '10px', padding: '12px 14px', fontSize: '15px', fontFamily: 'inherit' }} />
        {err && <div style={{ fontSize: '12.5px', color: C.danger, marginTop: '8px' }}>{err}</div>}
        <Btn variant="primary" onClick={submit} disabled={busy} style={{ width: '100%', marginTop: '14px', justifyContent: 'center' }}>{busy ? '…' : (isEn() ? 'Sign in' : '로그인')}</Btn>
        <div style={{ fontSize: '11.5px', color: C.t58, marginTop: '16px', lineHeight: 1.6, background: '#f9f9f9', borderRadius: '8px', padding: '10px 12px' }}>
          {isEn()
            ? <>Forgot the password? On the server, create a file named <b>reset-password</b> in the data folder — the next sign-in attempt disables login so you can set a new one.</>
            : <>비밀번호를 잊으셨나요? 서버에서 데이터 폴더에 <b>reset-password</b> 파일을 만들면(예: <code>touch ~/.claude-control/default/reset-password</code>) 다음 로그인 시도 때 로그인 기능이 해제되어 새로 설정할 수 있습니다.</>}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [, force] = useReducer(x => x + 1, 0);
  const [r, setR] = useState(route());
  const [isMobile, setIsMobile] = useState(window.innerWidth < 840);
  const [goalOpen, setGoalOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    const unsub = subscribe(force);
    const onHash = () => setR(route());
    const onResize = () => setIsMobile(window.innerWidth < 840);
    const onAuth = () => setAuthRequired(true);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('resize', onResize);
    window.addEventListener('cc-auth-required', onAuth);
    (async () => {
      await ensureSelfRegistered();
      await loadSnapshot().catch(() => showToast('서비스 연결 실패 — 서버 상태를 확인하세요.'));
      connectWs();
      loadModels(); // 실제 사용 가능 모델 목록 (SDK supportedModels)
      loadAllChat().catch(() => { /* 안읽음 배지는 WS 증분으로 채워짐 */ }); // 안읽음 카운트 근원 데이터
    })();
    return () => { unsub(); window.removeEventListener('hashchange', onHash); window.removeEventListener('resize', onResize); window.removeEventListener('cc-auth-required', onAuth); };
  }, []);

  // 현재 보고 있는 화면은 읽음 처리 (idempotent — 같은 값이면 no-op이라 렌더 루프 없음)
  useEffect(() => {
    if (!store.allChat) return;
    if (r.screen === 'chat') {
      markRead(r.param || localStorage.getItem('cc_last_room') || 'main'); // 현재 방만 읽음 처리
    } else if (r.screen === 'subs' && r.param) markRead(`sub:${r.param}`);
  });

  const badges = {
    chatPending: store.pendingCount, // 답변 대기 카드 (행동 필요 — 골드)
    // 채팅 안읽음 = 모든 방(팀 채팅 포함) 합산
    chatUnread: (store.threads.length ? store.threads : [{ channel: 'main' }])
      .reduce((n, th) => n + unreadCount(th.channel), 0),
    subsUnread: store.agents.filter(a => a.kind === 'sub').reduce((n, a) => n + unreadCount(`sub:${a.id}`), 0),
    approvals: store.approvals.filter(a => a.status === 'pending').length,
  };
  const activeCount = store.agents.filter(a => a.status === 'working').length;
  const navItem = [...NAV, SETTINGS_ITEM].find(n => n.key === r.screen) || (r.screen === 'review' ? { title: '아티팩트 검토' } : null);
  const openGoal = () => setGoalOpen(true);
  const openAi = () => setAiOpen(true);

  // 채팅 통합 — 방 param에 따라 팀 채팅(team) 또는 팀장 방 뷰. 미지정 시 마지막 방 복원
  const chatRoom = r.screen === 'chat' ? (r.param || localStorage.getItem('cc_last_room') || 'main') : null;
  if (r.screen === 'chat' && r.param) localStorage.setItem('cc_last_room', r.param);

  const chatView = <ChatScreen openGoal={openGoal} param={chatRoom} />;
  const screens = {
    dashboard: <Dashboard openGoal={openGoal} />,
    // 데스크탑: 좌측 채팅방 목록 패널 + 우측 대화 / 모바일: 드롭다운(밴드 내)
    chat: isMobile ? chatView : (
      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', maxWidth: '1104px', margin: '0 auto' }}>
        <RoomList current={chatRoom} />
        <div style={{ flex: 1, minWidth: 0 }}>{chatView}</div>
      </div>
    ),
    subs: <SubsScreen param={r.param} openAi={openAi} />,
    git: <GitScreen />,
    tickets: <TicketsScreen />,
    approvals: <ApprovalsScreen />,
    reports: <ReportsScreen param={r.param} />,
    settings: <SettingsScreen />,
    review: <ReviewScreen param={r.param} />,
    files: <FilesScreen />,
    terminal: <TerminalScreen />,
  };

  if (authRequired) return <LoginGate />;
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.cream }}>
      {!isMobile && <Sidebar screen={r.screen} badges={badges} />}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!isMobile && (
          <header style={{ position: 'sticky', top: 0, zIndex: 40, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.10), 0 2px 2px rgba(0,0,0,0.06)', padding: '0 24px', height: '64px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '19px', fontWeight: 600, color: C.heading }}>{t(navItem?.title)}</div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', background: C.mint, borderRadius: '50px', padding: '5px 14px', flexShrink: 0 }}>
              <span style={dotStyle(C.cta, 7, true)} />
              <span style={{ fontSize: '13px', fontWeight: 600, color: C.heading, whiteSpace: 'nowrap' }}>{t('실행 중')} · {activeCount} agents</span>
            </div>
          </header>
        )}
        <main style={{ flex: 1, padding: isMobile
          ? '12px 12px 80px'
          // 채팅류 화면은 하단 여백 없이 페이지 끝까지 — 대화 영역 최대화
          : (r.screen === 'chat' || r.screen === 'requests' || r.screen === 'terminal' || r.screen === 'files' || r.screen === 'review' || r.screen === 'git' || (r.screen === 'subs' && r.param) ? '24px 24px 24px' : '24px 24px 120px'),
          maxWidth: (r.screen === 'terminal' || r.screen === 'files' || r.screen === 'review' || r.screen === 'git') ? 'none' : '1240px', width: '100%', margin: '0 auto' }}>
          {store.ready ? screens[r.screen] : <div style={{ padding: '60px', textAlign: 'center', color: C.t58 }}>연결 중…</div>}
        </main>
        {isMobile && <MobileTabs screen={r.screen} badges={badges} />}
      </div>
      <UsageWidget />
      {goalOpen && <GoalModal onClose={() => setGoalOpen(false)} />}
      {aiOpen && <ExternalAiModal onClose={() => setAiOpen(false)} />}
      {store.toast && (
        <div style={{ position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)', zIndex: 120, background: C.dark, color: '#fff', borderRadius: '50px', padding: '10px 22px', fontSize: '13.5px', fontWeight: 600, boxShadow: '0 0 6px rgba(0,0,0,0.24), 0 8px 12px rgba(0,0,0,0.14)', whiteSpace: 'nowrap', animation: 'toast-in 0.2s ease' }}>
          {store.toast}
        </div>
      )}
    </div>
  );
}

// 새 창 터미널 팝업(?termpopup=1)은 사이드바 없는 단일 터미널만
function Root() {
  return new URLSearchParams(location.search).get('termpopup') ? <TerminalPopup /> : <App />;
}
render(<Root />, document.getElementById('app'));
