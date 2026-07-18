import { h, Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { showToast } from '../store.js';
import { C, card, Chip, Btn, Modal, actorChip, actorLabel, fmtTime } from '../ui.jsx';
import { I } from '../icons.jsx';
import { t } from '../i18n.js';

const LANE_COLORS = [C.cta, C.gold, C.sub, C.goldText];
const laneX = (l) => 12 + l * 18;

// 커밋 그래프 행 SVG: 레인 세로선 + 커밋 도트 + 머지 곡선
function GraphSvg({ row }) {
  const lanes = Math.max(row.laneCount || 1, row.lane + 1);
  const w = Math.max(48, 12 + lanes * 18);
  return (
    <svg width={w} height="56" viewBox={`0 0 ${w} 56`} style={{ flexShrink: 0, display: 'block' }}>
      {Array.from({ length: lanes }, (_, i) => (
        <path key={i} d={`M${laneX(i)} 0 V56`} stroke={LANE_COLORS[i % LANE_COLORS.length]} stroke-width="2" fill="none" opacity={i === row.lane ? 1 : 0.55} />
      ))}
      {row.parents && row.parents.length > 1 && (
        <path d={`M${laneX(row.lane + 1)} 56 C${laneX(row.lane + 1)} 40 ${laneX(row.lane)} 44 ${laneX(row.lane)} 28`} stroke={LANE_COLORS[(row.lane + 1) % LANE_COLORS.length]} stroke-width="2" fill="none" />
      )}
      <circle cx={laneX(row.lane)} cy="28" r="5" fill={LANE_COLORS[row.lane % LANE_COLORS.length]} stroke="#fff" stroke-width="2" />
    </svg>
  );
}

// 파일 경로 목록 → 트리 렌더 행 [{name, depth, isDir, path}]
function buildTreeRows(paths) {
  const rows = [];
  const seenDirs = new Set();
  for (const p of [...paths].sort()) {
    const parts = p.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts.slice(0, i + 1).join('/');
      if (!seenDirs.has(dir)) {
        seenDirs.add(dir);
        rows.push({ name: parts[i], depth: i, isDir: true, path: dir });
      }
    }
    rows.push({ name: parts[parts.length - 1], depth: parts.length - 1, isDir: false, path: p });
  }
  return rows;
}

