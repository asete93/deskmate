// 채팅·보고서 공용 — 본문 속 이미지/HTML 파일 참조 렌더
import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { currentBase } from './api.js';
import { C } from './ui.jsx';
import { t } from './i18n.js';

// 본문 속 이미지 참조 렌더 — ![alt](path) 마크다운·워크스페이스 상대경로를 인라인 이미지로
const IMG_MD = /!\[[^\]]*\]\(([^)\s]+)\)/g;
const IMG_BARE = /(?:^|[\s`("'])((?:[\w~-][\w./~-]*)?[\w-]+\.(?:png|jpe?g|gif|webp|svg))(?=$|[\s`)"',])/gi;
export function extractImages(text) {
  if (!text) return [];
  const out = [];
  for (const m of text.matchAll(IMG_MD)) out.push(m[1]);
  for (const m of text.matchAll(IMG_BARE)) out.push(m[1]);
  const seen = new Set();
  return out.filter(u => !/^https?:/.test(u) || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(u))
    .map(u => /^https?:/.test(u) ? u : currentBase() + (u.startsWith('/') ? u : `/workspace/${u.replace(/^\.\//, '')}`))
    .filter(u => (seen.has(u) ? false : (seen.add(u), true)))
    .slice(0, 8);
}
export function InlineImages({ text }) {
  const imgs = extractImages(text);
  if (!imgs.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
      {imgs.map((u, i) => (
        <a key={i} href={u} target="_blank" rel="noreferrer">
          <img src={u} alt="" loading="lazy"
            onError={e => { e.currentTarget.closest('a').style.display = 'none'; }}
            style={{ maxWidth: '320px', maxHeight: '240px', borderRadius: '10px', border: `1px solid ${C.line}`, display: 'block', background: '#fff' }} />
        </a>
      ))}
    </div>
  );
}

// 본문 속 HTML 파일 참조 — 칩으로 표시, 클릭하면 인앱 뷰어(iframe 모달)
const HTML_BARE = /(?:^|[\s`("'])((?:[\w~-][\w./~-]*)?[\w-]+\.html?)(?=$|[\s`)"',])/gi;
export function extractHtmlRefs(text) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const m of text.matchAll(HTML_BARE)) {
    const u = /^https?:/.test(m[1]) ? m[1] : currentBase() + (m[1].startsWith('/') ? m[1] : `/workspace/${m[1].replace(/^\.\//, '')}`);
    if (!seen.has(u)) { seen.add(u); out.push({ url: u, name: m[1].split('/').pop() }); }
  }
  return out.slice(0, 6);
}
export function HtmlViewerModal({ url, title, onClose }) {
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px' }}>
      <div style={{ background: '#fff', borderRadius: '12px', boxShadow: C.popShadow, width: 'min(1100px, 96vw)', height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', background: C.dark, color: '#fff' }}>
          <span style={{ fontSize: '13.5px', fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <span onClick={() => window.open(url, '_blank', 'noopener')} style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 600, border: '1px solid rgba(255,255,255,0.4)', borderRadius: '50px', padding: '4px 12px' }}>{t('새 창에서 열기')}</span>
          <span onClick={onClose} style={{ cursor: 'pointer', fontSize: '17px', padding: '0 4px', color: 'rgba(255,255,255,0.85)' }}>✕</span>
        </div>
        <iframe src={url} title={title} style={{ flex: 1, border: 'none', width: '100%' }} />
      </div>
    </div>
  );
}
export function HtmlChips({ text }) {
  const [open, setOpen] = useState(null);
  const refs = extractHtmlRefs(text);
  if (!refs.length) return null;
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
        {refs.map((r, i) => (
          <span key={i} onClick={() => setOpen(r)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', background: C.cream, border: `1px solid ${C.line}`, borderRadius: '50px', padding: '5px 13px', fontSize: '12.5px', fontWeight: 600, color: C.heading }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.cta} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
            {r.name} <span style={{ color: C.cta }}>{t('열람')} →</span>
          </span>
        ))}
      </div>
      {open && <HtmlViewerModal url={open.url} title={open.name} onClose={() => setOpen(null)} />}
    </>
  );
}

