import { execFileSync } from 'node:child_process';

// workspace repo에 대한 읽기 전용 git 조회 + CLAUDE.md 커밋
export function createGitApi(workDir) {
  const git = (...args) => execFileSync('git', args, { cwd: workDir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

  function branches() {
    const cur = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
    return git('for-each-ref', 'refs/heads', '--format=%(refname:short)').trim().split('\n').filter(Boolean)
      .map(name => ({
        name,
        current: name === cur,
        commits: Number(git('rev-list', '--count', name).trim()),
      }));
  }

  // 커밋 그래프: 레인 배치 포함 (단순 레인 할당 알고리즘)
  function graph(branch) {
    const range = branch ? [branch] : ['--all'];
    const raw = git('log', ...range, '--date-order', '--pretty=format:%H%x1f%P%x1f%an%x1f%at%x1f%s').trim();
    if (!raw) return [];
    const commits = raw.split('\n').map(l => {
      const [sha, parents, author, at, subject] = l.split('\x1f');
      return { sha, parents: parents ? parents.split(' ') : [], author, ts: Number(at) * 1000, subject };
    });
    // 레인 할당: 위(최신)에서 아래로. 각 레인은 "다음에 올 커밋 sha" 추적.
    const lanes = [];
    for (const c of commits) {
      let lane = lanes.indexOf(c.sha);
      if (lane === -1) { lane = lanes.indexOf(null); if (lane === -1) lane = lanes.length; }
      lanes[lane] = c.parents[0] || null;
      // 머지 커밋: 두 번째 부모에 새 레인
      for (let i = 1; i < c.parents.length; i++) {
        let pl = lanes.indexOf(c.parents[i]);
        if (pl === -1) { pl = lanes.indexOf(null); if (pl === -1) pl = lanes.length; lanes[pl] = c.parents[i]; }
      }
      // 동일 부모를 기다리던 다른 레인 정리(분기 합류)
      for (let i = 0; i < lanes.length; i++) {
        if (i !== lane && lanes[i] === c.sha) lanes[i] = null;
      }
      c.lane = lane;
      c.laneCount = lanes.length;
      const stat = statFor(c.sha);
      c.additions = stat.add; c.deletions = stat.del;
    }
    return commits;
  }

  function statFor(sha) {
    try {
      const out = git('show', sha, '--numstat', '--format=');
      let add = 0, del = 0;
      for (const line of out.trim().split('\n')) {
        const m = line.match(/^(\d+|-)\t(\d+|-)\t/);
        if (m) { add += m[1] === '-' ? 0 : Number(m[1]); del += m[2] === '-' ? 0 : Number(m[2]); }
      }
      return { add, del };
    } catch { return { add: 0, del: 0 }; }
  }

  function commitMeta(sha) {
    const [h, an, at, s] = git('log', '-1', sha, '--pretty=format:%H%x1f%an%x1f%at%x1f%s').split('\x1f');
    return { sha: h, author: an, ts: Number(at) * 1000, subject: s };
  }

  // 변경 파일 목록 + 파일별 diff
  function commitDiff(sha) {
    const nameStatus = git('show', sha, '--name-status', '--format=').trim();
    const files = nameStatus.split('\n').filter(Boolean).map(l => {
      const [status, ...p] = l.split('\t');
      return { status: status[0], path: p[p.length - 1] };
    });
    for (const f of files) {
      const st = fileStat(sha, f.path);
      f.additions = st.add; f.deletions = st.del;
      f.diff = fileDiff(sha, f.path);
    }
    return { meta: commitMeta(sha), files };
  }

  function fileStat(sha, path) {
    const out = git('show', sha, '--numstat', '--format=', '--', path).trim();
    const m = out.match(/^(\d+|-)\t(\d+|-)\t/);
    return m ? { add: m[1] === '-' ? 0 : Number(m[1]), del: m[2] === '-' ? 0 : Number(m[2]) } : { add: 0, del: 0 };
  }

  // diff 라인 파싱: [{t:'add'|'del'|'ctx'|'hunk', text}]
  function fileDiff(sha, path) {
    let out;
    try { out = git('show', sha, '--format=', '--', path); } catch { return []; }
    const lines = [];
    let inHunk = false;
    for (const line of out.split('\n')) {
      if (line.startsWith('@@')) { inHunk = true; lines.push({ t: 'hunk', text: line }); continue; }
      if (!inHunk) continue;
      if (line.startsWith('+')) lines.push({ t: 'add', text: line.slice(1) });
      else if (line.startsWith('-')) lines.push({ t: 'del', text: line.slice(1) });
      else lines.push({ t: 'ctx', text: line.slice(1) });
    }
    return lines.slice(0, 400);
  }

  // 커밋 시점 파일 트리 스냅샷
  function tree(sha) {
    const out = git('ls-tree', '-r', '--name-only', sha).trim();
    return out ? out.split('\n') : [];
  }

  function fileAt(sha, path) {
    const content = git('show', `${sha}:${path}`);
    let last = null;
    try {
      const [h, an, at, s] = git('log', '-1', sha, '--pretty=format:%h%x1f%an%x1f%at%x1f%s', '--', path).split('\x1f');
      last = { sha: h, author: an, ts: Number(at) * 1000, subject: s };
    } catch { /* no history */ }
    return { content: content.slice(0, 200_000), lastCommit: last };
  }

  // CLAUDE.md 저장 → 커밋 (Git 파일 뷰와 동기화)
  function commitFile(path, message, author = 'User') {
    git('add', path);
    try {
      git('-c', `user.name=${author}`, '-c', 'user.email=control@local', 'commit', '-m', message);
      return true;
    } catch { return false; /* 변경 없음 */ }
  }

  return { branches, graph, commitDiff, tree, fileAt, commitFile, commitMeta };
}
