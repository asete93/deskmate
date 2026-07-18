import { h, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import xtermCss from '@xterm/xterm/css/xterm.css';
import { C } from '../ui.jsx';
import { currentBase, authToken, api } from '../api.js';
import { showToast } from '../store.js';
import { isEn, t } from '../i18n.js';

const GAP = 5; // 터미널 사이 간격(px)

function injectCss() {
  if (!document.getElementById('xterm-css')) {
    const st = document.createElement('style'); st.id = 'xterm-css'; st.textContent = xtermCss; document.head.appendChild(st);
  }
}

// 클립보드 — HTTP(비 secure context)에선 navigator.clipboard가 없어 execCommand로 폴백
function copyText(txt) {
  if (!txt) return;
  if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(txt).catch(() => fallbackCopy(txt)); return; }
  fallbackCopy(txt);
}
function fallbackCopy(txt) {
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:absolute;left:-9999px;top:0';
  document.body.appendChild(ta);
  ta.select(); ta.setSelectionRange(0, txt.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  document.body.removeChild(ta);
  if (!ok) showToast(isEn() ? 'Copy blocked by the browser (use HTTPS).' : '브라우저가 복사를 막았습니다 (HTTPS에서 가능).');
}
// true 반환 = 붙여넣기 처리함. false = 클립보드 읽기 불가(브라우저 정책)
function pasteInto(send) {
  if (navigator.clipboard?.readText) { navigator.clipboard.readText().then(t => { if (t) send(t); }).catch(() => {}); return true; }
  return false;
}

// ── 단일 터미널 뷰 — 최초 1회만 연결, sid는 ref로 유지해 재연결/언마운트 없음(세션 영속). ──
function TermPane({ sid, ephemeral = false, onSid, fontSize = 13, onFont }) {
  const host = useRef(null);
  const tmuxRef = useRef(true); // 백엔드 종류 (ready 메시지로 갱신)
  const sidRef = useRef(sid);
  const wsRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const [status, setStatus] = useState('connecting');
  // 폰트 크기 변경 시 반영 + 리핏
  useEffect(() => {
    if (termRef.current) { termRef.current.options.fontSize = fontSize; try { fitRef.current?.fit(); } catch { /* noop */ } }
  }, [fontSize]);

  const connect = (term) => {
    const u = new URL(currentBase());
    const proto = u.protocol === 'https:' ? 'wss' : 'ws';
    const params = new URLSearchParams({ cols: String(term.cols), rows: String(term.rows) });
    if (sidRef.current) params.set('id', sidRef.current);
    if (ephemeral) params.set('ephemeral', '1');
    if (authToken()) params.set('token', authToken());
    const sock = new WebSocket(`${proto}://${u.host}/term?${params}`);
    sock.binaryType = 'arraybuffer';
    wsRef.current = sock;
    setStatus('connecting');
    sock.onopen = () => setStatus('open');
    sock.onclose = () => setStatus('closed');
    sock.onerror = () => setStatus('closed');
    sock.onmessage = (e) => {
      if (typeof e.data === 'string' && e.data[0] === '\x00') {
        try {
          const c = JSON.parse(e.data.slice(1));
          // 서버가 준 id가 우리가 요청한 sid와 다르면(세션이 죽어 새로 생성됨) layout을 새 id로 갱신.
          // 이걸 안 하면 죽은 sid를 계속 요청해 매 새로고침마다 새 세션이 생긴다.
          if (c.type === 'ready') { tmuxRef.current = !!c.tmux; if (sidRef.current !== c.id) { sidRef.current = c.id; onSid?.(c.id); } }
        } catch { /* noop */ }
        return;
      }
      term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
    };
  };

  useEffect(() => {
    injectCss();
    const term = new Terminal({
      cursorBlink: true, fontSize, scrollback: 5000,
      fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      theme: { background: '#14211c', foreground: '#e6efe9', cursor: '#d4e9e2', selectionBackground: 'rgba(0,117,74,0.4)' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();
    termRef.current = term; fitRef.current = fit;
    // Ctrl/Cmd+휠 = 폰트 크기. 일반 휠 = 과거 출력 스크롤(tmux copy-mode 변환 —
    // tmux가 화면을 자체 관리해 xterm 스크롤백이 안 쌓이므로 PageUp/Down 키로 번역한다)
    const copyModeRef = { current: false };
    // 휠 변환은 tmux 백엔드에서만 — node-pty/script는 xterm 스크롤백이 자체 동작
    
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        onFont?.(d => Math.min(28, Math.max(9, d + (e.deltaY < 0 ? 1 : -1))));
        return;
      }
      if (!tmuxRef.current) return; // 비-tmux: 브라우저(xterm) 기본 스크롤에 맡긴다
      e.preventDefault();
      const send = (t) => { if (wsRef.current?.readyState === 1) wsRef.current.send(t); };
      if (e.deltaY < 0) {
        if (!copyModeRef.current) { send('\x02['); copyModeRef.current = true; } // C-b [ = copy-mode
        send('\x1b[5~'); // PageUp
      } else if (copyModeRef.current) {
        send('\x1b[6~'); // PageDown — 바닥까지 내려가면 tmux가 copy-mode 종료
      }
    };
    host.current.addEventListener('wheel', onWheel, { passive: false });
    term.onData(d => { copyModeRef.current = false; if (wsRef.current?.readyState === 1) wsRef.current.send(d); });

    const sendTxt = (t) => { if (wsRef.current?.readyState === 1) wsRef.current.send(t); };
    // 복사·붙여넣기: 키(Ctrl/Cmd+Shift+C/V) + 우클릭(선택 있으면 복사+해제, 없으면 붙여넣기)
    term.attachCustomKeyEventHandler((e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.type === 'keydown' && mod && (e.shiftKey || e.metaKey)) {
        const k = e.key.toLowerCase();
        if (k === 'c') { const sel = term.getSelection(); if (sel) { copyText(sel); return false; } }
        if (k === 'v') { pasteInto(sendTxt); return false; }
      }
      return true;
    });
    const onCtx = (e) => {
      e.preventDefault(); // 브라우저 기본 우클릭 메뉴는 항상 막는다
      const sel = term.getSelection();
      if (sel) { copyText(sel); term.clearSelection(); return; }
      // 빈 선택 우클릭 = 붙여넣기. HTTP(비 secure)에선 클립보드 읽기가 막혀 Ctrl+V로 안내.
      if (!pasteInto(sendTxt)) showToast(isEn() ? 'Paste needs HTTPS — use Ctrl+V instead.' : '붙여넣기는 HTTPS에서만 됩니다 — Ctrl+V를 사용하세요.');
    };
    host.current.addEventListener('contextmenu', onCtx);
    connect(term);

    const doFit = () => {
      try { fit.fit(); if (wsRef.current?.readyState === 1) wsRef.current.send('\x00' + JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })); } catch { /* noop */ }
    };
    const ro = new ResizeObserver(doFit);
    ro.observe(host.current);
    window.addEventListener('resize', doFit);
    // 재연결용
    host.current.__reconnect = () => { try { wsRef.current?.close(); } catch { /* noop */ } connect(term); };
    return () => { ro.disconnect(); window.removeEventListener('resize', doFit); host.current?.removeEventListener('contextmenu', onCtx); host.current?.removeEventListener('wheel', onWheel); try { wsRef.current?.close(); } catch { /* noop */ } term.dispose(); };
  }, []); // 최초 1회 — 언마운트 전까지 세션 유지

  const dot = status === 'open' ? C.cta : status === 'connecting' ? C.gold : C.danger;
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#14211c', borderRadius: '8px', overflow: 'hidden' }}>
      {/* 콘텐츠는 좌상단 상태 인디케이터 아래 행부터 시작 (첫 줄 안 가리게) */}
      {/* 패딩은 바깥 래퍼가 담당, host는 무패딩 — FitAddon이 패딩 계산 없이 정확한 행 수를 잡아
          마지막 줄이 잘리지 않는다 (폰트 크기가 바뀌어도 ResizeObserver→fit이 재계산) */}
      <div style={{ position: 'absolute', inset: '22px 8px' }}>
        <div ref={host} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
      </div>
      {status === 'closed' && (
        <div onClick={() => host.current?.__reconnect?.()} style={{ position: 'absolute', top: '8px', right: '10px', cursor: 'pointer', background: C.danger, color: '#fff', borderRadius: '50px', padding: '3px 12px', fontSize: '11.5px', fontWeight: 700 }}>
          {isEn() ? 'Reconnect' : '재연결'}
        </div>
      )}
      <span style={{ position: 'absolute', top: '9px', left: '9px', width: '7px', height: '7px', borderRadius: '50%', background: dot, opacity: 0.85, pointerEvents: 'none' }} />
    </div>
  );
}

