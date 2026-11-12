# UX 원칙 기반 리디자인

## 검증 환경 · 최신 사용자 재개 지시

사용자 작업 방해 피드백으로 CUA를 중단한 뒤 ‘아휴 아니다 그냥 해줘라’ 재개 지시를 받았다. 필요한 실제 검증을 ADE 프리뷰에서 짧게 묶어 수행한다. 기존 사용자 터미널/프로세스에 입력하지 않는다. OOM일 때 창 앱만 재시작 가능하다는 승인은 유지하며 코어는 보존한다. 임시 fixture 자동 검사와 실제 화면 조작 근거를 구분한다.

## 현재 방향 · ADE 재구성 계획 제안

2026-11-06 사용자 후속 정정이 아래 기존 점진 이식 계획보다 우선한다. 사용자는 기존 구현의 내부 로직 보존까지 요구한 것이 아니며, 승인 데모를 기준으로 처음부터 작은 단위로 만들기를 요청했다. 제품 목적은 한 ADE에서 대부분의 개발 작업을 처리하는 것이다. DB는 후순위다.

사용자가 제안에 동의하고 ‘계획 세우고 진행’을 지시했다. 현재 실행 모드는 **전체 완료까지 연속 진행**이다. 사용자는 단계별 중단 대신 완료까지 진행할 것을 명시했다. [ADE 재구성 계획](12-ade-rebuild-plan.md)이 최신 기준이다. UI 기반 → 핵심 ADE 작업 흐름 → 통합 편집기 → DB 순서, 편집기 입력/단축키/IME의 작은 선행 검증과 화면별 실제 검증을 따른다. 기존 T28–T38의 수리/설치 경로를 추가 진행하지 않는다.

| 새 단계 | 상태 | 다음 판단 |
| --- | --- | --- |
| UI/작업흐름 재계획 | 사용자 수락 | 아래 네 단계로 순차 구현 |
| UI 기반·ADE 프레임 | T39 첫 프레임·핵심 조작 검증 | [결과](results/T39-ade-shell-rebuild.md). 다섯 슬롯 collapse/reopen·크기 보존·native split·탭·갤러리 확인, 확대/작은 창 검증 남음 |
| 핵심 ADE 기능 | T40–T48 새 구현·일부 실제 확인 | 프로젝트/탐색/검색/검토/설정/독립 실행 결과, 실제 파일 저장·실행 exit0/로그 확인 |
| 통합 편집기 | T44/T45/T48/T54 구현·실제 IME 확인 | CodeMirror 문서 모델 + native 입력, ㅇ→아→안·연속 한글·저장 확인. 단일 탭 host/LSP 후속 실제 검사 중 |
| DB | T49/T51/T52/T53 구현·통합 중 | 새 연결/트리/표/SQL/전송과 하단 결과 host, SQLite 실제 왕복 대기 |

기존 조사·작업·결함 기록은 아래에 보존한다. 새 구조의 완료 근거로 자동 승계하지 않는다. 공통 설계/작업 분해/경계 계약은 새 계획에, 첫 구현 단위는T39에, 검증은06에 기록한다.

## 현재 배치 · T40–T54

- 새 모듈 `mods/ade`에서 승인 데모 기준 프레임과 동작을 구성한다. 이전 codenav UI/controller는 새 화면의 기반으로 사용하지 않는다.
- 테스트 공간 `ADE 검증`과 소유 임시 Git/SQLite fixture로 검증한다. 실제 한글 IME 조합/연속 입력, 파일 저장, 독립 실행 stdout/exit0와 하단 표시를 관찰했다.
- 터미널은 core 탭 단위이며 선택 탭의 전체 native pane tree를 표시한다. 새 탭 및 오른쪽 pane 분할 실제 확인. 확대/이동/닫기 후속 확인 중.
- 최신 사용자 보고: DB가 터미널 아래에 나타남. T51 수정은 왼쪽 위/왼쪽 아래/오른쪽 위/오른쪽 아래/하단 다섯 슬롯을 실제 native 형제 순서에 반영한다. 같은 슬롯만 배타 전환하고 다른 슬롯·manual 크기·pane payload·알 수 없는 자식을 보존한다. 설치 도구도 같은 순수 migration을 재사용한다.
- `EditorHost` 단일 파일/DB 문서 탭, `ResultsHost` 단일 실행/SQL 결과 탭을 root에서 통합했다. native 전체 표면 검사와 실제 SQLite/미저장 LSP 검증 후 완료 여부를 판단한다.
- batch 설치만 진행해 HMR churn을 줄인다. OOM 시 창 앱 재시작은 사용자 승인되어 있으나 core는 종료하지 않는다.

최신 실제 통합 근거와 발견한 오류/교정/남은 검증은 [T55 native 통합](results/T55-native-integration.md)에 기록한다. 현재 Mac 잠금 해제와 공유 엔진 재시작 응답을 기다리는 동안 자동 회귀를 마쳤다. 전체 완료 아님.

