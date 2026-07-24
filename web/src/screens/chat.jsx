import { h, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { marked } from 'marked';
import { store, loadChannel, loadOlder, showToast, unreadCount } from '../store.js';
import { api, currentBase } from '../api.js';
import { C, card, Btn, SegPill, Input, Chip, StatusPill, REQ_STATUS, actorChip, actorLabel, fmtTime, modelLabel, modelOptions, effortOptions, agentStatus, dotStyle, Linkify, Modal, Spin } from '../ui.jsx';
import { CfgPanel } from './subs.jsx';
import { I } from '../icons.jsx';
import { nav } from '../main.jsx';
import { t, isEn } from '../i18n.js';
import { ReportLinkCard } from './reports.jsx';
import { InlineImages, HtmlChips } from '../refs.jsx';
import { ReportModal, ReportBadge } from './report.jsx';

const MODES = [
  { key: 'plan', label: 'Plan Mode', desc: '계획까지만 수행하고, 실행 전 사용자 승인을 받습니다.' },
  { key: 'auto', label: 'Auto Mode', desc: '승인 지정 항목 외에는 자동으로 실행합니다.' },
  { key: 'ask', label: 'Ask Mode', desc: '단계별로 사용자 확인을 요청합니다.' },
];

// ---- 인터랙션 카드 4종 ----
function AnsweredBar({ text }) {
  return <div style={{ background: C.mint, borderRadius: '8px', padding: '10px 14px', fontSize: '13.5px', fontWeight: 600, color: C.heading, marginTop: '12px' }}>✓ {text}</div>;
}

function ChoiceCard({ m, answer }) {
  const c = m.content;
  const multi = !!c.multi;
  const [detailOpen, setDetailOpen] = useState(false);
  const [pending, setPending] = useState(null); // 클릭한 옵션 id — 서버 반영까지 스피너
  // 다중 선택: 토글로 모아서 "선택 완료" 버튼으로 한 번에 제출 (단일 선택은 즉시 제출)
  const [sel, setSel] = useState([]);
  const pickedLabels = m.answered
    ? (multi ? (m.answer?.labels || []) : [m.answer?.label].filter(Boolean))
    : [];
  const toggle = (op) => setSel(s => s.includes(op.id) ? s.filter(x => x !== op.id) : [...s, op.id]);
  const submitMulti = () => {
    if (pending != null) return;
    const ops = (c.options || []).filter(op => sel.includes(op.id));
    setPending('__multi__');
    Promise.resolve(answer({ ids: ops.map(o => o.id), labels: ops.map(o => o.label), label: ops.map(o => o.label).join(', ') })).finally(() => setTimeout(() => setPending(null), 400));
  };
  return (
    <div style={card({ padding: '20px' })}>
      <div style={{ fontSize: '14.5px', lineHeight: 1.55, marginBottom: '6px' }}>{c.text}</div>
      {/* 본문 첨부(계획 전문 등) — 마크다운 팝업으로 열람 */}
      {c.detail?.body && (
        <div onClick={() => setDetailOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderRadius: '12px', padding: '11px 15px', cursor: 'pointer', margin: '8px 0 4px' }}>
          <span style={{ fontSize: '16px' }}>📋</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: C.heading, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.detail.title || t('상세 내용')}</div>
            <div style={{ fontSize: '11.5px', color: C.t58 }}>{t('결정 전에 전문을 확인하세요')}</div>
          </div>
          <span style={{ fontSize: '12px', fontWeight: 700, color: C.goldText, flexShrink: 0 }}>{t('전문 보기 →')}</span>
        </div>
      )}
      {detailOpen && <DetailModal title={c.detail?.title || t('상세 내용')} body={c.detail?.body} onClose={() => setDetailOpen(false)} />}
      {multi && !m.answered && <div style={{ fontSize: '12px', fontWeight: 600, color: C.goldText, marginBottom: '10px' }}>{t('복수 선택 가능 — 고른 뒤 "선택 완료"를 누르세요')}</div>}
      <div style={{ height: multi ? 0 : '8px' }} />
      {/* 답변 후에도 전체 선택지를 보여준다 (선택된 것 하이라이트) — 옵션이 사라지면 하나뿐이었던 것처럼 보임 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: '10px' }}>
        {(c.options || []).map(op => {
          const isPicked = m.answered ? pickedLabels.includes(op.label) : (multi && sel.includes(op.id));
          return (
            <div key={op.id} onClick={() => {
              if (m.answered || pending != null) return;
              if (multi) toggle(op);
              else { setPending(op.id); Promise.resolve(answer({ id: op.id, label: op.label })).finally(() => setTimeout(() => setPending(null), 400)); }
            }}
              style={{
                border: `1px solid ${isPicked ? C.cta : C.border}`, borderRadius: '12px', padding: '14px 16px',
                cursor: m.answered ? 'default' : 'pointer', transition: 'all 0.2s ease',
                background: isPicked ? C.mint : '#fff',
                opacity: m.answered && !isPicked ? 0.55 : 1,
              }}
              onMouseEnter={e => { if (!m.answered && !isPicked) { e.currentTarget.style.borderColor = C.cta; e.currentTarget.style.background = '#f9f9f9'; } }}
              onMouseLeave={e => { if (!m.answered && !isPicked) { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = '#fff'; } }}>
              <div style={{ fontSize: '15px', fontWeight: 600, color: C.heading, display: 'flex', alignItems: 'center', gap: '7px' }}>{pending === op.id && !m.answered ? <Spin /> : isPicked ? '✓ ' : ''}{op.label}</div>
              <div style={{ fontSize: '13px', color: C.t58, marginTop: '4px', lineHeight: 1.45 }}>{op.desc}</div>
            </div>
          );
        })}
      </div>
      {multi && !m.answered && (
        <div style={{ marginTop: '14px' }}>
          <Btn variant="primary" small disabled={sel.length === 0 || pending != null} onClick={submitMulti}>{pending === '__multi__' ? <Spin color="#fff" track="rgba(255,255,255,0.35)" /> : null} {t('선택 완료')} ({sel.length})</Btn>
        </div>
      )}
      {m.answered && <AnsweredBar text={`선택 완료 — ${pickedLabels.join(', ')}`} />}
    </div>
  );
}

function DiffCard({ m, answer }) {
  const c = m.content;
  const colors = { add: { bg: 'rgba(0,117,74,0.08)', c: C.heading }, del: { bg: 'rgba(200,32,20,0.08)', c: C.danger }, ctx: { bg: '#fff', c: C.t58 }, hunk: { bg: C.ceramic, c: C.t58 } };
  return (
    <div style={card({ padding: '20px' })}>
      <div style={{ fontSize: '14.5px', lineHeight: 1.55, marginBottom: '12px' }}>{c.text}</div>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: '8px', overflow: 'hidden', fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '13px' }}>
        {(c.lines || []).map((ln, i) => {
          const cc = colors[ln.t] || colors.ctx;
          return <div key={i} style={{ padding: '5px 14px', whiteSpace: 'pre-wrap', background: cc.bg, color: cc.c }}>{ln.t === 'add' ? '+ ' : ln.t === 'del' ? '− ' : '  '}{ln.text}</div>;
        })}
      </div>
      {!m.answered ? (
        <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
          <Btn variant="primary" small onClick={() => answer({ decision: 'approve', label: '승인 후 적용' })}>승인 후 적용</Btn>
          <Btn variant="darkOutline" small onClick={() => answer({ decision: 'reject', label: '거절' })}>거절</Btn>
        </div>
      ) : <AnsweredBar text={m.answer?.decision === 'approve' ? '승인 — 문서에 반영되었습니다' : '거절 — 기존 내용 유지'} />}
    </div>
  );
}

function ArtifactCard({ m, answer }) {
  const c = m.content;
  const art = c.artifact || {};
  // 인라인 렌더 대신 링크 팝업 — 워크스페이스 정적 서빙이라 상대경로 CSS/JS 정상 동작
  const openPreview = () => {
    if (art.url) {
      const full = art.url.startsWith('http') ? art.url : currentBase() + art.url;
      window.open(full, 'artifact-preview', 'width=1100,height=800,noopener');
    } else if (art.html) {
      // 구버전 메시지 호환: html 문자열만 있는 경우
      const w = window.open('', 'artifact-preview', 'width=1100,height=800');
      if (w) { w.document.write(art.html); w.document.close(); }
    } else {
      showToast('미리보기 대상이 없습니다.');
    }
  };
  const full = art.url ? (art.url.startsWith('http') ? art.url : currentBase() + art.url) : null;
  const isImg = full && /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(full);
  const isHtml = full && /\.(html?|svg)(\?|$)/i.test(full);
  return (
    <div style={card({ padding: '20px' })}>
      <div style={{ fontSize: '14.5px', lineHeight: 1.55, marginBottom: '14px', whiteSpace: 'pre-wrap' }}>{c.text}</div>
      {/* 이미지·HTML은 채팅 안에서 바로 미리보기 */}
      {isImg && (
        <img src={full} alt={art.title || ''} onClick={openPreview}
          style={{ maxWidth: '100%', maxHeight: '420px', borderRadius: '12px', border: `1px solid ${C.line}`, cursor: 'zoom-in', display: 'block', marginBottom: '12px', background: '#fff' }} />
      )}
      {!isImg && isHtml && (
        <iframe src={full} title={art.title || 'artifact'}
          style={{ width: '100%', height: '380px', border: `1px solid ${C.line}`, borderRadius: '12px', background: '#fff', marginBottom: '12px' }} />
      )}
      <div onClick={openPreview}
        style={{ display: 'flex', alignItems: 'center', gap: '12px', border: `1px solid ${C.line}`, borderRadius: '12px', background: C.cream, padding: '14px 16px', cursor: 'pointer' }}
        onMouseEnter={e => e.currentTarget.style.borderColor = C.cta}
        onMouseLeave={e => e.currentTarget.style.borderColor = C.line}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.cta} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><circle cx="6.5" cy="6" r="0.5" /><circle cx="9.5" cy="6" r="0.5" />
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '14.5px', fontWeight: 600, color: C.heading }}>{art.title || '산출물 미리보기'}</div>
          {art.meta && <div style={{ fontSize: '12px', color: C.t58, marginTop: '2px' }}>{art.meta}</div>}
        </div>
        <span style={{ fontSize: '12.5px', fontWeight: 600, color: C.cta, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          새 창에서 열기
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></svg>
        </span>
      </div>
      {!m.answered ? (
        <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
          {/* 주석 리뷰 — 핀 코멘트·텍스트 직접 수정으로 구조화 피드백 */}
          <Btn variant="primary" small onClick={() => nav('review', m.id)}>{isEn() ? '📝 Review with pins' : '📝 핀 리뷰 열기'}</Btn>
          <Btn variant="outline" small onClick={() => answer({ decision: 'approve', label: '승인' })}>{t('승인')}</Btn>
        </div>
      ) : (
        <AnsweredBar text={m.answer?.decision === 'approve'
          ? (isEn() ? 'Approved' : '승인 완료')
          : `${isEn() ? 'Change request sent' : '수정 요청 전달됨'}${m.answer?.pins?.length || m.answer?.edits?.length ? ` — 핀 ${m.answer?.pins?.length || 0} · 수정 ${m.answer?.edits?.length || 0}` : ''}`} />
      )}
      {m.answered && (m.answer?.pins?.length || m.answer?.edits?.length) ? (
        <div style={{ marginTop: '8px' }}>
          <a onClick={() => nav('review', m.id)} style={{ cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}>{isEn() ? 'View review →' : '리뷰 내용 보기 →'}</a>
        </div>
      ) : null}
    </div>
  );
}

function FormCard({ m, answer }) {
  const c = m.content;
  const fields = c.form?.fields || [];
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(f => [f.key, f.type === 'segment' ? (f.options?.[0] || '') : ''])));
  return (
    <div style={card({ padding: '20px' })}>
      <div style={{ fontSize: '14.5px', lineHeight: 1.55, marginBottom: '14px' }}>{c.text}</div>
      {!m.answered ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {fields.map(f => (
            <div key={f.key}>
              <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58, marginBottom: '6px' }}>{f.label}</div>
              {f.type === 'segment' ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(f.options || []).map(op => (
                    <SegPill key={op} active={values[f.key] === op} onClick={() => setValues({ ...values, [f.key]: op })}>{op}</SegPill>
                  ))}
                </div>
              ) : (
                <Input value={values[f.key]} placeholder={f.placeholder || ''} onInput={e => setValues({ ...values, [f.key]: e.target.value })} />
              )}
            </div>
          ))}
          <div><Btn variant="primary" small onClick={() => answer({ values, label: '입력 적용' })}>적용</Btn></div>
        </div>
      ) : <AnsweredBar text={`적용 완료 — ${Object.entries(m.answer?.values || {}).map(([k, v]) => `${k}: ${v}`).join(', ')}`} />}
    </div>
  );
}

