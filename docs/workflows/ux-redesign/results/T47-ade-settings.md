# T47 ADE 설정

`mods/ade/settings.js`의 SettingsView를 ADE 공통 관리 목록·입력·버튼에서 새로 구현했다. 화면/도구 창/단축키 세 페이지를 제공하며 메뉴·툴바 설정 페이지는 만들지 않았다. root frame의 설정 진입과 실제 editor preference 소비는 root 작업 범위다.

화면 페이지의 편집기 글꼴·크기(8–40)는 Apply 시 `ade.preferences = {editorFont,editorSize,...기존값}`에만 저장한다. 앱 전역 settings 파일은 변경하지 않는다.

도구 창 페이지는 다섯 실제 도구의 공통 관리 목록, 상단 이동 액션, 오른쪽 표시/위치 상세와 높이가 명시된 다섯 위치 선택 목록을 제공한다. visibility는 로컬 draft tree에 toggleRegion을 적용하며 Apply 전에 실제 배치를 변경하지 않는다. Apply는 편집한 필드만 최신 native layout 상태에 합쳐 arrangeRegions를 적용하고 성공 후 `ade.tool-settings` metadata를 기록한다. 대화상자가 열린 동안 바뀐 다른 도구의 visibility와 수동 크기, native terminal body를 보존한다.

frame-layout의 frameNodes는 각 known region을 ade-left/center/right의 실제 parent에서 검증한다. regionSettings(tree,metadata)는 실제 위치·순서·숨김을 반환한다. arrangeRegions(tree,settings)는 `{region:{position,order,hidden}}`을 받아 기존 region을 이동한다. 위치는 left-top/left-bottom/right-top/right-bottom/bottom이다. side에는 top 다음 bottom을, center에는 기존 editor와 unknown children 다음 도구를 둔다. unknown children의 데이터·상대 순서와 각 panel의 크기·native terminal을 보존한다. 비어 있거나 모두 숨겨진 side column은 숨긴다. toggleRegion과 selectTerminal은 이동된 실제 owning column을 사용한다.

단축키 페이지는 실제 keys()와 keys.json을 읽고 목록 검색·선택, 위쪽 추가/변경/제거, 오른쪽 작업/chord 입력을 제공한다. ade: 접두어의 작업만 편집 가능하며 기본/native 사용자 작업은 읽기 전용이다. Control과 Command는 각각 유지한다. 입력은 문자열 chord이며 별도 전역 키 기록/자동 등록은 하지 않는다. 변경은 draft로 보관하고 Apply 때 원본 파일 전체 snapshot과 latest read를 비교한 뒤 writeTextFile의 expected-text CAS로 저장한다. 다른 수정이 있으면 재열기를 안내하고 덮어쓰지 않는다. unknown sections와 typed binding objects를 보존한다. keys.json이 없으면 최초 명시 저장 시 keys()의 effective bindings를 함께 보존한다.

Apply는 모든 페이지의 편집된 draft를 적용한다. 변경하지 않은 기본값은 쓰지 않는다. 단축키 latest/CAS 검사를 먼저 수행하여 stale 파일이면 다른 페이지를 적용하지 않고 오류와 draft를 유지한다. 여러 저장 대상은 하나의 native transaction이 아니므로 이후 단계가 실패하면 이미 성공한 항목은 유지하고 나머지 draft와 오류를 창에 남긴다. 취소/닫기는 미적용 draft를 버린다. 열기만으로 preference/keys/layout을 쓰지 않는다.

검증:

- `node design/ade/check_frame_layout.mjs` 통과: 이동 후 검증/정렬, 다섯 위치, 실제 parent toggle/native terminal, empty column, idempotence, 원본·unknown·크기 보존.
- `node --experimental-vm-modules design/ade/check_settings.mjs` 통과: Ctrl/Meta 구분, ADE 소유 scope, native 충돌 거부, staged/CAS, unknown 보존, 초기 write 없음, preference와 tool layout 적용.
- `node --experimental-vm-modules design/ade/check_terminal.mjs` 회귀 통과.
- 화면/도구 창/단축키 각각 임시 복사 native fixture `herdr-app check` 통과. 사용자 설정 Apply는 호출하지 않았다.
- `herdr-app check mods/ade`, `python3 design/idea/sync_ui.py --check --mod ade`, `node design/ade/build_layout.mjs --check` 통과.

이 작업자는 설치·CUA·실제 사용자 keys/layout Apply를 수행하지 않았다. root 진입 연결·actual UI의 팝업/키보드/배치·편집기 글꼴 반영은 root 검증에서 별도로 기록한다.