export function GitScreen() {
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [graph, setGraph] = useState([]);
  const [selSha, setSelSha] = useState(null);
  const [tab, setTab] = useState('changes');
  const [diff, setDiff] = useState(null);
  const [diffFile, setDiffFile] = useState(null);
  const [tree, setTree] = useState([]);
  const [collapsed, setCollapsed] = useState(new Set()); // 접힌 폴더 경로
  const [view, setView] = useState('history');   // history | work
  const [ws, setWs] = useState(null);            // git status {branch, files}
  const [wSel, setWSel] = useState(null);        // {path, staged} — diff 미리보기 대상
  const [wDiff, setWDiff] = useState(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [ignoreDraft, setIgnoreDraft] = useState('');
  const openIgnore = () => api.get('/git/ignore').then(r => { setIgnoreDraft(r.content); setIgnoreOpen(true); }).catch(e => showToast(e.message));
  const saveIgnore = () => gitAct(async () => {
    const st = await api.post('/git/ignore', { content: ignoreDraft });
    setIgnoreOpen(false); showToast('.gitignore 저장됨');
    return st;
  });
  const [wBusy, setWBusy] = useState(false);
  const loadStatus = () => api.get('/git/status').then(setWs).catch(e => showToast(e.message));
  useEffect(() => { if (view === 'work') { loadStatus(); setWSel(null); setWDiff(null); } }, [view]);
  useEffect(() => {
    if (!wSel) { setWDiff(null); return; }
    api.get(`/git/workdiff?path=${encodeURIComponent(wSel.path)}&staged=${wSel.staged ? '1' : '0'}`).then(setWDiff).catch(() => setWDiff(null));
  }, [wSel?.path, wSel?.staged]);
  const gitAct = async (fn) => {
    if (wBusy) return; setWBusy(true);
    try { const st = await fn(); if (st?.files) setWs(st); else await loadStatus(); }
    catch (e) { showToast(e.message); }
    setWBusy(false);
  };
  const doCommit = () => gitAct(async () => {
    let msg = commitMsg.trim();
    if (!msg) {
      // 메시지 미작성 — staged diff 분석으로 자동 생성 (haiku 1회, 실패시 규칙 기반)
      const sug = await api.post('/git/suggest-commit');
      msg = sug.message;
      showToast(`커밋 메시지 자동 생성 — "${msg}"`);
    }
    const r = await api.post('/git/commit', { message: msg });
    showToast(`커밋 완료 — ${r.sha}`);
    setCommitMsg(''); setWSel(null);
    api.get('/git/branches').then(setBranches).catch(() => {});
    setBranch(b => b); // graph 갱신 트리거는 아래 effect가 branch 기준이라 직접 재호출
    api.get(`/git/graph${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`).then(setGraph).catch(() => {});
    return api.get('/git/status');
  });
  const [fileView, setFileView] = useState(null);

  useEffect(() => {
    api.get('/git/branches').then(bs => {
      setBranches(bs);
      const cur = bs.find(b => b.current) || bs[0];
      setBranch(cur?.name || null);
    }).catch(e => showToast(e.message));
  }, []);

  useEffect(() => {
    if (!branch) return;
    api.get(`/git/graph?branch=${encodeURIComponent(branch)}`).then(g => {
      setGraph(g);
      if (g.length) selectCommit(g[0].sha);
    }).catch(e => showToast(e.message));
  }, [branch]);

  const selectCommit = (sha) => {
    setSelSha(sha);
    setFileView(null);
    api.get(`/git/commit/${sha}/diff`).then(d => {
      setDiff(d);
      setDiffFile(d.files[0]?.path || null);
    }).catch(e => showToast(e.message));
    api.get(`/git/commit/${sha}/tree`).then(setTree).catch(() => setTree([]));
  };

  const openFile = (path) => {
    api.get(`/git/commit/${selSha}/file?path=${encodeURIComponent(path)}`)
      .then(f => setFileView({ path, ...f }))
      .catch(e => showToast(e.message));
  };

  const sel = graph.find(g => g.sha === selSha);
  const curBranch = branches.find(b => b.name === branch);
  const selFile = diff?.files.find(f => f.path === diffFile);
  const diffColor = { add: { bg: 'rgba(212,233,226,0.55)', c: C.heading }, del: { bg: 'rgba(200,32,20,0.08)', c: C.danger }, ctx: { bg: '#fff', c: C.t58 }, hunk: { bg: C.ceramic, c: C.t58 } };
  const tagStyle = (tag) => tag === 'A' ? { bg: C.mint, color: C.heading } : tag === 'D' ? { bg: 'rgba(200,32,20,0.10)', color: C.danger } : { bg: C.goldLight, color: C.goldText };
  const tabStyle = (active) => ({
    borderRadius: '50px', padding: '6px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${C.cta}`, background: active ? C.cta : '#fff', color: active ? '#fff' : C.cta,
  });

  const mobileG = window.innerWidth < 840;
  return (
    <div style={{ height: mobileG ? 'calc(100dvh - 104px)' : 'calc(100vh - 112px)', display: 'flex', flexDirection: 'column', gap: '14px', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
        <div onClick={() => setView('history')} style={tabStyle(view === 'history')}>{t('커밋 이력')}</div>
        <div onClick={() => setView('work')} style={tabStyle(view === 'work')}>
          {t('변경사항 · 커밋')}{ws && view === 'work' ? ` (${ws.files.length})` : ''}
        </div>
      </div>

      {view === 'work' && (
        <section style={card({ padding: '20px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' })}>
          {!ws ? <div style={{ color: C.t58, fontSize: '13px' }}>불러오는 중…</div> : (
            <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0 }}>
              {/* 좌: 스테이징 목록 */}
              <div style={{ flex: 1, minWidth: '260px', maxWidth: '400px', display: 'flex', flexDirection: 'column', minHeight: 0, gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: C.t58 }}>{t('변경')} {ws.files.length}</span>
                  <Btn variant="outline" small onClick={() => gitAct(() => api.post('/git/stage', { all: true }))} disabled={wBusy || ws.files.every(f => !f.unstaged)}>{t('전체 스테이지')}</Btn>
                  <Btn variant="darkOutline" small onClick={openIgnore}>.gitignore</Btn>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', color: C.goldText, marginBottom: '5px' }}>{t('스테이징됨')} ({ws.files.filter(f => f.staged).length}) — {t('커밋에 포함')}</div>
                    {ws.files.filter(f => f.staged).map(f => (
                      <div key={`s${f.path}`} onClick={() => setWSel({ path: f.path, staged: true })}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '6px', cursor: 'pointer', background: wSel?.path === f.path && wSel?.staged ? C.mint : 'transparent' }}>
                        <span style={{ fontSize: '10.5px', fontWeight: 700, borderRadius: '4px', padding: '1px 6px', background: C.mint, color: C.heading }}>{f.staged}</span>
                        <span style={{ fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12px', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
                        <Btn variant="darkOutline" small onClick={(e) => { e.stopPropagation(); gitAct(() => api.post('/git/unstage', { paths: [f.path] })); }} disabled={wBusy}>{t('내리기')}</Btn>
                      </div>
                    ))}
                    {ws.files.every(f => !f.staged) && <div style={{ fontSize: '12px', color: C.t58, padding: '2px 8px' }}>없음</div>}
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', color: C.t58, marginBottom: '5px' }}>{t('미스테이징')} ({ws.files.filter(f => f.unstaged).length})</div>
                    {ws.files.filter(f => f.unstaged).map(f => (
                      <div key={`u${f.path}`} onClick={() => setWSel({ path: f.path, staged: false })}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '6px', cursor: 'pointer', background: wSel?.path === f.path && !wSel?.staged ? C.mint : 'transparent' }}>
                        <span style={{ fontSize: '10.5px', fontWeight: 700, borderRadius: '4px', padding: '1px 6px', background: f.unstaged === '?' ? C.goldLight : C.ceramic, color: f.unstaged === '?' ? C.goldText : C.t58 }}>{f.unstaged === '?' ? 'N' : f.unstaged}</span>
                        <span style={{ fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12px', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
                        <Btn variant="outline" small onClick={(e) => { e.stopPropagation(); gitAct(() => api.post('/git/stage', { paths: [f.path] })); }} disabled={wBusy}>{t('+ 스테이지')}</Btn>
                      </div>
                    ))}
                    {ws.files.every(f => !f.unstaged) && <div style={{ fontSize: '12px', color: C.t58, padding: '2px 8px' }}>없음</div>}
                  </div>
                </div>
                {/* 커밋 박스 */}
                <div style={{ flexShrink: 0, borderTop: `1px solid ${C.line}`, paddingTop: '10px' }}>
                  <textarea value={commitMsg} onInput={e => setCommitMsg(e.target.value)} rows={2}
                    placeholder={'커밋 메시지 — 비워두면 자동 생성 (예: feat: 디자인 시안 추가)'}
                    style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '8px 10px', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', outlineColor: C.cta }} />
                  <Btn variant="primary" style={{ width: '100%', justifyContent: 'center', marginTop: '6px' }}
                    disabled={wBusy || ws.files.every(f => !f.staged)} onClick={doCommit}>
                    {wBusy ? '처리 중…' : commitMsg.trim() ? `커밋 (${ws.files.filter(f => f.staged).length}개 파일)` : `자동 메시지로 커밋 (${ws.files.filter(f => f.staged).length}개 파일)`}
                  </Btn>
                  {!commitMsg.trim() && <div style={{ fontSize: '11px', color: C.t58, marginTop: '4px' }}>메시지를 비워두면 변경 내용을 분석해 자동 생성합니다 (Haiku 1회 호출 — 소량의 토큰 사용)</div>}
                </div>
              </div>
              {/* 우: diff 미리보기 */}
              <div style={{ flex: 2, minWidth: '280px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {wSel ? (
                  <>
                    <div style={{ fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12.5px', fontWeight: 600, color: C.heading, marginBottom: '8px', flexShrink: 0 }}>{wSel.path} {wSel.staged ? '(스테이징된 변경)' : ''}</div>
                    <div style={{ border: `1px solid ${C.line}`, borderRadius: '8px', overflowY: 'auto', flex: 1, minHeight: 0, fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12.5px' }}>
                      {(wDiff?.diff || []).map((dl, i) => {
                        const cc = diffColor[dl.t] || diffColor.ctx;
                        return <div key={i} style={{ padding: '4px 14px', whiteSpace: 'pre-wrap', lineHeight: 1.55, background: cc.bg, color: cc.c }}>{dl.t === 'add' ? '+ ' : dl.t === 'del' ? '− ' : '  '}{dl.text}</div>;
                      })}
                      {wDiff && wDiff.diff.length === 0 && <div style={{ padding: '14px', color: C.t58, fontSize: '12.5px' }}>표시할 변경 내용이 없습니다 (바이너리 또는 변경 없음)</div>}
                    </div>
                  </>
                ) : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.t58, fontSize: '13px' }}>왼쪽에서 파일을 선택하면 변경 내용이 표시됩니다.</div>}
              </div>
            </div>
          )}
        </section>
      )}

      {ignoreOpen && (
        <Modal onClose={() => setIgnoreOpen(false)} maxWidth="640px">
          <div style={{ fontSize: '15.5px', fontWeight: 700, color: C.heading, marginBottom: '4px' }}>.gitignore {t('편집')}</div>
          <div style={{ fontSize: '12.5px', color: C.t58, marginBottom: '12px' }}>한 줄에 하나씩 — 저장하면 변경사항 목록이 즉시 갱신됩니다 (예: node_modules/)</div>
          <textarea value={ignoreDraft} onInput={e => setIgnoreDraft(e.target.value)} rows={14} spellcheck={false}
            style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", lineHeight: 1.6, resize: 'vertical', outlineColor: C.cta }} />
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '12px' }}>
            <Btn variant="darkOutline" onClick={() => setIgnoreOpen(false)}>{t('취소')}</Btn>
            <Btn variant="primary" onClick={saveIgnore} disabled={wBusy}>{t('저장')}</Btn>
          </div>
        </Modal>
      )}

      {view === 'history' && <>
      {/* 상단: 브랜치 + 커밋 그래프 */}
      <section style={card({ padding: '20px', flexShrink: 0 })}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <div onClick={() => setMenuOpen(!menuOpen)} style={{ display: 'flex', alignItems: 'center', gap: '8px', border: `1px solid ${C.border}`, borderRadius: '50px', padding: '7px 16px', cursor: 'pointer', fontSize: '13.5px', fontWeight: 600 }}>
              {I.git(13, C.cta)}
              <span>{branch || '…'}</span>
              {I.chevron(11)}
            </div>
            {menuOpen && (
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, width: '250px', background: '#fff', borderRadius: '12px', boxShadow: C.popShadow, padding: '8px', zIndex: 60 }}>
                {branches.map(bo => (
                  <div key={bo.name} onClick={() => { setBranch(bo.name); setMenuOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 10px', borderRadius: '8px', cursor: 'pointer' }}>
                    {I.git(13, bo.name === branch ? C.cta : C.t58)}
                    <span style={{ flex: 1, fontSize: '13px', fontWeight: 600 }}>{bo.name}</span>
                    <span style={{ fontSize: '11.5px', color: C.t58 }}>{bo.commits} commits</span>
                    {bo.name === branch && <span style={{ fontSize: '11px', fontWeight: 700, color: C.heading }}>✓</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <span style={{ fontSize: '12.5px', fontWeight: 600, color: C.t58, background: C.ceramic, borderRadius: '50px', padding: '4px 12px' }}>{curBranch?.commits ?? '-'} commits</span>
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: C.t58 }}>커밋을 선택하면 아래에 상세가 표시됩니다</span>
        </div>
        <div style={{ maxHeight: '24vh', overflowY: 'auto' }}>
          {graph.map(gr => {
            const chip = actorChip(gr.author);
            return (
              <div key={gr.sha} onClick={() => selectCommit(gr.sha)} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', borderRadius: '8px', paddingRight: '12px', background: gr.sha === selSha ? C.mint : 'transparent' }}>
                <GraphSvg row={gr} />
                <span style={{ fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12px', fontWeight: 600, color: C.cta, background: C.mint, borderRadius: '4px', padding: '2px 7px' }}>{gr.sha.slice(0, 7)}</span>
                <span style={{ flex: 1, minWidth: '120px', fontSize: '13.5px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{gr.subject}</span>
                <Chip bg={chip.bg} color={chip.color} style={{ fontSize: '11px' }}>{actorLabel(gr.author)}</Chip>
                <span style={{ fontSize: '12px', color: C.t58, whiteSpace: 'nowrap' }}>{fmtTime(gr.ts)}</span>
                <span style={{ fontSize: '11.5px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  <span style={{ color: C.heading }}>+{gr.additions}</span> <span style={{ color: C.danger }}>−{gr.deletions}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* 하단: 선택 커밋 상세 */}
      <section style={card({ padding: '20px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' })}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12.5px', fontWeight: 600, color: C.cta, background: C.mint, borderRadius: '4px', padding: '2px 8px' }}>{selSha?.slice(0, 7) || '-'}</span>
          <span style={{ fontSize: '14.5px', fontWeight: 600, color: C.heading, flex: 1, minWidth: '160px' }}>{sel?.subject || ''}</span>
          <span style={{ fontSize: '12.5px', color: C.t58 }}>{sel ? `${sel.author} · ${fmtTime(sel.ts)}` : ''}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <div onClick={() => setTab('changes')} style={tabStyle(tab === 'changes')}>변경 파일 이력</div>
          <div onClick={() => setTab('tree')} style={tabStyle(tab === 'tree')}>파일 트리</div>
        </div>

        {tab === 'changes' && diff && (
          <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0 }}>
            <div style={{ flex: 1, minWidth: '230px', maxWidth: '330px', display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto' }}>
              {diff.files.map(cf => {
                const tag = tagStyle(cf.status);
                const active = cf.path === diffFile;
                return (
                  <div key={cf.path} onClick={() => setDiffFile(cf.path)} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 10px', borderRadius: '8px', cursor: 'pointer', background: active ? C.mint : 'transparent' }}>
                    <span style={{ fontSize: '10.5px', fontWeight: 700, borderRadius: '4px', padding: '1px 6px', background: tag.bg, color: tag.color }}>{cf.status}</span>
                    <span style={{ fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12px', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: active ? 700 : 400, color: active ? C.heading : C.t87 }}>{cf.path}</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <span style={{ color: C.heading }}>+{cf.additions}</span> <span style={{ color: C.danger }}>−{cf.deletions}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ flex: 2, minWidth: '280px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12.5px', fontWeight: 600, color: C.heading, marginBottom: '8px', flexShrink: 0 }}>{diffFile}</div>
              <div style={{ border: `1px solid ${C.line}`, borderRadius: '8px', overflowY: 'auto', flex: 1, minHeight: 0, fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12.5px' }}>
                {(selFile?.diff || []).map((dl, i) => {
                  const cc = diffColor[dl.t] || diffColor.ctx;
                  return <div key={i} style={{ padding: '4px 14px', whiteSpace: 'pre-wrap', lineHeight: 1.55, background: cc.bg, color: cc.c }}>{dl.t === 'add' ? '+ ' : dl.t === 'del' ? '− ' : '  '}{dl.text}</div>;
                })}
              </div>
            </div>
          </div>
        )}

        {tab === 'tree' && (
          <>
            <div style={{ fontSize: '12px', color: C.t58, marginBottom: '10px', flexShrink: 0 }}>{selSha?.slice(0, 7)} 커밋 시점의 소스 원본입니다. 이후 커밋에서 추가된 파일은 보이지 않습니다.</div>
            <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0 }}>
              <div style={{ flex: 1, minWidth: '230px', maxWidth: '320px', background: '#f9f9f9', border: `1px solid ${C.line}`, borderRadius: '8px', padding: '10px', overflowY: 'auto' }}>
                {buildTreeRows(tree)
                  // 접힌 폴더의 하위 항목 숨김 (자기 자신은 표시)
                  .filter(rf => {
                    const parts = rf.path.split('/');
                    for (let i = 1; i < parts.length; i++) if (collapsed.has(parts.slice(0, i).join('/'))) return false;
                    return true;
                  })
                  .map(rf => {
                    const isOpen = rf.isDir && !collapsed.has(rf.path);
                    return (
                      <div key={rf.path}
                        onClick={() => rf.isDir
                          ? setCollapsed(prev => { const n = new Set(prev); n.has(rf.path) ? n.delete(rf.path) : n.add(rf.path); return n; })
                          : openFile(rf.path)}
                        style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '7px 10px', borderRadius: '6px', cursor: 'pointer', paddingLeft: `${10 + rf.depth * 16}px`, background: fileView?.path === rf.path ? C.mint : 'transparent' }}>
                        {rf.isDir && <span style={{ fontSize: '9px', width: '9px', color: C.t58, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s', flexShrink: 0 }}>▶</span>}
                        {rf.isDir ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d6b56a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style={{ flexShrink: 0 }}
                            dangerouslySetInnerHTML={{ __html: isOpen
                              ? '<path d="M6 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2H8l-3 12z"/>'
                              : '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/>' }} />
                        ) : I.file(14)}
                        <span style={{ fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12.5px', fontWeight: fileView?.path === rf.path ? 700 : 400, color: fileView?.path === rf.path ? C.heading : C.t87, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rf.name}</span>
                      </div>
                    );
                  })}
              </div>
              <div style={{ flex: 2, minWidth: '280px', overflowY: 'auto', minHeight: 0 }}>
                {fileView ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
                      <span style={{ fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '13.5px', fontWeight: 600, color: C.heading }}>{fileView.path}</span>
                      <span style={{ marginLeft: 'auto', fontSize: '11.5px', color: C.t58 }}>
                        {fileView.lastCommit ? `마지막 커밋 ${fileView.lastCommit.sha} · ${fileView.lastCommit.author} · ${fileView.lastCommit.subject}` : ''}
                      </span>
                    </div>
                    <pre style={{ margin: 0, background: '#f9f9f9', border: `1px solid ${C.line}`, borderRadius: '8px', padding: '16px', fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12.5px', lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowX: 'auto', color: C.t87 }}>{fileView.content}</pre>
                  </>
                ) : (
                  <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: '13.5px', color: C.t58 }}>왼쪽 트리에서 파일을 선택하면 내용이 표시됩니다.</div>
                )}
              </div>
            </div>
          </>
        )}
      </section>
      </>}
    </div>
  );
}
