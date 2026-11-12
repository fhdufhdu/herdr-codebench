# T28 모드 전용 편집기와 첫 통합 배치

2026-11-06. 사용자 지시대로 09 문서에 한글 IME·글꼴 대응·자체 편집기 결정을 먼저 기록한 뒤 개발했다. 앱 본체는 수정하지 않았다. 상태: **구현·자동/native eager 검사·파일 설치 완료, HMR 메모리 부족과 Mac 잠금으로 실제 통합 검증 대기**. 잠금 해제와 Herdr 창 앱의 직접 재시작을 요청했다. 앞선 실험 창의 한글 성공과 이번 production 통합 검증을 구분한다.

## 적용한 동작

- idea 로컬 텍스트 파일은 `EditableCode` 한 표면에서 입력·선택·탐색·진단·저장을 처리한다. 기존 CodeView renderer에 문서/언어 요청/caret hook만 추가했다. CodeMirror의 DOM 없는 state·Unicode segmentation 번들을 재사용한다.
- Markdown 원문/미리보기는 같은 문서·dirty·undo 상태를 사용한다. SQLBuffer도 같은 편집기를 사용하여 편집 중 caret/선택 범위를 실행 후보로 만든다. DDL은 같은 표면의 readonly 상태다.
- codebench의 기존 source/native 편집 전환과 SQL 편집기를 유지한다. 미디어·바이너리 viewer와 원격 편집 경로도 유지한다. routing과 action capability는 동일한 `isSourceDocument`를 사용한다.
- 저장은 원본 snapshot으로 `writeTextFile` CAS를 수행한다. 저장 중 추가 입력은 dirty로 남고 외부 변경을 덮어쓰지 않는다. dirty 닫기/이동·workspace 격리·clean 문서 재읽기·passive LSP close를 검사했다. 원문은 shared state에 저장하지 않는다.
- Save/Preview의 action ID와 사용자 키맵은 유지한다. focused input의 유효 키맵 context bridge와 UI action의 실제 owner 전달을 연결했다. 고정 Cmd+S나 hidden Activity forwarding에 의존하지 않는다. 키 제거/재할당·Ctrl/Meta·sequence·IME pending 경계는 [별도 계약](T28-command-routing.md)을 따른다.
- 미저장 문서를 owner/revision으로 동기화하고 오래된 hover/진단/토큰을 버린다. 버전 없는 진단은 confidence를 구분한다. Spring의 explicit text 분석도 현재 원문을 사용한다. completion/rename/format/multi-file edit는 이번 구현에 포함하지 않는다.

## 실행 결과·공통 UI·설정

T29 전용 core process를 `execution-layout.js`로 하단 결과 도구의 native terminal block에 연결했다. 결과 block만 column으로 감싸 controller와 terminal을 배치하고, 기존 도구의 위치·크기·min·hidden과 사용자 terminal payload는 보존한다. 실행 중 출력을 readonly Editor나 JSON에 복사하지 않는다. SQL을 선택하면 같은 controller가 표를 표시하고 terminal block은 접힌다. legacy 실행 기록은 이전 transcript를 유지한다. processOwned 복구는 실제 queued/running/final을 사용하며 footer가 없다는 이유로 untracked로 바꾸지 않는다.

프로젝트 popup은 한 외곽·한 header·작은 정렬 selector로 정리했다([T30](T30-project-popup.md)). 설정에서 메뉴/도구 모음 편집 page와 진입 잔재를 제거하고 키맵·도구 영역은 공통 관리 목록/상세를 사용한다([T31](T31-settings-cleanup.md)). 기존 customization 저장값과 runtime 소비는 유지한다.

기존 DB driver/TLS selector의 fixture를 실제 Select/Popup 계약으로 갱신했다. 다섯 driver·네 TLS 옵션·SQLite/network 필드·credential 요청·profile 수명을 검사했고, driver/TLS 변경 뒤 Delete 확인 상태가 남는 오류를 수정했다([T32](T32-database-select-validation.md)). 이 검사는 실제 네트워크 DB/TLS/Keychain 왕복의 증거는 아니다.

## 검증과 설치

통과한 production 회귀: `check_editor_buffer`, `check_editor_input`, `check_editor_commands`, `check_editable_code`, `check_database_editor`, `check_actions`, `check_tabs`, `check_editor_context`, `check_run_sessions`, `check_workspace`, `check_settings`, `check_project_order`, `check_shortcuts`, `check_system`, `check_surfaces`.

- DB 회귀에는 실제 SQLBuffer의 입력/선택 후보/단일 승인 경로/CAS/discard/readonly DDL/codebench를 포함했다. native 결과 layout 회귀는 이동된 도구와 기존 terminal을 보존하며 shell terminal↔SQL 표↔legacy transcript 전환을 검사한다.
- `check_native_surfaces.py` 15개 상태: 설정/연결/프로젝트/실행 구성/갤러리/결과 11개와 실제 EditableCode source/Markdown/readonly/inline input 4개가 native eager 검사를 통과했다. 실제 paint/IME/키 우선순위를 대신하지 않는다.
- Go 전체 race 검사를 통과했고 모든 6 target을 다시 빌드·checksum 검증했다. 설치 engine version은 `0.1.0-bfa2e1289dac`이다.
- canonical `sync_ui.py --check`, 변경 mod `herdr-app check`, `git diff --check`를 통과했다. `./install.sh`는 기존 layout 배치와 사용자 키 충돌을 보존하며 파일을 설치했다. 첫 설치 직후 errors는 빈 배열이었으나 최종 설치 뒤 `herdr-app status`가 codenav 재로딩 `Null"null"` 및 반복 `out of memory`를 보고했다. 최신 UI 적용 성공으로 판정하지 않았다. 앱이나 core를 재시작하지 않았다.

## 남은 확인과 후속 범위

사용자가 잠금 해제와 Herdr 창 앱 재시작을 마친 뒤 errors와 최신 모드 적용을 먼저 확인해야 한다. 이후 임시 파일 저장·유효 Save shortcut·Markdown 왕복·한글/큰 글꼴·SQLite 선택 실행/표 수정·하단 live 출력/중지/resize를 CUA로 검증해야 한다. 현재 결과는 실제 설치본 UX 검증 완료가 아니다.

09의 DB 디자인 감사 전체를 해결했다고 표시하지 않는다. 연결 목록 전체 draft, 실행 후보 선택 후 명시 확인 dialog, 결과 탭/metadata 위계, 고정 grid header, pending 수정 bar, 추출/가져오기 compact selector 등은 [T17 감사](T17-database-design-alignment.md)에 남아 있다. 이 배치는 자체 편집기 통합과 실행 P0·프로젝트/설정 잔재 정리가 중심이다.
