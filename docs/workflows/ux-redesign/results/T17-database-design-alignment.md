# T17 Database 화면 정합 감사

2026-11-06. 상태: **감사 결과 검토 대기 / 추가 구현 보류**. 사용자 최신 지시인 ‘다른 점을 모두 찾아 먼저 변경점을 확인’에 따라 source 감사만 진행한다. 지정 effort medium 유지. 실제 앱 관찰은 부모 담당이며 이 문서는 source로 확인한 사실과 제안을 구분한다.

## 이미 발생한 부분 변경

최신 지시가 도착하기 전 `mods/codenav/database.js`만 부분 수정했다. 되돌리지 않았으며 추가 source 변경은 멈췄다.

- idea 연결 관리에서 driver/TLS 버튼 나열을 Select/Popup/MenuController 기반 compact selector로 전환하는 코드를 추가했다. `selector()`는 driver/TLS가 함께 사용한다. 새 focus/menu handle은 init에서 생성하고 release한다.
- InputState.new의 실제 placeholder 옵션을 사용했다. idea 상세 label 폭 84, master 폭 250, 공통 shell padding에 더하는 상세 padding 8로 데모의 24/20 상세 여백에 맞추는 부분을 작성했다. Name→DB 종류 순서를 반영하고 중복 전역 설명을 줄였다.
- codebench driver/TLS 버튼 배치는 기존 분기에 남겼다.
- `node --check mods/codenav/database.js`만 통과했다. **native eager/관련 fixture/실제 UI 검증은 하지 않았으므로 적용 완료가 아니다.** 기존 DB UI fixture는 버튼 ID를 기대하고 Select/Popup host stub이 없으므로 부분 변경에 맞춘 후속 검증 수정이 필요하다.
- T17에서 `database-editor.js`, 관련 검사, generated 파일, 설치본은 아직 수정하지 않았다. 아래 실제 구현 근거 중 database.js의 selector/여백은 이 미검증 부분 변경을 포함하며 설치된 UI와 동일하다고 주장하지 않는다.

## 우선순위

- **P1**: 승인된 행동 순서·주요 행동·결과 위치/선택 방식이 달라지는 항목.
- **P2**: 밀도·정보 위계·빈 상태·상세 표현과 제어 배치의 차이.
- **P3**: 실제 기능에 필요한 추가 기능. 삭제하지 않고 데모 구조 안에서 위치/강조만 정리할 항목.

## 화면별 차이와 제안

