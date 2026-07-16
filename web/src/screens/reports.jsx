import { h, Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { store, showToast } from '../store.js';
import { api, currentBase } from '../api.js';
import { C, card, Btn, Chip, fmtDateTime } from '../ui.jsx';
import { ReportModal } from './report.jsx';

// 보고서 관리 — 전체 산출 보고서 목록·열람·내보내기·삭제
export function ReportsScreen({ param }) {
  const [openId, setOpenId] = useState(param ? Number(param) : null);
  const reports = store.requests.filter(r => r.report).sort((a, b) => b.updated_ts - a.updated_ts);
  const open = openId != null ? reports.find(r => r.id === openId) : null;

  useEffect(() => { if (param) setOpenId(Number(param)); }, [param]);

  const download = (id, ext) => {
    const a = document.createElement('a');
    a.href = `${currentBase()}/api/requests/${id}/report.${ext}`;
    a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
    showToast(`${ext.toUpperCase()} 내보내기 시작`);
  };
  const remove = async (id) => {
    try { await api.del(`/requests/${id}/report`); showToast('보고서가 삭제되었습니다.'); } catch (e) { showToast(e.message); }
  };

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ fontSize: '13px', color: C.t58 }}>팀이 작성한 산출 보고서 {reports.length}건 — 열람·내보내기·삭제할 수 있습니다.</div>
      {reports.length === 0 && (
        <section style={card({ padding: '40px', textAlign: 'center' })}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: C.heading }}>아직 보고서가 없습니다</div>
          <div style={{ fontSize: '13.5px', color: C.t58, marginTop: '6px' }}>요청이 완료되면 팀장이 보고서를 작성하고, 채팅에 링크가 게시됩니다.</div>
        </section>
      )}
      {reports.map(r => (
        <section key={r.id} style={card({ padding: '20px 24px' })}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: C.t58 }}>REQ-{r.id}</span>
            <span onClick={() => setOpenId(r.id)} style={{ fontSize: '15.5px', fontWeight: 600, color: C.heading, cursor: 'pointer' }}>{r.report.title}</span>
            <span style={{ marginLeft: 'auto', fontSize: '12px', color: C.t58 }}>{r.report.date || fmtDateTime(r.updated_ts)}</span>
          </div>
          <div style={{ fontSize: '12.5px', color: C.t58, marginTop: '4px' }}>{r.report.subtitle} · 작성 {r.report.author || '팀장'}</div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
            <Btn variant="primary" small onClick={() => setOpenId(r.id)}>열람</Btn>
            <Btn variant="outline" small onClick={() => download(r.id, 'pptx')}>PPTX</Btn>
            <Btn variant="outline" small onClick={() => download(r.id, 'xlsx')}>Excel</Btn>
            <Btn variant="danger" small style={{ marginLeft: 'auto' }} onClick={() => remove(r.id)}>삭제</Btn>
          </div>
        </section>
      ))}
      {open && <ReportModal requestId={open.id} report={open.report} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// 채팅용 보고서 링크 카드 — 클릭 시 보고서 관리 화면에서 자동 열람
export function ReportLinkCard({ m }) {
  const rid = m.content.request_id;
  const [open, setOpen] = useState(false);
  // 채팅에서는 페이지 이동 대신 인라인 모달로 열람 (보고서 관리 화면과 동일 뷰)
  const req = store.requests.find(r => r.id === rid);
  return (
    <>
    <div onClick={() => setOpen(true)}
      style={{ display: 'flex', alignItems: 'center', gap: '12px', background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderRadius: '12px', padding: '13px 16px', cursor: 'pointer', maxWidth: '480px' }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.goldText} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M8 13h8" /><path d="M8 17h5" />
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: C.goldText }}>산출 보고서</div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: C.t87, marginTop: '2px' }}>{m.content.title}</div>
        {m.content.subtitle && <div style={{ fontSize: '12px', color: C.t58, marginTop: '1px' }}>{m.content.subtitle}</div>}
      </div>
      <span style={{ fontSize: '12.5px', fontWeight: 600, color: C.goldText, whiteSpace: 'nowrap' }}>열람 →</span>
    </div>
    {open && <ReportModal requestId={rid} report={req?.report} onClose={() => setOpen(false)} />}
    </>
  );
}
