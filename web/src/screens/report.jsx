import { h, Fragment } from 'preact';
import { showToast } from '../store.js';
import { currentBase } from '../api.js';
import { C, Btn, label12 } from '../ui.jsx';

// 산출 보고서 모달 — 인터랙티브 HTML 렌더 + PPTX/Excel 내보내기
export function ReportModal({ requestId, report, onClose }) {
  const download = (ext) => {
    showToast(`${ext.toUpperCase()} 내보내기 시작`);
    const a = document.createElement('a');
    a.href = `${currentBase()}/api/requests/${requestId}/report.${ext}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.30)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#fff', borderRadius: '12px', boxShadow: C.popShadow, width: '100%', maxWidth: '820px', maxHeight: '88vh', overflowY: 'auto' }}>

        {/* 헤더 — 다크 그린 밴드, sticky */}
        <div style={{ position: 'sticky', top: 0, zIndex: 5, background: C.dark, color: '#fff', borderRadius: '12px 12px 0 0', padding: '18px 24px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.14em', color: C.gold }}>REPORT</div>
            <div style={{ fontSize: '17px', fontWeight: 600, marginTop: '2px' }}>{report.title}</div>
          </div>
          <Btn variant="primary" small onClick={() => download('pptx')}>PPTX</Btn>
          <Btn variant="primary" small onClick={() => download('xlsx')}>Excel</Btn>
          <span onClick={onClose} style={{ cursor: 'pointer', fontSize: '18px', color: 'rgba(255,255,255,0.8)', padding: '0 4px' }}>✕</span>
        </div>

        <div style={{ padding: '24px' }}>
          {/* 메타 라인 */}
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12.5px', color: C.t58, marginBottom: '16px' }}>
            <span style={{ fontWeight: 600, color: C.heading }}>{report.subtitle}</span>
            <span>작성 · {report.author || '팀장'}</span>
            <span>{report.date}</span>
          </div>

          {/* SUMMARY — 크림 배경 */}
          <div style={{ background: C.cream, borderRadius: '12px', padding: '18px 20px', marginBottom: '16px' }}>
            <div style={{ ...label12, marginBottom: '8px' }}>SUMMARY</div>
            <div style={{ fontSize: '14.5px', lineHeight: 1.65 }}>{report.summary}</div>
          </div>

          {/* METRICS — auto-fit 반응형 */}
          {(report.metrics || []).length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '16px' }}>
              {report.metrics.map((m, i) => (
                <div key={i} style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: '12px', boxShadow: C.cardShadow, padding: '14px 16px' }}>
                  <div style={{ fontSize: '11.5px', fontWeight: 600, color: C.t58 }}>{m.label}</div>
                  <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px', color: m.color || C.heading }}>{m.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* DATA 테이블 */}
          {report.table?.cols?.length > 0 && (
            <div style={{ border: `1px solid ${C.line}`, borderRadius: '12px', overflow: 'hidden', marginBottom: '16px' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px', minWidth: '420px' }}>
                  <thead>
                    <tr>
                      {report.table.cols.map((c, i) => (
                        <th key={i} style={{ textAlign: 'left', padding: '11px 16px', background: C.ceramic, color: C.heading, fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(report.table.rows || []).map((r, i) => (
                      <tr key={i} style={{ background: i % 2 ? '#f9f9f9' : '#fff' }}>
                        {r.map((cell, j) => (
                          <td key={j} style={{ padding: '10px 16px', borderTop: `1px solid ${C.line}`, lineHeight: 1.5 }}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SECTIONS */}
          {(report.sections || []).map((sec, i) => (
            <div key={i} style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '15px', fontWeight: 600, color: C.heading, marginBottom: '6px' }}>{sec.h}</div>
              <div style={{ fontSize: '14px', lineHeight: 1.65, color: C.t87 }}>{sec.b}</div>
            </div>
          ))}
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