## 이전 진행 기록

2026-11-06. 사용자 재시작 후 실제 앱에 접근했다. 후속 지시에 따라 구현을 중지하고 승인 데모와 설치본의 변경점을 감사했다. [통합 변경 목록](09-demo-native-audit.md)이 현재 기준이다. 이후 목표를 단일 편집 UI·미저장 LSP·소스 뷰어 대체로 구체화해 [심화 검토](10-unified-editor-review.md)를 완료했다. 작업 브랜치는 `codex/ux-principles-redesign`이며 기존 미커밋 DB·프로젝트 정렬 작업을 유지한다.

중앙 편집기와 좌·우·아래 도구 영역을 유지한다. 현재 소스 뷰어와 탐색 경로는 보존하되 최종 목표는 같은 native 편집 표면에 LSP를 연결하고 검증 후 소스 뷰어 역할을 대체하는 것이다. Markdown은 같은 buffer의 편집·미리보기로 유지한다. 특정 제품의 외관 정합 목표를 UX 원칙 기반의 자체 디자인 시스템으로 대체한다. 공통 아이콘 규칙과 DB 개선 방향도 포함한다. YAGNI·KISS·DRY와 검증된 라이브러리 재사용을 적용한다.

## 단계

| 단계 | 상태 | 산출물 | 완료 조건 |
| --- | --- | --- | --- |
| 조사 | 완료 | 01-discovery.md | UX 원칙과 현재 코드, DB 기능 근거 연결 |
| 요구사항·설계 | 완료 | 02-requirements.md, 03-architecture.md | 뷰어 유지와 텍스트 모드 전환 반영 |
| 구현 | 재개·첫 배치 설치 | tasks/, results/T28-owned-editor-integration.md | 자체 편집기/실행 P0/선택기/설정, 실제 UI 검증 대기 |
| 통합 검증 | 실제 불일치 확인 | 07-integration-review.md | 이전 자동 검사 25종 통과, 실제 실행 위치·추적과 시각 차이 미해결 |
| 변경점 감사 | 완료 | 09-demo-native-audit.md | 설정·DB·공통 UI·실행 P0·자체 편집기 사실/추정 구분 |
| 편집기 심화 검토 | 완료·모드 소유 구현으로 대체 | 10-unified-editor-review.md, 11-custom-editor-implementation.md | 앱 본체 변경 없이 문서·표시·입력·LSP 소유 |
| 자체 편집기 구현 | 진행 중 | 11-custom-editor-implementation.md | 사용자 정정: 앱 본체 변경 없이 모드가 문서·입력·표시·LSP 소유 |

## 태스크

