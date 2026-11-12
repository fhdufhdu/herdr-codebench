# U01 프로젝트 목록 순서 결과

## 구현

- `mods/codenav/tools.js`의 Projects selector 아래에 공통 `uiToolbar`/`uiButton`으로 선택 프로젝트 위/아래 이동을 제공한다. `Alt+↑`, `Alt+↓`도 같은 명령을 실행한다. 일반 화살표 이동, Enter/클릭 프로젝트 열기, Esc, Open Folder는 기존 `MenuController`/`uiMenu` 경로를 유지한다.
- 사용자 후속 요청에 따라 상단에 이름순·최근 사용순·직접 지정 버튼을 추가했다. 기준은 `codenav.projectSort`에 저장하고 machine 그룹 안에서 정렬한다. 자동 정렬을 선택해도 core의 직접 지정 순서는 보존한다. 이동 버튼과 단축키는 직접 지정에서 활성화한다.
- 최근 사용 기록은 항상 표시되는 Status에서 활성 프로젝트 전환을 감지해 `codenav.projectRecent`에 기록한다. 삭제된 ID와 중복을 제거한다. runtime에 과거 방문 시각이 없어 설치 후 관찰한 방문부터 기록하며, 기록이 없는 항목끼리는 core 순서를 유지한다.
- 이동은 메뉴를 닫거나 프로젝트를 열지 않는다. 선택 ID를 유지하고 선택 항목으로 스크롤하며 메뉴 포커스를 복구한다. 첫/마지막, 다른 machine 경계, Open Folder 선택에서는 버튼을 비활성화한다. 메뉴와 도구 모음 합계 높이를 400px 이내로 제한한다.
- `mods/codenav/project-order.js`는 인접 항목의 machine 일치와 ID/방향을 검증하고 `space.move {id,index}` 인자만 만든다. 실제 명령 직전 `spaces()`를 재조회하여 외부 변경/삭제를 반영한다. 별도 설정/순서 저장소는 만들지 않았다.
- 인덱스는 **전체 `spaces()` 목록에서 1부터 시작하는 target 위치**다. 설치된 `~/.config/herdr-app/mods/spaces/main.js`의 same-machine drag와 `space.move` 호출을 근거로 하며, machine-local 인덱스로 추정 변환하지 않았다. 영속 저장은 core가 소유한다.
- drag는 추가하지 않았다. 기존 deferred menu/keyboard 계약을 유지하는 선택 항목 이동 버튼과 shortcut으로 현재 요구를 충족한다. 공통 컴포넌트/생성물은 수정하지 않았다. 부모 소유 i18n에 `Move Project Up`, `Move Project Down` 키를 전달했다.

## 실행한 검증

- `node --experimental-vm-modules design/idea/check_project_order.mjs` — 통과. 순수 모델의 미지/누락 ID, 빈 목록, 잘못된 방향/동일 위치, 첫/마지막 및 machine 경계, 원격 항목 global index, 최신 목록 재조회 및 삭제, 실제 Projects 클래스와 공통 MenuController/uiMenu를 이용한 클릭/키보드/Enter/Esc/Open Folder, 이동과 열기 분리, 선택 유지, 30개 항목 scroll 호출 및 release를 확인했다.
- 같은 검증에 이름의 숫자 정렬, 최근 방문 순위, 기준 저장·재열기, 자동 정렬 중 이동 차단, core 순서 보존, Status의 방문 기록과 일반 재렌더 무변경을 추가했다. 실제 toolbar 진입점의 팝업 높이도 검증한다.
- `node --experimental-vm-modules design/idea/check_surfaces.mjs` — 통과.
- `python3 design/idea/sync_ui.py --check` — 통과 (`codenav`, `activity`).
- `node --experimental-vm-modules design/idea/check_system.mjs` — 통과 (공통 색/밀도/deferred icon/키보드/scroll 및 layout 보존 계약).

## 실제 Herdr 확인

- `herdr-app check mods/codenav` 통과 후 변경 모듈을 일괄 설치했다.
- 2026-11-05 Computer Use로 실행 중인 Herdr의 idea 레이아웃에서 실제 프로젝트 버튼을 열었다. 원래 진입점이 하단 이동 도구 모음 높이를 예약하지 않아 잘리던 문제를 수정했다. 정렬 버튼 세 개와 하단 이동 버튼 모두 화면에 표시됨을 확인했다.
- 최근 사용순에서 현재 프로젝트가 첫 번째로 표시되고 이동 버튼이 비활성화된다. 이름순에서 이름에 맞게 재정렬되며 기존 선택 ID가 유지된다.
- 직접 지정에서 선택한 `herdr-codebench`를 `Alt+↑`로 `estrack` 위로 옮긴 뒤 아래로 이동 버튼으로 원래 마지막 위치를 복원했다. Esc로 닫고 다시 열어 직접 지정 기준과 원래 순서가 유지됨을 확인했다.

## 남은 확인

이번 실제 화면 검증은 idea 레이아웃의 현재 7개 프로젝트 목록을 사용했다. codebench 외관과 30개 목록의 실제 가시성은 VM 검증 범위이며, 앱 재시작 후 디스크 영속성은 직접 확인하지 않았다.