// ── 레이아웃 트리 ──
let nodeSeq = 1;
const leaf = () => ({ id: `n${nodeSeq++}`, sid: null });
const findLeaf = (t, id) => (t.split ? (findLeaf(t.a, id) || findLeaf(t.b, id)) : (t.id === id ? t : null));
function replaceLeaf(t, id, repl) {
  if (t.split) return { ...t, a: replaceLeaf(t.a, id, repl), b: replaceLeaf(t.b, id, repl) };
  return t.id === id ? repl : t;
}
function removeLeaf(t, id) {
  if (!t.split) return t.id === id ? null : t;
  const a = removeLeaf(t.a, id); const b = removeLeaf(t.b, id);
  if (a === null) return b; if (b === null) return a;
  return { ...t, a, b };
}
const leafIds = (t) => (t.split ? [...leafIds(t.a), ...leafIds(t.b)] : [t.id]);

// 트리 → 각 리프의 px 사각형 + 디바이더 목록 (gap 반영)
function computeRects(node, x, y, w, h, out, divs) {
  if (!node.split) { out.push({ id: node.id, sid: node.sid, x, y, w, h }); return; }
  const row = node.split === 'row';
  if (row) {
    const aw = (w - GAP) * node.ratio;
    computeRects(node.a, x, y, aw, h, out, divs);
    divs.push({ node, dir: 'row', x: x + aw, y, w: GAP, h, parentX: x, parentY: y, parentW: w, parentH: h });
    computeRects(node.b, x + aw + GAP, y, w - GAP - aw, h, out, divs);
  } else {
    const ah = (h - GAP) * node.ratio;
    computeRects(node.a, x, y, w, ah, out, divs);
    divs.push({ node, dir: 'col', x, y: y + ah, w, h: GAP, parentX: x, parentY: y, parentW: w, parentH: h });
    computeRects(node.b, x, y + ah + GAP, w, h - GAP - ah, out, divs);
  }
}