| ID | 상태 | 담당·범위 |
| --- | --- | --- |
| R01 | 완료 | 부모, UX 원칙 조사·설계 |
| R02 | 완료 | [파일 편집·뷰어 조사](results/R02-editor-audit.md) |
| R03 | 완료 | [DB 기능·개선안](results/R03-database-research.md) |
| R04 | 완료 | [아이콘 적용 범위](results/R04-icon-audit.md) |
| T01 | 구현·자동 검증 | [공통 아이콘 구현](tasks/T01-icons.md), [결과](results/T01-icons.md) |
| T02 | 구현·자동 검증 | [편집기 독립 개선](tasks/T02-editor.md), [결과](results/T02-editor.md) |
| T03 | 구현·자동 검증 | [DB 보존·피드백](tasks/T03-database.md), [결과](results/T03-database.md) |
| T04 | 구현·자동 검증 | [공통 시스템](tasks/T04-system.md), [결과](results/T04-system.md) |
| T05 | 구현·자동 검증 | [DB 문서 수명](results/T05-lifecycle.md) |
| T06 | 일부 native 확인 | [Markdown 텍스트 모드](results/T06-markdown-modes.md) |
| T07 | native 재검증 대기 | [Find Action 조사](results/T07-actions.md) |
| T08 | HTML 검증 완료 | [데모 의견과 프로젝트 정렬](results/T08-demo-review.md) |
| T09 | 참고 조사 완료 | [native DnD API](results/T09-native-drag-audit.md), 사용자 후속으로 DnD 이동 제외 |
| T10 | HTML 검증 완료 | [설정·컬렉션·목적 위치 이동](results/T10-settings-and-move.md) |
| T11 | HTML 통합 검증 중 | [공통 목록 관리](tasks/T11-managed-lists.md) |
| T12 | HTML 통합 검증 중 | [하단 실행 결과·SQL](tasks/T12-run-output-tabs.md) |
| T13 | 구현·자동 검증, native 대기 | [실제 목록 관리 UI](tasks/T13-native-managed-lists.md) |
| T14 | 구현·자동 검증, native 대기 | [실제 실행·SQL 결과 도구](tasks/T14-native-execution-results.md) |
| T15 | 설치 후 실제 불일치 확인 | [셸·설정 및 통합](results/T15-native-integration.md) |
| T16 | 감사 완료, 부분 구현 보류 | [설정 잔재 제거·키맵 목록](results/T16-settings-cleanup.md) |
| T17 | 감사 완료, 부분 구현 보류 | [Database 디자인 정합](results/T17-database-design-alignment.md) |
| T18 | 감사 완료 | [공통 UI·프로젝트 선택기](results/T18-common-ui-audit.md) |
| T19 | 감사 완료 | [실행 위치·실시간 출력 P0](results/T19-run-routing-audit.md) |
| T20 | 조사 완료 | [자체 편집기 타당성](results/T20-editor-feasibility.md) |
| T21 | 조사 완료 | [native 통합안·Textarea 비교·회귀표](results/T21-editor-native-deep-review.md) |
| T22 | 조사 완료 | [미저장 LSP·현재 pipeline](results/T22-editor-lsp-pipeline.md) |
| T23 | 조사 완료 | [공식 라이브러리·배포 binary 경계](results/T23-editor-library-review.md) |
| T24 | 구현·자동/native 검사 | 자체 문서 모델·순수 JS 라이브러리 재사용 |
| T25 | 실제 한글/큰 글꼴 실험 통과 | native IME 입력부와 모드 소유 selection/commands 실험 |
| T26 | 구현·race/실제 TS 검사 | 미저장 문서 LSP·owner/revision·진단 수명 |
| T27 | production 회귀 통과 | 실제 EditableCode/SQLBuffer·CAS·선택 실행·workspace |
| T28 | 설치·일반 파일 저장/Markdown 미저장 미리보기 실제 확인 | [자체 편집기/SQL 기본 통합](results/T28-owned-editor-integration.md), 재시작 후 검증 재개, SQLite 왕복은 남음 |
| T29 | native 결과 block 통합·독립 회귀 | 전용 core process·하단 native 출력 실제 관찰, 자체 시험 실행 왕복은 남음 |
| T30 | 구현·설치·회귀 | 프로젝트 popup 단일 외곽·작은 정렬 selector |
| T31 | 구현·설치·회귀 | 설정 잔재 제거·키맵/도구 영역 공통 관리 목록 |
| T32 | 검사·최소 오류 수정·설치 | [DB driver/TLS selector·비밀번호·profile 수명](results/T32-database-select-validation.md) |
| T33 | 구현·회귀·설치, native 재검증 대기 | [문서 전체 Save/Preview shortcut](results/T33-document-command-scope.md), SQL context 중첩과 IME 보호 |
| T34 | 재보고·T38 후속 | [도구 크기 조절 복구](results/T34-tool-resize.md), rail 유지 확인, 이동 버벅임은T38에서 처리 |
| T35 | 구현·설치·연결 관리 실제 관찰 | [DB 탐색/연결 관리](results/T35-database-manager.md), SQLite 왕복 남음 |
| T36 | 구현·설치·자동 검증 | [실행 로그 수명 복구](results/T36-run-log-visibility.md), 실제 사용자 live 출력 관찰, 자체 GUI 왕복 남음 |
| T37 | 구현·설치·자동 검증 | [DB 문서/결과/전송](results/T37-database-editor-demo.md), 실제 SQLite 흐름 대기 |
| T38 | 반복 갱신 수정·설치, 실제 성능 검증 대기 | [크기 조절 redraw 루프](results/T38-resize-redraw-loop.md) |

하위 조사 reasoning effort는 스킬 기본값 `medium`이며 메인 세션 설정은 변경하지 않는다. 감사 태스크는 지정 결과 문서만 작성하며 추가 구현·생성·설치를 수행하지 않는다.

## 이어서 할 작업

먼저 [통합 변경 목록](09-demo-native-audit.md)을 기준으로 실행 구성의 하단 live 출력·정상 실행 추적, 프로젝트 선택기 단일 외곽, 공통 컴포넌트 역할, 설정/키맵·DB 순서로 범위를 정한다. 사용자가 09 문서 기록 후 개발을 지시했다. 편집기 실험과 기본 모드 통합을 구분하고 각 단계 검사 뒤 배치 설치한다. 사용자 정정으로 앱 본체를 수정하는 native Editor host 확장안은 대체됐다. 현재는 09 문서에 기록한 모드 전용 편집기 통합을 진행한다. 실제 host/dependency와 위치·장식·edit 능력을 확인한 후 미저장 LSP·단일 문서 통합을 진행하며, [제거 검증 기준](10-unified-editor-review.md)에 도달하기 전 viewer는 유지한다.

이전 설치의 새 관리창·결과 뷰 native eager 검사 11종과 자동 25종은 통과했으나 실제 위치/행동 검증을 대신하지 않는다. 재시작 대기는 끝났으며 현재 미해결 사항은 소스·상태 계약과 실제 UI 정합이다. 사용자 제공 실행 화면은 터미널이 선택되고 하단이 상태 확인 불가/0ms/명령만 남는 P0를 보여준다. 사용자의 실행·터미널·실제 DB 데이터는 감사 중 변경하지 않는다.

