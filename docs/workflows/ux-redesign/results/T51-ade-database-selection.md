# T51 후속 · DB 다중 선택·DDL와 프로젝트 직접 순서

DatabaseTree에 database/schema/table/view의 다중 선택을 추가했다. 일반 클릭은 기존 펼치기/문서 열기를 유지한다. Cmd 또는 Ctrl 클릭은 항목을 추가/해제하고, Shift 클릭은 visible tree의 anchor부터 범위를 선택하며 modifier 클릭 자체는 문서를 열거나 트리를 접지 않는다. Shift+방향/Home/End/Page 이동은 MenuController로 focus/scroll을 이동한 뒤 범위를 선택한다. Ctrl/Cmd+A는 현재 보이는 실제 개체를 선택한다. folder/loading/retry/source 행은 DDL 개체에 포함하지 않는다.

설치 runtime의 virtual-list on_item_click은 modifier event를 제공하지 않고 virtual list 자체의 on_mouse_down은 연결되지 않는다. 따라서 plain v_flex wrapper의 public on_mouse_down에서 modifiers를 보관하고 list의 stable-key click에서 사용한다. deferred row renderer 안에는 event handler를 추가하지 않았다.

DDL 버튼은 선택한 개체를 databaseDocumentSpec(source,node,selection)과 모델 ddlSelection에 전달하여 읽기용 DDL 문서를 연다. database 전체와 schema의 하위 객체 포함 관계는 모델에서 중복을 정리한다. 서로 다른 DB/schema 개체는 자신의 scope를 유지하며, 다른 연결의 선택은 연결별 문서로 나눈다. SQL 실행이나 profile mutation은 선택/DDL 열기에 포함되지 않는다. 선택은 refresh 때 비워 오래된 catalog를 재사용하지 않는다.

프로젝트 정렬의 “직접 지정”을 선택하면 추가 버튼을 누르지 않고 바로 공통 managed list의 순서 draft/이동 액션/확인·취소를 표시한다. 직접 모드 선택만으로 core 공간 순서나 저장된 order를 변경하지 않는다. 파일 openDocument는 해당 projectKey의 ade.editor-mode를 file로 전환하므로 중앙 통합 strip이 DB 문서 상태에서 실제 파일로 돌아온다. 다른 프로젝트의 모드는 유지한다.

검증:

- `node --experimental-vm-modules design/ade/check_database_ui.mjs` 통과: Cmd 추가/Ctrl 해제, modifier 클릭 미열기, Shift 범위/키보드, 전체 보이는 개체, whole database/schema 포함 정리, 서로 다른 database/schema scope, 연결별 DDL 문서, refresh selection 해제와 무실행.
- `node --experimental-vm-modules design/idea/check_ade_workspace.mjs` 통과: 직접 모드 즉시 draft 진입·저장 전 core/order 불변, 프로젝트별 file mode 전환과 상대 경로 거부.
- DB 다중 선택/DDL toolbar와 프로젝트 순서 관리 각각 inert 임시 native fixture `herdr-app check` 통과. virtual-list handler warning 없이 렌더되었다.
- `herdr-app check mods/ade` 통과.

이 작업자는 설치·CUA·실제 profile 변경·쿼리 실행을 수행하지 않았다. 실제 modifier pointer/keyboard와 DDL 결과·통합 strip의 시각 흐름 확인은 root 검증 범위다.
