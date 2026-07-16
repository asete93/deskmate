import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// 외부 AI(OpenAI Codex CLI) 실행기 — provider='openai' 팀원의 실제 두뇌.
// `codex exec` 헤드리스 모드: 세션은 thread_id로 이어감(resume), 워크스페이스에서 작업.
// effort는 model_reasoning_effort 설정으로 전달 (minimal/low/medium/high/xhigh).
export const CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'];

// 진행 중 프로세스 (인터럽트용)
const active = new Map(); // agentId → child
export function killCodex(agentId) {
  const child = active.get(agentId);
  if (child) { try { child.kill('SIGTERM'); } catch { /* 이미 종료 */ } }
}

export function runCodex(agent, text, { workDir, uploadsDir, onSessionId }) {
  return new Promise((resolve) => {
    const outFile = path.join(os.tmpdir(), `codex-out-${agent.id}-${Date.now()}.txt`);
    const args = ['exec'];
    if (agent.session_id) {
      // resume: sandbox/-C/--add-dir 미지원 — 세션이 원래 작업 설정을 유지한다
      args.push('resume', agent.session_id);
    }
    args.push('--skip-git-repo-check', '--json', '--output-last-message', outFile);
    if (!agent.session_id) {
      args.push('--sandbox', 'workspace-write', '-C', workDir);
      if (uploadsDir) args.push('--add-dir', uploadsDir);
    }
    if (agent.model) args.push('-m', agent.model);
    if (agent.effort && CODEX_EFFORTS.includes(agent.effort)) {
      args.push('-c', `model_reasoning_effort="${agent.effort}"`);
    }
    args.push('-'); // 프롬프트는 stdin으로 — 다중라인·특수문자 안전

    const child = spawn('codex', args, {
      cwd: workDir,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    active.set(agent.id, child);
    child.stdin.write(text);
    child.stdin.end();

    let stderrTail = '';
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      // JSONL 이벤트에서 세션(thread) id 캡처 — 다음 턴 resume용
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'thread.started' && ev.thread_id) onSessionId?.(ev.thread_id);
        } catch { /* JSON 아닌 로그 라인 */ }
      }
    });
    child.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-800); });

    // 안전장치: 20분 초과 시 종료
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { } }, 20 * 60_000);

    child.on('close', (code) => {
      clearTimeout(killer);
      active.delete(agent.id);
      let reply = '';
      try { reply = fs.readFileSync(outFile, 'utf8').trim(); fs.unlinkSync(outFile); } catch { /* 출력 없음 */ }
      if (!reply) {
        reply = code === 0
          ? '(Codex가 응답 텍스트 없이 종료했습니다)'
          : `(Codex 실행 오류 — exit ${code}) ${stderrTail.split('\n').slice(-3).join(' ').slice(0, 200)}`;
      }
      resolve(reply);
    });
    child.on('error', (e) => {
      clearTimeout(killer);
      resolve(`(Codex CLI 실행 실패: ${e.message} — 서버에 codex가 설치되어 있는지 확인하세요)`);
    });
  });
}
