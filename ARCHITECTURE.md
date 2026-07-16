# Claude Control — 아키텍처

Claude Code 웹 제어 멀티 에이전트 오케스트레이션 대시보드.
UI 기준: `../Claude Control.dc.html` (Green Apron 디자인 시스템), 기능 기준: `../BUILD_PROMPT.md`.

## 핵심 설계 원칙

1. **앱 DB가 단일 진실 소스.** 채팅 이력·타임라인·요청 로그·티켓·승인은 전부 서버 SQLite에 이벤트로 기록.
   Agent SDK transcript는 "재시작 가능한 워커의 내부 상태"로만 취급 — UI는 절대 SDK transcript에 의존하지 않는다.
   → 세션이 죽어도 UI 이력 무손실 (Q1 대응).
2. **인터랙션 게이트 = DB 영속 + promise 홀드.** 에이전트가 질문(AskUserQuestion)·승인을 요구하면
   `interactions` 테이블에 저장 후 WS push. 답변 오면 resolve. 프로세스 재시작 시 미답변 인터랙션은
   DB에서 복원되고, 답변 도착 시 `resume: sessionId` + 답 주입으로 세션 재개 (Q2 대응).
3. **서브 에이전트 = 독립 top-level 세션.** SDK subagent(Task)는 일회성이므로 1:1 채팅 불가.
   Orchestrator ↔ 서브 간 지시는 백엔드 릴레이가 중계하고, 그 지점에서 요청 로그(REQ 스레드)에 기록.
4. **CLAUDE.md 수정은 파일 쓰기 + 세션 통지.** 세션은 CLAUDE.md를 시작 시 한 번만 읽으므로,
   저장 시 파일 반영 + 실행 중 세션에 변경 통지 메시지 주입 (Q3 대응).
5. **드라이버 추상화.** `MockDriver`(API 키 불필요, 전체 플로우 시뮬레이션) / `SdkDriver`(실 Agent SDK).
   `ANTHROPIC_API_KEY` 있으면 SDK, 없으면 목. `AGENT_DRIVER=mock|sdk`로 강제 가능.

## 구성

```
docker compose
 ├─ control-a  :3200  (SERVICE_NAME="Claude Control A", volume data-a)
 └─ control-b  :3201  (SERVICE_NAME="Claude Control B", volume data-b)
```
동일 이미지 2개 인스턴스 → 사이드패널 CONNECTED SERVICE 스위처 데모.
프론트가 API/WS 베이스 URL을 바꿔 연결(서비스 레지스트리는 localStorage, CORS 전체 허용).

## 서버 (Node 24, ESM, 의존성 최소)

```
server/src/
  index.js        http 서버 + 정적 서빙 + WS 허브
  db.js           node:sqlite 스키마/쿼리 (네이티브 모듈 0개)
  bus.js          이벤트 버스 → WS broadcast + 타임라인 기록
  api.js          REST 라우트
  gitApi.js       git CLI 래핑 (브랜치/그래프/diff/트리 스냅샷/파일 원본)
  notify.js       Discord/Slack 웹훅 실발송, Email/카카오 스텁
  agents/
    manager.js    에이전트 CRUD·세션 수명주기·인터랙션 게이트·승인 플로우
    mockDriver.js 스크립트된 오케스트레이터/서브 (전 카드 타입·승인·티켓 시뮬)
    sdkDriver.js  @anthropic-ai/claude-agent-sdk 연동 (canUseTool, resume, setModel/setPermissionMode)
  seedWorkspace.js  데모 git repo 생성 (main + feature 분기·머지, 에이전트 작성자)
```

### DB 스키마 (SQLite, `data/control.db`)

