# T13 native 목록 관리 이식 결과

2026-11-05. 소유 파일 `design/idea/ui.js`, `mods/codenav/tools.js`, `mods/codenav/database.js`에 승인된 상단 툴바·선택 목록·상세 설정 패턴을 적용했다. 기존 미커밋 변경을 유지하고 생성물과 설치 파일은 수정하지 않았다.

## 공통 계약

`uiManagedList(id, rows, controller, cx, {selectedId,onSelect,onActivate,onClose,actions,search,caption})`를 canonical UI에 추가했다. `controller`는 init에서 만든 MenuController이며 호출자가 controller와 focus를 release한다. rows는 `{id,label,detail?,icon?:()=>graphic(),disabled?}`, actions는 `{id,label,icon?:()=>graphic(),action,disabled?,shortcut?}`다. search는 호출자가 소유한 native Input element다.

상단 단일 툴바, 검색·caption, virtual list와 scrollbar를 조립한다. ↑↓/Home/End/PageUp/PageDown은 단일 선택을 변경하고 Alt+↑↓는 활성 move-up/down 액션을 호출한다. Enter만 onActivate를 호출한다. 동일 행 선택이나 경계키에서 onSelect를 반복 호출하지 않아 미저장 상세 입력이 초기화되지 않는다. 렌더 중 스크롤 요청을 하지 않고 선택·이동 이벤트에서만 MenuController.ensureVisible을 호출한다. deferred row 아이콘은 factory만 허용한다.

## Projects

idea에서 정렬 셀렉트의 직접 지정을 선택하면 `view:projects, manageOrder:true`인 별도 480×440 dialog를 연다. 실제 spaces를 복사한 draft에서 검색·선택·위/아래를 수행한다. 검색 중 이동과 machine 경계 이동을 비활성화한다. Cancel/Escape는 코어 순서와 정렬 기준을 바꾸지 않는다. Apply는 최신 live ids와 machine 그룹을 확인하고 실제 space.move를 전달한 뒤 manual 정렬을 저장한다. 정렬 목록의 기존 codebench 툴바와 직접 이동은 유지한다.

## Database

idea의 전역 연결 sidebar를 공통 목록으로 이식했다. 상단 New/Delete/Duplicate/위/아래, 이름·driver 검색과 우측 기존 상세 form, Save/Test/Cancel을 조립한다. 복제는 현재 metadata에서 id와 password를 제거하고 새 form을 열어 다른 프로필의 Keychain credential을 상속하지 않는다. password 입력은 native InputState만 소유하며 공유 상태에 넣지 않는다.

연결 순서는 source id 배열만 `codenav.database.sourceOrder`에 저장하며 이동 직후에는 draft다. 현재 프로필 Save 성공 시 순서도 저장하고 Database 트리 refresh에 반영한다. Cancel은 미저장 상세와 순서를 폐기한다. 기존 Delete 두 번 확인 후 backend·Keychain 삭제와 각 프로필 Save 동작을 유지했다. 이미 Save하거나 확인 삭제한 내용을 Cancel로 되돌리는 전체 CRUD transaction은 추가하지 않았다. codebench sidebar와 순서는 기존 동작을 유지한다.

## 검증

- 소유한 세 JavaScript 파일 `node --check` 통과.
- `node --experimental-vm-modules design/idea/check_system.mjs` 통과.
- 생성 전의 미노출 export를 피하기 위해 fixture loader만 메모리에서 canonical UI로 연결하여 기존 `check_database_ui.mjs` 전체 회귀 통과. password masking/Keychain 유지·명시 clear·stale 응답·실제 CRUD·catalog·handle cleanup 포함.
- 같은 메모리 fixture에 공통 방향키·disabled skip·Alt 이동 disabled, DB draft 순서·검색 이동 차단·credential 없는 복제 assertion을 추가하여 통과.
- Projects 기존 fixture 기반 메모리 실행에서 별도 dialog, draft Cancel/Apply, 검색과 machine 경계, 코어 순서 저장, scroll/focus release 통과. 기존 테스트 파일은 변경하지 않았다.

생성·`--check`·mod CLI check·일괄 설치 및 실제 앱 화면 검증은 부모 통합 단계에서 수행한다. 이 하위 결과만으로 실제 앱 검증 완료를 주장하지 않는다.

## 재현 가능한 저장소 회귀 검사 보강

부모의 일괄 생성 후 `check_project_order.mjs`와 `check_surfaces.mjs` fixture에 native Input/InputState와 새 공통 목록 의존성을 추가했다. Projects 검사에서 기존 직접 이동 keyboard/toolbar 회귀는 codebench로 유지하고 idea 검사는 승인된 별도 관리 dialog 기준으로 갱신했다. 자동 정렬·menu 선택/클릭/열기/닫기·최근 사용 기록 회귀도 유지한다.

신규 저장소 assertion은 직접 지정 dialog 진입과 definite bounds, ↑↓/Home/End/Page 키 선택, 이동 뒤 선택 유지, 첫/끝·machine 경계 이동 차단, 검색 중 두 이동 버튼 비활성 및 Alt 이동 차단, 일반 redraw scroll 유지, draft 중 코어 명령 없음, Escape/Cancel의 기존 순서·정렬 보존, Apply의 live id 재확인과 순서 저장, input/focus/scroll 해제를 포함한다.

다음 두 명령 모두 수정된 저장소 파일 그대로 통과했다. 메모리 loader 치환은 필요 없다.

```sh
node --experimental-vm-modules design/idea/check_project_order.mjs
node --experimental-vm-modules design/idea/check_surfaces.mjs
```

## Native 입력 API 교정

부모의 실제 native eager fixture가 Projects 관리창과 DB 연결 관리에서 `unknown element method placeholder`를 발견했다. 설치된 runtime 선언에서 placeholder는 `InputState.new({placeholder})` 옵션이며 Input element의 메서드가 아니다. 두 source의 검색 placeholder를 init의 InputState 생성 옵션으로 옮겼다. canonical UI와 생성물은 이 교정에서 수정하지 않았다.

기존 proxy 기반 fixture가 임의의 element 메서드를 허용하여 해당 오류를 잡지 못했다. 따라서 JavaScript fixture PASS만으로 native API 호환을 판단할 수 없으며 native eager check와 실제 화면 확인이 필요하다. 수정 후 원본 project-order/surfaces/database-ui 검사가 모두 통과했다. 부모 소유 `/tmp/check-native-redesign.py`로 source를 복사하여 실제 `herdr-app check`를 replay한 결과 Projects order, connection-network, connection-sqlite가 모두 통과했다. 같은 replay의 다른 화면은 부모가 별도로 교정 중인 accessible label/결과 fixture export 문제를 보고했으므로 전체 replay 통과로 기록하지 않는다.
