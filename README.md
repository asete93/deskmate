# Claude Control — My AI Team

**Claude Code를 "회사 조직"처럼 부리는 웹 플랫폼.**
대표(당신) → 팀장(메인 에이전트) → 팀원(서브 에이전트) 구조로, 채팅 한 줄로 지시하면 팀장이 판단·분해·위임하고 팀원이 구현하며, 결과는 검증을 거쳐 보고서·아티팩트로 돌아옵니다.

> A web platform that runs Claude Code as a company-like AI team — you are the CEO, a Team Lead agent plans & verifies, Worker agents implement.

![대시보드](docs/screenshots/dashboard.png)

## 핵심 컨셉

- **대표–팀장–팀원 구조가 플랫폼 레벨에서 강제됩니다.** 팀장은 판단·브리프·검증만 하고(파일 편집 툴이 물리적으로 차단됨), 구현은 팀원에게 위임합니다. 팀원 고용/해고는 대표의 결재를 거쳐야만 반영됩니다.
- **채팅방마다 독립된 기억.** 방을 나누면 주제별로 맥락이 섞이지 않고, 필요할 때는 팀장이 전체 이력을 검색해 참조합니다. 방별로 모델·effort도 다르게 지정해 토큰을 아낄 수 있습니다.
- **사람이 개입해야 할 지점은 카드로.** 선택지 질문·설정 입력·파일 수정 승인·산출물 검토가 채팅 카드로 도착하고, 답하면 에이전트가 그 지점부터 이어서 진행합니다.
- **산출물은 주석 리뷰 루프로.** 웹 결과물 위에 핀을 꽂아 코멘트하고 텍스트는 그 자리에서 직접 고치면, 구조화된 수정 지시서가 팀에 전달되고 반영본이 다시 검토로 돌아옵니다.

## 주요 기능

| 영역 | 기능 |
|---|---|
| 채팅 | 채팅방(방별 세션·기억·모델 스펙), 전 구성원과 소통(@이름·대상 지정), 위임 과정 실시간 표시, 파일/이미지 첨부(드래그·붙여넣기), 인터랙티브 카드(선택·다중선택·폼·diff 승인), 긴 보고는 요약+원문 팝업, 작업 중단, 대화 초기화, 안읽음 배지 |
| 조직 | 조직도, 대표 직접 고용(모델·effort 지정), 팀장 제안+대표 결재 고용, 외부 AI 팀원(OpenAI Codex), 팀원별 커스텀 지침, 1:1 직접 문의 |
| 결재 | 팀원 고용/해고·결정 사항·기타 카테고리, 스펙 조정 후 승인, 결재 이력 |
| 산출물 | 요청(REQ)별 진행·토큰 집계, 산출 보고서(웹 열람 + **PPTX/Excel 다운로드**), 아티팩트 **주석(핀) 리뷰 루프**, 티켓 보드, Git 커밋 이력 |
| 운영 | 웹 **터미널**(서버 셸 접근), 예약 작업(정기 지시), 구독 사용량 실시간 위젯, 서비스 스위처(다중 인스턴스), 실행 모드(Plan/Auto/Ask) |
| 플랫폼 | 다국어(한국어/English — UI와 **에이전트 동작 언어**까지 전환), 로그인(단일 비밀번호 + 분실 복구 + 브루트포스 방어), 접근 IP 대역 제한, 불변 플랫폼 지침(4계층) |

## 빠른 시작

요구사항: **Node.js ≥ 22.5**, Claude Pro/Max 구독(권장) 또는 Anthropic API 키.

```bash
# GitHub에서 바로 실행 (설치 즉시 기동 — 빌드 불필요)
npx github:<유저명>/claude-control

# 주요 옵션
npx github:<유저명>/claude-control \
  --port auto \                     # 남는 포트 자동 할당 (기동 배너에 실제 주소 표시)
  --name myproject \                # 데이터 공간 분리 (~/.claude-control/myproject)
  --allow 192.168.0.0/16 \          # 접근 허용 IP 대역 (미지정 시 전체 허용)
  --https \                         # 자체 서명 인증서로 HTTPS 기동 (클립보드 등 secure 기능)
  --driver sdk                      # mock | sdk | auto
```

