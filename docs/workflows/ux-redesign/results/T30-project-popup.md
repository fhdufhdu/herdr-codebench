# T30 프로젝트 선택기·공통 외곽

2026-11-06. 프로젝트 선택기의 외곽은 부모 popup 한 곳이 소유하도록 바꿨다. standalone 메뉴는 기존 외곽을 유지하며, 내장 목록만 같은 키보드·선택·virtual scroll 구현을 외곽 없이 재사용한다. 전역 팔레트·버튼 디자인은 변경하지 않았다.

## 변경과 계약

`uiMenu(..., {embedded:true})`를 추가했다. 기본값은 false여서 다른 호출자는 그대로다. embedded는 popup background/border/radius를 만들지 않으며 기존 MenuController focus/selection/keyboard/scroll과 stable row key, disabled/separator 동작을 유지한다. 내부 padding은 양쪽6px, standalone은 추가 border를 포함해 총14px, embedded는12px를 높이·폭 계산에 사용한다. `rows[].tip`은 전체 텍스트 tooltip, `rows[].current`는 키보드 highlight와 별개의 이름 semibold 강조다. 기존 아이콘 factory 규칙은 유지한다.

IDEA 프로젝트 popup은 데모와 같은400px 폭, 한 줄 header와 작은12px 정렬 선택, 내장 project menu로 조립한다. 기존480px/two-header 기준으로 요청하던 popup 높이를 한 header+separator+padding+외곽 기준으로 맞춰 작은 목록의 빈 여백을 없앴다. parent border 내부 menu 폭은398px이며 부모/목록 모두 definite bounds를 갖는다. codebench는480px, 기존 위·아래 이동 toolbar와 단축키·직접 정렬 동작을 보존한다.

프로젝트명/경로/remote 접두어, 동명 stable id, 현재 프로젝트 초기 선택, 폴더 열기, 이름/최근/직접 정렬, 직접 지정 관리 dialog의 staged Cancel/Apply·machine boundary는 유지했다. 긴 경로는 기존 한 줄 truncate와 전체 이름·machine·경로 tooltip으로 구분한다. 정렬 Select/Popup의 focus/open/close와 submenu Escape 동작도 기존 소유권을 유지한다.

추가 지시로 toolbar 우클릭의 삭제된 Menus and Toolbars 페이지 진입 handler와 쓰이지 않는 settings import를 제거했다. 저장된 codenav.customization runtime 소비는 유지한다.

## 갤러리와 검증

개발자 gallery의 기존100행 standalone menu 옆에 **Open embedded menu…** 예제를 추가했다. view props는 `{view:"designpreview",variant:"embedded-menu"}`, popup400×400이다. parent header/frame와 embedded100행 목록, disabled/separator, current 강조와 긴 경로 tooltip을 확인할 수 있다. 모든 예제 동작은 local state만 바꾼다.

통과:

- `python3 design/idea/sync_ui.py` 및 `--check` — codenav/activity canonical 생성·일치.
- `node --experimental-vm-modules design/idea/check_system.mjs` — standalone frame 보존/embedded 무외곽 및 definite geometry, 기존 deferred icon/키보드/scroll·공통 상태 회귀.
- `node --experimental-vm-modules design/idea/check_project_order.mjs` — compact/normal × UI13/16의 부모 한 외곽과 높이 합계, 동명 local/remote stable id·전체 경로 tooltip·current 강조, 이동/Escape, 기존 sort Select·긴 관리 목록·Cancel/Apply·machine/live-id·cleanup·codebench·recency 회귀.
- `node --experimental-vm-modules design/idea/check_surfaces.mjs` — toolbar 우클릭 잔재 제거와 customization 소비/Problems/헤더 기존 회귀. 프로젝트 geometry helper용 mock을 실제 return shape로 보완.
- `herdr-app check mods/codenav`, `herdr-app check mods/activity`.
- 소유 변경 파일의 `git diff --check`.

설치/HMR/CUA는 수행하지 않았다. 실제 popup 및 gallery의 시각·focus·긴 경로·100행 End/Home/PageUp/PageDown/Enter/Escape 검증은 부모의 단독 native 검증으로 이어진다. CLI check만으로 화면 일치를 주장하지 않는다.

## 정확한 변경 파일 인계

- canonical: design/idea/ui.js
- caller: mods/codenav/tools.js (Projects, popup sizing helper/해당 toolbar 진입, 제거된 settings 우클릭 handler)
- example: mods/codenav/design-preview.js
- checks: design/idea/check_project_order.mjs, check_system.mjs, check_surfaces.mjs
- generated: mods/codenav/idea-design.js, mods/activity/idea-design.js (`sync_ui.py`만 사용)
- result: docs/workflows/ux-redesign/results/T30-project-popup.md

common.js/main.js/editor/DB/실행/settings source와 설치 파일은 변경하지 않았다.