// ---- 상세 원문 팝업 (마크다운 렌더) ----
marked.use({ gfm: true, breaks: true });
const MD_CSS = `
.md-body{font-size:14.5px;line-height:1.65;color:#22302b;overflow-wrap:break-word;white-space:normal}
.md-body>*:first-child{margin-top:0}
.md-body h1,.md-body h2{margin:22px 0 8px;padding-bottom:6px;border-bottom:1px solid #e7e3d8;color:#14211c;font-weight:700}
.md-body h3,.md-body h4{margin:16px 0 6px;color:#14211c;font-weight:700}
.md-body h1{font-size:19px}.md-body h2{font-size:16.5px}.md-body h3{font-size:15px}.md-body h4{font-size:14.5px}
.md-body p{margin:7px 0}
.md-body strong{color:#14211c}
.md-body ul,.md-body ol{padding-left:24px;margin:7px 0}
.md-body li{margin:3px 0;padding-left:2px}
.md-body li::marker{color:#00754a;font-weight:700}
.md-body li>p{margin:0}
.md-body li>ul,.md-body li>ol{margin:3px 0}
.md-body table{border-collapse:collapse;margin:12px 0;font-size:13px;max-width:100%;display:block;overflow-x:auto}
.md-body th,.md-body td{border:1px solid #ddd8cc;padding:7px 12px;text-align:left;vertical-align:top}
.md-body th{background:#f4f2ec;font-weight:700}
.md-body tr:nth-child(even) td{background:#faf9f5}
.md-body code{background:#eef4f0;color:#0b5c3f;border-radius:4px;padding:1.5px 6px;font-size:12.5px;font-family:ui-monospace,'SF Mono',Menlo,monospace}
.md-body pre{background:#14211c;color:#e6efe9;padding:14px 16px;border-radius:10px;overflow-x:auto;white-space:pre;margin:10px 0}
.md-body pre code{background:none;color:inherit;padding:0;font-size:12.5px;line-height:1.6}
.md-body hr{border:none;border-top:1px dashed #ddd8cc;margin:18px 0}
.md-body blockquote{border-left:3px solid #00754a;margin:10px 0;padding:4px 14px;color:#5a6660;background:#f7f6f1;border-radius:0 8px 8px 0}
.md-body a{color:#00754a;text-decoration:underline}
`;
export function DetailModal({ title, body, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 140, background: 'rgba(20,33,28,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '16px', width: 'min(920px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: C.popShadow }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 22px 10px' }}>
          <span style={{ fontSize: '16px' }}>📄</span>
          <span style={{ fontSize: '15.5px', fontWeight: 700, color: C.heading, flex: 1 }}>{title}</span>
          <span onClick={onClose} title={t('닫기')} style={{ cursor: 'pointer', color: C.t58, fontSize: '16px', padding: '2px 6px' }}>✕</span>
        </div>
        <style>{MD_CSS}</style>
        <div className="md-body" style={{ overflowY: 'auto', padding: '2px 24px 24px' }} dangerouslySetInnerHTML={{ __html: marked.parse(body || '') }} />
      </div>
    </div>
  );
}

// 상세 첨부 카드 — 채팅에는 요약만, 원문은 팝업으로 (attach_detail)
function DetailCard({ m }) {
  const [open, setOpen] = useState(false);
  const c = m.content || {};
  return (
    <>
      <div onClick={() => setOpen(true)}
        style={{ display: 'flex', alignItems: 'center', gap: '10px', background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderRadius: '12px', padding: '11px 15px', cursor: 'pointer' }}>
        <span style={{ fontSize: '16px' }}>📄</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13.5px', fontWeight: 700, color: C.heading, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title || '상세 내용'}</div>
          <div style={{ fontSize: '11.5px', color: C.t58 }}>{t('상세 원문 · 클릭해서 열람')}</div>
        </div>
        <span style={{ fontSize: '12px', fontWeight: 700, color: C.goldText, flexShrink: 0 }}>{t('원문 보기 →')}</span>
      </div>
      {open && <DetailModal title={c.title || '상세 내용'} body={c.body} onClose={() => setOpen(false)} />}
    </>
  );
}

