# T50 ADE 터미널 core 탭·pane

사용자의 “터미널은 탭 단위로”, “pane 기능도 작동하게” 요청에 따라 T43의 단일 terminal composition을 native core 탭·pane tree로 바꿨다. 기존 공간/tab/pane/process를 복사하거나 재구성하지 않는다.

설치 runtime AGENTS의 정확한 content 계약은 `{tab:"active",pane:{...}}`이다. frame-layout 기본 terminal body가 이 content를 사용한다. pane은 lone:true, semantic background/border/focus, native split gap과 radius, 상단 항상 보이는 28px ADE pane-header를 갖는다. bodyblock의 movable:true는 root movable:false를 덮어쓰므로 native split pane grip을 허용한다. tool header는 기존 제목 36px + native tab strip 40px = 76px이다. builder로 layouts/ade.json을 재생성했다.

TerminalTabs는 현재 공간의 실제 core tabs를 표시한다. 선택은 tab.select, 닫기는 tab.close의 정상 확인 흐름, 새 터미널은 명시 클릭의 tab.new `{space,folder}`다. 닫기에 confirmed:true를 전달하지 않는다. PaneHeader는 runtime이 주는 pane id를 live panes에서 찾아 제목과 오른쪽/아래 분할·확대/복원·닫기를 표시한다. 모든 pane 명령에 해당 pane id를 명시한다. 드래그/분할 트리·focus·scroll은 native core가 소유한다.

showTerminal 호환 진입은 scope를 검사한 뒤 실제 pane의 core tab을 선택하고 native 전체 tab body를 연다. 특정 address가 split tree를 단일 terminal로 바꾸지 않는다. 현재 공간에 속하지만 pane이 없는 terminal/agent는 명시 선택 시 terminal.peek fallback을 사용한다. 다른 프로젝트 terminal은 거부한다. local root override와 원격 core 공간이 맞지 않으면 잘못된 머신에서 새 tab을 생성하지 않는다.

selectTerminal 순수 변환은 body를 native active tab으로 유지하고 이동된 실제 owning column을 연다. 기존 native pane frame 설정과 사용자 panel 크기/위치/unknown data를 보존한다. 이미 올바르게 열린 native tab body에서는 layout.set을 반복하지 않는다. 구형 36px terminal header와 단일 terminal/fallback body는 선택 진입에서 새 header/native content로 이동할 수 있다. 기존 processes에는 입력을 보내지 않는다.

검증:

- `node --experimental-vm-modules design/ade/check_terminal.mjs` 통과: core tab 선택/생성/정상 close, split tree 유지, 잘못된 scope/machine 차단, pane.split right/down·zoom·close의 정확한 pane id, orphan peek, 불필요한 layout rewrite 방지.
- `node design/ade/check_frame_layout.mjs` 통과: native tab/pane frame 계약, 76px header, lone/movable, native frame customization/수동 크기/이동 위치/unknown data 보존.
- `node --experimental-vm-modules design/ade/check_settings.mjs` 회귀 통과.
- `node design/ade/build_layout.mjs --check`, `herdr-app check mods/ade` 통과.
- TerminalTabs와 PaneHeader 각각 임시 복사 native fixture `herdr-app check` 통과.

이 작업자는 설치·CUA·실제 사용자 terminal/tab/pane 생성·분할·닫기를 수행하지 않았다. 실제 core tab 전환·split/zoom/grip·normal confirmation·terminal 입력/스크롤 관찰은 root 검증 범위다.
