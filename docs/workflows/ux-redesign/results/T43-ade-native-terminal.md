# T43 ADE native 터미널 영역

이 단일 terminal body 단계는 [T50 core 탭·pane](T50-ade-core-tabs-panes.md) 구현으로 대체되었다. 아래는 당시 구현·검증 기록이다.

`ade-terminal`을 같은 위치·크기의 native column으로 만들고, 고정 높이의 `ade-terminal-header`와 `ade-terminal-body`로 분리했다. header는 ADE owning frame의 단일 도구 헤더다. body는 기본적으로 실제 터미널 선택 목록이며 선택 후 `{terminal: address}` native layout block이 된다. 기존 터미널의 화면·입력·스크롤은 host terminal이 처리한다.

`selectTerminal(tree,address|null)`은 정상 ADE shell에서만 동작하는 순수 변환이다. body content와 terminal/right의 열린 상태만 변경한다. 다른 패널·크기·순서·unknown fields·기존 터미널 process는 그대로 보존한다. null은 선택 목록으로 돌아간다. toggle은 native terminal body에서도 같은 영역을 접고 연다.

`mods/ade/terminal.js` 공개 API:

- `terminalChoices(context)`는 현재 프로젝트의 공간 panes/agents/space labels 또는 ADE 생성 프로젝트 label에 속하는 실제 live terminal만 반환하며 machine을 검증한다.
- `showTerminal(address|null,context,cx)`는 주소 scope와 현재 프로젝트를 검사한 뒤 argv 기반 CLI로 native body를 설정한다.
- `openTerminal(context,cx)`는 명시적인 버튼 실행에서만 `hc run --json --bg --keep`로 대상 머신의 기본 shell을 생성한다. cwd·프로젝트 label과 유효한 공간/tab label을 argv로 넘긴다. remote label은 machine prefix를 제거하고, local root override에 remote 공간 id를 기록하지 않는다. 중복 클릭·stale 프로젝트는 launch를 차단한다.
- `TerminalBody.init/render/release`는 공통 ADE 관리 목록·MenuController, 빈 상태와 새 터미널 버튼을 제공한다. overlay props가 있으면 선택 후 닫는다.

검증:

- `node design/ade/check_frame_layout.mjs` 통과: 18개 고유 node, terminal header/body 계약, 순수 선택/reset, 동결 원본 불변, native terminal의 toggle, 크기/unknown data 보존.
- `node design/ade/build_layout.mjs --check` 통과.
- `node --experimental-vm-modules design/ade/check_terminal.mjs` 통과: 공간/machine 격리, 기존 터미널 composition, 원격 label, 명시 shell/중복 클릭/stale launch, local override.
- `herdr-app check mods/ade` 통과. frame 전체 연결·각 surface와 실제 terminal 입력/스크롤 UI 검사는 root가 별도로 수행한다.

이 작업자는 설치·CUA·live process 생성이나 기존 터미널 쓰기를 수행하지 않았다. 새 shell의 명령 경계는 모의 runtime으로 검증했다. 기존 터미널 kill/send/paste를 호출하는 경로는 없다.