// 긴 본문의 추출 요약 — 첫 핵심 문장 + 섹션 목차. 원문은 팝업에서.
function summarize(text) {
  const lines = text.split('\n');
  const heads = lines.filter(l => /^#{1,4}\s/.test(l.trim())).map(l => l.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim()).filter(Boolean);
  // 첫 의미 문단 (헤딩·리스트·인용·표 제외)
  const para = lines.map(l => l.trim()).find(l => l && !/^#{1,4}\s/.test(l) && !/^[-*>|`\d]/.test(l));
  let first = (para || lines.map(l => l.trim()).find(Boolean) || '').replace(/[*_`#>]/g, '').trim();
  const sent = first.match(/^[\s\S]{15,160}?(?:[.!?]|다\.|요\.|함\.)(?=\s|$)/);
  first = sent ? sent[0].trim() : (first.length > 160 ? first.slice(0, 160).trimEnd() + '…' : first);
  let out = first;
  if (heads.length) out += `\n▸ ${heads.slice(0, 6).join(' · ')}${heads.length > 6 ? ` 외 ${heads.length - 6}` : ''}`;
  return out;
}

// 붙여넣은 텍스트 칩 + 원문 뷰어 (입력창·메시지 공용)
export function PasteChip({ p, idx, onRemove }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span onClick={() => setOpen(true)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: C.ceramic, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '5px 12px', fontSize: '12px', fontWeight: 600, color: C.t87, cursor: 'pointer', maxWidth: '100%' }}>
        📋 {t('붙여넣은 텍스트')} #{idx + 1} · {p.lines.toLocaleString()}{t('줄')}
        {onRemove && <span onClick={(e) => { e.stopPropagation(); onRemove(); }} style={{ cursor: 'pointer', fontWeight: 700, color: C.t58 }}>✕</span>}
      </span>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(20,33,28,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '16px', width: 'min(920px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: C.popShadow }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 22px 10px' }}>
              <span style={{ fontSize: '16px' }}>📋</span>
              <span style={{ fontSize: '15px', fontWeight: 700, color: C.heading, flex: 1 }}>{t('붙여넣은 텍스트')} — {p.lines.toLocaleString()}{t('줄')}</span>
              <span onClick={() => setOpen(false)} style={{ cursor: 'pointer', color: C.t58, fontSize: '16px', padding: '2px 6px' }}>✕</span>
            </div>
            <pre style={{ margin: 0, overflow: 'auto', padding: '4px 22px 22px', fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12.5px', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', color: C.t87 }}>{p.text}</pre>
          </div>
        </div>
      )}
    </>
  );
}

// 발신자 아바타 — 기본은 이름(앞 2자), agents.avatar로 커스텀(조직도에서 수정)
function MsgAvatar({ name, onOpenCfg }) {
  const chip = actorChip(name);
  const ag = (store.agents || []).find(a => a.name === name || (name === 'Main' && a.kind === 'main'));
  const label = name === 'User' ? t('대표') : ((ag?.avatar || '').trim() || actorLabel(name).slice(0, 2));
  const clickable = name !== 'User' && ag && onOpenCfg;
  return (
    <div title={name === 'User' ? t('대표') : `${actorLabel(name)} — ${clickable ? (isEn() ? 'click to configure' : '클릭하면 설정') : ''}`}
      onClick={clickable ? () => onOpenCfg(ag.id) : undefined}
      style={{ width: '34px', height: '34px', borderRadius: '50%', background: chip.bg, color: chip.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: label.length > 2 ? '9.5px' : '11.5px', fontWeight: 700, flexShrink: 0, boxShadow: C.cardShadow, marginTop: '17px', whiteSpace: 'nowrap', overflow: 'hidden', cursor: clickable ? 'pointer' : 'default' }}>{label}</div>
  );
}

// 에이전트 발화 본문 — 길면 요약(첫 문장+목차)만 보이고 원문은 팝업 (attach_detail을 안 쓴 경우의 안전망)
// 마크다운의 문단 구분(빈 줄)은 말풍선에선 행간만 벌리므로 한 줄로 접는다 (원문 팝업은 그대로)
const tighten = (t) => String(t || '').replace(/\n[ \t]*\n+/g, '\n');
// 진행 로그(작업 중 중간 출력) 접기 — 연속된 progress 메시지를 한 줄 아코디언으로
export function groupProgress(msgs) {
  const rows = [];
  for (const m of msgs) {
    const isProg = m.kind === 'text' && m.content?.progress;
    const last = rows[rows.length - 1];
    if (isProg && last?.progress && last.from === m.from_actor) last.items.push(m);
    else if (isProg) rows.push({ progress: true, from: m.from_actor, items: [m] });
    else rows.push({ m });
  }
  return rows;
}
export function ProgressFold({ group }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ alignSelf: 'flex-start', maxWidth: '82%' }}>
      <div onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: C.t58, background: '#fff', border: `1px solid ${C.line}`, borderRadius: '50px', padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '10px' }}>{open ? '▾' : '▸'}</span>
        {actorLabel(group.from)} {t('진행 로그')} {group.items.length}
      </div>
      {open && (
        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px', borderLeft: `2px solid ${C.line}`, paddingLeft: '10px' }}>
          {group.items.map(pm => (
            <div key={pm.id} style={{ fontSize: '12.5px', lineHeight: 1.55, color: C.t58, whiteSpace: 'pre-wrap' }}>{pm.content.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// 이전 대화 무한 스크롤 — 상단 근접 시 이전 페이지 로딩, 프리펜드 후 보던 위치 유지
function useOlderOnScroll(ref, channel) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const onScroll = async () => {
    const el = ref.current;
    if (!el || busyRef.current || !store.chatMore?.[channel]) return;
    if (el.scrollTop > 60) return;
    busyRef.current = true;
    setBusy(true);
    const h0 = el.scrollHeight;
    try { await loadOlder(channel); } catch (e) { showToast(e.message); }
    requestAnimationFrame(() => {
      el.scrollTop += el.scrollHeight - h0;
      busyRef.current = false;
      setBusy(false);
    });
  };
  return { onScroll, busy };
}
function OlderSpin({ busy }) {
  if (!busy) return null;
  return <div style={{ alignSelf: 'center', fontSize: '12px', fontWeight: 700, color: C.t58, flexShrink: 0 }}>…</div>;
}

export function AgentText({ text, light = false }) {
  const [open, setOpen] = useState(false);
  const LIMIT = 400;
  if (!text || text.length <= LIMIT) return <Linkify text={tighten(text)} light={light} />;
  return (
    <>
      <Linkify text={summarize(text)} light={light} />
      <div onClick={() => setOpen(true)}
        style={{ marginTop: '8px', fontSize: '12.5px', fontWeight: 700, color: light ? '#d4e9e2' : C.cta, cursor: 'pointer' }}>
        {t('전체 내용 보기')} ({text.length.toLocaleString()}자)
      </div>
      {open && <DetailModal title={t('메시지 원문')} body={text} onClose={() => setOpen(false)} />}
    </>
  );
}

export const CARD_TITLES = { choice: '선택 필요', diff: 'CLAUDE.md 수정 제안', artifact: '아티팩트 검토', form: '입력 필요', detail: '상세 첨부' };
export const CARDS = { choice: ChoiceCard, diff: DiffCard, artifact: ArtifactCard, form: FormCard, detail: DetailCard };
export const answerByMessage = (m) => async (payload) => {
  const path = m.interaction_id != null
    ? `/interactions/${m.interaction_id}/answer`
    : `/interactions/by-message/${m.id}/answer`;
  try { await api.post(path, payload); } catch (e) { showToast(e.message); }
};

// 메시지 첨부 렌더 — 이미지는 미리보기, 그 외는 다운로드 칩
export function Attachments({ atts, align = 'flex-start' }) {
  if (!atts?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px', justifyContent: align === 'flex-end' ? 'flex-end' : 'flex-start' }}>
      {atts.map((a, i) => a.mime?.startsWith('image/') ? (
        <a key={i} href={currentBase() + a.url} target="_blank" rel="noreferrer">
          <img src={currentBase() + a.url} alt={a.name} style={{ maxWidth: '220px', maxHeight: '160px', borderRadius: '8px', border: `1px solid ${C.line}`, display: 'block' }} />
        </a>
      ) : (
        <a key={i} href={currentBase() + a.url} target="_blank" rel="noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fff', border: `1px solid ${C.border}`, borderRadius: '50px', padding: '5px 12px', fontSize: '12.5px', fontWeight: 600, color: C.heading }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
          {a.name} <span style={{ color: C.t58, fontWeight: 400 }}>{a.size >= 1048576 ? (a.size / 1048576).toFixed(1) + 'MB' : Math.ceil(a.size / 1024) + 'KB'}</span>
        </a>
      ))}
    </div>
  );
}

// 작업 중 컴팩트 독 — 채팅을 가리지 않는 한 줄 sticky 필, 클릭하면 상세(각자 현재 작업+중단) 팝오버
export function WorkingDock({ actives, channel }) {
  const [open, setOpen] = useState(false);
  if (!actives.length) return null;
  const first = actives[0];
  const waitingOnly = actives.every(a => a.status === 'waiting');
  const headline = actives.length > 1
    ? (isEn() ? `${first.name} +${actives.length - 1}` : `${first.name} 외 ${actives.length - 1}명`)
    : first.name;
  const tail = waitingOnly
    ? (isEn() ? 'waiting for your reply' : '응답 대기 중')
    : `${isEn() ? 'working' : '작업 중'}${actives.length === 1 && first.current_task ? ` · ${first.current_task}` : ''}`;
  const interrupt = (a) => api.post(`/agents/${a.id}/interrupt`, { channel: a.work_channel || channel || null }).catch(e => showToast(e.message));
  return (
    <div style={{ position: 'sticky', bottom: 0, display: 'flex', justifyContent: 'center', paddingTop: '4px', pointerEvents: 'none', zIndex: 5 }}>
      <div style={{ position: 'relative', pointerEvents: 'auto', maxWidth: '86%' }}>
        {open && (
          <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', width: 'min(430px, 88vw)', background: '#fff', borderRadius: '12px', boxShadow: C.popShadow, padding: '6px 14px', zIndex: 60 }}>
            {actives.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: `1px solid ${C.line}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13.5px', fontWeight: 700, color: C.heading }}>
                    {a.name}
                    <span style={{ marginLeft: '8px', fontSize: '11.5px', fontWeight: 700, color: a.status === 'waiting' ? C.goldText : C.cta }}>
                      {a.status === 'waiting' ? (isEn() ? 'waiting' : '응답 대기') : (isEn() ? 'working' : '작업 중')}
                    </span>
                  </div>
                  <div style={{ fontSize: '12.5px', color: C.t58, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.status === 'waiting'
                      ? (isEn() ? 'Answer the card in chat' : '채팅의 카드에 답해주세요')
                      : (a.current_task || (isEn() ? 'Working…' : '작업을 진행하고 있습니다…'))}
                  </div>
                </div>
                {a.status === 'working' && (
                  <span onClick={() => interrupt(a)}
                    style={{ cursor: 'pointer', border: '1px solid rgba(200,32,20,0.4)', color: C.danger, borderRadius: '50px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}>
                    {t('중단')}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <div onClick={() => setOpen(!open)}
          style={{ display: 'flex', alignItems: 'center', gap: '9px', cursor: 'pointer', background: waitingOnly ? C.goldLight : 'rgba(255,255,255,0.96)', border: `1px solid ${waitingOnly ? C.goldBorder : C.line}`, borderRadius: '50px', boxShadow: C.cardShadow, padding: '6px 15px' }}>
          {!waitingOnly && (
            <span style={{ display: 'inline-flex', gap: '4px' }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{ width: '5px', height: '5px', borderRadius: '50%', background: C.cta, animation: 'ga-pulse 1.2s ease infinite', animationDelay: `${i * 0.2}s` }} />
              ))}
            </span>
          )}
          <span style={{ fontSize: '12.5px', fontWeight: 600, color: waitingOnly ? C.goldText : C.t58, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '58vw' }}>
            {headline} {tail}
          </span>
          <span style={{ fontSize: '11px', color: C.t58 }}>{open ? '▾' : '▸'}</span>
        </div>
      </div>
    </div>
  );
}

// 작업 중 타이핑 도트 인디케이터 + 중단 버튼 (팀 채팅에서도 재사용)
export function WorkingIndicator({ agent, agentName, channel = null }) {
  if (!agent || agent.status === 'idle') return null;
  // 팀장은 방별 세션 — 다른 방에서 발원한 작업은 이 방에 표시하지 않는다
  if (channel && agent.kind === 'main' && (agent.work_channel || 'main') !== channel) return null;
  const waiting = agent.status === 'waiting';
  const label = waiting
    ? (isEn() ? `${agentName} is waiting for your reply — answer the card above` : `${agentName}이(가) 대표님의 응답을 기다리고 있습니다 — 위 카드에 답해주세요`)
    : `${agentName} ${isEn() ? 'working' : '작업 중'}${agent.current_task ? ` · ${agent.current_task}` : ''}…`;
  const interrupt = () => api.post(`/agents/${agent.id}/interrupt`, { channel: agent.work_channel || channel || null }).catch(e => showToast(e.message));
  return (
    <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '10px', background: waiting ? C.goldLight : '#fff', border: `1px solid ${waiting ? C.goldBorder : C.line}`, borderRadius: '4px 16px 16px 16px', boxShadow: C.cardShadow, padding: '8px 10px 8px 16px' }}>
      {!waiting && (
        <span style={{ display: 'inline-flex', gap: '4px' }}>
          {[0, 1, 2].map(i => (
            <span key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: C.cta, animation: 'ga-pulse 1.2s ease infinite', animationDelay: `${i * 0.2}s` }} />
          ))}
        </span>
      )}
      <span style={{ fontSize: '13px', fontWeight: 600, color: waiting ? C.goldText : C.t58 }}>{label}</span>
      {!waiting && (
        <span onClick={interrupt} title={t('진행 중 작업 중단')}
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', border: '1px solid rgba(200,32,20,0.4)', color: C.danger, borderRadius: '50px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}>
          <span style={{ width: '9px', height: '9px', background: C.danger, borderRadius: '2px', display: 'inline-block' }} />
          중단
        </span>
      )}
    </div>
  );
}

