# T51 ADE 데이터베이스 탐색·전역 연결 관리

승인 데모의 데이터베이스 tree와 전역 연결 관리 목록/상단 액션/오른쪽 상세 구조에서 `mods/ade/database.js`를 새로 구현했다. 기존 DB 화면 controller는 가져오거나 복사하지 않았다. 데이터/자격증명 저장은 별도 databaseService 엔진 경계가 소유한다.

DatabaseTree는 실제 전역 연결을 읽고 사용자가 펼칠 때만 catalog를 요청한다. connection→database/schema→테이블·뷰 그룹을 표시하고 그룹 개수와 28px 행을 제공한다. 선택·이동·Enter·좌우 펼치기는 MenuController와 native virtual list를 사용한다. 로딩/빈 개체/실패·재시도와 refresh generation 차단을 제공한다. 연결 설정 변경 revision을 관찰하여 다음 task에서 다시 읽는다. 테이블/뷰는 중앙 database document를 열고, SQL 콘솔은 선택한 연결/database/schema scope를 전달한다. view에는 table_type:view를 전달한다. 공유 문서 상태는 database-model의 openDatabaseDocument를 사용하며 별도 문서 store를 만들지 않았다.

DatabaseManager는 MySQL/MariaDB/PostgreSQL/SQL Server/SQLite와 compact driver/TLS selector를 제공한다. 공통 관리 목록의 추가·제거·복사·위/아래 순서와 오른쪽 retained input 상세는 Apply 전 draft다. 연결 테스트는 선택한 미저장 draft를 검사하며 저장하지 않는다. Apply는 변경한 연결과 삭제 예정 연결만 엔진에 전달하고 global order metadata를 기록한다. 여러 profile 저장은 하나의 DB transaction이 아니므로 부분 실패 시 성공한 항목은 유지하며 나머지 draft와 실제 오류를 표시한다. 취소/닫기는 미적용 draft를 버린다.

암호는 masked native input과 local Map에만 보관한다. 빈 입력은 저장된 credential을 유지하며, 별도 “저장된 비밀번호 지우기” 명시 액션만 password:""를 보낸다. 복사는 저장 credential의 존재를 복사하지 않는다. Apply 이후 input을 비우고 release에서 local credential state를 해제한다. shared에는 프로필 순서 id와 변경 revision만 기록한다. has_password/password_storage의 실제 engine 응답으로 Keychain/session/없음을 표시하며 UI가 임의로 보관 성공을 만들지 않는다.

frame-layout에 여섯 번째 REGIONS.database를 추가했다. 위치는 여전히 left-top/left-bottom/right-top/right-bottom/bottom의 다섯 slot이다. 기본 database는 right-top에 숨겨져 있어 기존 agents/terminal 크기나 프로세스를 바꾸지 않는다. validator는 구형 ADE shell의 database 부재를 허용하고 ensureDatabaseRegion은 node만 추가하는 멱등 migration이다. regionSettings는 metadata와 REGIONS.section을 사용하므로 같은 side의 두 번째 top 도구가 bottom으로 바뀌지 않는다. toggleRegion(tree,key,metadata)는 선택 도구를 열 때 같은 정확한 slot의 다른 도구를 숨긴다. 다른 slot과 중앙 editor, native pane tree, manual sizes, unknown nodes/data는 보존한다. arrangeRegions도 slot당 한 도구를 표시한다.

검증:

- `node --experimental-vm-modules design/ade/check_database_ui.mjs` 통과: lazy catalog/group/view scope, 오류/재시도와 stale refresh, draft CRUD/order, 테스트와 저장 구분, 암호 유지/명시 삭제/복사 방지, shared credential 비저장, async 새 연결 진입.
- `node design/ade/check_frame_layout.mjs` 통과: 여섯 도구/다섯 slot, hidden DB, legacy migration, same-slot 교체, native pane/manual sizes/unknown 보존.
- `node --experimental-vm-modules design/ade/check_settings.mjs`, `node --experimental-vm-modules design/ade/check_terminal.mjs` 회귀 통과.
- 실제 engine을 호출하지 않는 임시 복사 native fixture 다섯 개 통과: 펼친 tree, SQLite 상세, PostgreSQL 상세, driver selector, TLS selector.
- `herdr-app check mods/ade`, `node design/ade/build_layout.mjs --check` 통과. layouts/ade.json은 builder로 재생성했다.

이 작업자는 설치·CUA·실제 profile 저장/삭제/테스트를 수행하지 않았다. root의 main header/action 연결과 실제 UI 관찰·engine 연동 검증은 별도 기록한다.