## DB 데모 정합 재개 · 2026-11-06

사용자가 DB에 이전 UX가 남아 불편하고 하단 실행 로그가 전혀 보이지 않는다고 보고했다. T35 탐색/연결 관리(medium), T36 로그 P0(high), T37 source/결과/전송(root) 구현 중. 기존 T17 감사 26개를 현재 코드와 다시 대조한다. 저장된 연결·Keychain·transaction·codebench 보존, 실제 SQLite와 자체 실행으로 검증한다.

## 2026-11-09 재개 · 사용자 피드백 T56–T58

사용자가 공유 Go 엔진 재시작을 승인했고 잠금을 해제했다. 확인 당시 이전 엔진/상태 파일/포트 listener가 없어 다른 프로세스를 종료하지 않고 host 버전 `0.1.0-37914f236d1d`를 `t4x`로 실행했다. Herdr 창과 core는 유지했다. 실제 TypeScript 미저장 진단2→0, symbols3개, 정의2행17열, CmdS 저장 및 닫기/재열기 준비 상태를 확인했다. 실제 SQL CmdEnter 범위 선택, 선택1문장 실행8행, 하단별도결과탭 및 선택2행 JSON preview를 확인했다.

추가 사용자 피드백을 기존 목표의 후속으로 수용한다:

| ID | 상태 | 범위/담당 |
| --- | --- | --- |
| T56 | 설치·실제 단독 fill/복원 관찰 | 부모 검토 / ade_projects: 도구1개일 때 sidecolumn 꽉 채우기와 split 크기 복구, 파일목록 제외 관리목록의 실제 hover actions |
| T57 | 설치·수명 후속 검증 | 부모 검토 / ade_execution: 기존 열린 TS buffer의 엔진 복구·재시도와 구조 metadata 갱신, 상태/owner 보호 |
| T58 | 설치·실제 SQL 제목 관찰 | 부모 검토 / ade_editor: SQL 실행 내용 기반 짧은 결과 제목·반복실행 구분, rawSQL/rows shared 저장 금지 유지 |

선정 effort는 기존 구현 에이전트의 medium을 유지한다. 같은 파일 범위는 나누고, 전체 자동검사·native 주요 상태 및 실제 화면을 확인한 뒤 배치 설치한다. 기존 미커밋 변경은 유지한다. 관리 목록 hover는 deferred native row에 handlers를 넣지 않고 opt-in bounded ordinary-render rows로 구현하며, 기본 파일트리/큰 readonly keymap은 기존 virtual 경로를 유지한다.


## 2026-11-09 편집기 기본 조작·리뷰 후속 T59–T61

사용자가 더블클릭 단어 선택, Cmd+클릭 탐색, 우클릭 정보/정의/참조 및 기본 편집기 조작과 이전 코드 리뷰의 ADE 통합을 요청했다. 기존 목표에 추가하며 진행을 중단하지 않는다.

- T59: CodeInput의 Unicode 단어/줄 선택과 이동·삭제, 범위 들여쓰기·내어쓰기, 자동 들여쓰기, 찾기/치환. CodeMirror state transaction을 재사용하고 native IME 조합 중 조작을 보호한다.
- T60: 상단 버튼/Cmd+클릭/우클릭 메뉴가 같은 retained semantic descriptor를 소비한다. 실제 `document owner conflict` 재보고로 활성 문서만 lease를 취득하고 경로별 해제 후 인계하는 수명 수정도 최우선으로 포함한다. 다른 owner 강제 해제는 하지 않는다.
- T61: 중앙 리뷰 탭에서 branch/worktree 비교, 변경 파일·diff·hunk 탐색·소스 이동, 줄 범위 코멘트 보존·복사·명시적 AI 첨부 초안을 제공한다. 명시 fetch만 수행하며 자동 전송하지 않는다.

T56–58 수정본은 배치 설치했다. 실제 검증 프로젝트에서 DB 접기 후 터미널 단독 전체 높이, 재열기 후 기존 분할 크기 복원, TypeScript 진단과 greet/message 구조 목록, 새 구조 재분석 버튼, 프로젝트 목록 행 액션 표시를 관찰했다. SQL 제목 실제 화면 후속 검증은 남아 있다. 사용자가 자기 프로젝트로 돌아가 작업 중인 상태를 감지하면 임의 입력하지 않는다.


### LSP 수명·프로젝트 추가 후속

