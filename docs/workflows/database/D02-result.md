# D02 Go database service

상태: 구현, native driver 포함 race/vet 및 상위 release/API 통합 검증 완료.

담당: 위임된 Codex 구현 에이전트. 모델/effort는 부모 세션 설정 상속이며 이 태스크에서 변경하지 않았다. 파일 경계는 engine Go/module 파일과 이 결과 문서다.

## 구현

- Request.Database raw JSON, 인증된 기존 HTTP envelope의 11개 db_* endpoint 및 Engine 종료 lifecycle. DB 요청은 LSP 서버를 시작하지 않는다.
- 모든 space에서 사용하는 engine cache의 database-sources.json. 원자적 0600 저장, 비밀번호는 별도 세션 메모리만 사용하고 public 응답/파일에서 제외한다. 변경/삭제 시 pool을 닫는다.
- database/sql driver 연결: MySQL/MariaDB go-sql-driver/mysql v1.9.3, PostgreSQL pgx/v5 v5.7.6, SQL Server go-mssqldb v1.9.3, SQLite ncruces/go-sqlite3 v0.36.0. SQLite driver는 Wasm SQLite를 wasm2go로 번역한 CGO 없는 Go 구현이며 외부 CLI/별도 runtime 파일이 필요 없다. 해당 버전의 공식 go.mod에 따라 최소 Go는 1.26.0이다(설치된 Go는 1.27.1).
- TLS 기본값은 인증서 검증. disable/require/verify-full 명시 옵션 지원. PostgreSQL 연결 문자열은 pgpass/service/client key 설정 상속을 차단한다. 제품 연결은 profile에 명시한 사용자명을 요구한다. SQLite는 절대 파일 경로를 요구하며 URI와 메모리 DB는 받지 않는다.
- lazy database/schema/table/view/column catalog, PK 표시, server-side page(default 200/max 1000). identifier는 dialect별 quote, 값은 parameter binding.
- query는 HTTP request와 별도 lifetime. 최대 32개 실행/대기, 동시 4개, 120초 timeout, 최대 256 statement, 결과당/전체 job 16 MiB 제한. 실제 statement 위치와 경과 시간만 보고한다. cancel 및 Engine 종료 시 취소한다. 완료 snapshot은 최대64개, 새 작업 시작 시 15분 지난 항목을 제거한다. console connection은 종료 때 폐기하여 session 설정/미완료 transaction을 다른 요청에 넘기지 않는다.
- int64의 JavaScript 안전 범위 초과값 및 DECIMAL/NUMERIC text는 문자열. NULL은 null. binary는 `{type:'binary',base64:'...'}`로 전달하며 row apply에서도 받는다.
- apply는 명시적 transaction에서 PK+original values 조건으로 update/delete를 수행한다. update/delete가 정확히1행이 아니거나 중간 오류가 나면 전체 rollback. PK 없는 테이블도 insert/import는 허용하고 update/delete는 거절한다. 삭제는 원래의 모든 비생성 column 값을 요구하며 변경은 PK와 변경한 column의 original 값을 요구한다.
- mixed hierarchy DDL은 부모 우선 재귀 추출과 중복 제거. SQLite는 sqlite_schema의 table/view/index/trigger SQL, MySQL/MariaDB는 database/table/view SHOW CREATE(데이터베이스 문자셋/정렬 포함), PostgreSQL은 catalog column/constraint/index/view 정의를 사용한다.
- SQL Server는 sys catalog에서 일반 column의 length(max/Unicode bytes÷2), decimal precision/scale, time precision, float precision, identity(seed/increment/replication), nullable/default name/collation/computed persisted/rowguid/sparse/column set을 추출한다. PK/unique/check/FK와 composite column 순서/참조 action 및 rowstore clustered/nonclustered index의 key direction/include/filter/일반 옵션을 보존한다. FK/check 추가는 전체 table 정의 뒤로 미뤄 ordinary forward reference를 처리한다. metadata가 필요한데 비어 있으면 오류로 반환하며 알 수 없는 타입을 임의로 일반 타입으로 바꾸지 않는다.
- 상위 리뷰에서 발견한 `a.id`/`b.id` column 선택 충돌은 column을 owner table로 먼저 정규화한 뒤 중복제거하도록 수정했다. 두 table과 중복 table 선택을 섞는 실제 SQLite 회귀 검증도 통과했다.

## 검증

최종 검증은 공개 모듈 캐시 `/private/tmp/herdr-db-gomod`와 engine/.cache/build를 사용하고 `GOPROXY=off`로 실행했다. 부모 세션이 초기 DNS 차단 해소 후 공개 의존성을 받아 go.sum을 실제 생성했으며, 최종 offline tidy는 이 구현 에이전트가 수행했다.

- 실제 네이티브 driver 전체 `go test -race -count=1 -timeout=60s ./...`: PASS, 5.577s. 기존 모든 Go 테스트 및 신규 실제 SQLite 테스트 포함, SKIP 없음.
- 취소 회귀 `go test -race -count=10 -timeout=60s -run 'TestDatabaseSQLiteCancel' -v ./...`: PASS, 2.266s. 첫 VM 시작과 겹치는 취소200회 및 첫 행 이후 CPU 계산 중 취소10회.
- 전체 `go vet ./...`: PASS.
- `git diff --check`: PASS.
- 모든 driver가 포함된 호스트 테스트 binary의 컴파일·실행까지 확인했다. CGO=0 release 대상별 build/dist 생성 및 실제 앱 설치는 부모 통합 태스크가 담당하며 여기서 수행했다고 주장하지 않는다.

