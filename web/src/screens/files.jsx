import { h, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, currentBase, authToken } from '../api.js';
import { showToast } from '../store.js';
import { C, card, Btn } from '../ui.jsx';
import { createEditor } from '../cm.js';
import { isEn } from '../i18n.js';

// 터미널과 같은 다크 베이스
const BG = '#14211c', PANEL = '#1a2b24', LINE = 'rgba(255,255,255,0.10)', FG = '#e6efe9', MUTE = 'rgba(255,255,255,0.55)';

const fileIcon = (dir, open) => dir
  ? (open ? '<path d="M6 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2H8l-3 12z"/>' : '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/>')
  : '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>';

// 재귀 트리 노드 — 펼침 상태(openDirs)·새로고침(reloadKey)은 상위 관리라 이동/업로드 후 자동 갱신됨
function TreeNode({ node, depth, onOpen, onSelect, selected, onCtx, onDropTo, dragPath, setDragPath, openDirs, setOpenDirs, reloadKey }) {
  const open = openDirs.has(node.path);
  const [children, setChildren] = useState(null);
  const [over, setOver] = useState(false);
  const load = async () => { try { setChildren(await api.get(`/files?path=${encodeURIComponent(node.path)}`)); } catch (e) { showToast(e.message); } };
  useEffect(() => { if (node.dir && open) load(); }, [open, reloadKey]);
  const onClick = (e) => {
    onSelect(node, e); // 다중 선택 처리(상위)
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (node.dir) setOpenDirs(prev => { const n = new Set(prev); n.has(node.path) ? n.delete(node.path) : n.add(node.path); return n; });
    else onOpen(node);
  };
  const isSel = selected.has(node.path);
  const dropDir = node.dir ? node.path : node.path.split('/').slice(0, -1).join('/');
  return (
    <div>
      <div data-path={node.path} draggable onDragStart={(e) => { setDragPath(node.path); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); onDropTo(dropDir, e); }}
        onClick={onClick} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onCtx(node, e); }}
        style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 8px', paddingLeft: `${8 + depth * 14}px`, cursor: 'pointer', fontSize: '13px', color: isSel ? '#fff' : FG, background: isSel ? C.cta : over ? 'rgba(0,117,74,0.35)' : 'transparent', borderRadius: '5px', whiteSpace: 'nowrap', outline: over ? `1px dashed ${C.mint}` : 'none' }}
        onMouseEnter={e => { if (!isSel && !over) e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }} onMouseLeave={e => { if (!isSel && !over) e.currentTarget.style.background = 'transparent'; }}>
        {node.dir && <span style={{ fontSize: '9px', width: '8px', color: MUTE, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }}>▶</span>}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isSel ? '#fff' : (node.dir ? '#d6b56a' : MUTE)} stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" dangerouslySetInnerHTML={{ __html: fileIcon(node.dir, open) }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
      </div>
      {node.dir && open && children && children.map(c => <TreeNode key={c.path} node={c} depth={depth + 1} onOpen={onOpen} onSelect={onSelect} selected={selected} onCtx={onCtx} onDropTo={onDropTo} dragPath={dragPath} setDragPath={setDragPath} openDirs={openDirs} setOpenDirs={setOpenDirs} reloadKey={reloadKey} />)}
    </div>
  );
}