TypeScript/Kotlin 서버의 실제 상태는 모두 ready인데 화면은 `document owner conflict`를 보였다. 숨긴 복원 탭의 불필요한 lease 획득, HMR 해제/재획득 경쟁, OOM으로 해제 hook을 완료하지 못한 세션을 각각 방어한다. 활성 파일만 lease를 갖고 경로별 해제 gate를 기다린다. 엔진은 60초 동안 갱신되지 않은 lease만 충돌 시 만료 처리하며 이전 owner를 폐기해 늦은 쓰기를 차단한다. 활성 편집기는 원문 없는 owner/revision heartbeat를 10초마다 보낸다. 같은 owner의 짧은 재시도 뒤 65초에 한 번 더 확인하며 다른 살아 있는 owner를 강제 해제하지 않는다. 만료/갱신/다른 owner·revision 보호와 race 검사가 통과했다.

사용자가 새 프로젝트 추가 시 기존 프로젝트가 바뀐다고 보고했다. 폴더 선택기에서 현재 space의 `ade.projectRoots`를 덮어쓰던 경로를 제거했다. 새 로컬 폴더는 `space.new`로 독립 생성하고 기존 로컬 root는 선택한다. 기존 override metadata를 자동 삭제하지 않으며 다른 프로젝트 문서·core terminal을 유지한다. 공백·따옴표 경로, remote 프로젝트 보존, 중복 root 재사용 회귀 검사를 추가했다.


### 실제 검증과 추가 기본 편집 기능

검증 전용 space에서 `message` 더블클릭 후 CmdF를 눌렀을 때 검색어와 선택 범위가 단어 전체가 되는 것을 관찰했다(`/tmp/ade-word-find.png`). 우클릭 메뉴 열림·아래키 선택·Enter 닫힘을 관찰했지만 실제 정의 이동은 추가 확인 중이다. 오류 상태 본문이 자동 높이로 접혀 보이지 않던 문제도 후속 고정 높이에 반영한다.

중앙 코드 리뷰 탭에서 실제 Git 변경 파일6개·README old/new diff를 표시하고 `ADE 실제 UI 검증 코멘트`를 저장해 코멘트1개가 되는 것을 관찰했다(`/tmp/ade-review-live.png`). AI 전송이나 사용자 저장소 변경은 수행하지 않았다.

T62는 CtrlSpace 자동완성·선택 후보 resolve/import·CmdAltL 서식·줄 주석을 포함한다. 독립 포트의 실제 새 엔진+TypeScript 서버로 완료 후보100개 중 customerName, resolve 성공, 서식2편집, 정의1개를 검증하고 파일 원문이 바뀌지 않음을 확인했다. 클라이언트 Unicode/CAS/겹침 거절·한 번 undo와 늦은 응답 거절 회귀도 통과했다. 스니펫·서버 명령·다른 파일 편집은 미지원 상태를 명시하고 실행하지 않는다.

Mac 잠금으로 새 프로젝트 추가와 다음 배치의 실제 완료/서식/정의 이동 입력 검증은 보류 중이다. 잠금 해제 질문을 보냈으며 코드·자동 검증은 계속한다. 새 테스트용 폴더 경로는 `/tmp/ade-add-project-path.txt`에 저장했다.


### 현재 설치/재개 지점 · 2026-11-09

T56–T62와 새 프로젝트 추가 수정은 ADE에 배치 설치했다. 현재 Go 배포 버전은 `0.1.0-17c2c0dd57c9`, 소유 core 주소 `t50`이다. 승인받은 엔진만 교체했으며 Herdr 창·사용자 core terminal은 종료하지 않았다. 생성물·공통 시스템·관리 목록·편집기/메뉴/완성/수명·중앙 host·workspace·리뷰·실행/결과·설정·frame 회귀, native frame23상태, 배포6binary 검증이 통과했다. 앱 status errors도 비어 있다.

실제 설치 엔진에 현재 LspSession 소스를 연결한 독립 로컬 probe도 분석ready/symbols2, definition1/onNavigate 호출, error없음을 확인했다(`/tmp/ade-live-lsp-probe.mjs`). 대상은 `native-lsp-probe.ts` 임시 파일이며 종료 시 exact own lease를 해제했다. UI 클릭을 대체한 검증으로 표기하지 않는다.

남은 실제 UI 확인: 잠금 해제 후 검증 space `sp818190e2778ac57957d1a7aa779ceb94`에서 (1) 추가 폴더를 새space로 열어 원래공간 보존 (2) completion-roundtrip.ts의 customerN 끝에서CtrlSpace→customerName 적용/undo, CmdAltL 서식/undo (3) greet Cmdclick/우클릭정의 이동, 오류 재발시 새로 높이를 준 본문 메시지 확보 (4) 최종 preview/추출기·가져오기 잔여왕복. Mac 잠금 해제 질문은 이미 보냈고 답변은 아직 없다. 읽기 전용 shot에서 사용자가 다른 프로젝트/~ 공간으로 이동한 것을 관찰했으므로 사용자 터미널에 임의 입력하지 않는다.


## 2026-11-09 잠금 해제 후 실제 입력 재개

