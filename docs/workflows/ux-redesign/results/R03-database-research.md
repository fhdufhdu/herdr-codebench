# R03 데이터베이스 UX 조사

2026-11-05. 조사·개선안 작성 완료, 구현과 실제 UI 검증은 후속 단계다. 현재 체크아웃의 `mods/codenav/database*.js`, `engine/database*.go`, 기존 DB 요구사항과 UX 관찰 기록을 읽었다. 외부 제품은 공식 문서를 비교했으며 직접 실행해 확인한 동작으로 기록하지 않는다. 사용자 DB에 접속하지 않았다. 위임 설정은 부모가 지정한 기본 `medium`을 따르며 모델 변경은 요청하지 않았다.

## 판단 기준

기존 12개 요구사항을 기준으로 연결 대상, 실행 원문, 변경의 저장 단계, 결과의 출처를 사용자가 행동 직전에 알아볼 수 있게 한다. 작업 중에는 실제 상태를 보여주고 실패 뒤에는 원문과 staged 변경을 복구할 수 있어야 한다. 제품의 외형과 메뉴 수를 목표로 삼지 않는다. 아래 제안은 공식 기능 설명과 코드 차이를 바탕으로 도출한 설계 판단이다.

## 공식 자료 6개와 비교

각 자료의 확인 범위를 제한했다. 표의 ‘미확인’은 해당 기능이 제품에 없다는 뜻으로 해석하지 않는다.