인증(실 Claude 구동) — 셋 중 하나:

```bash
# 1) 권장: Claude 구독 장기 토큰
claude setup-token   # 발급 후
CLAUDE_CODE_OAUTH_TOKEN=<토큰> npx github:<유저명>/claude-control

# 2) 이미 `claude /login` 된 머신이면 그대로 실행 (자동 감지 → sdk 승격)

# 3) API 키
ANTHROPIC_API_KEY=sk-ant-... npx github:<유저명>/claude-control
```

기동하면 배너에 접속 주소가 출력됩니다:

```
┌──────────────────────────────────────────────────
│  Claude Control · myproject
│  ▶ http://localhost:34357  (bind 0.0.0.0:34357)
└──────────────────────────────────────────────────
```

인증 없이 실행하면 **mock 드라이버**(전 플로우 시뮬레이션)로 떠서 UI를 미리 볼 수 있습니다.

## 화면

| | |
|---|---|
| ![채팅](docs/screenshots/chat-room.png) | ![주석 리뷰](docs/screenshots/review.png) |
| 채팅방 — 위임 과정·REQ 경계·토큰이 한 흐름에 | 주석 리뷰 — 결과물에 핀을 꽂고 텍스트를 직접 수정 |
| ![조직도](docs/screenshots/org-chart.png) | ![결재](docs/screenshots/approvals.png) |
| 회사 조직도 | 결재 — 팀장이 올린 안건을 스펙 조정 후 승인 |

전체 기능 설명은 **[사용자 가이드](docs/USER_GUIDE.md)** 를 참고하세요.

## 데이터와 영속성

- 모든 데이터(대화·방·설정·보고서·워크스페이스·업로드)는 `~/.claude-control/<name>/`에 저장됩니다 — **서버를 재기동해도, npx를 새로 받아도 유지**됩니다.
- 에이전트의 대화 기억은 방별 세션으로 저장되어 재기동 후 이어집니다. 세션 파일이 유실되면 자동으로 새 세션으로 복구되고 채팅 이력은 DB에 남습니다.
- 상시 운영은 systemd 등록을 권장합니다(부팅 자동시작 + 크래시 복구) — [사용자 가이드의 배포 절](docs/USER_GUIDE.md#12-배포) 참고.

## 보안

- **로그인**(설정에서 on): 단일 비밀번호(scrypt 해시), 실패 5회 = 15분 잠금 + 전역 시도 제한, API·파일·WebSocket 전부 보호.
- **비밀번호 분실**: 서버에서 `touch ~/.claude-control/<name>/reset-password` — 다음 로그인 시도 때 초기화(서버 쉘 접근 = 소유자 증명).
- **`--allow <CIDR>`**: 신뢰 대역 밖 요청은 전부 403.
- 대시보드 접근자는 에이전트를 통해 서버에서 명령을 실행할 수 있습니다 — **공개망 배포 시 로그인은 필수**, 외부 노출 시 TLS 리버스 프록시를 권장합니다.

## 아키텍처

```
server/   Node 22.5+ · Express · ws · node:sqlite (네이티브 모듈 0)
web/      Preact · esbuild 번들 (dist 커밋 — 설치 시 빌드 불필요)
데이터     ~/.claude-control/<name>/  (control.db · workspace/ · uploads/)
```

앱 SQLite가 단일 진실 소스(세션이 죽어도 상태 유지), 드라이버 추상화(mock/sdk), 4계층 지침 구조(서버 로직 → 불변 플랫폼 지침 → 프로젝트 CLAUDE.md → 런타임 설정). 자세한 설계는 [ARCHITECTURE.md](ARCHITECTURE.md).

## 라이선스

미정 (공개 시 결정)