실제 완료 증거:
- completion-roundtrip.ts에서 CtrlSpace 후보 customerName 선택·Enter 적용·CmdS 저장으로 customerN→customerName을 파일에서 확인했다.
- CmdAltL 서식으로 `const result=customerName`→`const result = customerName`, 저장 후 CmdZ 한 번으로 원래 형태 복원을 파일에서 확인했다.
- Cmd클릭으로 같은 문서 사용 위치→정의1행7열 이동을 실제 커서와 scoped navigation metadata에서 확인했다.
- native 폴더 선택기로 새 검증 root를 열어 별도space `sp8c34998fa5c964868254bdbd2679c473`/core `t51` 생성, 기존 ADE검증space/root/core t4m 유지, 새파일트리에 README만 표시되는 것을 확인했다.

참조 찾기는 추가 결함을 실제 재현했다. 메뉴 선택은 맞지만 상태가 requesting으로 남는다. 커서 변경 시 requesting을 정상 상태로 돌리지 않던 결함과 read-only 탐색30초deadline을 수정·설치했다. 새 독립 references-ui.ts는 ready이며 diagnostic metadata상 native 요청이 `read-state`에서 멈춘다. 같은 설치 엔진에 같은 LspSession 소스를 직접 연결한 export/global 참조는 각각12ms/29ms에 성공해 native task/overlay·공유상태 갱신의 context 경계를 추적한다. 원인 해결 전 참조 UI 검증은 완료로 표시하지 않는다. 원문/토큰은 diagnostic metadata에 포함하지 않는다.


### Native 참조 요청 수명 원인

설치된 gpui-kit.d.ts의 TaskOptions.owner 계약은 spawn의 기본 소유자가 AsyncContext의 소유자가 아니라 **현재 실행 중인 view**라고 명시한다. 메뉴가 shared request를 게시해 편집기 retained worker를 깨울 때 새 nested task가 기본값으로 메뉴에 속할 수 있으며, 메뉴 close가 그 task를 취소한다. 같은 선언은 취소된 Task의 promise가 영원히 pending으로 남는다고 명시한다. 실제 read-state 단계 정체와 맞는 수명 결함이다. native ADEFrame을 명시적 owner로 전달해 하위 편집기 spawn/timer가 닫히는 popup을 상속하지 않도록 수정한다. helper EditorSurface 자체는 수동 생성되므로 native host owner를 props로 전달한다. 실제 UI 확인 후 완료로 기록한다.


### 2026-11-09 native 제한 확인 후 마지막 배치

진단 보호를 추가해 실제 예외를 확보했다: `TypeError: opts.owner must be the view that is running, or null; a task cannot yet be owned by another view`. 공개 TaskOptions의 임의 view owner와 실제 runtime의 cross-view 제한을 구분한다. 임의 global owner/null로 바꾸지 않았다. 초기 편집기 소유 retained worker가 popup wake 이후 **job을 실행하기 전에 foreground sleep(1)로 자기 turn을 재개**하도록 수정했다. 이후 하위 작업·timer 생성이 원래 편집기 실행 경계 안에서 일어난다. Cross-view spawn 거절을 재현한 순서 회귀와 관련 editor/host/LSP/completion/native 검사 통과; 가장 최근 설치 backup은 `1794185585393223000`이다. 다른 worker job 하나의 예외는 queue 전체를 종료하지 않도록 보호했다.

설치 직후 Mac이 다시 잠겨 실제 참조 메뉴 재검증은 아직 못 했다. 잠금 해제 질문을 다시 보냈다. 재개 시 별도 LSP lease가 이미 해제된 native-lsp-probe.ts를 파일 목록에서 열고(대략 physical x375,y534; 실제 화면 재확인), greet 위 우클릭→참조를 선택해 결과목록과 이동을 확인한다. 기존 refs 파일은 HMR 이전 owner가 남았을 수 있어 60초 만료/65초 재확인 계약을 고려한다. 실제로 앞선 owner-conflict는 앱/엔진을 재시작하지 않고 정상 ready로 자동 복구되는 것을 확인했다.


### 2026-11-09 T64 표시 안정성과 native 참조 검증 완료

입력 중 코드 색상/밑줄 깜빡임에 대해 이전 decoration을 현재 ChangeSet으로 보정하고, 현재 revision의 실제 응답에서만 교체한다. pending 진단의 빈 배열은 확정 결과로 해석하지 않는다. 직접 수정한 진단 범위만 제거하며, 이전 진단은 대기 표시와 함께 유지한다. 구체적인 회귀·실제 입력 증거는 [T64](results/T64-lsp-decoration-stability.md)에 기록했다. 설치 backup은 `1794186611632829000`; 앱 status errors 없음.

위 sleep(1) 재개 시도는 실제 native에서 실패해 **대체했다**. TextEditor/EditorHost의 init 소유 25ms timer가 queue를 처리한다. idle notify 없이 release 취소/예외 후 계속 처리 테스트가 통과했다. 실제 navigation.ts 우클릭→참조에서 결과 popup `navigation.ts:1:14`와 analysis references/reply/query4/ready를 확인했다. 이제 해당 native 참조 정체는 미확인 항목에서 해제한다. Go 변경과 엔진 재시작은 없었다.


