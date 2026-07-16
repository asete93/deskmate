import { h, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { showToast } from '../store.js';
import { api, currentBase } from '../api.js';
import { C, card, Btn, Chip } from '../ui.jsx';
import { nav } from '../main.jsx';
import { t, isEn } from '../i18n.js';

// ═══ 주석 리뷰 루프 — 산출물 위에 핀 코멘트를 꽂고, 텍스트는 그 자리에서 직접 고친다.
// 제출하면 요소 셀렉터·좌표·수정 전/후가 구조화 지시서로 팀장에게 전달되고,
// 팀원이 반영한 뒤 같은 경로로 재검토를 요청하는 버전 반복 루프.

// 클릭한 요소의 CSS 셀렉터 경로 (사람이 읽을 라벨은 별도)
function cssPath(el) {
  const parts = [];
  while (el && el.nodeType === 1 && el.tagName !== 'HTML' && el.tagName !== 'BODY') {
    if (el.id) { parts.unshift(`#${el.id}`); return parts.join(' > '); }
    let sel = el.tagName.toLowerCase();
    const parent = el.parentNode;
    if (parent) {
      const sib = [...parent.children].filter(c => c.tagName === el.tagName);
      if (sib.length > 1) sel += `:nth-of-type(${sib.indexOf(el) + 1})`;
    }
    parts.unshift(sel);
    el = el.parentNode;
  }
  return parts.join(' > ');
}
const labelOf = (el) => (el.textContent || el.getAttribute?.('alt') || el.tagName || '').trim().replace(/\s+/g, ' ').slice(0, 40);

export function ReviewScreen({ param }) {
  const [m, setM] = useState(null);
  const [mode, setMode] = useState('pin'); // pin | edit
  const [pins, setPins] = useState([]);    // {selector,label,xr,yr,comment}
  const [edits, setEdits] = useState([]);  // {selector,label,before,after}
  const [draft, setDraft] = useState(null); // 코멘트 입력 중인 핀 index
  const [focused, setFocused] = useState(null); // 하이라이트 중인 핀 index
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const iframeRef = useRef(null);
  const frameWrapRef = useRef(null);
  const stateRef = useRef({});
  stateRef.current = { mode, pins, focused };

  // 문서가 컨테이너보다 넓으면 축소해 화면 폭에 맞춘다 (핀 좌표는 문서 좌표라 함께 스케일됨)
  const applyFit = () => {
    const wrap = frameWrapRef.current, ifr = iframeRef.current, doc = ifr?.contentDocument;
    if (!wrap || !ifr || !doc?.documentElement) return;
    ifr.style.width = '100%'; ifr.style.height = '100%'; ifr.style.transform = '';
    const cw = wrap.clientWidth;
    const docW = Math.max(doc.documentElement.scrollWidth, doc.body?.scrollWidth || 0);
    if (docW > cw + 4) {
      const sc = cw / docW;
      ifr.style.width = `${docW}px`;
      ifr.style.height = `${wrap.clientHeight / sc}px`;
      ifr.style.transform = `scale(${sc})`;
      ifr.style.transformOrigin = '0 0';
    }
  };
  useEffect(() => {
    const onResize = () => applyFit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    api.get(`/messages/${param}`).then(setM).catch(e => showToast(e.message));
  }, [param]);

  const art = m?.content?.artifact || {};
  const interactive = typeof art.url === 'string' && (art.url.startsWith('/workspace/') || art.url.startsWith('/uploads/'));
  const src = interactive ? currentBase() + art.url : art.url;
  const done = !!m?.answered;

  // 핀 마커를 문서 안에 주입 (스크롤 자동 동기). focusIdx 핀은 대상 요소 하이라이트.
  const renderMarkers = (doc, list, focusIdx = null) => {
    doc.querySelectorAll('[data-cc-pin],[data-cc-hl]').forEach(e => e.remove());
    list.forEach((p, i) => {
      let target = null;
      try { target = p.selector ? doc.querySelector(p.selector) : null; } catch { /* bad selector */ }
      const isFocus = focusIdx === i;
      const mark = doc.createElement('div');
      mark.setAttribute('data-cc-pin', String(i));
      mark.textContent = String(i + 1);
      let top; let left;
      if (target) {
        const r = target.getBoundingClientRect();
        top = r.top + doc.defaultView.scrollY - 10;
        left = r.left + doc.defaultView.scrollX + r.width - 10;
        if (isFocus) {
          // 대상 요소 하이라이트 박스
          const hl = doc.createElement('div');
          hl.setAttribute('data-cc-hl', '1');
          hl.style.cssText = `position:absolute;top:${r.top + doc.defaultView.scrollY - 3}px;left:${r.left + doc.defaultView.scrollX - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;z-index:99998;border:2px solid #b8860b;border-radius:6px;background:rgba(184,134,11,0.12);box-shadow:0 0 0 4px rgba(184,134,11,0.18);pointer-events:none;`;
          doc.body.appendChild(hl);
        }
      } else {
        top = p.yr * doc.documentElement.scrollHeight;
        left = p.xr * doc.documentElement.scrollWidth;
      }
      const scale = isFocus ? 'transform:scale(1.35);transform-origin:center;' : '';
      mark.style.cssText = `position:absolute;top:${top}px;left:${left}px;z-index:99999;width:22px;height:22px;border-radius:50% 50% 50% 4px;background:${isFocus ? '#00754a' : '#b8860b'};color:#fff;font:700 12px/22px sans-serif;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.35);pointer-events:none;${scale}`;
      doc.body.appendChild(mark);
    });
  };

  // 우측 목록에서 핀 선택 → 문서에서 해당 요소로 스크롤 + 하이라이트
  const focusPin = (i, list) => {
    const doc = iframeRef.current?.contentDocument;
    setFocused(i);
    if (!doc) return;
    const arr = list || (done ? (m.answer?.pins || []) : pins);
    renderMarkers(doc, arr, i);
    const p = arr[i];
    let target = null;
    try { target = p?.selector ? doc.querySelector(p.selector) : null; } catch { /* noop */ }
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else if (p) doc.defaultView.scrollTo({ top: p.yr * doc.documentElement.scrollHeight - 200, behavior: 'smooth' });
  };

  const onFrameLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !interactive) return;
    applyFit();
    setTimeout(applyFit, 300); // 폰트·이미지 로드 후 재계산
    // 답변 완료 건은 저장된 핀만 표시 (읽기 전용)
    if (done) { renderMarkers(doc, m.answer?.pins || []); return; }

    // 핀은 우클릭으로만 — 좌클릭은 문서 원래 동작(링크·탭 등) 그대로 통과
    doc.addEventListener('contextmenu', (e) => {
      const cur = stateRef.current;
      if (cur.mode !== 'pin') return;
      const el = e.target;
      if (el.getAttribute?.('data-cc-pin') != null) return;
      e.preventDefault(); e.stopPropagation();
      const p = {
        selector: cssPath(el), label: labelOf(el),
        xr: (e.pageX || 0) / Math.max(1, doc.documentElement.scrollWidth),
        yr: (e.pageY || 0) / Math.max(1, doc.documentElement.scrollHeight),
        comment: '',
      };
      setPins(prev => {
        const next = [...prev, p];
        const idx = next.length - 1;
        setFocused(idx); renderMarkers(doc, next, idx); setDraft(idx);
        return next;
      });
    }, true);

    doc.addEventListener('click', (e) => {
      const cur = stateRef.current;
      const el = e.target;
      if (el.getAttribute?.('data-cc-pin') != null) return;
      if (cur.mode === 'edit') {
        // 텍스트 요소를 그 자리에서 편집 — blur 시 변경분 기록
        if (!el.closest || el.tagName === 'IMG') return;
        e.preventDefault(); e.stopPropagation();
        if (el.isContentEditable) return;
        const before = el.textContent;
        el.setAttribute('contenteditable', 'true');
        el.style.outline = '2px dashed #00754a';
        el.focus();
        const onBlur = () => {
          el.removeAttribute('contenteditable');
          el.style.outline = '';
          el.removeEventListener('blur', onBlur);
          const after = el.textContent;
          if (after !== before) {
            setEdits(prev => [...prev, { selector: cssPath(el), label: labelOf(el) || before.slice(0, 40), before: before.trim().slice(0, 200), after: after.trim().slice(0, 200) }]);
          }
        };
        el.addEventListener('blur', onBlur);
      }
    }, true);
  };

  const removePin = (i) => {
    setPins(prev => {
      const next = prev.filter((_, j) => j !== i);
      const doc = iframeRef.current?.contentDocument;
      if (doc) renderMarkers(doc, next, null);
      return next;
    });
    if (draft === i) setDraft(null);
    setFocused(null);
  };

  const submit = async (approve) => {
    if (busy) return;
    const validPins = pins.filter(p => p.comment.trim());
    if (!approve && validPins.length === 0 && edits.length === 0 && !note.trim()) {
      showToast(isEn() ? 'Add at least one comment or edit.' : '핀 코멘트·텍스트 수정·종합 코멘트 중 하나는 필요합니다.'); return;
    }
    setBusy(true);
    const payload = approve
      ? { decision: 'approve', label: isEn() ? 'Approved' : '승인' }
      : { decision: 'request', label: `리뷰: 핀 ${validPins.length} · 수정 ${edits.length}`, pins: validPins, edits, note: note.trim() };
    try {
      await api.post(`/interactions/by-message/${m.id}/answer`, payload);
      showToast(approve ? (isEn() ? 'Approved.' : '승인했습니다.') : (isEn() ? 'Change request sent to the Team Lead.' : '수정 지시서를 팀장에게 전달했습니다.'));
      history.back();
    } catch (e) { showToast(e.message); }
    setBusy(false);
  };

  if (!m) return <div style={{ padding: '40px', textAlign: 'center', color: C.t58 }}>…</div>;

  const modeBtn = (key, label) => (
    <span onClick={() => setMode(key)} style={{
      cursor: 'pointer', borderRadius: '50px', padding: '6px 14px', fontSize: '12.5px', fontWeight: 700,
      background: mode === key ? C.dark : '#fff', color: mode === key ? '#fff' : C.t58, boxShadow: mode === key ? 'none' : C.cardShadow,
    }}>{label}</span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: 'calc(100vh - 112px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <a onClick={() => history.back()} style={{ cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>←</a>
        <div style={{ fontSize: '15.5px', fontWeight: 700, color: C.heading }}>{art.title || t('아티팩트 검토')}</div>
        {art.meta && <Chip bg={C.ceramic} color={C.t58}>{art.meta}</Chip>}
        {done && <Chip bg={C.mint} color={C.heading} style={{ fontWeight: 700 }}>{m.answer?.decision === 'approve' ? t('승인') : (isEn() ? 'Changes requested' : '수정 요청됨')}</Chip>}
        {!done && interactive && (
          <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
            {modeBtn('pin', isEn() ? '💬 Pin comment' : '💬 핀 코멘트')}
            {modeBtn('edit', isEn() ? '✏️ Edit text' : '✏️ 텍스트 수정')}
          </div>
        )}
      </div>
      {!interactive && (
        <div style={{ fontSize: '12.5px', color: C.t58 }}>
          {isEn() ? 'External URL — pin annotations unavailable; use the summary comment below.' : '외부 URL이라 핀 주석은 불가합니다 — 아래 종합 코멘트를 사용하세요.'}
        </div>
      )}
      <div style={{ display: 'flex', gap: '14px', flex: 1, minHeight: 0 }}>
        {/* 산출물 */}
        <div ref={frameWrapRef} style={{ flex: 1, minWidth: 0, ...card({ padding: 0, overflow: 'hidden' }) }}>
          <iframe ref={iframeRef} src={src} onLoad={onFrameLoad}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
        </div>
        {/* 리뷰 패널 */}
        <div style={{ width: '300px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
          <div style={card({ padding: '14px 16px' })}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: C.t58, marginBottom: '8px' }}>{isEn() ? 'PIN COMMENTS' : '핀 코멘트'} ({(done ? m.answer?.pins : pins)?.length || 0})</div>
            {(done ? (m.answer?.pins || []) : pins).map((p, i) => (
              <div key={i} style={{ borderTop: i ? `1px solid ${C.line}` : 'none', padding: '8px 0', margin: '0 -8px', paddingLeft: '8px', paddingRight: '8px', borderRadius: '8px', background: focused === i ? 'rgba(184,134,11,0.10)' : 'transparent' }}>
                <div onClick={() => focusPin(i)} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }} title={isEn() ? 'Focus this pin' : '이 핀 위치 보기'}>
                  <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: focused === i ? C.cta : C.gold, color: focused === i ? '#fff' : C.dark, fontSize: '11px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: C.heading, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label || p.selector}</span>
                  {!done && <span onClick={(e) => { e.stopPropagation(); removePin(i); }} style={{ cursor: 'pointer', color: C.t58, fontSize: '12px' }}>✕</span>}
                </div>
                {!done && draft === i ? (
                  <textarea autoFocus value={p.comment} rows={2}
                    onInput={e => setPins(prev => prev.map((x, j) => j === i ? { ...x, comment: e.target.value } : x))}
                    onBlur={() => setDraft(null)}
                    placeholder={isEn() ? 'What should change here?' : '이 요소를 어떻게 바꿀까요?'}
                    style={{ width: '100%', boxSizing: 'border-box', marginTop: '6px', border: `1px solid ${C.cta}`, borderRadius: '8px', padding: '7px 9px', fontSize: '12.5px', fontFamily: 'inherit', resize: 'vertical' }} />
                ) : (
                  <div onClick={() => !done && setDraft(i)} style={{ fontSize: '12.5px', color: p.comment ? C.t87 : C.t58, marginTop: '4px', cursor: done ? 'default' : 'pointer', whiteSpace: 'pre-wrap' }}>
                    {p.comment || (isEn() ? '(click to comment)' : '(클릭해서 코멘트 입력)')}
                  </div>
                )}
              </div>
            ))}
            {!done && pins.length === 0 && <div style={{ fontSize: '12px', color: C.t58 }}>{isEn() ? 'Right-click any element on the left to drop a pin. Left-click works normally (links, tabs).' : '왼쪽 화면에서 요소를 우클릭하면 핀이 생깁니다. 좌클릭은 원래대로 동작합니다(링크·탭).'}</div>}
          </div>
          <div style={card({ padding: '14px 16px' })}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: C.t58, marginBottom: '8px' }}>{isEn() ? 'TEXT EDITS' : '텍스트 직접 수정'} ({(done ? m.answer?.edits : edits)?.length || 0})</div>
            {(done ? (m.answer?.edits || []) : edits).map((e2, i) => (
              <div key={i} style={{ borderTop: i ? `1px solid ${C.line}` : 'none', padding: '8px 0', fontSize: '12.5px' }}>
                <div style={{ color: C.danger, textDecoration: 'line-through' }}>{e2.before}</div>
                <div style={{ color: C.heading, fontWeight: 600 }}>{e2.after}</div>
                {!done && <span onClick={() => setEdits(prev => prev.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: C.t58, fontSize: '11px' }}>{isEn() ? 'undo' : '취소'} ✕</span>}
              </div>
            ))}
            {!done && edits.length === 0 && <div style={{ fontSize: '12px', color: C.t58 }}>{isEn() ? 'Switch to ✏️ mode and click text to edit in place.' : '✏️ 모드에서 텍스트를 클릭하면 그 자리에서 고칠 수 있습니다.'}</div>}
          </div>
          {!done && (
            <div style={card({ padding: '14px 16px' })}>
              <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: C.t58, marginBottom: '8px' }}>{isEn() ? 'OVERALL COMMENT' : '종합 코멘트'}</div>
              <textarea value={note} onInput={e => setNote(e.target.value)} rows={3}
                placeholder={isEn() ? 'Overall direction, tone, etc. (optional)' : '전체 방향·톤 등 (선택)'}
                style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: '8px', padding: '8px 10px', fontSize: '12.5px', fontFamily: 'inherit', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <Btn variant="primary" onClick={() => submit(false)} disabled={busy} style={{ flex: 1, justifyContent: 'center' }}>{isEn() ? 'Send change request' : '수정 요청 보내기'}</Btn>
                <Btn variant="darkOutline" onClick={() => submit(true)} disabled={busy}>{t('승인')}</Btn>
              </div>
            </div>
          )}
          {done && m.answer?.note && (
            <div style={card({ padding: '14px 16px' })}>
              <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: C.t58, marginBottom: '6px' }}>{isEn() ? 'OVERALL COMMENT' : '종합 코멘트'}</div>
              <div style={{ fontSize: '12.5px', whiteSpace: 'pre-wrap' }}>{m.answer.note}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