| 제품·공식 자료 | 문서로 확인한 행동 | 적용할 UX 원칙 |
| --- | --- | --- |
| DBeaver SQL Execution | 커서 구문·선택 실행과 전체 스크립트 실행이 구별되고 여러 실행 결과를 결과 탭으로 다룬다 | 실행 범위의 일관된 구분과 결과 출처 인지. [공식 문서](https://dbeaver.com/docs/dbeaver/SQL-Execution/) |
| DBeaver SQL Generation | 여러 객체 선택 후 DDL 미리보기·파일 저장, 그리드에서 SQL 생성·복사 경로 제공 | 여러 객체의 범위를 실행 전에 검토. [공식 문서](https://dbeaver.com/docs/dbeaver/SQL-Generation/) |
| TablePlus Toolbar | GUI 변경을 discard·preview·commit으로 나누고, 연결·DB·환경 태그 및 연결 상세를 표시한다. import/export 진행과 완료·실패를 알린다 | 변경 단계의 명료성, 대상 인지, 상태 피드백. [공식 문서](https://tableplus.com/docs/gui-tools/the-interface/toolbar) |
| TablePlus Import & Export | CSV 입력의 미리보기·열 매핑과 대상 테이블 선택, 테이블·뷰·쿼리 결과 내보내기를 제공한다 | 쓰기 대상과 해석 결과의 사전 확인. [공식 문서](https://tableplus.com/docs/gui-tools/import-and-export) |
| Beekeeper Studio SQL Editor | 전체·현재 구문·선택 실행을 구분하고 현재 구문을 강조한다. 결과 집합을 선택할 수 있으며 명시적 transaction 동안 탭 전용 연결을 보유한다 | 실행 범위의 가시성, 결과 인지, transaction 수명 일관성. [공식 문서](https://docs.beekeeperstudio.io/user_guide/sql_editor/editor/) |
| pgAdmin Query Tool Toolbar | script·query 실행, Stop, commit·rollback, 변경 행 수, 결과 행 수·경과 시간·선택 행 수를 구분한다. 삭제는 staged 뒤 저장된다 | 취소·상태 피드백, staged 변경의 인지. [공식 문서](https://www.pgadmin.org/docs/pgadmin4/latest/query_tool_toolbar.html) |

| 비교 축 | DBeaver | TablePlus | Beekeeper Studio | pgAdmin | 현재 Herdr |
| --- | --- | --- | --- | --- | --- |
| 연결·문맥 | 실행 문서에서 연결 상세는 미확인 | 연결/DB와 상세 정보, 환경 태그 | query 탭의 연결 수명 설명 | 상태·transaction 명령 | source/DB/schema 툴바, 연결 관리자·테스트·비밀번호 저장 상태 |
| 실행 범위 | 선택/현재 구문/스크립트 | 이 조사 자료에서 미확인 | 전체/현재/선택, 현재 범위 강조 | script/query 분리 | viewer 정확한 선택·현재 구문·중첩 SELECT·전체 후보, 편집 모드는 구문 목록 |
| 결과·작업 | 여러 결과 탭 | 상태와 transfer 알림 | 여러 결과 선택과 결과 제한 | Stop, 행 수·시간 | job 상태·취소·결과 버튼, 결과 제한 안내 |
| 편집·쓰기 | 선택 자료에서 staging 상세 미확인 | pending·preview·commit·discard | transaction 연결 유지 | staged 삭제·save·commit/rollback | PK 기반 staging·Apply/Revert, 한 번의 Apply transaction |
| DDL 복수 선택 | 객체 복수 선택·검토·저장 | 선택 자료에서 미확인 | 선택 자료에서 미확인 | 선택 자료에서 미확인 | source별 혼합 계층 선택·재귀·중복 제거·경고 |
| 가져오기·추출 | 생성 SQL 미리보기·복사 | 매핑 미리보기·다양한 출력 대상 | 결과 다운로드, 대형 결과 제한 | 결과 CSV/JSON/XML 저장 | 공통 extractor 9종, CSV/TSV/JSON import, clipboard/file |

공통적으로 도출할 패턴은 행동 전 범위 확인, 진행과 완료의 구별, pending 변경과 서버 반영의 구별이다. DDL 계층 재귀와 extractor 재사용은 Herdr의 현재 요구사항과 구현을 보존한다. 다른 제품 내부에서도 같은 추출기 구현을 사용한다는 주장은 이번 공식 자료로 확인하지 않았다.

## 기존 12개 요구사항과 실제 구현

| 번호·요구 | 구현 근거 | 구체적 부족점·유지할 경계 |
| --- | --- | --- |
| 1 연결 | `database.js`의 `DatabaseManager`, `engine/database_drivers.go` | Test와 Save 분리 및 실제 오류 표시 유지. 현재 Save는 테스트를 필수로 요구하지 않고 성공 문구에도 optional이라고 표시하므로 기존 요구서의 ‘저장 전 테스트’와 수용 기준 정리가 필요하다 |
| 2 전역 관리 | `database.js`의 passwordDescription/perform, `engine/database_password.go` | 전역 프로필과 키체인/세션 상태 안내는 구현됨. 작업 툴바에는 source 이름·DB·schema만 있어 host/user/driver를 바로 확인하기 어렵다 |
| 3 테이블 보기·수정 | `database-editor.js`의 gridView/editCell/setCell/deleteRows/apply, `engine/database_apply.go` | 셀 수정·NULL·삭제 staging과 원자적 Apply 존재. 변경 행 수·삭제 표시·읽기 전용 이유를 눈에 보이는 텍스트로 보완할 여지가 있다 |
| 4 진행·취소 | `database-editor.js` 179–208, `engine/database.go` runJob/job | 실제 상태·시간·현재/총 블록·취소 존재. UI의 `doc.result`는 polling 종료 후 교체되어 완료된 앞선 결과를 실행 중 바로 고르기 어렵고 이전 결과 출처가 혼동될 수 있다 |
| 5 블록 실행 | `database-model.js` splitSQL, `database-editor.js` 418–420 | dialect 분리와 블록 버튼 존재. 번호만 있는 버튼과 결과 번호 사이에 원문 범위 연결이 약하다 |
| 6 선택 실행 | `database-editor.js` 163–175, `database-model.js` queryCandidates | viewer의 정확한 범위 유지. native 편집기는 현재 selection getter가 없어 동일한 드래그 실행을 제공한다고 표시할 수 없다 |
| 7 ⌘Enter 후보 | 같은 chooseQuery/queryCandidates | 편집 모드가 후보를 statement 목록으로 덮어써 전체 script 후보도 사라진다. 팝업은 원문 150자만 표시하고 줄 범위·연결 문맥은 표시하지 않는다 |
| 8 데이터 탭·안전 | `database-editor.js` documents/apply, `engine/database_apply.go` | PK와 original 값 비교 및 충돌 시 rollback 존재. DB dirty는 로컬 `textDirty`/`changes`에만 있고 `tabs.js` closeTabs의 일반 편집기 dirty 경로와 연결된 코드는 찾지 못했다. 닫기·재시작 시 보존은 후속 실제 검증 필요 |
| 9 테이블 DDL | `engine/database_ddl.go`, `database-editor.js` 131–133,395 | 원본/카탈로그 DDL과 경고, 문서·복사 존재. 경고와 적용 대상 확인의 위계 보완 가능 |
| 10 혼합 계층 DDL | `database.js` menuRows, `engine/database_ddl.go` 14–115 | source별 묶음, 부모 우선 재귀와 중복 제거 존재. DDL 탭 제목이 Selection에 머물 수 있어 선택 객체와 확장 범위를 알아보기 어렵다 |
| 11 행 추출 | `database-model.js` EXTRACTORS/extractData, `database-editor.js` dataset/copy | CSV/TSV/JSON/SQL INSERT/UPDATE/WHERE/Markdown/HTML/XML 공통화 구현됨. dataset은 서버 원본 rows를 사용하므로 staging 중 복사·내보내기의 의미를 명시해야 한다 |
| 12 가져오기·내보내기 | `database-editor.js` transfer/DatabaseTransfer, `database-model.js` parseImport | 20행 preview, 파일 재검증, transaction import 존재. header를 열 이름으로 사용하는 방식이며 target schema와의 명시적 mapping 검토는 없다. 전체 테이블 export를 선택해도 preview는 로드된 데이터이고 종료 성공 정보는 없다 |

## 우선순위와 개선 제안

### P0 변경 보존과 transaction 의미

- Apply 중 Delete/Revert가 여전히 활성화된다. `editCell`은 applying을 막지만 `deleteRows`, `setCell`, Revert 핸들러는 동일하게 막지 않는다. apply가 시작할 때 기존 셀 편집기도 닫지 않아 `setCell`이 전달 객체를 수정할 여지도 있다. 작업 시작 시 편집을 확정하고 적용 snapshot을 고정한 뒤 해당 문서의 mutation 진입점을 일관되게 막는다. 실패하면 같은 staging을 유지하고 성공 시 반영된 snapshot만 정리한다. 자동 회귀 확인은 느린 Apply 중 Delete/Revert/셀 확정 시도로 수행한다.
- DB SQL 초안·staging·실행 중 job을 탭 닫기 정책에 연결한다. 일반 편집기 dirty 계약을 확정한 뒤 재사용하며 SQL 초안 저장과 DB Apply를 서로 다른 이름으로 표시한다. 탭 닫기·다른 문서 이동·레이아웃 전환·실패 후 재시도에서 유지 여부를 검증한다.
- `engine/database.go` runJob은 한 job 동안 하나의 연결을 사용하고 종료 시 물리 연결을 폐기한다. 별도 Run 간 BEGIN/COMMIT은 이어지지 않는다. 콘솔에 이 수명을 설명하고 자동 commit 여부를 오인시키는 transaction 버튼은 구현과 함께 설계한다. cancellation·중간 statement 실패가 앞서 commit된 DML을 되돌린다고 안내하지 않는다. 테이블 Apply는 별도의 단일 transaction이며 `engine/database_apply.go`의 rollback·충돌 검사를 유지한다.

### P1 현재 기능의 인지와 피드백

- 기존 source/DB/schema 표시를 유지하고 연결 상세를 여는 경로에서 driver·host 또는 SQLite 경로·user를 확인하게 한다. 새 환경 태그 체계를 먼저 추가할 필요는 없다. SQL 후보·import 확인에도 같은 작업 대상을 표시한다.
- Run 메뉴는 선택·현재 구문·중첩 SELECT·전체 script라는 의미와 줄 범위를 표시한다. native 편집 모드는 ‘구문 선택 실행’으로 기능을 설명하고 전체 script 후보를 추가한다. 실제 selection/caret API가 도입될 때에만 편집 모드와 viewer의 범위를 통합한다.
- result 번호 옆에 원문 구문 번호·행 수·실행 상태를 연결한다. 한 statement가 여러 resultset을 반환할 수 있어 구문 번호와 resultset 번호를 분리해 취급한다. job 교체 시 이전 결과는 이전 실행임을 표시하고 polling 중 완료 결과를 고를 수 있게 한다. queued/running/cancel 요청/최종 cancelled를 구별하며 실제 퍼센트를 만들지 않는다.
- 표 하단에 수정·삭제 pending 수, PK 없는 테이블의 update/delete 불가 이유를 표시한다. staged 셀·삭제 행은 의미별 상태와 텍스트로 구별하고 색만으로 전달하지 않는다. generated 열의 편집 제한은 기존 컬럼 metadata를 재사용할 수 있는지 확인한 뒤 처리한다.

### P2 DDL과 데이터 이동의 검토 정확성

- DDL 실행 진입점에서 source별 선택 수와 부모 포함 범위를 보여주고 결과 제목에 source/선택 요약을 쓴다. 고급 속성 제외·재접속 경고를 SQL과 함께 확인하게 한다. 재귀·중복 제거 로직과 vendor별 DDL 생성은 재사용한다.
- export 범위를 선택 행/로드된 행/전체 테이블로 분명하게 표시한다. preview가 20행 sample임을 항상 드러내고 선택한 범위와 sample이 다르면 그 사실을 표시한다. staging 중 출력은 저장된 원본 값이라는 의미를 명시한다. 공통 extractor를 복사·preview·파일 출력 모두에 유지한다.
- import는 source header와 target column을 나란히 검토하고 누락·알 수 없는 열·generated 열을 실행 전에 알려준다. CSV delimiter/encoding 확장, 새 테이블 생성은 현재 요구에 추가하지 않는다. 형식·파일 변경 시 재검토 및 1,000행 단일 transaction 경계를 유지한다.
- transfer 실행 중에는 행 처리 수처럼 실제로 수집 가능한 정보와 작업 상태를 보이고 완료 시 경로·행 수 또는 clipboard 완료를 표시한다. import 성공 후 refresh가 실패했을 때 쓰기 성공과 재조회 실패를 구별한다. whole-table export의 동시 수정 일관성은 현재 페이지 조회만으로 보장되지 않으므로 snapshot 보장이 필요한 작업은 별도 엔진 설계로 분리한다.

## 구현 경계와 검증

현재 UI 개선은 P0·P1의 상태 일관성, 문구·범위·피드백, 기존 component 적용을 우선 대상으로 제안한다. manual transaction을 여러 Run에 걸쳐 유지하는 기능, 정확한 DML SQL preview, 일관된 export snapshot은 엔진 수명과 동시성 설계가 필요한 후속 기능으로 설명한다. 이번 조사에서 새 API 계약을 설계하지 않았다.

구현 시 `design/idea/tokens.json`과 `design/idea/ui.js`의 공통 상태·메뉴·버튼·dialog를 확장하고 generated 파일은 sync로 갱신한다. 새 DB 전용 디자인 체계와 중복 extractor는 만들지 않는다. `codebench`의 패널·탭·터미널과 기존 macOS 키맵 경계를 보존한다.

후속 수용 확인은 정확한 선택/여러 구문/DELIMITER/GO 실행, 여러 resultset과 중간 실패·취소, PK 없음·복합 PK·동시 수정 충돌·Apply 중 입력, 닫기와 복원, 부모·자손 혼합 DDL, NULL/빈 문자열/multiline/큰 정수/binary 추출, import 오류 rollback·파일 변경, 전체 export 제한을 포함한다. 문서 조사만 수행했으므로 실행 검사·`herdr-app check`·실제 UI 검증 완료로 간주하지 않는다. 기존 `docs/workflows/database/ux/findings.md`의 IDEA 관찰은 종전 기록으로만 참조했다.
