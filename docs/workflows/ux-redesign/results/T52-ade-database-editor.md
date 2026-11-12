# T52 ADE Database 중앙 문서·결과·전송

2026-11-06. `mods/ade/database-editor.js`에 새 DatabaseEditor, DatabaseResults, DatabaseTransfer를 구현했다. 기존 DB UI/controller를 import·상속·복사하지 않았다. fresh database-model/data-extract와 기존 engine의 다섯 driver 경계를 사용한다. 설치·사용자 DB profile 변경·실제 DB 쓰기는 이 하위 작업에서 수행하지 않았다.

## 중앙 문서

model의 프로젝트별 metadata tabs와 active id를 읽고 실제 원문·페이지·selection·staged 변경은 각 view의 local memory에 보관한다. init/refresh/비동기 callback에서 native input과 menu handle을 생성하며 render에서는 만들지 않는다. 늦은 read는 문서 identity/generation/release를 검사한다. 다른 프로젝트의 응답이 현재 문서를 덮지 않는다.

connection / driver / database 또는 schema context 행과 필요한 읽기 전용 표시는 중앙 문서가 소유한다. 테이블은 이름·행 수·실측 응답 시간과 DDL/복사/내보내기/가져오기/새로고침 툴바 하나를 사용한다. 고정 28px header·row, monospace 값, 파란 행 selection, italic/dim NULL을 사용한다. native h_resizable header의 최종 column widths를 모든 body row에 적용한다. 모든 크기에서 측정된 viewport 수의 native rows만 ordinary render로 만들며 wheel/이전·다음과 keyboard selection은 이 표시 window를 이동한다. deferred renderer 안에 event handler를 등록하는 경로는 제거했다.

행 click, Cmd/Ctrl 다중 선택, shift 범위, 방향키/Home/End/Page와 Cmd/Ctrl A/C를 제공한다. selection·navigation·scroll은 MenuController를 사용한다. 복사·전송 preview·파일 출력은 모두 data-extract의 동일 formatter를 호출한다.

cell double click은 retained native Input을 표시한다. Enter 또는 명시적 적용이 TableChanges에 stage하며 NULL 버튼은 빈 문자열과 구분된다. Apply만 실제 PK optimistic CAS writes를 실행한다. 오류 시 staged 값과 원본 snapshot을 유지한다. Cancel은 staged 변경만 되돌린다. view 및 PK 없는 기존 행의 편집은 거절한다. binary cell 편집은 명시적으로 지원하지 않는다.

SQL console은 동일 CodeInput의 문서/selection을 사용한다. CmdEnter(macOS)/CtrlEnter(다른 OS) 또는 실행 버튼은 SQLScript의 원문 offset 후보를 표시한다. ADE managed-list와 MenuController의 bounded native popup에서 선택 후 Enter 또는 별도 실행 버튼을 눌러야 실행된다. 선택/중첩/현재 구문/블록/전체 script 후보의 원문 snapshot이 변경되면 실행을 거절한다. lexical 색은 canonical herdr.ux.syntax를 사용한다. DDL은 같은 중앙 readonly CodeInput과 native tabs에 표시하고 engine warnings를 유지한다.

## 하단 실행 결과

SQL 결과를 중앙 console 안에 넣지 않는다. QueryJob은 engine job id와 제한된 metadata만 프로젝트 shared history에 게시하며 SQL 원문·결과 행은 shared에 넣지 않는다. DatabaseResults는 자기 runtime에서 실제 job을 조회하고 status/진행/elapsed/오류·결과 집합을 표시한다. local job snapshot은 최대 세 개이며 재선택 시 다시 조회한다. 기존 완료 결과의 selection은 polling 때문에 초기화하지 않는다. 중지는 explicit cancel 요청이다.

ResultsHost와의 계약은 init({context,embedded:true,selectedId?},cx), render(cx,{selectedId}={}), refresh(cx,context), select(id,cx), release()다. embedded에서는 자기 job tab strip을 생략하고 host의 공통 strip 아래 본문만 그린다. fetch 중 selection/context가 바뀌면 완료 후 새 대상을 다시 준비한다.

중앙 EditorHost와의 계약은 init({context,embedded:true},cx), activate(id,cx), closeDocument(id,cx), title(id), dirty(id), document(id), refresh(cx,context), render(cx), release()다. closeDocument는 true면 닫힘, false면 inline dirty prompt/적용 중 상태다. embedded에서는 문서 strip을 생략한다. console 원문은 현재 runtime memory에만 있으므로 닫기는 변경 버리기 확인을 요구한다.

## 전송

DatabaseTransfer init({mode,spec,dataset,selection,context,source?,overlay},cx)에서 export CSV/TSV/JSON/SQL INSERT/UPDATE/WHERE를 preview하고 복사한다. SQL 출력은 정확한 connection driver를 확인하며 필요하면 대상 table을 입력한다. SQL UPDATE는 명시적 key metadata가 없으면 formatter가 거절한다.

