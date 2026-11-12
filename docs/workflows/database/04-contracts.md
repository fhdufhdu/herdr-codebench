# Database engine / UI contract

기존 localhost token-auth POST 엔진/envelope 및 lsp.js transport를 재사용한다. 모든 DB 요청은 `{database:{...}}`, 응답은 기존 `{ok,result}`다. DB 작업은 LSP 서버를 시작하지 않는다. 런타임/CLI 별도 DB 설치 없이 Go database/sql 드라이버를 사용한다.

## Profiles and catalog

- Source `{id,name,driver,host,port,user,password?,database,path,tls?}`. driver: `mysql|mariadb|postgres|sqlserver|sqlite`. macOS의 비밀번호는 서비스 `dev.herdr.codebench.database`와 source ID로 키체인에 저장한다. 응답/메타데이터/로그에는 비밀번호를 반환하지 않는다. 다른 OS는 세션에만 보관한다. 메타데이터는 엔진 cache의 global database-sources.json(0600 원자적 저장); profile은 모든 space에서 공유된다. 매번 연결 테스트 성공을 저장 조건으로 강요하지 않는다.
- `db_sources {}` → `{sources:[Source public metadata with has_password,password_storage:'keychain'|'session'|'none']}`. 저장 상태만 반환하며 키체인 읽기는 실제 연결 때 해당 프로필에 한정한다.
- `db_save {source}` → public Source (새 id 자동 생성). 비밀번호 생략이면 기존 값 유지, 명시적 빈 문자열이면 삭제. macOS의 기존 RAM 비밀번호는 명시적 저장 때 키체인으로 승격. 클라이언트가 전달한 has_password/password_storage는 신뢰하지 않는다. profile 수정 시 기존 pool 닫기. 키체인 실패는 명시적 오류이며 평문으로 대체하지 않는다.
- `db_delete {source_id}` → `{deleted:true}`. 해당 프로필의 키체인 항목도 제거한다. 메타데이터 저장 실패 시 자격증명 변경을 보상하며, 보상 실패도 명시한다.
- `db_test {source?,source_id?}` → `{connected:true,driver}` (저장 전 draft 테스트 지원)
- `db_catalog {source_id,database?,schema?,table?}` → `{nodes:[{kind:'database'|'schema'|'table'|'view'|'column',name,database?,schema?,table?,data_type?,primary_key?}]}`. 미지정이면 상위부터 lazy load. 반환 node identity는 source_id/kind/database/schema/table/name 조합.
- `db_rows {source_id,database?,schema?,table,limit?,offset?}` → ResultSet + `{primary_keys:[string],offset,limit}`. limit default200/max1000, 서버에서 페이지. SQL identifier는 driver별 quote, 사용자 식별자를 SQL로 그대로 붙이지 않는다.
- `db_ddl {source_id,objects:[{kind,name,database?,schema?,table?}]}` → `{sql,warnings:[]}`. 혼합 계층/복수 선택, 부모가 포함된 자손 중복제거. database는 CREATE DATABASE부터, schema는 CREATE SCHEMA부터 자손 table/view/index 정의. 정보가 부족한 engine 개체를 조용히 완전 DDL이라고 가장하지 않고 warnings로 명시.

## Queries / editing

- `db_query {source_id,database?,schema?,statements:[string],limit?}` → `{job_id}` 즉시 반환. SQL 배열 순서대로 실행, 중간 오류에서 정지. UI에서 명시 선택한 원문만 전달한다. Job은 request context 종료 뒤에도 독립 lifetime, timeout과 cancel 적용.
- `db_job {job_id}` → `{id,state:'queued'|'running'|'completed'|'error'|'cancelled',current,total,elapsed_ms,results:[ResultSet],error?}`
- `db_cancel {job_id}` → job snapshot. 완료된 job은 제한 수/시간 후 회수, 무한 증가 금지.
- ResultSet `{columns:[{name,data_type?}],rows:[[value]],affected_rows?,truncated?,statement?,elapsed_ms?}`. 숫자는 정밀도 손실을 피하도록 드라이버별 안전한 직렬화. NULL은 JSON null, binary는 명시 형식. 가짜 서버 진행률을 만들지 않는다.
- `db_apply {source_id,database?,schema?,table,changes:[{op:'update'|'insert'|'delete',original?:{column:value},values?:{column:value}}]}` → `{affected_rows}`. explicit transaction/rollback, PK로 original row를 식별하고 원래 수정/삭제 값도 비교해 충돌 감지. 각 update/delete 영향행이1이 아니면 전체 rollback. PK 없는 테이블 update/delete는 거부, 조회·export·insert/import는 허용. insert는 generated column 생략 가능. 모든 값은 bound parameter.

## UI ownership and files

- D03 agent owns only `mods/codenav/database.js`, `design/idea/check_database_ui.mjs`, own result doc. Exports Database (tool body), DatabaseManager (modal). Receives `nextCommand` for `database-manage|database-add|database-refresh` and uses lsp(method,{database},cx sleep). Tree doubleclick/menus: `run('codenav.database-open:'+JSON.stringify({source_id,kind:'table'|'ddl'|'console',database,schema,table,objects?}))`. profile ID is never inferred from current space. Manager opens as codenav view `database-manager`.
- Parent owns integration files/tool/action registries, editor tabs, DB console/grid, `database-model.js` pure SQL lexer + common extractor, docs/validation/install.
- D02 agent owns engine Go files/go.mod/go.sum and own result/tests. Add `Database json.RawMessage` to Request, Engine db manager lifecycle and route handler delegation. Do not build dist or edit UI/parent docs.
- D01 investigation agent owns only `docs/workflows/database/01-artifact-research.md` and `evidence/` evidence. Use REA on explicit DatabaseTools JAR then focused static class/resource observation. No target runtime actions or actual DB credentials/configs.

## Validation

Go race/vet, fresh temp SQLite connect/catalog/query/poll/cancel/edit rollback/DDL/import lifecycle. JS lexer strings/comments/delimiters/nested query candidates/selected SQL + extractor CSV quoting/NULL/JSON/big numbers/shared copy/export. Mock only host imports in JS. Run actual localhost engine through Postman with test auth and independent fixture, native checks and actual UI screenshot. Do not claim unrun remote DB compatibility or native pointer behavior.