// 채팅 메시지 목록 (메인·서브 공용)
export function MessageList({ channel, height = null, agentName = '팀장', agentColor = C.heading, inCard = false }) {
  const ref = useRef(null);
  // 모바일: 하단 탭바+전환칩 몫을 빼고 dvh 사용 — 페이지 전체 세로 스크롤(이중 스크롤) 방지
  // 주의: 지역변수명 h 금지 — JSX 팩토리 h를 가림
  // 헤더 밴드(약 54px) 포함 기준으로 산정. 모바일은 여백 최소화해 채팅 영역 최대 확보.
  const listH = height || (window.innerWidth < 840
    ? 'calc(100dvh - 200px)'
    : `calc(100vh - ${inCard ? 250 : 244}px)`); // 데스크탑: 카드가 페이지 하단까지 차도록
  const msgs = store.messages[channel] || [];
  const agent = channel === 'main'
    ? store.agents.find(a => a.kind === 'main')
    : store.agents.find(a => a.id === Number(channel.split(':')[1]));
  useEffect(() => { loadChannel(channel); }, [channel]);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [msgs[msgs.length - 1]?.id, agent?.status]);
  const older = useOlderOnScroll(ref, channel);

  const answer = answerByMessage;

  return (
    <div ref={ref} onScroll={older.onScroll} style={{ overflowY: 'auto', height: listH, display: 'flex', flexDirection: 'column', gap: '14px', padding: inCard ? '16px 14px' : '4px 2px' }}>
      <OlderSpin busy={older.busy} />
      {groupProgress(msgs).map((row, gi) => {
        if (row.progress) return <ProgressFold key={`p${row.items[0].id}`} group={row} />;
        const m = row.m;
        if (m.from_actor === 'User') {
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ alignSelf: 'flex-end', maxWidth: '78%', background: C.cta, color: '#fff', borderRadius: '16px 16px 4px 16px', padding: '12px 16px', fontSize: '14.5px', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}><Linkify text={m.content.text} light /></div>
              <div style={{ alignSelf: 'flex-end', maxWidth: '78%' }}><Attachments atts={m.content.attachments} align="flex-end" /></div>
              <div style={{ alignSelf: 'flex-end', fontSize: '11.5px', color: C.t58, marginTop: '4px' }}>{fmtTime(m.ts)}</div>
            </div>
          );
        }
        // 시스템 배지 (새 대화 시작 구분선 등) — 중앙 표시
        if (m.kind === 'system') {
          return (
            <div key={m.id} style={{ alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: '8px', background: C.ceramic, borderRadius: '50px', padding: '5px 16px', margin: '2px 0' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: C.sub || C.t58 }}>{m.content.text}</span>
              <span style={{ fontSize: '10.5px', color: C.t58 }}>{fmtTime(m.ts)}</span>
            </div>
          );
        }
        // 산출 보고서 링크 카드
        if (m.kind === 'report') {
          return (
            <div key={m.id} style={{ alignSelf: 'flex-start' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: agentColor, marginBottom: '4px' }}>{agentName} · {fmtTime(m.ts)}</div>
              <ReportLinkCard m={m} />
            </div>
          );
        }
        const Card = CARDS[m.kind];
        // 팀원의 승인 카드가 팀장 채팅에 게시될 수 있음 — 실제 발신자 표시
        const who = m.from_actor === 'Main' ? agentName : m.from_actor;
        const head = `${who} · ${fmtTime(m.ts)}${Card ? ` · ${t(CARD_TITLES[m.kind])}` : ''}`;
        return (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ alignSelf: 'flex-start', width: '100%', maxWidth: Card ? '600px' : '82%' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: agentColor, marginBottom: '4px' }}>{head}</div>
              {Card
                ? <Card m={m} answer={answer(m)} />
                : <div style={{ background: '#fff', borderRadius: '4px 16px 16px 16px', boxShadow: C.cardShadow, padding: '12px 16px', fontSize: '14.5px', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}><AgentText text={m.content.text} />{m.to_actor === 'User' && <><InlineImages text={m.content.text} /><HtmlChips text={m.content.text} /></>}</div>}
            </div>
          </div>
        );
      })}
      <WorkingDock channel={channel}
        actives={agent && agent.status !== 'idle' && !(agent.kind === 'main' && (agent.work_channel || 'main') !== channel) ? [agent] : []} />
    </div>
  );
}

// ═══ 공용 채팅방 피드 — 대표+팀장+팀원 대화·위임·카드가 방 채널에 모두 표시 ═══
const fmtTok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n || 0));

// REQ 경계 디바이더 — 요구사항이 바뀌는 지점 표시 (제목·상태·토큰·보고서)
function ReqDivider({ req, onReport }) {
  if (!req) return null;
  const st = REQ_STATUS[req.status] || REQ_STATUS.active;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '10px 0 2px' }}>
      <div style={{ flex: 1, borderTop: `1px dashed ${C.goldBorder}` }} />
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderRadius: '50px', padding: '4px 14px', flexWrap: 'wrap', maxWidth: '80%' }}>
        <span style={{ fontSize: '11.5px', fontWeight: 700, color: C.goldText }}>REQ-{req.id}</span>
        <span style={{ fontSize: '12.5px', fontWeight: 600, color: C.t87, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '260px' }}>{req.title}</span>
        <StatusPill bg={st.bg} color={st.color}>{st.label}</StatusPill>
        {(req.tokens_in > 0 || req.tokens_out > 0) && (
          <span style={{ fontSize: '11px', color: C.t58 }}>in {fmtTok(req.tokens_in)} · out {fmtTok(req.tokens_out)}</span>
        )}
        {req.report && <span onClick={() => onReport(req)} style={{ cursor: 'pointer', display: 'inline-flex' }}><ReportBadge /></span>}
      </div>
      <div style={{ flex: 1, borderTop: `1px dashed ${C.goldBorder}` }} />
    </div>
  );
}

