import fs from 'node:fs';
import path from 'node:path';

// 워크스페이스 한정 파일 API. 모든 경로는 workDir 하위로 강제(경로 탈출 차단).
export function createFilesApi(workDir) {
  const root = path.resolve(workDir);

  // 상대경로 → 절대경로. root 밖이면 에러.
  function resolve(rel) {
    const abs = path.resolve(root, '.' + path.sep + (rel || '').replace(/^\/+/, ''));
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('워크스페이스 밖 경로는 접근할 수 없습니다');
    return abs;
  }

  const IGNORE = new Set(['.git', 'node_modules']);
  const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tar', '.mp4', '.mp3', '.woff', '.woff2', '.ttf', '.otf', '.exe', '.bin', '.so', '.dylib']);

  // 디렉터리 목록 (한 단계). dirs 먼저, 이름순.
  function list(rel = '') {
    const abs = resolve(rel);
    const st = fs.statSync(abs);
    if (!st.isDirectory()) throw new Error('디렉터리가 아닙니다');
    const items = fs.readdirSync(abs, { withFileTypes: true })
      .filter(d => !IGNORE.has(d.name))
      .map(d => {
        const childRel = path.posix.join(rel.replace(/\\/g, '/'), d.name);
        let size = 0; try { size = d.isFile() ? fs.statSync(path.join(abs, d.name)).size : 0; } catch { /* noop */ }
        return { name: d.name, path: childRel, dir: d.isDirectory(), size };
      })
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    return items;
  }

  function read(rel) {
    const abs = resolve(rel);
    const st = fs.statSync(abs);
    if (st.isDirectory()) throw new Error('디렉터리는 열 수 없습니다');
    if (st.size > 2 * 1024 * 1024) return { path: rel, tooLarge: true, size: st.size };
    if (BINARY_EXT.has(path.extname(abs).toLowerCase())) return { path: rel, binary: true, size: st.size };
    return { path: rel, content: fs.readFileSync(abs, 'utf8'), size: st.size };
  }

  function write(rel, content) {
    const abs = resolve(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(content ?? ''));
    return { path: rel, size: Buffer.byteLength(String(content ?? '')) };
  }

  function createNode(rel, dir) {
    const abs = resolve(rel);
    if (fs.existsSync(abs)) throw new Error('이미 존재합니다');
    if (dir) fs.mkdirSync(abs, { recursive: true });
    else { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, ''); }
    return { path: rel, dir: !!dir };
  }

  function remove(rel) {
    const abs = resolve(rel);
    if (abs === root) throw new Error('루트는 삭제할 수 없습니다');
    fs.rmSync(abs, { recursive: true, force: true });
    return { ok: true };
  }

  function rename(rel, toRel) {
    const abs = resolve(rel); const dst = resolve(toRel);
    if (fs.existsSync(dst)) throw new Error('대상 경로가 이미 존재합니다');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(abs, dst);
    return { path: toRel };
  }

  // DnD/붙여넣기 이동: src를 dstDir(폴더) 안으로. 같은 이름 있으면 에러.
  function move(srcRel, dstDirRel) {
    const abs = resolve(srcRel);
    const name = path.basename(abs);
    const dstDir = resolve(dstDirRel || '');
    if (!fs.statSync(dstDir).isDirectory()) throw new Error('대상이 폴더가 아닙니다');
    const dst = path.join(dstDir, name);
    if (abs === dst) return { path: srcRel };
    if (dst.startsWith(abs + path.sep)) throw new Error('폴더를 자기 하위로 옮길 수 없습니다');
    if (fs.existsSync(dst)) throw new Error('대상 폴더에 같은 이름이 이미 있습니다');
    fs.renameSync(abs, dst);
    return { path: path.relative(root, dst).split(path.sep).join('/') };
  }

  // 업로드(멀티파트 파일 버퍼) 또는 붙여넣기 저장 — dstDir 안에 name으로. 중복이면 이름 뒤 (n).
  function saveUpload(dstDirRel, name, buffer) {
    const dstDir = resolve(dstDirRel || '');
    fs.mkdirSync(dstDir, { recursive: true });
    const safe = String(name).normalize('NFC').replace(/[/\\]/g, '_');
    let target = path.join(dstDir, safe);
    if (target !== resolve(path.relative(root, target).split(path.sep).join('/'))) throw new Error('잘못된 경로');
    const ext = path.extname(safe); const base = safe.slice(0, safe.length - ext.length);
    let i = 1;
    while (fs.existsSync(target)) { target = path.join(dstDir, `${base} (${i++})${ext}`); }
    fs.writeFileSync(target, buffer);
    return { path: path.relative(root, target).split(path.sep).join('/') };
  }

  // 복사: src를 dstDir 안으로 (파일·폴더 재귀). 같은 이름이면 "이름 (복사본)".
  function copy(srcRel, dstDirRel) {
    const abs = resolve(srcRel);
    const name = path.basename(abs);
    const dstDir = resolve(dstDirRel || '');
    if (!fs.statSync(dstDir).isDirectory()) throw new Error('대상이 폴더가 아닙니다');
    if (dstDir === abs || dstDir.startsWith(abs + path.sep)) throw new Error('폴더를 자기 하위로 복사할 수 없습니다');
    const ext = path.extname(name); const base = name.slice(0, name.length - ext.length);
    let dst = path.join(dstDir, name); let i = 1;
    while (fs.existsSync(dst)) dst = path.join(dstDir, `${base} (복사본${i > 1 ? ' ' + i : ''})${ext}`), i++;
    fs.cpSync(abs, dst, { recursive: true });
    return { path: path.relative(root, dst).split(path.sep).join('/') };
  }

  // 다운로드용 절대경로 (라우트에서 res.download)
  function absPath(rel) { return resolve(rel); }

  return { list, read, write, createNode, remove, rename, move, copy, saveUpload, absPath };
}
