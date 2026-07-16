# 검증 결과 — BUILD_PROMPT 체크리스트 32항 + Q1–Q4

검증 방법: Docker 2기(:3200/:3201) 기동 → REST/WS 스모크 테스트 + Playwright 9화면 워크스루(콘솔 에러 0) + 크래시 복구 시나리오.

## 체크리스트 (32/32)

| # | 항목 | 상태 | 검증 방식 |
|---|---|---|---|
| 1 | 메인 에이전트 1개 (계획·검증·의도) | ✅ | Orchestrator 세션, 직접 구현 안 함 (디스패치만) |
| 2 | 서브 에이전트 실제 수행 | ✅ | Builder/Verifier 디스패치 플로우 REST 테스트 |
| 3 | 사용자·메인·서브 커뮤니케이션 이력 | ✅ | messages 테이블 + 채팅/요청 로그 화면 |
| 4 | 타임라인 히스토리 | ✅ | events 테이블, 대시보드 TIMELINE, WS 실시간 |
| 5 | 티켓별 이슈 처리 + 상세 | ✅ | 티켓 모달 처리 이력 (history 2건+ 확인) |
| 6 | 목표 수정 | ✅ | 모달 저장 → Orchestrator 재수립 메시지 + 타임라인 |
| 7 | 적용된 MD 확인·수정 | ✅ | CLAUDE.md 탭 → 저장 → 파일 반영 + git 커밋 확인 |
| 8 | 서브 직접 문의 | ✅ | sub:{id} 1:1 채팅 REST 테스트 |
| 9 | 메인·서브 model/effort 변경 | ✅ | 설정 필/카드 패널 → API 반영 |
| 10 | 인터랙션 카드 4종 | ✅ | choice/diff/artifact/form 전부 트리거·응답 테스트 |
| 11 | 아티팩트 GUI 소통 | ✅ | 미리보기 카드 렌더 (Playwright 확인) |
| 12 | 승인 페이지 + 요청 사유 전문 | ✅ | Designer 추가 요청 → 사유 표시 → 승인 → 목록 반영 |
| 13 | 모바일 반응형 | ✅ | 390px 뷰포트 스크린샷 — 하단 탭 9종 + 배지 |
| 14 | model/effort 화면 통합 | ✅ | 메인 설정 필 · 서브 카드 확장 패널 |
| 15 | 티켓 테이블 뷰 | ✅ | 보드/테이블 토글 + 상태 정렬 |
| 16 | 동일 서비스 연결 + 현재 연결 표시 | ✅ | :3200/:3201 2기 + "현재 연결됨" 뱃지 |
| 17 | 사이드패널 서비스 전환 | ✅ | CONNECTED SERVICE 스위처 (CORS 검증) |
| 18 | 미답변 알림 인디케이터 | ✅ | 골드 배지 — pending interaction/approval 카운트 |
| 19 | 요청별 에이전트 소통 스레드 | ✅ | REQ 상세: 보낸이→받는이 라우팅 칩 |
| 20 | 외부 AI 서브 연동 | ✅ | GPT-5 연동 → model 고정 확인 (effort만 변경 가능) |
| 21 | 조직도 | ✅ | User→Orchestrator→서브 트리 + 연결선 |
| 22 | Git History + 파일 확인 | ✅ | 실 git repo 연동 |
| 23 | 브랜치 드롭박스 + 그래프 | ✅ | 2레인 그래프 (merge 곡선), 브랜치별 커밋 수 |
| 24 | 변경 파일 이력 탭 | ✅ | A/M 태그 + diff 뷰 (추가=민트/삭제=레드) |
| 25 | 파일트리 탭 (커밋 시점) | ✅ | git ls-tree 스냅샷 + 소스 뷰어 + 마지막 커밋 메타 |
| 26 | 서브 삭제 (사용자) | ✅ | 확인 모달 → 삭제 → Orchestrator 회수 메시지 |
| 27 | 서브 개별 model/effort | ✅ | 카드 "모델 설정" 확장 패널 |
| 28 | Settings에 서브 설정 없음 | ✅ | Settings = 서비스 연결 + 알림 채널만 |
| 29 | 설정 연 카드만 확장 | ✅ | grid align-items:start |
| 30 | 알림 채널 등록 | ✅ | Discord/Slack 웹훅 실발송, Email/카카오 스텁 (발송 로그 확인) |
| 31 | Settings에 메인 설정 없음 | ✅ | 메인 설정은 채팅 화면 필에서만 |
| 32 | Plan/Auto/Ask Mode | ✅ | MODE 전환 → Orchestrator 확인 메시지 |