### 2026-11-09 외부 라이브러리 이동 · T65

외부 위치의 UI 차단을 제거하고 중앙 readonly 편집기에 연결했다. 실제 TypeScript Array.map→lib.es5.d.ts:1468 이동·소스/주석 표시를 확인했다. 프로젝트 밖/node_modules는 저장을 차단하고, JAR/JDT materialized 소스는 readonly provenance를 복원한다. 세부 범위·검증은 [T65](results/T65-external-library-navigation.md). 코드 리뷰 header action 이름을 `코드 리뷰`로 명확히 했다.


### 2026-11-09 T66 프로젝트·리뷰 후속

고정 현재 프로젝트 비교, 자체 Git 파일 색/상태 문구/폴더 집계, 단일 폴더 chain 확장, 리뷰 LSP 정보·정의·참조/진단·과거 원문 분리, 코멘트 상세/수정 삭제 버튼, 열린 최근8문서 분석 캐시를 반영했다. [T66](results/T66-review-project-ux.md)에 회귀·실제 화면 근거와 전체 프로젝트 사전 인덱싱 미구현 경계를 기록했다. 최신 sourceRoot는 canonical 리뷰 코멘트 키를 유지한다. 실제 map 정보→라이브러리 정의 이동, TS 진단1개, 단일 경로 확장, Git 상태색을 검증했다. 사용자 코멘트 실제 삭제 없음.


### T67 진행 중 · 2026-11-09

사용자 요청으로 프로젝트 열기 시 언어 서버/인덱스 비동기 사전 준비와 외부 materialized 라이브러리의 original-server LSP 탐색을 구현한다. [T67 명세](tasks/T67-project-analysis-spec.md). 준비 상태와 인덱스 완성은 구분하고 foreground 문서 열기는 막지 않는다. 기존 문서 캐시8은 보존한다.

T67 구현·배포 및 자동/API 검증 완료, 마지막 native 클릭 검증 대기. [통합 결과](results/T67-project-analysis-integration.md). 최종 엔진 `0.1.0-9b4987d11d6c`, owned runner `t58`; 실제 TS 표준 라이브러리 hover 및 프로젝트 사용 참조 확인. Mac 잠금으로 상세 팝업/외부 탐색 마지막 화면 확인은 완료로 표시하지 않는다.

T67 마지막 native 검증 완료: 프로젝트 상세의 재시도 disabled 잔류를 수정해 실제 클릭→Kotlin/TypeScript 준비됨 확인. 외부 Spring 함수 정보·반환된 참조 목록 및 ConfigurableApplicationContext.java 정의 이동 확인. 최신 ADE 설치 backup `1794197286888433000`. 범위와 Kotlin 참조 결과 제한은 통합 결과에 기록했다.

### 2026-11-09 리뷰 파일 보기 전환

파일 목록 상단에 목록/파일 트리 버튼 추가. 기존 전체 경로 목록 유지, tree는 변경 파일만 폴더 우선 계층으로 표시하고 클릭/Enter로 접고 펼친다. 공통 managed list/MenuController 및 canonical adeRow indent 재사용, 선택 모드 공유 상태 보존. 원본 path·diff·코멘트 그대로 유지. 모델 검사: 중복 basename/폴더 접기/삭제 파일과 새 동명 디렉터리 공존/입력 불변성 통과, 기존 리뷰 회귀와 shared system 통과. 실제 native에서 버튼 전환 및 계층 표시 확인. 가상 목록 eager native label로 빈 행이 되는 문제를 실제 검증에서 발견해 plain label + deferred adeRow indent로 수정. 최신 설치 backup 1794199426024019000.

### 리뷰 트리 정합성과 너비 조절

사용자 피드백에 따라 문자 화살표를 제거하고 현재 ProjectTree와 같은 chevron → folder/file icon 순서, 16px 들여쓰기/leaf spacer 및 Left/Right 펼침을 적용했다. 파일 목록/코드 사이는 native h_resizable+resizable_panel, stable project id, 목록 초기 260px/200~700px 및 코드 최소 280px. 실제 화면에서 트리 아이콘 정렬과 경계 드래그로 목록 폭이 넓어지고 파일명이 더 보이는 결과를 확인했다. 리뷰 회귀·트리 모델·shared system·mod check 통과, 설치 backup 1794201265994717000. 코드 내용/코멘트 수정 없음.

### 2026-11-09 · 편집기 탐색 기록

