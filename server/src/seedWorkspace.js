import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// 워크스페이스 git repo 초기화. 클린 상태 — README + CLAUDE.md 초기 커밋 1개만.
// 실제 에이전트 작업이 이후 커밋을 채운다. 데모 이력은 심지 않는다.
// 이미 repo면 아무것도 하지 않는다.
export function seedWorkspace(workDir, lang = process.env.CC_LANG || 'ko') {
  if (fs.existsSync(path.join(workDir, '.git'))) return false;
  fs.mkdirSync(workDir, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: workDir, encoding: 'utf8' });
  const as = (name) => ['-c', `user.name=${name}`, '-c', `user.email=${name.toLowerCase()}@agents.local`];
  const write = (rel, content) => {
    const p = path.join(workDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };

  let gitOk = true;
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { gitOk = false; }
  if (gitOk) { try { git('init', '-b', 'main'); } catch { gitOk = false; } }
  write('README.md', lang === 'en' ? '# Workspace\n\nWorking directory for the agent team.\n' : '# Workspace\n\n에이전트 팀 작업 공간.\n');
  if (lang === 'en') {
    write('CLAUDE.md', `# CLAUDE.md — Project Instructions (freely editable)

Project-specific instructions the team follows in this workspace.
Edit freely from the Team Lead screen → CLAUDE.md tab.

Note: core platform rules (Lead–Member structure, hire/dismiss approvals, working principles)
are enforced by a separate immutable constitution and cannot be changed here.
(See Team Lead screen → CLAUDE.md tab → "View platform constitution")

## Project goal · background
- (Describe what you want to build with this platform)

## Code conventions
- Commit messages in English, type prefixes (feat/fix/docs).

## Domain knowledge · cautions
- (Project-specific context the team should know)
`);
  } else write('CLAUDE.md', `# CLAUDE.md — 프로젝트 지침 (자유 편집 영역)

이 파일은 이 워크스페이스에서 팀이 따를 프로젝트별 지침입니다.
팀장 화면 → CLAUDE.md 탭에서 자유롭게 수정하세요.

참고: 팀장-팀원 구조, 고용/해고 승인 절차, 행동 원칙 등 플랫폼 핵심 규칙은
별도의 불변 지침으로 항상 적용되며 이 파일로 변경되지 않습니다.
(팀장 화면 → CLAUDE.md 탭 → "플랫폼 지침 보기"에서 확인 가능)

## 프로젝트 목표·배경
- (이 플랫폼으로 무엇을 하려는지 적어주세요 — 예: 업무 자동화, 신규 개발 프로젝트)

## 코드 컨벤션
- 커밋 메시지는 한국어, 타입 프리픽스(feat/fix/docs).

## 도메인 지식 · 주의사항
- (팀이 알아야 할 프로젝트 고유의 맥락을 적어주세요)
`);
  if (gitOk) {
    try {
      git('add', '-A');
      git(...as(lang === 'en' ? 'TeamLead' : '팀장'), 'commit', '-q', '-m', lang === 'en' ? 'chore: initialize workspace' : 'chore: 워크스페이스 초기화');
    } catch { /* git 실패해도 워크스페이스 파일은 유효 */ }
  } else {
    console.warn('[claude-control] git 미설치 — 워크스페이스를 git 없이 시드합니다 (Git 메뉴 비활성)');
  }
  return true;
}