export function TerminalScreen() {
  const mobile = window.innerWidth < 840;
  const [tree, setTree] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem('cc_term_layout') || 'null'); if (saved?.tree) { nodeSeq = saved._seq || 50; return saved.tree; } } catch { /* noop */ }
    return leaf();
  });
  const [mobileActive, setMobileActive] = useState(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fonts, setFonts] = useState(() => { try { return JSON.parse(localStorage.getItem('cc_term_fonts') || '{}'); } catch { return {}; } });
  const [dragId, setDragId] = useState(null); // 헤더 DnD로 이동 중인 리프
  const [overId, setOverId] = useState(null);
  const [, bump] = useState(0);
  const boxRef = useRef(null);

  const save = (t) => { try { localStorage.setItem('cc_term_layout', JSON.stringify({ tree: t, _seq: nodeSeq })); } catch { /* noop */ } };
  const setLeafSid = (id, sid) => setTree(prev => { const l = findLeaf(prev, id); if (!l) return prev; const n = replaceLeaf(prev, id, { ...l, sid }); save(n); return n; });
  const split = (id, dir) => setTree(prev => { const l = findLeaf(prev, id); const n = replaceLeaf(prev, id, { split: dir, ratio: 0.5, a: l, b: leaf() }); save(n); return n; });
  // X = 이 화면의 창(연결)만 닫는다 — 서버 tmux 세션은 살아있어 다시 붙을 수 있다.
  // 마지막 창이면 빈 리프로 교체 → 새 세션이 열린다.
  const closePane = (id) => setTree(prev => {
    const n = removeLeaf(prev, id) || leaf();
    save(n); return n;
  });
  const setFont = (id, fn) => setFonts(prev => { const cur = prev[id] || 13; const next = { ...prev, [id]: fn(cur) }; try { localStorage.setItem('cc_term_fonts', JSON.stringify(next)); } catch { /* noop */ } return next; });
  // 헤더 DnD — 두 리프 노드를 위치 교환(id·sid 통째 이동 → key 따라 TermPane 이동, 세션 유지)
  const swapPanes = (aId, bId) => setTree(prev => {
    const la = findLeaf(prev, aId); const lb = findLeaf(prev, bId);
    if (!la || !lb || aId === bId) return prev;
    let n = replaceLeaf(prev, aId, { ...la, id: '__SWAP_TMP__' });
    n = replaceLeaf(n, bId, la);
    n = replaceLeaf(n, '__SWAP_TMP__', lb);
    save(n); return n;
  });

  useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const ids = leafIds(tree);
  const activeId = mobile ? (ids.includes(mobileActive) ? mobileActive : ids[0]) : null;

  const rects = []; const divs = [];
  if (!mobile && size.w > 0) computeRects(tree, 0, 0, size.w, size.h, rects, divs);

  const startDrag = (d) => (e) => {
    e.preventDefault();
    const box = boxRef.current.getBoundingClientRect();
    const move = (ev) => {
      const r = d.dir === 'row' ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
      // 부모 split의 시작 위치 보정은 근사 — 전체 비율로 충분히 자연스러움
      d.node.ratio = Math.min(0.85, Math.max(0.15, d.dir === 'row' ? (ev.clientX - box.left - d.parentX) / d.parentW : (ev.clientY - box.top - d.parentY) / d.parentH));
      bump(x => x + 1);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); save(tree); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const iconBtn = (onClick, title, path) => (
    <span onClick={onClick} title={title} style={{ cursor: 'pointer', display: 'inline-flex', padding: '6px', borderRadius: '8px', color: C.t58 }}
      onMouseEnter={e => e.currentTarget.style.background = '#f0eee9'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" dangerouslySetInnerHTML={{ __html: path }} />
    </span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? '8px' : '0', height: mobile ? 'calc(100dvh - 104px)' : 'calc(100vh - 112px)' }}>
      {/* 데스크탑은 상단 바 없이 터미널만 (분할/폰트/이동/닫기는 각 창 헤더에). 모바일만 세션 선택 바. */}
      {mobile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <select value={activeId} onChange={e => setMobileActive(e.target.value)}
            style={{ fontSize: '13px', padding: '6px 10px', borderRadius: '8px', border: `1px solid ${C.line}`, fontFamily: 'inherit', flex: 1 }}>
            {ids.map((id, i) => <option key={id} value={id}>{isEn() ? `Terminal ${i + 1}` : `터미널 ${i + 1}`}</option>)}
          </select>
          {iconBtn(() => split(activeId, 'row'), isEn() ? 'New terminal' : '새 터미널', '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>')}
          {iconBtn(() => closePane(activeId), isEn() ? 'Close pane' : '창 닫기', '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>')}
        </div>
      )}

      <div ref={boxRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {/* 컨테이너 크기 확정 전(size 0)엔 xterm을 만들지 않는다 — 0행으로 시작하면 첫 프롬프트가 유실됨 */}
        {/* 모든 리프를 절대위치로 항상 마운트 — 분할해도 언마운트되지 않아 세션이 유지된다 */}
        {(mobile || size.w > 0) && ids.map((id, i) => {
          const l = findLeaf(tree, id);
          const rect = rects.find(r => r.id === id);
          const style = mobile
            ? { position: 'absolute', inset: 0, display: id === activeId ? 'block' : 'none' }
            : { position: 'absolute', left: `${rect?.x || 0}px`, top: `${rect?.y || 0}px`, width: `${rect?.w || 0}px`, height: `${rect?.h || 0}px` };
          return (
            <div key={id} style={style}
              onDragOver={dragId && dragId !== id ? (e => { e.preventDefault(); setOverId(id); }) : undefined}
              onDragLeave={() => setOverId(o => (o === id ? null : o))}
              onDrop={dragId ? (e => { e.preventDefault(); swapPanes(dragId, id); setDragId(null); setOverId(null); }) : undefined}>
              {/* 창 헤더 — 이동 핸들(드래그) + 폰트 +/− + 분할/닫기 (데스크탑) */}
              {!mobile && (
                <div style={{ position: 'absolute', top: '4px', right: '6px', zIndex: 5, display: 'flex', alignItems: 'center', gap: '1px', background: 'rgba(13,21,18,0.72)', borderRadius: '8px', padding: '1px 2px' }}>
                  <span draggable title={t('드래그해서 위치 이동')} onDragStart={() => setDragId(id)} onDragEnd={() => { setDragId(null); setOverId(null); }}
                    style={{ cursor: 'grab', display: 'inline-flex', padding: '4px', color: 'rgba(255,255,255,0.5)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>
                  </span>
                  <PaneBtn title={t('글자 작게')} path='<line x1="5" y1="12" x2="19" y2="12"/>' onClick={() => setFont(id, d => Math.max(9, d - 1))} />
                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.55)', minWidth: '16px', textAlign: 'center' }}>{fonts[id] || 13}</span>
                  <PaneBtn title={t('글자 크게')} path='<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>' onClick={() => setFont(id, d => Math.min(28, d + 1))} />
                  <PaneBtn title={t('세로 분할')} path='<rect x="3" y="3" width="18" height="18" rx="1"/><line x1="12" y1="3" x2="12" y2="21"/>' onClick={() => split(id, 'row')} />
                  <PaneBtn title={t('가로 분할')} path='<rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="12" x2="21" y2="12"/>' onClick={() => split(id, 'col')} />
                  <PaneBtn title={ids.length > 1 ? t('창 닫기 (서버 세션은 유지)') : t('이 창 연결 해제 — 새 세션으로 시작')} path='<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' onClick={() => closePane(id)} />
                </div>
              )}
              {overId === id && <div style={{ position: 'absolute', inset: 0, zIndex: 6, border: `2px solid ${C.cta}`, borderRadius: '8px', background: 'rgba(0,117,74,0.12)', pointerEvents: 'none' }} />}
              <TermPane sid={l?.sid} onSid={s => setLeafSid(id, s)} fontSize={fonts[id] || 13} onFont={fn => setFont(id, fn)} />
            </div>
          );
        })}
        {/* 디바이더 */}
        {!mobile && divs.map((d, i) => (
          <div key={i} onPointerDown={startDrag(d)}
            style={{ position: 'absolute', left: `${d.x}px`, top: `${d.y}px`, width: `${d.w}px`, height: `${d.h}px`, cursor: d.dir === 'row' ? 'col-resize' : 'row-resize', zIndex: 4 }} />
        ))}
      </div>
    </div>
  );
}

const PaneBtn = ({ title, path, onClick }) => (
  <span onClick={onClick} title={title} style={{ cursor: 'pointer', display: 'inline-flex', padding: '4px', borderRadius: '6px', color: 'rgba(255,255,255,0.55)' }}
    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = '#fff'; }}
    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.55)'; }}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" dangerouslySetInnerHTML={{ __html: path }} />
  </span>
);

export function TerminalPopup() {
  return <div style={{ position: 'fixed', inset: 0, background: '#14211c' }}><TermPane ephemeral /></div>;
}