## Q1–Q4 대응 검증

- **Q1 (세션 사망)**: 서버 kill → 재기동 → pending 인터랙션 1건 유지 + 재기동 후 응답 성공. 채팅/타임라인 무손실 (앱 DB가 진실 소스). SDK 모드는 session_id 저장 + resume.
- **Q2 (답변 대기)**: 인터랙션 게이트 = DB 영속 + WS push + promise 홀드. 4종 카드 전부 왕복 테스트 통과. SDK 모드는 canUseTool 홀드(타임아웃 없음) + 재시작 시 resume 주입.
- **Q3 (동시 수정)**: CLAUDE.md 저장 → 파일 반영 + git 커밋 + 실행 중 세션에 변경 통지 주입. 서브별 세션 분리. (다중 세션 동일 cwd 동시 편집은 아키텍처상 워크스페이스 분리 권장 — ARCHITECTURE.md)
- **Q4 (기타)**: 외부 AI = 어댑터 스텁 + model 고정, 카카오 = 스텁, effort 미드세션 변경 = 세션 재시작 처리, 보안 주의사항 문서화.

## 추가 기능 — REQ 산출 보고서 (2026-07-13)

| 항목 | 상태 | 검증 방식 |
|---|---|---|
| 요청 카드 "보고서" 뱃지 (report 있을 때만) | ✅ | Playwright — 뱃지 2건(REQ-1 시드 + REQ-3 자동 생성), 미완료 요청엔 미노출 |
| 요청 상세 "보고서 확인" 버튼 | ✅ | report 있는 요청에만 노출 |
| 인터랙티브 HTML 보고서 모달 | ✅ | 다크 헤더(sticky)+메타+SUMMARY(크림)+지표 그리드+줄무늬 표+섹션 렌더 확인 |
| PPTX 내보내기 | ✅ | pptxgenjs 실생성 — 슬라이드 6장(표지/요약/지표/표/섹션×2), zip 매직 바이트, 브라우저 다운로드 확인 |
| Excel 내보내기 | ✅ | exceljs 실생성 — Summary/Metrics/Data/Sections 4시트 확인 |
| 반응형 | ✅ | 390px — 지표 스택, 표 가로 스크롤 |
| 자동 생성 | ✅ | 디스패치 플로우 완료 시 목 드라이버가 보고서 작성 · SDK 모드는 `submit_report` MCP 툴 |

## 실 Claude Code 연동 검증 (2026-07-13, SDK 0.1.77, 구독 인증)

호스트의 Claude Code 구독 인증(ambient creds, API 키 없음)으로 `AGENT_DRIVER=sdk` 기동 후:

| 검증 | 결과 |
|---|---|
| 실 Orchestrator 세션 기동 | ✅ 실 Claude 응답 (SDK가 CLI 서브프로세스로 구독 인증 사용) |
| 답변 대기 게이트 (핵심) | ✅ `ask_choice` MCP 툴 호출 → choice 카드 생성 → pending=1로 **블록** |
| 웹 답변 제출 → 세션 재개 | ✅ 답 제출 후 tool result 수신 → "React 선택하셨습니다" 후속 응답 |
| 인증 없이 부팅 시 크래시 방지 | ✅ try/catch로 세션 오류 격리, 서버 생존 |

### SDK API 검증으로 수정한 것 (이전 리서치 오류 2건)
- `effort`는 SDK Options에 **없음** → query에서 제거, 앱 메타데이터로만 유지.
- permissionMode `'auto'` **없음** → 실제 값 `default|acceptEdits|bypassPermissions|plan|delegate|dontAsk`. MODE_MAP은 유효 값만 사용(문제 없었음).
- 검증 완료: `setModel`/`setPermissionMode`/`interrupt`(런타임), `canUseTool`/`resume`/`mcpServers`/`settingSources`/`systemPrompt.append`(타입 정의).
- AskUserQuestion-via-canUseTool 대신 커스텀 MCP 툴(`ask_choice`)을 주 경로로 채택 (제어 확실).

## 미검증/한계

- 크래시 후 resume 주입(onInteractionAnswered)은 실세션에서 미검증 (구조는 정상, mock에서 검증).
- 외부 AI 실 API 호출 / 카카오톡 실발송 / SMTP 발송은 스텁.
- 장수명 세션 N개 상시 유지 시 구독 사용량 소모 — idle 세션 종료 정책은 후속 과제.
