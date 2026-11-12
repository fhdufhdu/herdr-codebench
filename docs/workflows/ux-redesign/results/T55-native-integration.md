# T55 새 ADE native 통합 · 진행 중

## 확인한 결과

- 설치 migration과 runtime toggles는 동일 `ensureDatabaseRegion/orderKnownChildren`을 사용한다. 실제 설치의 `[agents, terminal, database]` 순서가 `[agents, database, terminal]`로 교정됐고 DB를 열면 위에, 터미널은 아래에 보인다. 같은 슬롯의 agents만 숨는다.
- core 탭 2개의 pane tree를 보존했다. 실제 native 분할, 확대/복원, 테스트용 세 번째 pane 닫기 후 tab2의 두 pane이 유지된다. 다른 프로젝트 터미널에는 입력/종료하지 않았다.
- 하단 `ResultsHost`에서 기존 두 테스트 실행을 완료/exit0 상태와 stdout 두 줄로 확인했다. 이전 status running 잔류는 새 host metadata 동기화로 해소됐다.
- CodeInput 300줄 실제 표시 1–18, CmdDown 283–300, CmdUp/Down과 휠 60–77을 확인했다. deferred renderer에서 handler를 등록하는 금지된 구현이 빈 화면 원인이었으며 bounded ordinary render로 제거했다.
- 실제 DBManager에서 이름 `ADE owned SQLite`, 소유 임시 SQLite 파일로 연결 테스트 성공 및 적용. 전역 프로필에 생성 확인. 다른 저장 연결은 변경하지 않았다.
- 실제 source→main→테이블→customers 열기 성공. 8행/NULL 표시, 셀 더블클릭 수정→Enter로 staging. 디스크 SELECT는 적용 전 `김민서`, 적용 후 `김민서 검증`임을 확인했다.
- DBManager 고정900×680 body가860×640 overlay를 넘어 footer가 잘리는 것을 발견해 root size_full로 교정했다. 프로젝트/설정/검색/첨부 overlay root도 호스트 bounds를 따른다.

## 후속 검증/수정

- SQL CmdEnter가 nativeInput Enter binding에 먹혀 줄바꿈한 것을 확인. SQL 전용 CodeInput action으로 수정했고 순수/실제 candidates 상태 native 검사 통과. 실제 앱 단축키 재검증 대기.
- 실행 범위 popup의 `.on_mouse_down_out("left", handler)` 잘못된 API로 native rerender 실패 확인. 단일handler 인자로 수정. 실제 candidates 상태 nativefixture와 `/tmp/ade-popup-fixed-crop.png`에서 현재 구문·현재 블록·명시적 실행 버튼의 native 표시를 확인했다.
- 실제 table density/header/row gutter/PK 표시를 승인 데모 기준으로 보완했다. semantic surface/14px monospace/#/PK/breadcrumb/known-local badge와 viewport fill·수동 열 너비 보존. 실제 최종 배치 화면 재검증 대기.
- 재로딩 후 이전 LSP lease가 남는 문제: cleanup에서 취소된 serial을 기다리지 않도록 fresh close transport로 수정. 이미 남아 있던 legacy lease는 강제 탈취/엔진 재시작하지 않았다. 새 문서의 실제 LSP 재검증 남음.
- SQLite SQL 선택 실행/하단 결과/DDL/복사/내보내기/가져오기, 새 입력부 IME+저장, 수동 크기 조절·설정 다섯 슬롯 이동 후 확인을 마친 뒤 완료 판단.

## 근거

`/tmp/ade-slot-fixed-small.png`, `/tmp/ade-source-probe-crop.png`, `/tmp/ade-source-end-crop.png`, `/tmp/ade-source-wheel-crop.png`, `/tmp/ade-connection-tested-crop.png`, `/tmp/ade-customers-small.png`, `/tmp/ade-pane-restored-small.png`.

## 추가 배치와 대기

- CodeInput 모든 크기 bounded native window, DataGrid 모든 크기 bounded ordinary row render, SQL-only Cmd/CtrlEnter, pending IME 실행 방지, 잘못된 popup API 인자를 수정해 설치했다.
- 복사/내보내기는 공통 extractor+형식 선택/preview chooser를 사용한다. 성공한 import 대상 버전 변경은 clean table만 갱신하고 dirty 편집은 보존한다.
- DB 전역 profile revision 자동 갱신은 render-owned spawn 대신 init-owned worker에 coalesced descriptor를 전달한다. 수동 refresh/자동 revision race/실패/release 검사가 통과했다. 프로젝트 변경은 전역 DB tree 상태를 초기화하지 않도록 main router도 교정(최종 배치에 포함 예정).
- 엔진 `document_close`는 unopened owner도 idempotent tombstone 처리해 늦은 최초 sync가 orphan lease로 남지 않도록 했다. 활성 다른 owner·stale revision 보호는 유지한다. `go test -race ./...` 통과, 6개 플랫폼 바이너리 검증 및 host 버전 `0.1.0-37914f236d1d` 설치 완료. 실행 중 공유 엔진 `t3p`는 이전 버전이며 재시작 승인을 요청했다. 창/터미널 코어는 재시작하지 않았다.
- Mac 잠금으로 CUA가 막혀 사용자에게 잠금 해제를 요청했다. SQL/하단 결과/DDL/복사/내보내기/가져오기, 새 입력부 IME+저장과 resize 실제 확인은 잠금 해제 후 이어간다. 전체 완료로 표시하지 않는다.