// 입력 바 내장 전송 대상 pill — 클릭하면 팀장 포함 전체 직원 선택 드롭업
export function TargetPill({ effTarget, targetName, setTarget }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const chanOf = (a) => (a.kind === 'main' ? 'main' : `sub:${a.id}`);
  return (
    <span ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <span onClick={() => setOpen(o => !o)}
        title={effTarget === 'main' ? t('클릭해서 전송 대상 선택') : `${targetName}${t('에게 갑니다 — 클릭해서 변경')}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', background: effTarget === 'main' ? C.ceramic : C.mint, borderRadius: '50px', padding: '5px 12px', fontSize: '12px', fontWeight: 700, color: C.heading }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style={{ color: C.t58 }}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></svg>
        {targetName}
        {effTarget !== 'main' && (
          <span onClick={(e) => { e.stopPropagation(); setTarget('main'); setOpen(false); }} title={t('팀장에게로 되돌리기')} style={{ cursor: 'pointer', fontWeight: 700, color: C.t58 }}>✕</span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style={{ color: C.t58 }}><path d="m18 15-6-6-6 6" /></svg>
      </span>
      {open && (
        <div style={{ position: 'absolute', bottom: 'calc(100% + 16px)', left: '-6px', minWidth: '250px', background: '#fff', borderRadius: '12px', boxShadow: C.popShadow, padding: '6px', zIndex: 70 }}>
          <div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.08em', color: C.t58, padding: '4px 10px' }}>{t('전송 대상 선택')}</div>
          {store.agents.map(a => {
            const active = chanOf(a) === effTarget;
            return (
              <div key={a.id} onClick={() => { setTarget(chanOf(a)); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer', background: active ? C.mint : 'transparent' }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f9f9f9'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: a.kind === 'main' ? C.dark : C.cta, flexShrink: 0 }} />
                <span style={{ fontSize: '13.5px', fontWeight: 600, color: C.heading, whiteSpace: 'nowrap', flexShrink: 0 }}>{a.name}</span>
                <span style={{ fontSize: '11.5px', color: C.t58, marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '150px' }}>{a.kind === 'main' ? t('팀장') : a.role || t('팀원')}</span>
                {active && <span style={{ fontSize: '12px', fontWeight: 700, color: C.cta }}>✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </span>
  );
}

// 방 피드 — 해당 채널의 전 대화(대표/팀장/팀원, 위임, 카드, 시스템 배지)를 시간순으로
export function RoomFeed({ channel, inCard = false }) {
  const ref = useRef(null);
  const [reportReq, setReportReq] = useState(null);
  const [cfgAgentId, setCfgAgentId] = useState(null); // 아바타 클릭 → 팀원 설정 팝업
  const msgs = store.messages[channel] || [];
  const reqById = Object.fromEntries(store.requests.map(r => [r.id, r]));
  // 이 방에서 발원한 작업만 인디케이터 표시
  const roomActive = store.agents.filter(a => a.status !== 'idle' && (a.work_channel || 'main') === channel);
  useEffect(() => { loadChannel(channel); }, [channel]);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [msgs[msgs.length - 1]?.id, roomActive.length, channel]);
  const older = useOlderOnScroll(ref, channel);
  const mobile = window.innerWidth < 840;
  const listH = mobile ? 'calc(100dvh - 200px)' : `calc(100vh - ${inCard ? 250 : 244}px)`;

  let lastReqId = null;
  const rows = [];
  for (const row of groupProgress(msgs)) {
    const first = row.progress ? row.items[0] : row.m;
    if (first.request_id != null && first.request_id !== lastReqId) {
      lastReqId = first.request_id;
      rows.push({ divider: reqById[first.request_id] || { id: first.request_id, title: '', status: 'active' } });
    }
    rows.push(row);
  }

  return (
    <div ref={ref} onScroll={older.onScroll} style={{ overflowY: 'auto', height: listH, display: 'flex', flexDirection: 'column', gap: '18px', padding: inCard ? '16px 14px' : '4px 2px' }}>
      <OlderSpin busy={older.busy} />
      {rows.map((r, i) => {
        if (r.divider) return <ReqDivider key={`d${r.divider.id}-${i}`} req={r.divider} onReport={setReportReq} />;
        if (r.progress) return <ProgressFold key={`p${r.items[0].id}`} group={r} />;
        const m = r.m;
        if (m.kind === 'report') {
          return (
            <div key={m.id} style={{ display: 'flex', gap: '9px', alignItems: 'flex-start' }}>
              <MsgAvatar name={m.from_actor} onOpenCfg={setCfgAgentId} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                <div style={{ fontSize: '11.5px', color: C.t58, marginBottom: '3px' }}>{fmtTime(m.ts)}</div>
                <ReportLinkCard m={m} />
              </div>
            </div>
          );
        }
        if (m.kind === 'system') {
          return (
            <div key={m.id} style={{ alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: '8px', background: C.ceramic, borderRadius: '50px', padding: '5px 16px', margin: '2px 0' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: C.t58 }}>{m.content.text}</span>
              <span style={{ fontSize: '10.5px', color: C.t58 }}>{fmtTime(m.ts)}</span>
            </div>
          );
        }
        if (m.from_actor === 'User') {
          return (
            <div key={m.id} style={{ display: 'flex', gap: '9px', justifyContent: 'flex-end', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 0, maxWidth: 'calc(100% - 43px)' }}>
                <div style={{ fontSize: '11.5px', color: C.t58, marginBottom: '3px' }}>{fmtTime(m.ts)}</div>
                <div style={{ maxWidth: '100%', background: C.cta, color: '#fff', borderRadius: '16px 16px 4px 16px', padding: '10px 15px', fontSize: '14px', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
                  <span style={{ fontWeight: 700, color: '#d4e9e2' }}>{actorLabel(m.to_actor)}</span>{' '}
                  <Linkify text={m.content.text} light />
                </div>
                {(m.content.pastes || []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px', justifyContent: 'flex-end' }}>
                    {m.content.pastes.map((pp, i) => <PasteChip key={i} p={pp} idx={i} />)}
                  </div>
                )}
                <Attachments atts={m.content.attachments} align="flex-end" />
              </div>
              <MsgAvatar name="User" />
            </div>
          );
        }
        const Card = CARDS[m.kind];
        // 수신자 표시 — 호칭 없이 이름만
        const recvName = m.to_actor === 'User' ? t('대표') : actorLabel(m.to_actor);
        return (
          <div key={m.id} style={{ display: 'flex', gap: '9px', alignItems: 'flex-start' }}>
            <MsgAvatar name={m.from_actor} onOpenCfg={setCfgAgentId} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '11.5px', color: C.t58, marginBottom: '3px' }}>
                {fmtTime(m.ts)}
                {Card && <span style={{ fontWeight: 600, color: C.goldText }}> · {t(CARD_TITLES[m.kind])}</span>}
              </div>
              <div style={{ width: '100%', maxWidth: Card ? '620px' : '82%' }}>
                {Card
                  ? <Card m={m} answer={answerByMessage(m)} />
                  : (
                    <div style={{ background: '#fff', borderRadius: '4px 16px 16px 16px', boxShadow: C.cardShadow, padding: '10px 15px', fontSize: '14px', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
                      <span style={{ fontWeight: 700, color: C.cta }}>{recvName}</span>{' '}
                      <AgentText text={m.content.text} />
                      {m.to_actor === 'User' && <InlineImages text={m.content.text} />}
                      {m.to_actor === 'User' && <HtmlChips text={m.content.text} />}
                      <Attachments atts={m.content.attachments} />
                    </div>
                  )}
              </div>
            </div>
          </div>
        );
      })}
      {msgs.length === 0 && <div style={{ color: C.t58, fontSize: '13.5px', alignSelf: 'center', marginTop: '40px' }}>{isEn() ? 'No messages yet — send the first request below.' : '아직 대화가 없습니다. 아래 입력창에서 첫 요청을 보내보세요.'}</div>}
      <WorkingDock actives={roomActive} channel={channel} />
      {reportReq && <ReportModal requestId={reportReq.id} report={reportReq.report} onClose={() => setReportReq(null)} />}
      {cfgAgentId != null && (() => {
        const a = store.agents.find(x => x.id === cfgAgentId);
        if (!a) return null;
        return (
          <Modal onClose={() => setCfgAgentId(null)} maxWidth="640px">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '15.5px', fontWeight: 700, color: C.heading, whiteSpace: 'nowrap', flexShrink: 0 }}>{a.name}</span>
              <span style={{ fontSize: '12.5px', color: C.t58 }}>{a.kind === 'main' ? t('팀장') : a.role}</span>
            </div>
            <CfgPanel agent={a} />
          </Modal>
        );
      })()}
    </div>
  );
}

// ---- 데스크탑 좌측 채팅방 목록 패널 ----
export function RoomList({ current }) {
  const [editing, setEditing] = useState(null); // 이름 변경 중인 channel
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const rooms = store.threads || [];
  const create = async () => {
    try {
      const t = await api.post('/threads', { title: newTitle.trim() });
      setCreating(false); setNewTitle('');
      nav('chat', t.channel);
    } catch (e) { showToast(e.message); }
  };
  const rename = async (channel) => {
    try { await api.post(`/threads/${encodeURIComponent(channel)}/rename`, { title: draft.trim() }); setEditing(null); }
    catch (e) { showToast(e.message); }
  };
  const remove = async (th) => {
    if (!confirm(isEn() ? `Delete room "${th.title}"?\nIts history and memory will be erased.` : `"${th.title}" 방을 삭제할까요?\n이 방의 대화 이력과 기억이 모두 삭제됩니다.`)) return;
    try {
      await api.del(`/threads/${encodeURIComponent(th.channel)}`);
      if (th.channel === current) nav('chat', 'main');
    } catch (e) { showToast(e.message); }
  };
  return (
    <aside style={{ ...card({ padding: '12px 8px' }), width: '212px', flexShrink: 0, position: 'sticky', top: '88px' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '2px 10px 10px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: C.t58, flex: 1 }}>{t('채팅방')}</span>
        <span onClick={() => { setCreating(!creating); setNewTitle(''); }} title={t("새 채팅방")}
          style={{ cursor: 'pointer', fontSize: '16px', fontWeight: 700, color: C.cta, lineHeight: 1, padding: '0 4px' }}>+</span>
      </div>
      {creating && (
        <div style={{ display: 'flex', gap: '5px', padding: '0 6px 8px' }}>
          <input value={newTitle} onInput={e => setNewTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }}
            placeholder={t("방 이름")} autoFocus
            style={{ flex: 1, border: `1px solid ${C.line}`, borderRadius: '8px', padding: '6px 9px', fontSize: '12.5px', fontFamily: 'inherit', minWidth: 0 }} />
          <Btn variant="primary" small onClick={create}>{t('생성')}</Btn>
        </div>
      )}
      {rooms.map(th => {
        const active = th.channel === current;
        const unread = unreadCount(th.channel);
        if (editing === th.channel) {
          return (
            <div key={th.channel} style={{ display: 'flex', gap: '5px', padding: '4px 6px' }}>
              <input value={draft} onInput={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') rename(th.channel); }} autoFocus
                style={{ flex: 1, border: `1px solid ${C.cta}`, borderRadius: '8px', padding: '6px 9px', fontSize: '12.5px', fontFamily: 'inherit', minWidth: 0 }} />
              <Btn variant="primary" small onClick={() => rename(th.channel)}>{t('저장')}</Btn>
            </div>
          );
        }
        return (
          <div key={th.channel} onClick={() => nav('chat', th.channel)}
            style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 10px', borderRadius: '8px', cursor: 'pointer', background: active ? C.mint : 'transparent' }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f9f9f9'; e.currentTarget.querySelectorAll('[data-act]').forEach(el => el.style.opacity = 1); }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; e.currentTarget.querySelectorAll('[data-act]').forEach(el => el.style.opacity = 0); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={active ? C.cta : C.t58} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ flexShrink: 0 }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <span style={{ fontSize: '13px', fontWeight: active ? 700 : 600, color: C.heading, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{th.title || th.channel}</span>
            {unread > 0 && <span style={{ background: C.cta, color: '#fff', fontSize: '10px', fontWeight: 700, borderRadius: '50px', padding: '1px 6px', flexShrink: 0 }}>{unread}</span>}
            {(
              <span data-act onClick={(e) => { e.stopPropagation(); setEditing(th.channel); setDraft(th.title || ''); }} title={t("이름 변경")}
                style={{ opacity: 0, cursor: 'pointer', color: C.t58, fontSize: '12px', flexShrink: 0, transition: 'opacity 0.15s' }}>✎</span>
            )}
            {th.channel !== 'main' && (
              <span data-act onClick={(e) => { e.stopPropagation(); remove(th); }} title={t("방 삭제 (이력·기억 포함)")}
                style={{ opacity: 0, cursor: 'pointer', color: C.t58, fontSize: '12px', flexShrink: 0, transition: 'opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.color = C.danger; }}
                onMouseLeave={e => { e.currentTarget.style.color = C.t58; }}>✕</span>
            )}
          </div>
        );
      })}
    </aside>
  );
}
// ---- 채팅방 셀렉터 — 팀 채팅 + 팀장 방들(방별 독립 세션) 드롭다운 (모바일) ----
export function ThreadSwitcher({ current, onPick, light = false }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setCreating(false); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const rooms = store.threads || [];
  const cur = rooms.find(x => x.channel === current);
  const create = async () => {
    try {
      const t = await api.post('/threads', { title: title.trim() });
      setOpen(false); setCreating(false); setTitle('');
      onPick(t.channel);
    } catch (e) { showToast(e.message); }
  };
  const remove = async (e, th) => {
    e.stopPropagation();
    if (!confirm(isEn() ? `Delete room "${th.title}"?\nIts history and memory will be erased.` : `"${th.title}" 방을 삭제할까요?\n이 방의 대화 이력과 기억이 모두 삭제됩니다.`)) return;
    try {
      await api.del(`/threads/${encodeURIComponent(th.channel)}`);
      if (th.channel === current) onPick('main');
    } catch (err) { showToast(err.message); }
  };
  const pillStyle = light
    ? { background: C.ceramic, color: C.heading }
    : { background: 'rgba(255,255,255,0.12)', color: '#fff' };
  return (
    <span ref={ref} style={{ position: 'relative' }}>
      <span onClick={() => setOpen(o => !o)} title={t('채팅방 — 방마다 대화 기억이 독립됩니다')}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', borderRadius: '50px', padding: '5px 13px', fontSize: '12.5px', fontWeight: 700, whiteSpace: 'nowrap', ...pillStyle }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        {cur?.title || (isEn() ? 'Main chat' : '메인 채팅')}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style={{ opacity: 0.7 }}><path d="m6 9 6 6 6-6" /></svg>
      </span>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 10px)', left: 0, minWidth: '260px', background: '#fff', borderRadius: '12px', boxShadow: C.popShadow, padding: '6px', zIndex: 80 }}>
          <div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.08em', color: C.t58, padding: '4px 10px' }}>{t('채팅방 — 방마다 기억 독립')}</div>
          {rooms.map(th => (
            <div key={th.channel} onClick={() => { onPick(th.channel); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer', background: th.channel === current ? C.mint : 'transparent' }}
              onMouseEnter={e => { if (th.channel !== current) e.currentTarget.style.background = '#f9f9f9'; }}
              onMouseLeave={e => { if (th.channel !== current) e.currentTarget.style.background = 'transparent'; }}>

              <span style={{ fontSize: '13.5px', fontWeight: 600, color: C.heading, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{th.title || th.channel}</span>
              {th.channel === current && <span style={{ fontSize: '12px', fontWeight: 700, color: C.cta }}>✓</span>}
              {th.channel !== 'main' && (
                <span onClick={(e) => remove(e, th)} title={t("방 삭제 (이력·기억 포함)")}
                  style={{ cursor: 'pointer', color: C.t58, fontSize: '13px', padding: '0 3px', flexShrink: 0 }}
                  onMouseEnter={e => { e.currentTarget.style.color = C.danger; }}
                  onMouseLeave={e => { e.currentTarget.style.color = C.t58; }}>✕</span>
              )}
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${C.line}`, marginTop: '4px', paddingTop: '6px' }}>
            {!creating ? (
              <div onClick={() => setCreating(true)} style={{ padding: '8px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, color: C.cta }}>{t('+ 새 채팅방')}</div>
            ) : (
              <div style={{ display: 'flex', gap: '6px', padding: '4px 6px' }}>
                <input value={title} onInput={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }}
                  placeholder={t("방 이름")} autoFocus
                  style={{ flex: 1, border: `1px solid ${C.line}`, borderRadius: '8px', padding: '7px 10px', fontSize: '13px', fontFamily: 'inherit', minWidth: 0 }} />
                <Btn variant="primary" small onClick={create}>{t('생성')}</Btn>
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

// 대화 상대 셀렉터 — 드롭다운 (팀원이 많아져도 한 줄 고정, 모바일 대응)
// dark: 헤더 밴드용 스타일, subtitle: 이름 아래 보조 정보(모델·모드 등)
export function AgentSwitcher({ current, dark = false, subtitle = null }) {
  const [open, setOpen] = useState(false);
  const main = store.agents.find(a => a.kind === 'main');
  const subs = store.agents.filter(a => a.kind === 'sub');
  if (!main) return null;
  const all = [main, ...subs];
  const cur = current === 'main' ? main : subs.find(a => String(a.id) === current) || main;
  const curSt = agentStatus(cur.status);
  const go = (a) => {
    setOpen(false);
    const target = a.kind === 'main' ? 'main' : String(a.id);
    if (target !== current) location.hash = a.kind === 'main' ? '#/chat' : `#/subs/${a.id}`;
  };
  const trigger = dark ? (
    <div onClick={() => setOpen(!open)} style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '2px 4px' }}>
      <span style={dotStyle(cur.status === 'idle' ? C.mint : curSt.dot, 8, cur.status === 'working')} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: 700, color: '#fff' }}>
          {cur.name} {I.chevron(11, 'rgba(255,255,255,0.7)')}
        </div>
        {subtitle && <div style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.6)', marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>}
      </div>
    </div>
  ) : (
    <div onClick={() => setOpen(!open)} style={{
      display: 'inline-flex', alignItems: 'center', gap: '8px', border: `1px solid ${C.border}`,
      borderRadius: '50px', padding: '6px 14px', cursor: 'pointer', background: '#fff',
      fontSize: '13px', fontWeight: 600, transition: 'all 0.2s ease',
    }}>
      <span style={dotStyle(curSt.dot, 8, cur.status === 'working')} />
      <span style={{ color: C.heading }}>{cur.name}</span>
      <span style={{ fontSize: '11.5px', color: C.t58 }}>{cur.kind === 'main' ? '팀장' : cur.role || '팀원'}</span>
      {I.chevron(11)}
    </div>
  );
  return (
    <div style={{ position: 'relative', alignSelf: 'flex-start', minWidth: 0 }}>
      {trigger}
      {open && (
        <>
          {/* 바깥 클릭 닫기 */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 65 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 70,
            width: 'min(340px, calc(100vw - 40px))', background: '#fff', borderRadius: '12px',
            boxShadow: C.popShadow, padding: '6px', maxHeight: '50vh', overflowY: 'auto',
          }}>
            <div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.08em', color: C.t58, padding: '6px 10px' }}>대화 상대 선택</div>
            {all.map(a => {
              const active = a === cur;
              const st = agentStatus(a.status);
              const sub = a.status === 'waiting' ? '응답 대기 중'
                : a.status === 'working' ? (a.current_task || '작업 중')
                : (a.kind === 'main' ? '팀장' : a.role || '대기');
              return (
                <div key={a.id} onClick={() => go(a)} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 10px',
                  borderRadius: '8px', cursor: 'pointer', background: active ? C.mint : 'transparent',
                }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f9f9f9'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                  <span style={dotStyle(st.dot, 8, a.status === 'working')} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13.5px', fontWeight: 600, color: C.heading }}>{a.name}</div>
                    <div style={{ fontSize: '11.5px', color: a.status === 'waiting' ? C.goldText : C.t58, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
                  </div>
                  {active && <span style={{ fontSize: '11px', fontWeight: 700, color: C.heading, flexShrink: 0 }}>대화 중</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// 전송 대기 이미지의 미리보기 URL 캐시 (파일 객체당 1회 생성)
const previewUrls = new WeakMap();
const previewUrl = (f) => {
  if (!previewUrls.has(f)) previewUrls.set(f, URL.createObjectURL(f));
  return previewUrls.get(f);
};

export function ChatInput({ channel, target = null, placeholder, inCard = false, noRedirect = false, onRouted = null, leading = null }) {
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState([]);   // 전송 대기 첨부 (n건)
  const [pastes, setPastes] = useState([]); // 전송 대기 붙여넣기 텍스트 [{text, lines}]
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [zoom, setZoom] = useState(null);   // 확대 중인 이미지 URL
  const fileRef = useRef(null);

  // 화면 어디에나 파일을 끌어다 놓으면 첨부 대기열에 추가 (채팅 화면에서만 활성)
  useEffect(() => {
    const onOver = (e) => {
      if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragOver(true); }
    };
    const onLeave = (e) => { if (!e.relatedTarget) setDragOver(false); };
    const onDrop = (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      setDragOver(false);
      setFiles(prev => [...prev, ...e.dataTransfer.files]);
    };
    // 클립보드 이미지 붙여넣기(Ctrl/Cmd+V) → 첨부 대기열
    const onPaste = (e) => {
      const items = e.clipboardData?.items || [];
      const imgs = [];
      for (const it of items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) imgs.push(new File([f], `붙여넣기-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${(f.type.split('/')[1] || 'png')}`, { type: f.type }));
        }
      }
      if (imgs.length) { e.preventDefault(); setFiles(prev => [...prev, ...imgs]); return; }
      // 긴 텍스트 붙여넣기(채팅 입력창에 포커스일 때만) → 원문은 칩으로, 입력창은 깨끗하게
      const ae = document.activeElement;
      if ((ae?.tagName === 'INPUT' || ae?.tagName === 'TEXTAREA') && ae.placeholder === placeholder) {
        const txt = e.clipboardData?.getData('text') || '';
        const lines = txt.split('\n').length;
        if (lines >= 8 || txt.length > 600) {
          e.preventDefault();
          setPastes(prev => [...prev, { text: txt, lines }]);
        }
      }
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  const send = async () => {
    const text = draft.trim();
    if ((!text && files.length === 0 && pastes.length === 0) || sending) return;
    setSending(true);
    try {
      // 1) 첨부 업로드 (있으면)
      let attachments = [];
      if (files.length) {
        const fd = new FormData();
        for (const f of files) fd.append('files', f);
        const up = await fetch(currentBase() + '/api/upload', { method: 'POST', body: fd });
        if (!up.ok) throw new Error('파일 업로드 실패');
        attachments = await up.json();
      }
      // 2) 메시지 전송 — team 채널은 target(수신 대상)을 함께 전달
      const r = await api.post(`/chat/${encodeURIComponent(channel)}`, { text, attachments, ...(pastes.length ? { pastes } : {}), ...(target ? { target } : {}) });
      setDraft(''); setFiles([]); setPastes([]);
      if (channel === 'team') {
        // 팀 채팅은 제자리 유지 — @지목으로 대상이 바뀌었으면 pill 고정만 갱신
        if (r.target && r.target !== target) { showToast('지목한 직원에게 전달했습니다.'); onRouted?.(r.target); }
      } else if (r.channel && r.channel !== channel) {
        // 1:1 방에서 "@이름 …"로 다른 에이전트 지목 — 해당 채팅으로 이동
        showToast('지목한 직원에게 전달했습니다.');
        if (noRedirect) onRouted?.(r.channel);
        else location.hash = r.channel === 'main' ? '#/chat' : `#/subs/${r.channel.split(':')[1]}`;
      }
    } catch (e) { showToast(e.message); }
    setSending(false);
  };

  // @자동완성 — 입력 끝의 "@..." 프리픽스로 호출 가능한 팀장·직원 목록 필터
  const mention = draft.match(/@(\S*)$/);
  const candidates = mention
    ? store.agents.filter(a => a.name.toLowerCase().startsWith(mention[1].toLowerCase()))
    : [];
  // 대상 고정 모드(통합 팀 채팅)에선 @지목 즉시 pill 전환 — 본문에서 @이름은 제거
  const routeMention = (name) => {
    const a = store.agents.find(x => x.name === name);
    if (!a || !onRouted) return false;
    onRouted(a.kind === 'main' ? 'main' : `sub:${a.id}`);
    return true;
  };
  const pickMention = (name) => {
    setDraft(routeMention(name) ? draft.replace(/@\S*$/, '') : draft.replace(/@\S*$/, `@${name} `));
    (document.querySelector(`textarea[placeholder="${placeholder}"]`) || document.querySelector(`input[placeholder="${placeholder}"]`))?.focus();
  };
  const onInputText = (v) => {
    const m = onRouted && v.match(/(?:^|\s)@(\S+)\s$/);
    if (m && routeMention(m[1])) { setDraft(v.replace(/@\S+\s$/, '')); return; }
    setDraft(v);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', position: 'relative' }}>
      {dragOver && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 130, background: 'rgba(30,57,50,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ border: '2px dashed #d4e9e2', borderRadius: '16px', padding: '36px 56px', textAlign: 'center', color: '#fff' }}>
            <div style={{ fontSize: '18px', fontWeight: 700 }}>{t('여기에 놓아 첨부')}</div>
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.75)', marginTop: '6px' }}>{t('파일·이미지를 끌어다 놓으면 전송 대기열에 추가됩니다')}</div>
          </div>
        </div>
      )}
      {mention && candidates.length > 0 && (
        <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '8px', minWidth: '240px', maxWidth: '340px', background: '#fff', borderRadius: '12px', boxShadow: C.popShadow, padding: '6px', zIndex: 70 }}>
          <div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.08em', color: C.t58, padding: '4px 10px' }}>{t('호출 가능한 직원')}</div>
          {candidates.map(a => (
            <div key={a.id} onClick={() => pickMention(a.name)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f9f9f9'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: a.kind === 'main' ? C.dark : C.cta, flexShrink: 0 }} />
              <span style={{ fontSize: '13.5px', fontWeight: 600, color: C.heading, whiteSpace: 'nowrap', flexShrink: 0 }}>{a.name}</span>
              <span style={{ fontSize: '11.5px', color: C.t58, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {a.kind === 'main' ? t('팀장') : (a.role || t('팀원')).split(/[—(]/)[0].trim().slice(0, 28)}
              </span>
            </div>
          ))}
        </div>
      )}
      {pastes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '0 8px', alignItems: 'center' }}>
          {pastes.map((pp, i) => <PasteChip key={i} p={pp} idx={i} onRemove={() => setPastes(pastes.filter((_, j) => j !== i))} />)}
        </div>
      )}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '0 8px', alignItems: 'center' }}>
          {files.map((f, i) => f.type?.startsWith('image/') ? (
            // 이미지: 파일명 대신 썸네일 — 클릭하면 확대
            <span key={i} style={{ position: 'relative', display: 'inline-flex' }}>
              <img src={previewUrl(f)} alt={f.name} onClick={() => setZoom(previewUrl(f))}
                style={{ width: '54px', height: '54px', objectFit: 'cover', borderRadius: '10px', border: `1px solid ${C.line}`, cursor: 'zoom-in', display: 'block' }} />
              <span onClick={() => setFiles(files.filter((_, j) => j !== i))} title={t('첨부 제거')}
                style={{ position: 'absolute', top: '-6px', right: '-6px', width: '17px', height: '17px', borderRadius: '50%', background: C.dark, color: '#fff', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>✕</span>
            </span>
          ) : (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: C.mint, borderRadius: '50px', padding: '4px 12px', fontSize: '12.5px', fontWeight: 600, color: C.heading }}>
              {f.name}
              <span onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{ cursor: 'pointer', fontWeight: 700 }}>✕</span>
            </span>
          ))}
        </div>
      )}
      {zoom && (
        <div onClick={() => setZoom(null)} style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(20,33,28,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', padding: '28px' }}>
          <img src={zoom} style={{ maxWidth: '94%', maxHeight: '94%', borderRadius: '12px', boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: '#fff', borderRadius: '24px', boxShadow: inCard ? 'none' : C.cardShadow, border: inCard ? `1px solid ${C.border}` : 'none', padding: '8px 8px 8px 14px' }}>
        {/* 전송 대상 pill 등 입력 바 내장 슬롯 */}
        {leading}
        {/* 첨부 버튼 (파일·이미지 n건) */}
        <div onClick={() => fileRef.current?.click()} title={t("파일·이미지 첨부")}
          style={{ cursor: 'pointer', flexShrink: 0, display: 'inline-flex', padding: '6px', borderRadius: '50%', color: C.t58 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
        </div>
        <input type="file" multiple hidden ref={fileRef}
          onChange={e => { setFiles([...files, ...e.target.files]); e.target.value = ''; }} />
        <textarea value={draft} rows={1}
          onInput={e => { onInputText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`; }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); e.target.style.height = 'auto'; } }}
          placeholder={placeholder}
          style={{ flex: 1, border: 'none', outline: 'none', fontSize: '14.5px', background: 'transparent', minWidth: 0, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: '132px', padding: '0', display: 'block' }} />
        <Btn variant="primary" onClick={send}>{sending ? t('전송 중…') : t('보내기')}</Btn>
      </div>
    </div>
  );
}

export function ChatScreen({ openGoal, param }) {
  const [tab, setTab] = useState('chat');
  // 고정 전송 대상 — @지목/pill 선택 시 바뀌고, 방 전환 시 팀장으로 복귀
  const [target, setTarget] = useState('main');
  // 채팅방 — 방마다 독립 세션(기억). 라우팅: #/chat (기본 방) 또는 #/chat/<channel>
  // 삭제됐거나 알 수 없는 방이면 기본 방으로 폴백
  const raw = param && (param === 'main' || param.startsWith('main:')) ? param : 'main';
  const room = raw === 'main' || (store.threads || []).some(x => x.channel === raw) ? raw : 'main';
  useEffect(() => { setTarget('main'); }, [room]); // 방 전환 시 전송 대상 초기화
  const targetAgent = target === 'main'
    ? store.agents.find(a => a.kind === 'main')
    : store.agents.find(a => String(a.id) === target.split(':')[1]);
  const effTarget = targetAgent ? target : 'main'; // 대상이 해고됐으면 팀장 복귀
  const targetName = (targetAgent || store.agents.find(a => a.kind === 'main'))?.name || t('팀장');
  const [cfgOpen, setCfgOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false); // 대화 초기화 방식 선택 팝업
  const [avatarDraft, setAvatarDraft] = useState(null);
  const [mdEditing, setMdEditing] = useState(false);
  const [mdDraft, setMdDraft] = useState('');
  const [platformMd, setPlatformMd] = useState(null); // 열람 중이면 내용, 아니면 null
  const [nameDraft, setNameDraft] = useState(null);
  const main = store.agents.find(a => a.kind === 'main') || {};
  const modeLabelText = MODES.find(m => m.key === store.mode)?.label || store.mode;

  const setMode = (mode) => api.post('/mode', { mode }).catch(e => showToast(e.message));
  const [cfgBusy, setCfgBusy] = useState(null); // 클릭한 pill 키 — 반영까지 스피너
  const withBusy = (key, p) => { setCfgBusy(key); Promise.resolve(p).catch(e => showToast(e.message)).finally(() => setTimeout(() => setCfgBusy(null), 250)); };
  const setCfg = (patch) => api.post(`/agents/${main.id}/config`, patch).catch(e => showToast(e.message));
  // 방별 스펙 오버라이드 (빈 값 = 기본값 따름)
  const curThread = (store.threads || []).find(x => x.channel === room);
  const setRoomCfg = (patch) => api.post(`/threads/${encodeURIComponent(room)}/config`, patch).catch(e => showToast(e.message));
  const roomModel = curThread?.model || main.model;
  const roomEffort = curThread?.effort || main.effort;
  const saveMd = async () => {
    await api.post('/claude-md', { content: mdDraft }).catch(e => showToast(e.message));
    setMdEditing(false);
  };
  const togglePlatform = async () => {
    if (platformMd != null) { setPlatformMd(null); return; }
    try { setPlatformMd((await api.get('/platform-prompt')).content); } catch (e) { showToast(e.message); }
  };

  const mobile = window.innerWidth < 840;

  // A안 — 통합 헤더 밴드: 대화상대 셀렉터 + 탭 세그먼트 + 설정·목표 아이콘
  const segStyle = (on) => ({
    borderRadius: '50px', padding: '5px 15px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer',
    background: on ? '#fff' : 'transparent', color: on ? C.dark : 'rgba(255,255,255,0.65)',
    transition: 'all 0.15s ease', whiteSpace: 'nowrap',
  });
  const iconBtn = (active) => ({
    width: mobile ? '26px' : '30px', height: mobile ? '26px' : '30px', borderRadius: '50%', cursor: 'pointer', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: active ? '#fff' : 'rgba(255,255,255,0.12)', color: active ? C.dark : 'rgba(255,255,255,0.85)',
  });
  const roomTitle = (store.threads || []).find(x => x.channel === room)?.title || (isEn() ? 'Main chat' : '메인 채팅');
  const band = (
    <div style={{ background: C.dark, color: '#fff', padding: mobile ? '8px 10px' : '10px 14px', display: 'flex', alignItems: 'center', gap: mobile ? '6px' : '10px', flexWrap: mobile ? 'nowrap' : 'wrap', borderRadius: mobile ? '12px' : '0' }}>
      {mobile ? (
        // 모바일: 방 드롭다운이 곧 타이틀 — 남는 폭을 차지하되 줄바꿈 없이 축소
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <ThreadSwitcher current={room} onPick={(ch) => nav('chat', ch)} />
        </div>
      ) : (
        // 데스크탑: 좌측 방 목록이 전환 담당 — 밴드엔 방 이름 + 담당(팀장) 정보
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{roomTitle}</div>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.65)', marginTop: '1px' }}>{main.name || t('팀장')} · {modelLabel(roomModel)} · {roomEffort}{curThread?.model || curThread?.effort ? (isEn() ? ' (room)' : ' (방 전용)') : ''} · {modeLabelText}</div>
        </div>
      )}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: mobile ? '5px' : '8px', flexShrink: 0 }}>
        <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.12)', borderRadius: '50px', padding: '3px' }}>
          <div onClick={() => setTab('chat')} style={{ ...segStyle(tab === 'chat'), ...(mobile ? { padding: '4px 10px', fontSize: '11.5px' } : {}) }}>{t('대화')}</div>
          <div onClick={() => setTab('md')} style={{ ...segStyle(tab === 'md'), ...(mobile ? { padding: '4px 10px', fontSize: '11.5px' } : {}) }}>{mobile ? 'MD' : 'CLAUDE.md'}</div>
        </div>
        <span onClick={async () => {
          try {
            const msgs = await api.get(`/chat/${encodeURIComponent(room)}`);
            const nameOf = (x) => (x === 'User' ? t('대표') : actorLabel(x));
            const lines = msgs.filter(m => m.kind !== 'system').map(m => {
              const time = new Date(m.ts).toLocaleString('ko-KR');
              let body = m.content?.text || '';
              if (m.kind === 'report') body = `[보고서] ${m.content?.title || ''} ${m.content?.subtitle || ''}`.trim();
              else if (m.kind !== 'text') body = `[${t(CARD_TITLES[m.kind] || m.kind)}] ${body}${m.answered ? `\n→ 답변: ${m.answer?.label || m.answer?.decision || JSON.stringify(m.answer || {}).slice(0, 80)}` : ' (미답변)'}`;
              for (let i = 0; i < (m.content?.pastes || []).length; i++) body += `\n\n[붙여넣은 텍스트 ${i + 1} — ${m.content.pastes[i].lines}줄]\n${m.content.pastes[i].text}`;
              return `### ${nameOf(m.from_actor)} → ${nameOf(m.to_actor)} · ${time}\n\n${body}`;
            });
            const md = `# ${roomTitle} — 대화 내보내기 (${new Date().toLocaleString('ko-KR')})\n\n${lines.join('\n\n---\n\n')}\n`;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
            a.download = `${roomTitle}-대화-${new Date().toISOString().slice(0, 10)}.md`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
          } catch (e) { showToast(e.message); }
        }} title={isEn() ? 'Export this room as Markdown' : '대화 내보내기 — 이 방의 대화를 Markdown 파일로 저장'} style={iconBtn(false)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
        </span>
        <span onClick={() => setClearOpen(true)} title={isEn() ? 'Clear conversation' : '대화 초기화'} style={iconBtn(false)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
        </span>
        <span data-cfg-toggle onClick={() => setCfgOpen(!cfgOpen)} title={t('팀장 설정 (모드·모델·effort·이름)')} style={iconBtn(cfgOpen)}>{I.settings(15)}</span>
        <span onClick={openGoal} title={t('목표 수정')} style={iconBtn(false)}>{I.target(15)}</span>
      </div>
    </div>
  );

  const cfgPanel = cfgOpen && (
    <Modal onClose={() => setCfgOpen(false)} maxWidth="680px">
        <div style={{ fontSize: '15.5px', fontWeight: 700, color: C.heading, marginBottom: '14px' }}>{t('팀장 설정')} — {roomTitle}</div>
        <div data-cfg-panel style={{ display: 'flex', gap: '22px 28px', flexWrap: 'wrap' }}>
          <div style={{ width: '100%' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58, marginBottom: '8px' }}>NAME</div>
            <div style={{ display: 'flex', gap: '8px', maxWidth: '340px' }}>
              <Input value={nameDraft ?? main.name ?? ''} onInput={e => setNameDraft(e.target.value)} placeholder={t("팀장 이름")} style={{ flex: 1, width: 'auto', padding: '8px 12px' }} />
              <Btn variant="outline" small onClick={() => { if (nameDraft && nameDraft !== main.name) setCfg({ name: nameDraft }); }}>{t('변경')}</Btn>
              <Input value={avatarDraft ?? (main.avatar || '')} maxLength={4} onInput={e => setAvatarDraft(e.target.value)} placeholder={isEn() ? 'Avatar' : '아바타'} style={{ width: '76px', flex: 'none', padding: '8px 10px', textAlign: 'center' }} />
              <Btn variant="outline" small onClick={() => { if (avatarDraft != null) setCfg({ avatar: avatarDraft.trim() }); }}>{isEn() ? 'Avatar' : '아바타'}</Btn>
            </div>
            <div style={{ fontSize: '12px', color: C.t58, marginTop: '6px' }}>{t('이름을 정하면 채팅에서')} "@{nameDraft || main.name}" {t('으로 부를 수 있습니다.')}</div>
          </div>
          <div style={{ width: '100%' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: C.t58, marginBottom: '8px' }}>MODE</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {MODES.map(md => <SegPill key={md.key} active={store.mode === md.key} onClick={() => withBusy(`mode:${md.key}`, setMode(md.key))}>{cfgBusy === `mode:${md.key}` ? <Spin /> : null} {md.label}</SegPill>)}
            </div>
            <div style={{ fontSize: '12.5px', color: C.t58, marginTop: '8px' }}>{(() => { const md = MODES.find(m => m.key === store.mode); return md ? `${md.label} — ${t(md.desc)}` : ''; })()}</div>
          </div>
          {/* 이 방 전용 스펙 — 미지정(기본값)이면 아래 팀장 기본값 사용. 잡담 방은 저사양으로 토큰 절약 */}
          <div style={{ width: '100%', background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderRadius: '10px', padding: '12px 14px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: C.goldText, marginBottom: '4px' }}>
              {isEn() ? 'THIS ROOM — MODEL · EFFORT' : '이 방의 MODEL · EFFORT'}
            </div>
            <div style={{ fontSize: '12px', color: C.t58, marginBottom: '10px' }}>
              {isEn() ? 'Overrides for this room only. "Default" follows the Team Lead\'s base spec (Org chart).' : '이 방에서만 적용됩니다. "기본값"이면 팀장 기본 스펙(조직도)을 따릅니다.'}
            </div>
            <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '10.5px', fontWeight: 600, color: C.t58, marginBottom: '6px' }}>MODEL</div>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  <SegPill small active={!curThread?.model} onClick={() => withBusy('rm:', setRoomCfg({ model: '' }))}>{cfgBusy === 'rm:' ? <Spin /> : null} {isEn() ? 'Default' : '기본값'}</SegPill>
                  {modelOptions().map(mo => <SegPill key={mo.value} small active={curThread?.model === mo.value} onClick={() => withBusy(`rm:${mo.value}`, setRoomCfg({ model: mo.value }))}>{cfgBusy === `rm:${mo.value}` ? <Spin /> : null} {mo.label}</SegPill>)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '10.5px', fontWeight: 600, color: C.t58, marginBottom: '6px' }}>EFFORT</div>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  <SegPill small active={!curThread?.effort} onClick={() => withBusy('re:', setRoomCfg({ effort: '' }))}>{cfgBusy === 're:' ? <Spin /> : null} {isEn() ? 'Default' : '기본값'}</SegPill>
                  {effortOptions(curThread?.model || main.model).map(ef => <SegPill key={ef} small active={curThread?.effort === ef} onClick={() => withBusy(`re:${ef}`, setRoomCfg({ effort: ef }))}>{cfgBusy === `re:${ef}` ? <Spin /> : null} {ef}</SegPill>)}
                </div>
              </div>
            </div>
          </div>
        </div>
    </Modal>
  );

  const clearModal = clearOpen && (
    <Modal onClose={() => setClearOpen(false)} maxWidth="440px">
      <div style={{ fontSize: '16px', fontWeight: 700, color: C.heading }}>{t('대화 초기화')} — {roomTitle}</div>
      <div style={{ fontSize: '13px', color: C.t58, marginTop: '6px', marginBottom: '16px' }}>{isEn() ? 'Choose what to clear.' : '어떻게 지울지 선택하세요.'}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Btn variant="black" style={{ background: C.danger, justifyContent: 'center' }} onClick={() => {
          setClearOpen(false);
          api.post(`/threads/${encodeURIComponent(room)}/clear`, { memory: true }).catch(e => showToast(e.message));
        }}>{isEn() ? 'Erase messages + memory' : '전체 초기화 — 내용과 팀장 기억 모두 삭제'}</Btn>
        <div style={{ fontSize: '11.5px', color: C.t58, marginTop: '-4px', paddingLeft: '4px' }}>{isEn() ? 'Session restarts from scratch; pending cards are cancelled.' : '세션이 백지에서 다시 시작되고, 대기 중인 카드도 취소됩니다.'}</div>
        <Btn variant="darkOutline" style={{ justifyContent: 'center' }} onClick={() => {
          setClearOpen(false);
          api.post(`/threads/${encodeURIComponent(room)}/clear`, { memory: false }).catch(e => showToast(e.message));
        }}>{isEn() ? 'Clear messages only (keep memory)' : '내용만 지우기 — 화면 정리 (기억·작업 유지)'}</Btn>
        <div style={{ fontSize: '11.5px', color: C.t58, marginTop: '-4px', paddingLeft: '4px' }}>{isEn() ? 'The Team Lead keeps context; unanswered cards stay.' : '팀장의 기억과 진행 중 작업은 그대로, 미답변 카드는 남습니다.'}</div>
      </div>
    </Modal>
  );

  const mdView = (
        <div style={mobile ? card({ padding: '24px' }) : { padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '14px', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: C.heading }}>CLAUDE.md</div>
              <div style={{ fontSize: '12.5px', color: C.t58, marginTop: '2px' }}>{t('프로젝트 지침 (자유 편집) · 팀 구조 등 핵심 규칙은 플랫폼 지침으로 고정')}</div>
            </div>
            <Btn variant="darkOutline" small onClick={togglePlatform}>{platformMd != null ? t('플랫폼 지침 닫기') : t('플랫폼 지침 보기')}</Btn>
            {!mdEditing ? (
              <Btn variant="outline" small onClick={() => { setMdDraft(store.claude_md); setMdEditing(true); }}>{t('수정')}</Btn>
            ) : (
              <>
                <Btn variant="darkOutline" small onClick={() => setMdEditing(false)}>{t('취소')}</Btn>
                <Btn variant="primary" small onClick={saveMd}>{t('저장')}</Btn>
              </>
            )}
          </div>
          {platformMd != null && (
            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: C.goldText, background: C.goldLight, borderRadius: '50px', padding: '3px 10px' }}>{t('플랫폼 불변 지침 · 읽기전용')}</span>
                <span style={{ fontSize: '12px', color: C.t58 }}>{t('팀 구조·행동 원칙 — CLAUDE.md보다 항상 우선 적용')}</span>
              </div>
              <pre style={{ margin: 0, background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderRadius: '8px', padding: '18px', fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12.5px', lineHeight: 1.7, whiteSpace: 'pre-wrap', color: C.t87, maxHeight: '380px', overflowY: 'auto' }}>{platformMd}</pre>
            </div>
          )}
          {!mdEditing ? (
            <pre style={{ margin: 0, background: '#f9f9f9', border: `1px solid ${C.line}`, borderRadius: '8px', padding: '18px', fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '13px', lineHeight: 1.7, whiteSpace: 'pre-wrap', color: C.t87 }}>{store.claude_md}</pre>
          ) : (
            <textarea value={mdDraft} onInput={e => setMdDraft(e.target.value)} rows={18}
              style={{ width: '100%', background: '#fff', border: `1px solid ${C.cta}`, borderRadius: '8px', padding: '18px', fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '13px', lineHeight: 1.7, outline: 'none', resize: 'vertical' }} />
          )}
        </div>
  );

  // 모바일: 밴드 + 풀폭 콘텐츠 / 데스크톱: 밴드가 카드 상단에 통합
  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '860px', margin: '0 auto' }}>
        {band}
        {cfgPanel}
        {clearModal}
        {tab === 'chat' ? (
          <>
            <RoomFeed channel={room} />
            <ChatInput channel={room} target={effTarget} noRedirect onRouted={setTarget}
              leading={<TargetPill effTarget={effTarget} targetName={targetName} setTarget={setTarget} />}
              placeholder={t("메시지 입력 — @이름 으로 대상 변경")} />
          </>
        ) : mdView}
      </div>
    );
  }
  return (
    <div style={{ maxWidth: '860px', margin: '0 auto' }}>
      <div style={card({ overflow: 'hidden' })}>
        {band}
        {cfgPanel}
        {clearModal}
        {tab === 'chat' ? (
          <>
            <div style={{ background: '#edeae3', margin: '12px 12px 0', borderRadius: '8px' }}>
              <RoomFeed channel={room} inCard />
            </div>
            <div style={{ margin: '12px' }}>
              <ChatInput channel={room} target={effTarget} noRedirect onRouted={setTarget}
                leading={<TargetPill effTarget={effTarget} targetName={targetName} setTarget={setTarget} />}
                placeholder={t("메시지 입력 — @이름 으로 대상 변경")} inCard />
            </div>
          </>
        ) : mdView}
      </div>
    </div>
  );
}
