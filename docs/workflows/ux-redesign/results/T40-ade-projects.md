# T40 ADE 프로젝트·탐색·문서

`mods/ade/workspace.js`를 승인 데모와 ADE 공통 primitives에서 새로 구현했다. 기존 프로젝트/탐색 controller는 가져오거나 복사하지 않았다.

- `currentProject()`는 활성 공간의 folder/machine/name/branch/id를 사용하고 해당 공간의 tab에 속한 panes cwd로 빈 folder를 보완한다. 시스템 폴더 선택은 원래 공간을 변경하지 않는 scope별 로컬 root override다.
- `projectKey(context)`는 `[machine,root,id]` JSON 배열이다. `ade.documents`에는 프로젝트별 absolute path tabs/active만 저장한다. 원문·native editor state는 이 모듈에서 보관하지 않는다.
- ProjectTree는 lazy 실제 디렉터리 읽기, 오류/재시도/빈 상태, MenuController 선택·스크롤·키보드, 세대 및 현재 프로젝트 검사로 늦은 응답을 차단한다. `refresh(cx)`와 focus를 공개하고 release에서 핸들을 해제한다.
- ProjectPicker는 실제 공간 선택·이름/최근/직접 정렬, 공통 ADE 관리 목록의 draft 순서/확인/취소, 시스템 폴더 열기를 제공한다. 정렬 진입은 헤더의 단일 버튼과 명시 높이의 옵션 목록이다. 개인 공간·터미널의 삭제나 재생성은 하지 않는다.

API는 path-first `openDocument(path,context)`, `selectDocument(path,context)`, `closeDocument(path,context)`다. context 생략 시 currentProject를 사용한다. documentState는 `{tabs,active}`이고 빈 active는 null이다. ProjectTree의 `onOpen(path,context,eventCx)`는 owning frame/editor로 전달된다.

검증:

- `node --experimental-vm-modules design/idea/check_ade_workspace.mjs` 통과: context와 tab 충돌 격리, 중복 path/상대 path 거부, 활성 문서 닫기, pane cwd 범위, lazy read, 실패 후 재시도, refresh/프로젝트 변경의 stale 응답, draft reorder, 원래 공간 보존과 로컬 folder override.
- `herdr-app check mods/ade` 통과.
- `python3 design/idea/sync_ui.py --check --mod ade` 통과.
- `node --experimental-vm-modules design/idea/check_system.mjs` 통과.

제약: 디렉터리 읽기는 argv로 경로를 전달하는 `python3 -c`/os.scandir를 사용하므로 대상 머신에 python3가 필요하다. 경로를 shell에 보간하지 않는다. 누락/접속 오류는 재시도 가능한 실제 오류로 표시한다. 이 작업자는 설치·CUA·사용자 live process 조작을 수행하지 않았다. 실제 UI 확인과 frame 연결은 root 작업에서 별도로 검증한다.
