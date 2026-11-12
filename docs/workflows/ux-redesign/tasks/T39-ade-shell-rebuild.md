# T39 — ADE 프레임부터 새로 구성

- 상태: 첫 프레임 구현·핵심 조작 검증. 작은 창/큰 글꼴·전체 포커스 경로 검증 남음.
- 목적: U01/U05/U06/U09/U10/U11/U16/U17/U18. 승인 데모를 실제 native ADE의 시각·행동 원본으로 삼는다.
- 시작 조건: [재구성 제안](../12-ade-rebuild-plan.md)의 순서와 첫 단위에 따라 구현을 재개할 때.
- 원본: `design/ux-redesign-demo.html`, 사용자 최종 화면/목록 UX 피드백, 현재 설치 runtime 선언.
- 범위: 상단 bar, 중앙 탭/문서 자리, 좌우 stripe, 다섯 도구 슬롯, 하단 상태줄. 도구 열기/닫기·빈 열 접힘·크기 조절·포커스.
- 제외: DB 구현, 편집기 본 구현, 전체 기본 기능 동시 이식, 사용자 데이터/실행 변경, Herdr 앱 본체 수정.

## 구현 방향

현재 `idea` 프레임과 컴포넌트 구현을 시각 기준으로 삼지 않는다. 데모와 새 native 조립의 대응표를 만든 뒤 필요한 공통 컴포넌트부터 새로 작성한다. 실제 source 배치는 이 작은 단위의 조사 뒤 확정하며 새 범용 플러그인/문서/도킹 프레임워크를 먼저 만들지 않는다.

## 확정한 첫 구현 경계

- 새 모드는 `mods/ade`, 검증/시연용 native 레이아웃은 `layouts/ade.json`이다. 기존 idea/codebench 레이아웃을 덮어쓰거나 기존 사용자 패널을 초기화하지 않는다. 기본 기능 연결은 다음 단계다.
- canonical `herdr.ade` 치수는 데모에서 추출한 top48/status26/stripe44/tab40/tabFill34/header36/row28/control28/left218/right244/lower180/radius4다. 색은 `herdr.ux.colors`, 아이콘은 기존 검증된 Lucide 자산 원본을 공유한다.
- `frame-layout.js`는 순수 native tree와 도구 open/close만 소유한다. `createFrameLayout(metrics)`와 `toggleRegion(tree,key)`를 export한다. region은 project/structure/agents/terminal/results이며 각각 왼쪽 위/아래·오른쪽 위/아래·중앙 아래다. `REGIONS`가 id/label/icon/side/section의 단일 원본이다.
- 노드 id는 ade-root/ade-appbar/ade-workspace/ade-content/ade-left/ade-center/ade-right/ade-stripe-left/ade-stripe-right/ade-editor/ade-status와 `ade-${region}`이다. 각 도구는 header/body를 같은 mod view가 그리는 한 block이다. root resizablefalse, 실제 좌우/상하 split만 native resizabletrue/divider6(canvas). 현재 HTML처럼 아래 도구는 중앙 열 아래에 둔다.
- mod props는 `{view:"appbar"|"stripe"|"editor"|"panel"|"status"|"collection",side?,region?}`다. UI 전용 데이터는 ‘UI 미리보기’로 명시하고 실제 process/DB 성공을 만들지 않는다. 숨김 상태와 크기는 native layout만 소유한다. Render 중 layout/shared mutation이나 주기적 redraw 타이머는 없다.
- `design/ade/build_layout.mjs`가 canonical 치수와 순수 builder에서 JSON을 생성한다. 모드별 canonical UI 생성은 기존 sync `--mod ade`를 사용한다. 제품 상태와 OS 키맵을 미리 새로 만들지 않는다.
- root는 canonical UI/main.js·docs/native 검증, bounded 하위 작업은 frame-layout/builder/구조 회귀만 담당한다. 모델/추론 override 없이 현재 부모 실행 설정을 상속한다.

canonical 값/컴포넌트와 생성 경로는 `design/idea/tokens.json`·`ui.js`·`sync_ui.py`를 유지한다. 생성 파일 직접 수정은 하지 않는다. 다른 layout caller를 바꾸는 값은 영향과 이행을 확인한다. 기존 `codebench`는 별도 경로로 보존한다.

native 시험은 소유 fixture에서 한다. 현재 사용자 패널의 크기·활성 상태·터미널을 임의 초기화하지 않는다. 한 제목/행동 영역 원칙과 기존 기능 소유자에게 전달되는 명령 경계를 정한다. 미연결 동작은 활성 성공 버튼처럼 보이지 않게 한다.

## 관찰 사례와 완료 기준

- 모든 도구를 닫음 → 빈 좌우 열을 남기지 않고 중앙 영역이 넓어진다.
- 한쪽 위/아래를 함께 엶 → 같은 열을 공유하며 내부 경계를 조절할 수 있다.
- 좌/우/하단 경계 이동 → 실제 크기가 따라오며 반복 layout.set 루프가 없어야 한다. 정적 screenshot만으로 부드러움을 판정하지 않는다.
- 작은 창/큰 글꼴/긴 프로젝트명 → 핵심 제어가 잘리거나 겹치지 않는다.
- 키보드로 열기/닫기 → 현재 위치와 포커스가 예측 가능하다.

같은 창 크기·배율에서 데모/실제 screenshot을 나란히 비교한다. 배경 역할·타이포그래피·아이콘·여백·경계·탭·선택 상태를 항목별 기록한다. 차이를 설명할 수 없는 부분을 ‘native 차이’로 묶지 않는다.

변경된 모드의 `herdr-app check`, canonical sync `--check`, `check_system.mjs`, 관련 회귀와 실제 CUA 확인을 수행한다. 최초 전체 프레임의 실제 렌더를 보여준 뒤 피드백을 반영하고, 다음 화면 구현으로 이동한다. 현재 검증 결과와 남은 항목은 [T39 결과](../results/T39-ade-shell-rebuild.md)에 기록한다.