| 화면 / 우선순위 | 데모와 실제 source 차이·근거 | 변경 제안과 기능 영향 |
| --- | --- | --- |
| 탐색 / P1 | 데모는 연결 관리/추가가 header에 있고 바로 아래에 눈에 보이는 ‘SQL 콘솔’ 행동이 있다([demo:1820](../../../../design/ux-redesign-demo.html#L1820)). 실제 body는 tree/상태뿐이고 콘솔은 context menu의 `New Query Console`에 있다([database.js:179](../../../../mods/codenav/database.js#L179), [196](../../../../mods/codenav/database.js#L196)). | 선택 연결에 대한 SQL 콘솔 행동을 노출한다. 관리/추가/새로고침은 공통 header 소유를 유지해 제목/행동행을 복제하지 않는다. source/database/schema snapshot 전달은 기존 동작을 재사용한다. |
| 탐색 / P2 | 데모는 source→main→테이블/뷰 그룹과 개수를 보여준다([demo:1856](../../../../design/ux-redesign-demo.html#L1856)). 실제는 엔진 catalog의 database/schema/table/view/column 계층을 그대로 펼치며 종류별 그룹/개수가 없다([database.js:73](../../../../mods/codenav/database.js#L73), [99](../../../../mods/codenav/database.js#L99)). | 가져온 객체만으로 표현할 수 있는 table/view 구분과 로드된 개수를 정리한다. 엔진에 없는 개수나 전체 목록을 가정하지 않는다. backend 계층·lazy loading·에러 재시도·다중 선택은 보존한다. |
| 탐색 / P2 | 데모 테이블 행은 클릭으로 중앙 탭을 연다([demo:1866](../../../../design/ux-redesign-demo.html#L1866)). 실제는 단일 클릭에서 node를 펼치고 더블클릭/Enter/Meta+Down이 표를 연다([database.js:139](../../../../mods/codenav/database.js#L139), [217](../../../../mods/codenav/database.js#L217)). | 행 선택·확장 화살표·객체 열기를 분리해 승인한 클릭 행동과 맞춘다. 기존 키보드 열기와 column 탐색을 삭제하면 안 된다. 실제 클릭/확장 관찰 후 최종 결정할 행동 차이다. |
| 탐색 / P2 | 데모 footer는 ‘테이블을 클릭하면 중앙에서 열림, 연결은 전역’이라는 도움말을 상시 제공한다([demo:1893](../../../../design/ux-redesign-demo.html#L1893)). 실제 정상 tree에는 이 footer가 없다. 전역 안내는 빈 상태 또는 manager caption에만 있다([database.js:205](../../../../mods/codenav/database.js#L205)). | 짧은 컨텍스트 안내를 하단에 두되 body 높이를 과도하게 차지하는 설명행을 만들지 않는다. 실제 확정된 클릭 행동을 안내해야 한다. |
| 연결 관리 / P1 | 데모는 이름 다음 ‘DB 종류’ compact select다([demo:2034](../../../../design/ux-redesign-demo.html#L2034)). 변경 전 실제는 상세 상단 5-driver 버튼군이었다. 현재 부분 변경은 이를 selector로 바꿨지만 미검증이다([database.js:416](../../../../mods/codenav/database.js#L416), [443](../../../../mods/codenav/database.js#L443)). | 부분 변경을 실제 native API/키보드/포커스 복귀/disabled 상태로 검증하고 완성한다. 다섯 driver·default port 변경·SQLite/network 조건 필드는 유지한다. |
| 연결 관리 / P2 | 데모 dialog 폭 840, master 250, detail padding 20/24와 label 84다([demo:1125](../../../../design/ux-redesign-demo.html#L1125), [1290](../../../../design/ux-redesign-demo.html#L1290)). 실제 overlay는 900×680이고 이전 master 210/label105였다([database.js:43](../../../../mods/codenav/database.js#L43)). 부분 변경은 master/label/padding만 조정했다([462](../../../../mods/codenav/database.js#L462)). | 창 크기와 세로 밀도까지 한 화면에서 대조한다. 실제 필수 password/database/TLS 필드를 포함해야 하므로 410px demo 본문을 무조건 강제하면 안 된다. 고정 높이 안에서 한 상세 scroll을 사용한다. |
| 연결 관리 / P2 | 데모 title ‘연결 관리’와 선택된 연결 detail heading이다([demo:2020](../../../../design/ux-redesign-demo.html#L2020)). 실제 dialog title은 ‘Data Sources and Drivers’이며 변경 전 detail도 ‘Edit/New Data Source’라 문구가 반복됐다. 부분 변경에서 detail 이름만 정리했다([database.js:444](../../../../mods/codenav/database.js#L444), [462](../../../../mods/codenav/database.js#L462)). | title/전역 badge/detail heading의 역할을 분리하고 기존 전역 안내를 중복하지 않는다. 실제 상태나 저장 동작은 바꾸지 않는 문구·위계 수정이다. |
| 연결 관리 / P1 | 데모는 목록 전체를 draft로 편집하고 마지막 확인 때 저장한다([demo:3490](../../../../design/ux-redesign-demo.html#L3490), [3605](../../../../design/ux-redesign-demo.html#L3605)). 실제는 선택 profile별 즉시 Save이고 다른 profile을 선택하면 `.edit()`가 InputState를 덮는다. 순서는 profile 저장 성공 때만 저장한다([database.js:270](../../../../mods/codenav/database.js#L270), [297](../../../../mods/codenav/database.js#L297), [354](../../../../mods/codenav/database.js#L354)). | **동작 계약 차이로 별도 결정 필요**. 단순히 Save를 ‘확인’으로 바꾸면 의미가 틀린다. 기존 실저장 API를 유지하면서 source 전환 시 draft 보존/저장 경계를 명확하게 맞출 방법을 정해야 한다. Keychain 쓰기/삭제의 취소 의미를 무심코 바꾸면 안 된다. |
| 연결 관리 / P2 | 데모 master toolbar에는 추가/삭제/복제/편집/상하 이동이 공통 패턴으로 있다. 실제 managedSidebar는 편집 행동 없이 new/delete/duplicate/move만 노출한다([database.js:387](../../../../mods/codenav/database.js#L387)). 새 연결은 현재 이름의 임시 row로 보이고 별도 빈 상세 상태가 없다. | 기존 공통 목록의 편집 focus 행동과 새/빈/검색 0개 상태를 맞춘다. 새 profile를 숨기거나 현재 draft를 삭제하는 방식으로 빈 상태를 만들지 않는다. |
| 연결 관리 / P3 | 실제에는 password/database/TLS·저장 비밀번호 삭제·Keychain/session 보관 설명·두 번 누르는 삭제 확인이 있다([database.js:304](../../../../mods/codenav/database.js#L304), [450](../../../../mods/codenav/database.js#L450)). 데모는 짧은 Keychain 안내만 있다([demo:2084](../../../../design/ux-redesign-demo.html#L2084)). | 삭제 대상이 아니다. 실제 필드는 정렬된 한 열로 유지하고 TLS는 compact select로, 비밀번호 설명은 password 주변의 보조 정보로 배치한다. 실제 보관 플랫폼·빈 비밀번호 유지·clear 명시성은 그대로 둔다. |
| SQL source / P1 | 데모는 연결 문맥줄과 ‘실행 범위 선택’ primary→중지→저장을 왼쪽에 배치한다([demo:1568](../../../../design/ux-redesign-demo.html#L1568), [1595](../../../../design/ux-redesign-demo.html#L1595)). 실제는 하나의 toolbar에서 연결 caption이 먼저 flex1을 차지하고 Edit/Save/Discard/Run/Stop이 뒤에 있다([database-editor.js:471](../../../../mods/codenav/database-editor.js#L471)). | 문맥줄과 행동줄을 분리하고 primary 실행 범위 선택 하나를 왼쪽에 둔다. 편집/원문 전환·실저장·되돌리기는 보조 행동으로 남긴다. codebench toolbar는 기존 분기를 보존한다. |
| SQL source / P1 | 실제 source 하단의 `Run Block N`은 범위 picker 없이 즉시 execute한다([database-editor.js:516](../../../../mods/codenav/database-editor.js#L516)). 데모는 모두 실행 범위를 먼저 확인한다([demo:1962](../../../../design/ux-redesign-demo.html#L1962)). | idea의 중복 block 실행행을 범위 선택 경로로 합친다. statement/전체 script/선택/중첩 query 후보를 제거하지 말고 기존 queryCandidates로 접근 가능하게 유지한다. |
| SQL source / P2 | 데모는 바로 편집 가능한 textarea다. 실제는 source viewer 기본, 별도 native 편집 전환이며 native Editor API가 caret/selection을 제공하지 않아 편집 모드에서는 statement 목록을 명시한다([database-editor.js:206](../../../../mods/codenav/database-editor.js#L206)). | 이 runtime 제약을 데모와 동일하다고 주장하면 안 된다. 현재 정확한 원문 선택 viewer·편집 기능을 보존하면서 모드 표시와 실행 안내를 짧게 정리한다. DOM textarea처럼 native caret를 추측하지 않는다. |
| 실행 범위 확인 / P1 | 데모는 문맥·후보 제목·행 범위·preview를 선택한 뒤 footer ‘선택 범위 실행’을 누르는 dialog다([demo:1962](../../../../design/ux-redesign-demo.html#L1962)). 실제 `DatabaseQueryMenu`는 disabled title + 한 줄 후보 popup이고 후보 클릭/Enter 즉시 실행한다([database-editor.js:710](../../../../mods/codenav/database-editor.js#L710)). | 명시적인 후보 선택→실행을 분리하고 line-range/SQL preview를 계층화한다. 기존 MenuController와 실제 후보 원문/DELIMITER를 재사용한다. 실행 command를 두 번 보내지 않도록 확인 행동 하나만 dispatch한다. |
| SQL source 안내 / P2 | 데모는 source 아래에 결과가 하단 새 탭에 표시된다는 안내가 있다([demo:1636](../../../../design/ux-redesign-demo.html#L1636)). 실제 안내는 편집 모드·분리된 연결·transaction에 관한 문장이다([database-editor.js:509](../../../../mods/codenav/database-editor.js#L509)). | 주 안내를 ‘범위 확인→하단 결과’로 맞추고 transaction/모드 제약은 해당 문맥 보조 안내로 둔다. 실제 transaction 경계를 숨기거나 바꾸지 않는다. |
| 하단 SQL 결과 / P1 | 데모 전체 script는 각 statement마다 실행 strip의 독립 결과 탭을 만든다([demo:4494](../../../../design/ux-redesign-demo.html#L4494)). 실제는 한번의 job이 실행 탭 하나를 만들고 그 안에 `Result N` 버튼행이 있다([database-editor.js:243](../../../../mods/codenav/database-editor.js#L243), [675](../../../../mods/codenav/database-editor.js#L675)). | **표현 단위 결정이 필요**. 실제 engine job/연결/transaction/중지 단위를 유지한 채 statement 결과 선택을 승인된 탭 구조로 표현해야 한다. 데모를 따라 db_query를 statement마다 다시 보내는 변경은 금지한다. |
| 하단 SQL 결과 / P2 | 데모는 접힌 SQL details→summary+내보내기→표→행 선택 footer 순서다([demo:1792](../../../../design/ux-redesign-demo.html#L1792)). 실제는 SQL toggle가 표 toolbar 안에 있고 행/선택 요약·복사·CSV 추출기·export가 같은 행에 있다. 별도 행 선택 footer는 없다([database-editor.js:673](../../../../mods/codenav/database-editor.js#L673)). | SQL disclosure를 표 위에, 결과 요약/내보내기를 header action행에, 선택 안내/개수를 표 아래에 배치한다. native copy/extractor 기능은 없어지면 안 되므로 보조 action 또는 기존 context menu를 활용한다. 공통 tool header를 중복하지 않는다. |
| 하단 SQL 결과 / P2 | 실제는 보관 정책 caption·문맥/상태/ms·실행 중 progress·경고/오류를 추가로 제공한다([database-editor.js:657](../../../../mods/codenav/database-editor.js#L657)). 데모 정상 화면은 더 적은 metadata 행을 쓴다([demo:1785](../../../../design/ux-redesign-demo.html#L1785)). | 정상 상태의 metadata 행 수를 줄이고 같은 행에 결합한다. 보관 한도·truncation·조회 복구 불가/untracked 경고는 상태 발생 시 명확하게 남겨 실제 제약을 감추지 않는다. |
| 표 공통 / P1 | demo th는 sticky header, td/th 높이32, #폭38, 나머지 자연스러운 table 폭이다([demo:467](../../../../design/ux-redesign-demo.html#L467)). 실제 grid는 header도 가상 row0으로 세로 scroll하고 모든 열 고정180, #44, row높이 max24다([database-editor.js:415](../../../../mods/codenav/database-editor.js#L415)). | shared grid 하나에서 header 고정·밀도·가로폭 규칙을 맞춘다. table/SQL 결과에 별도 grid를 복제하면 안 된다. 가상화·큰 결과 성능·양방향 scroll·셀 키보드 이동은 보존한다. |
| 표 공통 / P2 | 데모 NULL은 muted italic, edited 셀은 3px inset 표시다([demo:502](../../../../design/ux-redesign-demo.html#L502)). 실제 NULL은 muted만 있고 edited row hover/cell border 색을 사용한다. 문자열은 폭180에서 truncate하며 multiline은 ↵로 치환한다([database-editor.js:424](../../../../mods/codenav/database-editor.js#L424), [432](../../../../mods/codenav/database-editor.js#L432)). | 선택·focus·수정·NULL 상태의 위계를 맞추고 잘린 readonly 값의 확인 경로를 명확히 한다. 전체 값 복사·typed NULL/number/bool·실제 multiline 저장을 화면 표현 때문에 손상시키면 안 된다. |
| 중앙 table 편집 / P1 | 데모는 변경이 있을 때 별도 pending bar에 ‘미반영 수정 N행’+되돌리기+primary 반영을 노출한다([demo:1640](../../../../design/ux-redesign-demo.html#L1640)). 실제는 상시 toolbar의 Apply/Revert icon과 별도 update/delete count caption이다([database-editor.js:493](../../../../mods/codenav/database-editor.js#L493), [527](../../../../mods/codenav/database-editor.js#L527)). | staged 변경이 있을 때 전용 pending action행으로 의미를 선명하게 한다. 기존 Apply/Revert handler·PK/낙관적 충돌·삭제·열린 셀 staging·close protection은 유지하며 같은 행동 버튼을 두 행에 복제하지 않는다. |
| 중앙 table 편집 / P2 | 데모 중앙 결과 heading은 table명+DDL+내보내기이고 footer에 더블클릭/Enter/Esc 안내가 있다([demo:1649](../../../../design/ux-redesign-demo.html#L1649)). 실제는 연결 caption과 icon actions 중심, DDL은 context menu에서 접근하며 footer는 개수/페이지 이동 중심이다([database-editor.js:371](../../../../mods/codenav/database-editor.js#L371), [531](../../../../mods/codenav/database-editor.js#L531)). | table명·DDL·내보내기와 편집 안내를 같은 계층으로 맞춘다. 실제 페이지 로드·선택·추출기·import 기능은 보조행/메뉴로 유지한다. |
| 추출/내보내기 / P1 | 데모는 범위/형식 compact selects→preview→복사/파일 버튼이다([demo:2111](../../../../design/ux-redesign-demo.html#L2111)). 실제는 모든 extractor의 wrap 버튼행→항상 보이는 파일 경로→범위 버튼행→preview다([database-editor.js:754](../../../../mods/codenav/database-editor.js#L754)). | 형식/범위를 compact selector로 정리하고 문맥·preview를 우선 배치한다. 실제 file API에 경로가 필요하므로 파일 저장 경로 입력은 유지하되 복사 흐름보다 먼저 강조하지 않는다. 기존 copy/file 동일 extractor는 재사용한다. |
| 추출/내보내기 / P3 | 실제는 4가지보다 많은 extractor, 전체 table 페이지 export, preview20행,16MiB 한도와 PK 기반SQL 형식 등을 제공한다([database-editor.js:396](../../../../mods/codenav/database-editor.js#L396), [717](../../../../mods/codenav/database-editor.js#L717)). 데모는 selected/loaded와 CSV/JSON/INSERT/TSV만 있다. | 기능 축소 대상이 아니다. 기본 control은 단순하게 유지하면서 모든 실제 형식을 선택할 수 있게 한다. demo의 고정 customers SQL 생성이나 선택 없을 때 임의 sample fallback을 이식하면 안 된다. |
| 가져오기 / P3 | demo에 import 화면은 없다. 실제는 CSV/TSV/JSON, 파일경로, preview 검토 후 한 transaction 적용과 변경파일 재검증이 있다([database-editor.js:383](../../../../mods/codenav/database-editor.js#L383), [733](../../../../mods/codenav/database-editor.js#L733)). | 별도 실기능 화면으로 보존하며 공통 dialog의 문맥/field/compact format/preview/footer 위계만 같은 규칙으로 맞춘다. 전체 import 흐름을 데모와 다르다는 이유로 삭제하지 않는다. |
| DDL / P2 | 데모는 table명·연결문맥·DDL preview·닫기/복사 dialog다([demo:2154](../../../../design/ux-redesign-demo.html#L2154)). 실제는 DDL을 중앙 database document로 열고 일반 SQLViewer와 상단 Copy DDL을 쓴다([database-editor.js:24](../../../../mods/codenav/database-editor.js#L24), [165](../../../../mods/codenav/database-editor.js#L165), [486](../../../../mods/codenav/database-editor.js#L486)). | dialog인지 문서인지 사용 흐름을 먼저 확정한다. 실제 다중 객체 DDL·warnings·source 문서/탭 보존은 필요하다. 단일 table DDL의 접근과 복사 배치만 맞출지 결정하고 임의로 중앙 문서 기능을 없애지 않는다. |

## 이미 맞는 구조 / 유지할 동작

- idea SQL 결과는 이미 공유 하단 `run-results` tool에 있고 원문 console·table 직접 편집은 중앙이다. 결과/source selected Set과 format은 분리되어 있다.
- 실행마다 명령·연결·결과 snapshot, 실행/열람 분리, 실행 중 닫기 금지·keyboard tab 이동과 인접 닫기, 재로딩 복구가 구현되어 있다. 디자인 정렬 때문에 이 상태 모델을 새로 만들 필요가 없다.
- 실제 DB transport·Keychain·global profiles·typed value·원본 기준 추출·cancel/progress·transaction 경계는 prototype로 대체하지 않는다. codebench의 기존 중앙 결과/관리 UI는 별도 supported 분기다.
- shared tool header·semantic color·생성 module import·MenuController는 기존 canonical 시스템을 따른다. 화면마다 새 primitive/lexical owner를 추가할 근거는 없다.

## 구현 전 정리할 계약과 검증

소스 감사에서 확인한 큰 결정은 네 가지다: 연결 목록 전체 draft 대 현재 profile별 Save, 후보 선택 후 명시 실행 대 즉시 popup 실행, whole-script 한 job의 결과를 탭에 표현하는 단위, DDL dialog 대 중앙 문서. 나머지 대부분은 기존 handler를 재사용하는 control/배치/밀도 변경이다. 이 결정 없이 문구나 버튼만 닮게 만들면 동작은 계속 데모와 다르게 남는다.

다음 검증은 구현 재개 이후 수행한다. 현재 감사 단계에서 수행했다고 주장하지 않는다.

1. 다섯 driver·네 TLS 옵션의 native Select/Popup 열기, 방향키/Home/End/Enter/Esc, 선택 후 focus 복귀, busy/닫기/SQLite 조건 표시와 owned handle 해제.
2. profile 새로 만들기/선택 전환/복제/순서/삭제/저장/취소의 draft 경계와 Keychain 유지·삭제·오류/지연 응답.
3. SQL viewer/편집 모드별 정확한 범위 후보와 explicit 확인, 한번의 실제 db_query, script transaction/DELIMITER·nested/selection 보존.
4. 동일 표 renderer에서 pinned header·가로/세로 scroll·값/NULL/수정/focus·PK·편집 staging·키보드·행 선택·큰 결과 가상화.
5. 하단 결과/source 격리·다중 결과·저장된 실행 복구·추출기/파일/clipboard·import 검토·DDL 경고와 codebench 회귀.
6. 부모의 실제 앱 관찰에서 데모와 native를 같은 창 크기·같은 연결·동일 상태로 비교한다. headless/native eager pass를 시각 정합 증거로 대신하지 않는다.

관련 기존 재현 경로는 `check_database_ui.mjs`, `check_database_editor.mjs`, `check_database_model.mjs`, `check_run_sessions.mjs`, `herdr-app check mods/codenav`다. 공통 생성물 sync/install과 실제 앱 조작은 부모가 일괄 수행한다.