최종 명령:

```sh
cd engine
GOMODCACHE=/private/tmp/herdr-db-gomod GOCACHE=$PWD/.cache/build GOPROXY=off go test -race -count=1 -timeout=60s ./...
GOMODCACHE=/private/tmp/herdr-db-gomod GOCACHE=$PWD/.cache/build GOPROXY=off go test -race -count=10 -timeout=60s -run 'TestDatabaseSQLiteCancel' -v ./...
GOMODCACHE=/private/tmp/herdr-db-gomod GOCACHE=$PWD/.cache/build GOPROXY=off go vet ./...
```

임시 파일 SQLite lifecycle 테스트는 connect/catalog/page/query/precision/NULL/stop-on-error/cancel/generated-column omission/optimistic conflict rollback/PK 없는 insert 허용과 update 거절/recursive mixed DDL 중복제거를 포함한다. SQL Server의 실제 서버 접속은 수행하지 않으며 catalog row 모델을 사용하는 semantic fixture로 일반 타입/PK/unique/check/FK/index 생성 및 누락 metadata 오류를 검증한다.

SQLite driver 선택은 실제 취소 회귀에 근거한다. modernc v1.39.1은 첫 VM 시작 전 interrupt를 잃었고, v1.61.1은 그 문제를 고쳤지만 후속 행의 CPU 계산 중 취소 회귀에 실패했다. 각 행에 query context를 적용하는 [ncruces v0.36.0 driver](https://raw.githubusercontent.com/ncruces/go-sqlite3/v0.36.0/driver/driver.go)로 교체한 뒤 두 회귀가 반복 통과했다. [공식 README](https://github.com/ncruces/go-sqlite3/tree/v0.36.0)에서 CGO 없는 wasm2go 구현과 단일 driver import를 확인했다. 내부 driver alias는 sqlite로 유지해 UI/profile 계약을 보존했다. modernc 의존성은 최종 graph에서 제거했다.

SQL Server 매핑은 공식 문서를 확인했다: [columns](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-columns-transact-sql?view=sql-server-ver17), [identity](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-identity-columns-transact-sql?view=sql-server-ver17), [computed](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-computed-columns-transact-sql?view=sql-server-ver17), [key constraints](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-key-constraints-transact-sql?view=sql-server-ver17), [indexes](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-indexes-transact-sql?view=sql-server-ver17), [index columns](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-index-columns-transact-sql?view=sql-server-ver17), [foreign keys](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-foreign-keys-transact-sql?view=sql-server-ver17), [constraint syntax](https://learn.microsoft.com/en-us/sql/t-sql/statements/alter-table-table-constraint-transact-sql?view=sql-server-ver17). MySQL [SHOW CREATE DATABASE](https://dev.mysql.com/doc/refman/8.4/en/show-create-database.html) 문서도 확인했다.

## 현재 한계 및 상위 통합 영향

- SQL Server는 session-local schema 변경 기능이 없으므로 console schema 선택은 login의 default schema를 바꾸지 않는다. SQL 원문에서 schema를 지정해야 한다.
- PostgreSQL DDL은 sequence/partition/inheritance/trigger/policy/owner/grant/referenced type 정의를 제외한다. SQL Server DDL은 trigger/permission/table storage/partition/compression/temporal/ledger/encryption/masking/user type/sequence와 특수 index 유형 및 고급 옵션을 제외한다. 이러한 생략은 응답 warnings에 명시한다. 완전한 database clone 기능을 제공한다고 주장하지 않는다.
- PostgreSQL/MySQL 계열 exotic 비교 불가 타입, SQL Server XML/text 등 SQL equality를 지원하지 않는 column은 optimistic apply 중 DB 오류를 반환하고 rollback한다. 타입별 별도 compare/cast는 구현하지 않았다.
- rowset 경로는 여러 result set도 순서대로 반환하며 statement당 최대256개로 제한한다. WITH mutation without RETURNING 같은 rowset 경로의 명령은 affected_rows가 없을 수 있다. 일반 DML은 ExecContext의 affected_rows를 반환한다. SET/DECLARE 등으로 시작하는 복잡한 vendor batch는 개별 statement로 분리해야 결과를 확실히 받을 수 있다.
- 라이브 localhost engine/Postman 및 실제 앱 UI 검증은 부모 통합 태스크가 담당한다. 원격 MySQL/MariaDB/PostgreSQL/SQL Server 호환성을 실제 서버로 검증했다고 주장하지 않는다.

## 상위 검토

상위 통합 검토 완료: 최종 소스 digest의6개 release를 빌드·검증하고, 실제 Postman/SQLite API와 설치된 앱의 데이터 탭·쿼리 결과까지 확인했다. 원격4개 DB의 실제 서버 검증은 남아 있다. 자세한 검증 경계는 [통합 검증](05-verification.md)에 기록한다.