- 모호했던 편집기 하단 이전/다음 화면 스크롤 버튼을 제거했다. 스크롤·기존 키보드 이동은 유지한다.
- 상단 뒤로/앞으로는 프로젝트별 최대 100개 파일·코드 위치를 보관한다. 파일 전환과 정의·참조·구조 위치 이동을 기록하고 커서 위치를 복원한다. 뒤로 이동 후 새 경로를 방문하면 앞으로 기록을 비운다. 모드 재시작 시 기록은 초기화한다.
- 비동기 파일 로딩 중 첫 줄이 중간 방문 위치로 기록되지 않으며, 읽기 실패 시 탐색을 다시 사용할 수 있다.
- 검증: check_ade_editor(같은 파일/다른 파일/외부 소스 위치 복원, 프로젝트 분리, 분기 초기화, 상한, 비동기 도착), check_ade_code_input, check_ade_editor_host, check_system, sync_ui --check, herdr-app check mods/ade 통과. 설치 후 실제 화면에서 상단 탐색 버튼과 하단 스크롤 버튼 제거를 확인했다.

### 2026-11-09 · 프로젝트 이름 변경·목록 제거

- 프로젝트 선택 창의 공통 목록 툴바와 행 호버 액션에 이름 변경·목록에서 제거를 추가했다. 이름은 space.rename으로 작업 공간에 반영하며 폴더와 프로젝트 식별자는 바꾸지 않는다. 빈 이름은 거절하고 실패 시 초안을 유지한다.
- 제거 전 창 안에서 대상과 보존 범위를 확인한다. 제거는 ADE 목록에서만 숨기며 space.close를 호출하지 않아 실행 중인 터미널·파일·미저장 문서를 유지한다. 제거한 프로젝트 복원 버튼과 기존 폴더 다시 열기로 복원할 수 있다.
- 검증: check_ade_workspace(이름 요청 인자·공백 거절·실패 재시도·목록 제거 지속·터미널 종료 없음·폴더 복원), check_system, 생성 사본 일치, herdr-app check mods/ade 통과. 실제 창에서 툴바·행 액션과 이름 입력·취소를 확인했다. 실제 업무 프로젝트 이름 변경·제거는 실행하지 않았다.

### 2026-11-09 · 편집기 드래그·전역 에이전트·프로젝트 서비스

- 드래그 caret 안정화와 편집기·리뷰 gutter 구분선, 전역 에이전트 목록을 반영했다. ADE 터미널 닫기에서는 마지막 실행 탭과 공간 수명을 분리했다.
- 인터페이스·구현·타입 정의 탐색과 Spring 검색, HTTP 블록·환경 선택 실행을 추가했다. HTTP 실행 코어는 기존 모드와 공유하고 하단 실행 결과를 사용한다.
- 자동 검사·실제 localhost ijhttp·소유 Herdr 테스트 공간 검증과 범위는 [T68 결과](results/T68-editor-project-services.md)에 기록했다.

### 2026-11-09 · 편집기 도구·LSP 상태 중복 제거

- 상단은 저장·다시 읽기, 탐색은 줄 번호 오른쪽 공통 아이콘, 상시 분석 상태는 브랜치 옆 버튼으로 정리했다. 리뷰 현재 소스 줄에도 탐색 아이콘을 적용했다.
- 자동 검사와 실제 화면 검증 범위는 [T68 결과](results/T68-editor-project-services.md)에 기록했다.

### 2026-11-09 · T69 파일 분석·SQL 문맥 완성

완료. 일반 파일 언어 서버 범위를 확대하고 SQL parser·연결 metadata·커서 기준 자동완성을 통합했다. 실제 SQLite 테이블명·CTE/JOIN 컬럼 추천과 TypeScript Math 멤버의 Tab 적용, 하단에서 위로 전환을 확인했다. [T69 명세](tasks/T69-analysis-completion.md), [통합 결과·지원 한계](results/T69-completion-integration.md).


### 2026-11-09 · T70 렌더 비용·HTTP 출력

고정폭 ASCII의 native glyph batching과 토큰 순회로 렌더 비용을 줄였다. 실행 결과에 전체 복사·각 줄 고정폭·수평 스크롤 추가. macOS HTTP 실행은 명시적 JVM 설정을 보존하면서 키체인 신뢰 저장소를 사용한다. 동일 서버 origin의 실제 TLS HEAD와 localhost HTTP 회귀 통과. 실제 사용자 SQL 재현/업무 요청 재실행은 완료로 표시하지 않는다. [적용·검증 범위](results/T70-render-http-output.md).


### T71 완료 · 파일 분석·Spring Data·소유권

사용자 최종 요청에 따라 프로젝트 사전 준비를 제거하고 선택한 파일만 분석 lease를 유지한다. Spring Data 후보·일반 소스 구현 탐색 보완과 중복 close 소유권 충돌 수정까지 설치했다. 동일 LyricCommandService의 실제 팝업 LSP 준비됨 및 live API에서 Repository 대상/old-owner 중복 해제 안전성을 확인했다. [명세](tasks/T71-navigation-pool.md), [통합 결과·검증·한계](results/T71-navigation-integration.md).