설치 runtime에는 folder picker만 있고 파일 저장 picker는 없다. 따라서 절대 경로를 입력받고 readTextFile/writeTextFile CAS를 사용한다. 기존 파일은 먼저 snapshot과 덮어쓰기 안내를 표시하며 두 번째 explicit overwrite에서 저장한다. preview·복사·저장은 동일 text다. stale snapshot은 오류를 보존한다.

Import는 CSV/TSV/JSON 파일 읽기, 대상 column mapping, 최대20행 preview와 최대1000행 검증을 제공한다. parse/preview는 DB에 쓰지 않는다. Import Apply에서만 engine의 transactional db_apply를 호출한다. backend rollback 오류를 그대로 표시하고 preview/mapping을 유지한다. 반환 schema에 없는 nullable/default/generated 정보까지 UI가 검증했다고 주장하지 않는다. 실제 제약 조건은 engine/DB transaction이 판정한다.

## 검증

- `node --experimental-vm-modules design/idea/check_ade_database_editor.mjs` 통과: native state render 중 생성 금지, cell stage 무쓰기, CAS 실패 보존과 명시 Apply, SQL 후보 열기 무실행 및 선택 구문만 실행, shared history 결과 제외, lower 결과 조회, 동일 extractor export, 기존 파일 snapshot 검토/overwrite, import preview 무쓰기/Apply, 500행의 bounded row 수·페이지 사이 절대 index selection/copy·End reveal. cell staging은 selection/anchor/window를 보존한다.
- `node --check mods/ade/database-editor.js` 및 당시 `herdr-app check mods/ade` 통과. 당시 main이 DB classes를 아직 mount하지 않았으므로 이를 DB native layout/interaction proof로 사용하지 않는다.
- root의 통합·격리 SQLite fixture에서 실제 row 표시, native resize, selection, double click/Input/Apply/Cancel, SQL 범위 선택 및 하단 결과, mixed-scope DDL, export/import, 실패 rollback을 확인해야 한다. 기존 사용자 profile/DB를 시험 데이터로 사용하지 않는다.

## Native 검증 후 교정·표시 정합

root는 격리 SQLite customers 8행 표시와 실제 cell staging/명시 Apply 전후 디스크 차이를 확인했다. 비어 있지 않은 SQL 범위 popup의 실제 paint와 Escape도 `/tmp/ade-popup-fixed-crop.png`에서 확인했다. 처음 popup에 잘못 사용한 on_mouse_down_out("left",handler)는 public API의 handler-only 형태로 수정했다. 실제 SQL CmdEnter가 native Enter로 소비되던 경로는 CodeInput의 SQL 전용 onExecute action으로 바꿨으며 engine 실행 proof는 root의 다음 배치 검증 대상이다.

승인 HTML과 비교해 DB icon/source/driver/schema breadcrumb, 확인 가능한 환경 badge, 별도 surface toolbar, table icon/이름/count-time chip, DDL·export 아이콘을 적용했다. 확인되지 않은 remote 환경을 로컬로 표시하지 않는다. grid는 # gutter와 PK 표기, monospace14 값, semantic separator/header/선택 색을 사용한다. email 등 긴 열에 더 넓은 기본 폭을 주고 viewport 여백을 자동 열에 배분한다. 사용자가 바꾼 열 폭은 창 크기 변경 뒤에도 유지한다. 모두 들어오는 작은 표에는 구간 pager를 만들지 않으며 테이블 server-page footer도 page 이동 또는 selection이 있을 때만 표시한다.

테이블/결과의 복사…는 기존 DatabaseTransfer의 동일 format/preview/copy UI를 연다. CSV/TSV/JSON/SQL 원문은 export와 같은 extractor를 사용하며 keyboard copy만 기본 CSV다. Import 성공은 원문 없이 target별 ade.database-data-changed counter를 게시한다. active clean table은 native timer의 fresh context에서 다시 읽고 dirty/편집 중이면 값을 보존한 채 안내한다. 테스트는 clean reload/dirty 보존, 선택 JSON/SQL 복사, 반응형 fill/사용자 width 보존, 작은 표 pager 없음, 비어 있지 않은 popup API signature도 검증한다.

`make_ade_database_probe.mjs`는 backend 접근을 모두 거절하는 독립 native fixture를 만든다. 기본은 선택 후보가 이미 열린 SQL 상태이며 `--table`은 8행/PK/NULL/resize가 있는 테이블 상태다. 두 실제 상태의 eager native check를 통과했다. 이 fixture check가 실제 DB execution 또는 최종 화면 정합 증거를 대신하지 않는다.