| 테이블 | 용도 |
|---|---|
| `agents` | id, name, kind(main/sub), role, model, effort, status, provider(외부AI), session_id, deleted |
| `messages` | 채팅+에이전트 간 통신. from_actor, to_actor, channel(main/sub:<id>), request_id, kind(text/choice/diff/artifact/form/system), content JSON, answered, answer JSON |
| `interactions` | 미답변 게이트. message_id, agent_id, type, payload, status(pending/answered) |
| `requests` | REQ-N. title, status(진행 중/검토 대기/완료), created_at |
| `tickets` | TKT-N. title, desc, status(backlog/in_progress/review/done), priority, assignee, history JSON |
| `approvals` | 서브 추가/삭제 승인. action(add/remove), target JSON(name/model/effort/role), reason, status |
| `events` | 타임라인. ts, actor, actor_type(user/main/sub), text |
| `settings` | goal, mode(plan/auto/ask), progress, notif_channels JSON, claude_md 경로 등 |

### REST (요약)

`GET /api/state` 전체 스냅샷(부팅용) ·
`POST /api/goal` · `POST /api/mode|model|effort` (main/서브별) ·
`POST /api/chat/:channel` 메시지 전송 · `POST /api/interactions/:id/answer` ·
`POST /api/agents` (외부 AI 연동 포함) · `DELETE /api/agents/:id` ·
`POST /api/approvals/:id/decide` ·
`GET /api/git/branches|graph|commit/:sha/diff|commit/:sha/tree|commit/:sha/file` ·
`GET/POST /api/claude-md` · `GET/POST /api/tickets` ·
`GET/POST/DELETE /api/notify-channels` · `GET /api/service-info`

### WS

`ws://host/ws` — 서버 push: `{type: message|interaction|agents|tickets|approvals|event|settings|request}`.
클라이언트는 스냅샷(GET /api/state) 후 증분 반영.

## 에이전트 수명주기 (SdkDriver)

- 에이전트별 `query()` 스트리밍 입력 세션. `session_id` DB 저장.
- `canUseTool`: AskUserQuestion/Edit 승인 → interactions 저장 + WS push + 알림 발송, promise 홀드.
- 프로세스 재시작: pending interaction은 DB 복원 → 답변 도착 시 `resume` 새 query에 답 주입.
- MODE 매핑: Plan→`plan`, Auto→`acceptEdits`(파일)+승인 항목만 게이트, Ask→`default`.
- 모델 변경 `setModel()`, 모드 변경 `setPermissionMode()` — 미드 세션.
  effort는 setter 없음 → 세션 종료 후 resume로 재시작.
- 서브 작업 지시: Orchestrator 결과를 백엔드가 파싱(디스패치 프로토콜) → 해당 서브 세션에 주입,
  왕복 메시지를 REQ 스레드에 기록.

## 프론트 (Preact + htm, esbuild 번들, 프레임워크 CDN 불필요)

```
web/src/
  main.jsx     라우팅(해시) + 스토어 + WS 클라이언트
  store.js     전역 상태 (스냅샷 + WS 증분)
  api.js       fetch 래퍼 (현재 서비스 베이스 URL)
  ui.jsx       공통(버튼/필/칩/모달/토스트)
  screens/     dashboard, chat, subs, requests, org, git, tickets, approvals, settings
```
- 디자인 토큰: §5 (크림 #f2f0eb, 그린 #006241/#00754a/#1e3932/#2b5148, 골드 #cba258, 위험 #c82014,
  12px 카드+이중 섀도, 50px pill 버튼 press scale(0.95), Pretendard, 그라데이션·이모지 금지).
- 반응형 840px: 데스크톱 사이드패널 236px sticky / 모바일 하단 탭 9종 + 헤더 서비스 필.

## 보안 주의

데모 목적으로 인증 없음 + CORS 개방. **신뢰 네트워크 밖 배포 금지.**
실사용 시: 토큰 인증, Auto Mode(bypass급) 제한, 바인딩 제한 필요.

## 알려진 한계

- 외부 AI(GPT-5/Gemini/Grok) 어댑터는 인터페이스만 정의, provider 뱃지·고정 모델 동작은 구현,
  실 API 호출은 스텁 (키 등록 구조만).
- 카카오톡 알림은 비즈니스 API 필요 → 등록/토글 가능하되 발송은 스텁 로그.
- Email은 SMTP_URL 설정 시 발송, 미설정 시 스텁 로그.
