import { h, Fragment } from 'preact';
import { showToast } from '../store.js';
import { api, currentBase } from '../api.js';
import { C, Btn, label12 } from '../ui.jsx';
import { t } from '../i18n.js';

// 산출 보고서 모달 — 인터랙티브 HTML 렌더 + PPTX/Excel 내보내기.
// 테마 4종(클래식/문서/대시보드/다크) — 선택은 localStorage에 기억.
import { useState } from 'preact/hooks';
import { InlineImages, HtmlChips } from '../refs.jsx';

const THEME_LIST = [
  { key: 'classic', label: '클래식' },
  { key: 'document', label: '문서' },
  { key: 'dashboard', label: '대시보드' },
  { key: 'dark', label: '다크' },
];

export function ReportModal({ requestId, report, onClose }) {
  const [theme, setTheme] = useState(localStorage.getItem('cc_report_theme') || 'classic');
  const pick = (k) => { setTheme(k); localStorage.setItem('cc_report_theme', k); };
  const download = (ext) => {
    showToast(`${ext.toUpperCase()} 내보내기 시작`);
    const a = document.createElement('a');
    a.href = `${currentBase()}/api/requests/${requestId}/report.${ext}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // 테마 토큰
  const T = {
    classic:   { paper: '#fff', text: C.t87, headText: C.heading, headBg: C.dark, headFg: '#fff', accent: C.gold, summaryBg: C.cream, line: C.line, thBg: C.ceramic, thFg: C.heading, zebra: '#f9f9f9', metricBg: '#fff', metricBorder: C.line, serif: false },
    document:  { paper: '#fff', text: '#2b2b26', headText: '#1a1a16', headBg: '#fff', headFg: '#1a1a16', accent: '#8a6a2f', summaryBg: '#faf9f4', line: '#e4e0d2', thBg: '#fff', thFg: '#1a1a16', zebra: '#fbfaf6', metricBg: '#fff', metricBorder: '#e4e0d2', serif: true },
    dashboard: { paper: '#f6f5f1', text: C.t87, headText: C.heading, headBg: '#f6f5f1', headFg: C.heading, accent: C.cta, summaryBg: '#fff', line: C.line, thBg: C.mint, thFg: C.heading, zebra: '#fbfaf7', metricBg: '#fff', metricBorder: 'transparent', serif: false },
    dark:      { paper: '#14211c', text: '#cfe0d7', headText: '#e6efe9', headBg: '#0e1814', headFg: '#e6efe9', accent: '#57c99a', summaryBg: '#1a2b24', line: 'rgba(255,255,255,0.12)', thBg: '#1a2b24', thFg: '#e6efe9', zebra: 'rgba(255,255,255,0.03)', metricBg: '#1a2b24', metricBorder: 'rgba(255,255,255,0.10)', serif: false },
  }[theme];
  const hFont = T.serif ? "Georgia, 'Times New Roman', serif" : 'inherit';

  const Metrics = ({ big }) => (report.metrics || []).length > 0 && (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${big ? 170 : 150}px, 1fr))`, gap: '10px', marginBottom: '16px' }}>
      {report.metrics.map((m, i) => (
        <div key={i} style={{ background: T.metricBg, border: `1px solid ${T.metricBorder}`, borderRadius: '12px', boxShadow: theme === 'dashboard' ? C.cardShadow : 'none', padding: big ? '18px 18px' : '14px 16px', borderTop: theme === 'dashboard' ? `3px solid ${m.color || T.accent}` : undefined }}>
          <div style={{ fontSize: '11.5px', fontWeight: 600, color: theme === 'dark' ? 'rgba(230,239,233,0.6)' : C.t58 }}>{m.label}</div>
          <div style={{ fontSize: big ? '28px' : '24px', fontWeight: 700, marginTop: '4px', color: m.color || T.headText }}>{m.value}</div>
        </div>
      ))}
    </div>
  );

  const Table = () => report.table?.cols?.length > 0 && (
    <div style={{ border: `1px solid ${T.line}`, borderRadius: theme === 'document' ? '0' : '12px', overflow: 'hidden', marginBottom: '16px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px', minWidth: '420px' }}>
          <thead>
            <tr>
              {report.table.cols.map((c2, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '11px 16px', background: T.thBg, color: T.thFg, fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: theme === 'document' ? `2px solid ${T.accent}` : 'none' }}>{c2}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(report.table.rows || []).map((r, i) => (
              <tr key={i} style={{ background: i % 2 ? T.zebra : 'transparent' }}>
                {r.map((cell, j) => (
                  <td key={j} style={{ padding: '10px 16px', borderTop: `1px solid ${T.line}`, lineHeight: 1.5, color: T.text }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const Summary = () => (
    <div style={{ background: T.summaryBg, borderRadius: theme === 'document' ? '0' : '12px', borderLeft: theme === 'document' ? `3px solid ${T.accent}` : 'none', padding: '18px 20px', marginBottom: '16px', boxShadow: theme === 'dashboard' ? C.cardShadow : 'none' }}>
      <div style={{ ...label12, color: theme === 'dark' ? T.accent : label12.color, marginBottom: '8px' }}>SUMMARY</div>
      <div style={{ fontSize: '14.5px', lineHeight: 1.65, color: T.text }}>{report.summary}</div>
      <InlineImages text={report.summary} />
      <HtmlChips text={report.summary} />
    </div>
  );

  const Sections = () => (report.sections || []).map((sec, i) => (
    <div key={i} style={{ marginBottom: '16px', paddingLeft: theme === 'dashboard' ? '12px' : 0, borderLeft: theme === 'dashboard' ? `3px solid ${C.mint}` : 'none' }}>
      <div style={{ fontSize: '15px', fontWeight: 600, color: T.headText, marginBottom: '6px', fontFamily: hFont }}>
        {theme === 'document' ? `${i + 1}. ` : ''}{sec.h}
      </div>
      <div style={{ fontSize: '14px', lineHeight: 1.7, color: T.text }}>{sec.b}</div>
      <InlineImages text={sec.b} />
      <HtmlChips text={sec.b} />
    </div>
  ));

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.30)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: T.paper, borderRadius: '12px', boxShadow: C.popShadow, width: '100%', maxWidth: '820px', maxHeight: '88vh', overflowY: 'auto' }}>

        {/* 헤더 — 테마별 배경, sticky */}
        <div style={{ position: 'sticky', top: 0, zIndex: 5, background: T.headBg, color: T.headFg, borderRadius: '12px 12px 0 0', padding: '18px 24px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', borderBottom: theme === 'classic' ? 'none' : `1px solid ${T.line}` }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.14em', color: T.accent }}>REPORT</div>
            <div style={{ fontSize: theme === 'document' ? '19px' : '17px', fontWeight: 600, marginTop: '2px', fontFamily: hFont }}>{report.title}</div>
          </div>
          {report.acked_ts
            ? <span style={{ fontSize: '12px', fontWeight: 700, color: T.accent }}>✓ {t('확인 완료')}</span>
            : <Btn variant="outline" small onClick={async () => { try { await api.post(`/requests/${requestId}/report/ack`); showToast(t('보고서를 확인 완료로 표시했습니다.')); } catch (e) { showToast(e.message); } }}>{t('확인 완료')}</Btn>}
          <Btn variant="primary" small onClick={() => download('pptx')}>PPTX</Btn>
          <Btn variant="primary" small onClick={() => download('xlsx')}>Excel</Btn>
          <span onClick={onClose} style={{ cursor: 'pointer', fontSize: '18px', color: theme === 'classic' || theme === 'dark' ? 'rgba(255,255,255,0.8)' : C.t58, padding: '0 4px' }}>✕</span>
          {/* 테마 시안 선택 */}
          <div style={{ width: '100%', display: 'flex', gap: '5px' }}>
            {THEME_LIST.map(th2 => (
              <span key={th2.key} onClick={() => pick(th2.key)} style={{ cursor: 'pointer', borderRadius: '50px', padding: '3px 11px', fontSize: '11px', fontWeight: 700, background: theme === th2.key ? T.accent : 'rgba(127,127,127,0.15)', color: theme === th2.key ? (theme === 'document' || theme === 'dashboard' ? '#fff' : '#14211c') : 'inherit', opacity: theme === th2.key ? 1 : 0.75 }}>{th2.label}</span>
            ))}
          </div>
        </div>

        <div style={{ padding: '24px', fontFamily: theme === 'document' ? hFont : 'inherit' }}>
          {/* 메타 라인 */}
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12.5px', color: theme === 'dark' ? 'rgba(230,239,233,0.55)' : C.t58, marginBottom: '16px', paddingBottom: theme === 'document' ? '12px' : 0, borderBottom: theme === 'document' ? `1px solid ${T.line}` : 'none' }}>
            <span style={{ fontWeight: 600, color: T.headText }}>{report.subtitle}</span>
            <span>작성 · {report.author || '팀장'}</span>
            <span>{report.date}</span>
          </div>

          {theme === 'dashboard' ? (
            <>
              <Metrics big />
              <Summary />
              <Table />
              <Sections />
            </>
          ) : (
            <>
              <Summary />
              <Metrics />
              <Table />
              <Sections />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// 요청 카드용 초록 "보고서" 뱃지 (문서 아이콘)
export function ReportBadge() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', fontWeight: 700, borderRadius: '50px', padding: '2px 9px', background: C.mint, color: C.heading, whiteSpace: 'nowrap' }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M8 13h8" /><path d="M8 17h5" />
      </svg>
      보고서
    </span>
  );
}