export function FilesScreen() {
  const [tree, setTree] = useState([]);
  const [tab, setTab] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [meta, setMeta] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [rootOver, setRootOver] = useState(false);
  const [dragPath, setDragPath] = useState(null);
  const [openDirs, setOpenDirs] = useState(new Set()); // 펼친 폴더 경로 — 이동/새로고침에도 유지
  const [selected, setSelected] = useState(new Set()); // 다중 선택된 경로
  const [clip, setClip] = useState(null); // {paths:[], cut:bool} 내부 클립보드
  const [band, setBand] = useState(null); // 러버밴드 사각형 (viewport 좌표)
  const treePanelRef = useRef(null);
  const editorHost = useRef(null);
  const editorRef = useRef(null);
  const contentRef = useRef('');
  const fileInput = useRef(null);
  const lastClickRef = useRef(null); // shift 범위 선택 기준
  const flatRef = useRef([]);        // 현재 보이는 순서(플랫) — shift 범위용

  // 보이는 노드를 순서대로 수집 (shift 범위 선택 기준)
  const collectFlat = (nodes, out) => { for (const n of nodes) { out.push(n.path); if (n.dir && openDirs.has(n.path) && n._children) collectFlat(n._children, out); } return out; };

  // 다중 선택 — 클릭 단일, Ctrl/Cmd 토글, Shift는 마지막 클릭(앵커)부터 화면 순서로 범위 선택
  const onSelect = (node, e) => {
    if (e.shiftKey && lastClickRef.current) {
      const rows = [...(treePanelRef.current?.querySelectorAll('[data-path]') || [])].map(el => el.dataset.path);
      const a = rows.indexOf(lastClickRef.current.path), b = rows.indexOf(node.path);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(prev => {
          const n = (e.metaKey || e.ctrlKey) ? new Set(prev) : new Set();
          for (let i = lo; i <= hi; i++) n.add(rows[i]);
          return n;
        });
        return; // 앵커 유지
      }
    }
    setSelected(prev => {
      const n = new Set(prev);
      if (e.metaKey || e.ctrlKey) { n.has(node.path) ? n.delete(node.path) : n.add(node.path); }
      else { n.clear(); n.add(node.path); }
      return n;
    });
    lastClickRef.current = node; // 붙여넣기 대상·shift 앵커
  };

  // 빈 공간 드래그 = 러버밴드 범위 선택. 움직임 없으면 = 빈 곳 클릭 → 선택 해제.
  const onTreeMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('[data-path]') || e.target.closest('[data-hdr]')) return;
    const x1 = e.clientX, y1 = e.clientY;
    let moved = false;
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - x1) + Math.abs(ev.clientY - y1) > 5) moved = true;
      if (!moved) return;
      setBand({ x: Math.min(x1, ev.clientX), y: Math.min(y1, ev.clientY), w: Math.abs(ev.clientX - x1), h: Math.abs(ev.clientY - y1) });
      const L = Math.min(x1, ev.clientX), R = Math.max(x1, ev.clientX), T = Math.min(y1, ev.clientY), B = Math.max(y1, ev.clientY);
      const hit = new Set();
      for (const el of treePanelRef.current?.querySelectorAll('[data-path]') || []) {
        const r = el.getBoundingClientRect();
        if (r.left < R && r.right > L && r.top < B && r.bottom > T) hit.add(el.dataset.path);
      }
      setSelected(hit);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setBand(null);
      if (!moved) setSelected(new Set());
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    e.preventDefault();
  };

  const loadRoot = async () => { try { setTree(await api.get('/files?path=')); } catch (e) { showToast(e.message); } };
  useEffect(() => { loadRoot(); }, [reloadKey]);
  useEffect(() => { const close = () => setCtx(null); window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, []);

  const openFile = async (node) => {
    if (dirty && !confirm(isEn() ? 'Discard unsaved changes?' : '저장하지 않은 변경을 버릴까요?')) return;
    try {
      const r = await api.get(`/file?path=${encodeURIComponent(node.path)}`);
      contentRef.current = r.content || '';
      setMeta(r.binary ? { binary: true } : r.tooLarge ? { tooLarge: true } : null);
      setDirty(false);
      setTab({ path: node.path, name: node.name, doc: r.content || '', editable: !r.binary && !r.tooLarge });
    } catch (e) { showToast(e.message); }
  };

  useEffect(() => {
    editorRef.current?.destroy(); editorRef.current = null;
    if (tab?.editable && editorHost.current) {
      editorHost.current.innerHTML = '';
      editorRef.current = createEditor({ parent: editorHost.current, doc: tab.doc, path: tab.path, onChange: (v) => { contentRef.current = v; setDirty(true); }, onSave: () => save() });
    }
    return () => { editorRef.current?.destroy(); editorRef.current = null; };
  }, [tab?.path]);

  const save = async () => {
    if (!tab) return;
    try { await api.post('/file', { path: tab.path, content: contentRef.current }); setDirty(false); showToast(isEn() ? 'Saved' : '저장했습니다'); }
    catch (e) { showToast(e.message); }
  };

  const uploadFiles = async (fileList, dir = '') => {
    if (!fileList?.length) return;
    const fd = new FormData();
    for (const f of fileList) fd.append('files', f);
    fd.append('dir', dir);
    try {
      const headers = authToken() ? { 'x-auth-token': authToken() } : {};
      const res = await fetch(currentBase() + '/api/file/upload', { method: 'POST', body: fd, headers });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '업로드 실패');
      showToast(isEn() ? 'Uploaded' : '업로드 완료');
      setReloadKey(k => k + 1);
    } catch (e) { showToast(e.message); }
  };

  // 트리 노드/루트로 drop — 내부 이동(dragPath) 또는 외부 파일 업로드
  const onDropTo = async (dir, e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length) { await uploadFiles(files, dir); setDragPath(null); return; }
    if (dragPath) {
      try { await api.post('/file/move', { path: dragPath, toDir: dir }); setReloadKey(k => k + 1); }
      catch (err) { showToast(err.message); }
      setDragPath(null);
    }
  };

  // 클립보드 붙여넣기 업로드 (이미지/파일)
  useEffect(() => {
    const onPaste = async (e) => {
      if (location.hash.replace(/^#\/?/, '').split('/')[0] !== 'files') return;
      const items = [...(e.clipboardData?.items || [])];
      const fileItems = items.filter(it => it.kind === 'file');
      if (fileItems.length) {
        e.preventDefault();
        const files = fileItems.map(it => it.getAsFile()).filter(Boolean);
        await uploadFiles(files, '');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const download = (node) => {
    const a = document.createElement('a');
    a.href = currentBase() + '/api/file/download?path=' + encodeURIComponent(node.path) + (authToken() ? '&token=' + authToken() : '');
    a.download = node.name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // 다중 선택 대상 삭제 (기본은 워크스페이스 루트 붙여넣기)
  const deleteSelected = async () => {
    const paths = [...selected];
    if (!paths.length) return;
    if (!confirm(`${paths.length}${isEn() ? ' item(s) — delete?' : '개 항목을 삭제할까요?'}`)) return;
    for (const path of paths) { try { await api.del(`/file?path=${encodeURIComponent(path)}`); if (tab?.path === path) setTab(null); } catch (e) { showToast(e.message); } }
    setSelected(new Set()); setReloadKey(k => k + 1);
  };

  // 붙여넣기 대상 폴더: 마지막 클릭이 폴더면 그 안, 파일이면 그 부모, 선택 없으면 루트
  const pasteDir = () => {
    const node = lastClickRef.current;
    if (!node || !selected.has(node.path)) return '';
    return node.dir ? node.path : (node.path.includes('/') ? node.path.split('/').slice(0, -1).join('/') : '');
  };

  // 내부 클립보드 붙여넣기 (복사=cp, 잘라내기=move)
  const pasteClip = async (dir) => {
    if (!clip?.paths?.length) return;
    for (const src of clip.paths) {
      try { await api.post(clip.cut ? '/file/move' : '/file/copy', { path: src, toDir: dir }); }
      catch (e) { showToast(e.message); }
    }
    if (clip.cut) setClip(null);
    setSelected(new Set()); setReloadKey(k => k + 1);
    showToast(clip.cut ? (isEn() ? 'Moved' : '이동했습니다') : (isEn() ? 'Copied' : '복사했습니다'));
  };

  // 키보드 단축키 — 파일 화면에서만 (에디터 포커스 중엔 제외)
  useEffect(() => {
    const onKey = (e) => {
      if (location.hash.replace(/^#\/?/, '').split('/')[0] !== 'files') return;
      if (e.target.closest?.('.cm-editor')) return; // 에디터 편집 중엔 무시
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'c') { if (selected.size) { setClip({ paths: [...selected], cut: false }); e.preventDefault(); showToast(`${selected.size}${isEn() ? ' copied' : '개 복사'}`); } }
      else if (mod && e.key.toLowerCase() === 'x') { if (selected.size) { setClip({ paths: [...selected], cut: true }); e.preventDefault(); showToast(`${selected.size}${isEn() ? ' cut' : '개 잘라내기'}`); } }
      else if (mod && e.key.toLowerCase() === 'v') { if (clip?.paths?.length) { pasteClip(pasteDir()); e.preventDefault(); } }
      else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelected(new Set(tree.map(n => n.path))); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (selected.size) { deleteSelected(); e.preventDefault(); } }
      else if (e.key === 'Escape') { setSelected(new Set()); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, clip, tree, tab]);

  const act = async (kind) => {
    const node = ctx?.node; setCtx(null);
    try {
      if (kind === 'newFile' || kind === 'newDir') {
        const base = node ? (node.dir ? node.path : node.path.split('/').slice(0, -1).join('/')) : '';
        const name = prompt(kind === 'newDir' ? (isEn() ? 'New folder name' : '새 폴더 이름') : (isEn() ? 'New file name' : '새 파일 이름'));
        if (!name) return;
        await api.post('/file/create', { path: base ? `${base}/${name}` : name, dir: kind === 'newDir' });
      } else if (kind === 'upload') { fileInput.current?.click(); return; }
      else if (kind === 'download') { download(node); return; }
      else if (kind === 'rename') {
        const to = prompt(isEn() ? 'New name/path' : '새 이름 또는 경로', node.path);
        if (!to || to === node.path) return;
        await api.post('/file/rename', { path: node.path, to });
        if (tab?.path === node.path) setTab(null);
      } else if (kind === 'delete') {
        if (!confirm(`${isEn() ? 'Delete' : '삭제'} "${node.name}"?`)) return;
        await api.del(`/file?path=${encodeURIComponent(node.path)}`);
        if (tab?.path === node.path) { setTab(null); editorRef.current?.destroy(); }
      }
      setReloadKey(k => k + 1);
    } catch (e) { showToast(e.message); }
  };

  return (
    <div style={{ display: 'flex', gap: '10px', height: 'calc(100vh - 112px)' }}>
      <input type="file" multiple hidden ref={fileInput} onChange={e => { uploadFiles(e.target.files, ''); e.target.value = ''; }} />
      {/* 좌: 파일 트리 (다크) */}
      <div ref={treePanelRef} style={{ position: 'relative', width: '260px', flexShrink: 0, background: PANEL, borderRadius: '12px', overflow: 'auto', boxShadow: C.cardShadow, padding: '8px 4px', userSelect: 'none' }}
        onMouseDown={onTreeMouseDown}
        onDragOver={e => { if (dragPath || e.dataTransfer.types.includes('Files')) { e.preventDefault(); setRootOver(true); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setRootOver(false); }}
        onDrop={e => { e.preventDefault(); setRootOver(false); onDropTo('', e); }}>
        <div data-hdr style={{ display: 'flex', alignItems: 'center', padding: '2px 8px 8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: MUTE, flex: 1 }}>{isEn() ? 'WORKSPACE' : '워크스페이스'}</span>
          <span onClick={(e) => { e.stopPropagation(); setCtx({ node: null, root: true }); }} title={isEn() ? 'New…' : '새로 만들기'} style={{ cursor: 'pointer', fontSize: '15px', fontWeight: 700, color: C.mint, padding: '0 4px' }}>+</span>
          <span onClick={(e) => { e.stopPropagation(); fileInput.current?.click(); }} title={isEn() ? 'Upload' : '업로드'} style={{ cursor: 'pointer', color: MUTE, padding: '0 4px', display: 'inline-flex' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></svg>
          </span>
          <span onClick={(e) => { e.stopPropagation(); setReloadKey(k => k + 1); }} title={isEn() ? 'Refresh' : '새로고침'} style={{ cursor: 'pointer', color: MUTE, padding: '0 4px', display: 'inline-flex' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
          </span>
        </div>
        {tree.map(n => <TreeNode key={n.path} node={n} depth={0} onOpen={openFile} onSelect={onSelect} selected={selected} onCtx={(node, e) => { if (!selected.has(node.path)) onSelect(node, e); setCtx({ node, x: e.clientX, y: e.clientY }); }} onDropTo={onDropTo} dragPath={dragPath} setDragPath={setDragPath} openDirs={openDirs} setOpenDirs={setOpenDirs} reloadKey={reloadKey} />)}
        {/* 빈 영역 — 우클릭 받도록 최소 높이 확보 */}
        <div style={{ minHeight: '140px' }} onContextMenu={e => { e.preventDefault(); setCtx({ node: null, x: e.clientX, y: e.clientY }); }} />
        {rootOver && <div style={{ position: 'absolute', inset: '4px', border: `2px dashed ${C.mint}`, borderRadius: '10px', pointerEvents: 'none' }} />}
      </div>
      {band && <div style={{ position: 'fixed', left: `${band.x}px`, top: `${band.y}px`, width: `${band.w}px`, height: `${band.h}px`, background: 'rgba(0,117,74,0.18)', border: `1px solid ${C.mint}`, zIndex: 90, pointerEvents: 'none' }} />}

      {/* 우: 에디터 (다크) */}
      <div style={{ flex: 1, minWidth: 0, background: BG, borderRadius: '12px', overflow: 'hidden', boxShadow: C.cardShadow, display: 'flex', flexDirection: 'column' }}>
        {tab ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 14px', borderBottom: `1px solid ${LINE}` }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: FG }}>{tab.path}{dirty ? ' •' : ''}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <span onClick={() => download(tab)} title={isEn() ? 'Download' : '다운로드'} style={{ cursor: 'pointer', color: MUTE, display: 'inline-flex', padding: '4px' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
                </span>
                <Btn variant="primary" small disabled={!dirty || !!meta} onClick={save}>{isEn() ? 'Save' : '저장'} (⌘S)</Btn>
              </div>
            </div>
            {meta?.binary ? <div style={{ padding: '40px', textAlign: 'center', color: MUTE }}>{isEn() ? 'Binary file — cannot edit here.' : '바이너리 파일 — 여기서 편집할 수 없습니다.'} <div style={{ marginTop: '12px' }}><Btn variant="darkOutline" small onClick={() => download(tab)}>{isEn() ? 'Download' : '다운로드'}</Btn></div></div>
              : meta?.tooLarge ? <div style={{ padding: '40px', textAlign: 'center', color: MUTE }}>{isEn() ? 'File too large (>2MB).' : '파일이 너무 큽니다 (2MB 초과).'}</div>
                : <div ref={editorHost} style={{ flex: 1, minHeight: 0, overflow: 'auto' }} />}
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: MUTE, fontSize: '13.5px', gap: '4px' }}>
            <div>{isEn() ? 'Select a file from the tree.' : '왼쪽 트리에서 파일을 선택하세요.'}</div>
            <div style={{ fontSize: '12px', opacity: 0.7 }}>{isEn() ? 'Drag files in to upload · drag items to move' : '파일을 끌어다 놓으면 업로드 · 항목 드래그로 이동'}</div>
          </div>
        )}
      </div>

      {ctx && (
        <div style={{ position: 'fixed', top: ctx.root ? '110px' : `${Math.min(ctx.y, window.innerHeight - 220)}px`, left: ctx.root ? '280px' : `${ctx.x}px`, zIndex: 100, background: '#fff', borderRadius: '10px', boxShadow: C.popShadow, padding: '5px', minWidth: '160px' }} onClick={e => e.stopPropagation()}>
          <MenuItem label={isEn() ? 'New file' : '새 파일'} onClick={() => act('newFile')} />
          <MenuItem label={isEn() ? 'New folder' : '새 폴더'} onClick={() => act('newDir')} />
          <MenuItem label={isEn() ? 'Upload files…' : '파일 업로드…'} onClick={() => act('upload')} />
          {clip?.paths?.length ? <MenuItem label={`${isEn() ? 'Paste' : '붙여넣기'} (${clip.paths.length})`} onClick={() => { const d = ctx.node ? (ctx.node.dir ? ctx.node.path : ctx.node.path.split('/').slice(0, -1).join('/')) : ''; setCtx(null); pasteClip(d); }} /> : null}
          {ctx.node && <>
            <div style={{ height: '1px', background: C.line, margin: '4px 0' }} />
            <MenuItem label={selected.size > 1 ? `${isEn() ? 'Copy' : '복사'} (${selected.size})` : (isEn() ? 'Copy' : '복사')} onClick={() => { setClip({ paths: [...(selected.size ? selected : [ctx.node.path])], cut: false }); setCtx(null); showToast(isEn() ? 'Copied' : '복사됨'); }} />
            <MenuItem label={selected.size > 1 ? `${isEn() ? 'Cut' : '잘라내기'} (${selected.size})` : (isEn() ? 'Cut' : '잘라내기')} onClick={() => { setClip({ paths: [...(selected.size ? selected : [ctx.node.path])], cut: true }); setCtx(null); showToast(isEn() ? 'Cut' : '잘라냄'); }} />
            {!ctx.node.dir && <MenuItem label={isEn() ? 'Download' : '다운로드'} onClick={() => act('download')} />}
            <MenuItem label={isEn() ? 'Rename' : '이름 변경'} onClick={() => act('rename')} />
            <MenuItem label={selected.size > 1 ? `${isEn() ? 'Delete' : '삭제'} (${selected.size})` : (isEn() ? 'Delete' : '삭제')} danger onClick={() => { setCtx(null); if (selected.size > 1) deleteSelected(); else act('delete'); }} />
          </>}
        </div>
      )}
    </div>
  );
}

const MenuItem = ({ label, onClick, danger }) => (
  <div onClick={onClick} style={{ padding: '7px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: danger ? C.danger : C.heading }}
    onMouseEnter={e => e.currentTarget.style.background = '#f4f2ec'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>{label}</div>
);
