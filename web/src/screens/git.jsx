import { h, Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { showToast } from '../store.js';
import { C, card, Chip, actorChip, actorLabel, fmtTime } from '../ui.jsx';
import { I } from '../icons.jsx';

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

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto' }}>
      {/* 상단: 브랜치 + 커밋 그래프 */}
      <section style={card({ padding: '20px', marginBottom: '16px' })}>
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
        <div style={{ maxHeight: '330px', overflowY: 'auto' }}>
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
      <section style={card({ padding: '20px' })}>
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
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: '230px', maxWidth: '330px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
            <div style={{ flex: 2, minWidth: '280px' }}>
              <div style={{ fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12.5px', fontWeight: 600, color: C.heading, marginBottom: '8px' }}>{diffFile}</div>
              <div style={{ border: `1px solid ${C.line}`, borderRadius: '8px', overflow: 'hidden', fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12.5px' }}>
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
            <div style={{ fontSize: '12px', color: C.t58, marginBottom: '10px' }}>{selSha?.slice(0, 7)} 커밋 시점의 소스 원본입니다. 이후 커밋에서 추가된 파일은 보이지 않습니다.</div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: '230px', maxWidth: '320px', background: '#f9f9f9', border: `1px solid ${C.line}`, borderRadius: '8px', padding: '10px' }}>
                {buildTreeRows(tree).map(rf => (
                  <div key={rf.path} onClick={() => !rf.isDir && openFile(rf.path)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', borderRadius: '6px', cursor: rf.isDir ? 'default' : 'pointer', paddingLeft: `${10 + rf.depth * 16}px`, background: fileView?.path === rf.path ? C.mint : 'transparent' }}>
                    {rf.isDir ? I.folder(14) : I.file(14)}
                    <span style={{ fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: '12.5px', fontWeight: fileView?.path === rf.path ? 700 : 400, color: fileView?.path === rf.path ? C.heading : C.t87 }}>{rf.name}</span>
                  </div>
                ))}
              </div>
              <div style={{ flex: 2, minWidth: '280px' }}>
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
    </div>
  );
}
