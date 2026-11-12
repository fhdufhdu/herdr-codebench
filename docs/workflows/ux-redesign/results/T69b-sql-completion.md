# T69b · 문맥 기반 SQL 자동완성

상태: 순수 completion 엔진·재현 가능한 parser vendor·검증 완료. UI와 DB 조회 계층은 상위 T69 통합에서 담당한다.

## 변경

- `mods/ade/sql-completion.js`: `completeSQL(text, offset, {tables, driver})`와 `referencedTables(text, offset, driver)` 제공. 범위는 JS UTF16이며 전체 identifier suffix/quote까지 교체한다. 결과에 `references`, `context`, `incomplete`, 제한 초과 시 `reason`을 포함한다.
- 기존 [CodeMirror SQL dialect/parser](https://github.com/codemirror/lang-sql/blob/main/src/sql.ts)의 실제 Lezer tree를 사용한다. [grammar](https://github.com/codemirror/lang-sql/blob/main/src/sql.grammar)의 Statement, Parens, CompositeIdentifier와 [dialect tokenizer](https://github.com/codemirror/lang-sql/blob/main/src/tokens.ts)의 identifier/string/comment 노드가 경계와 quote를 결정한다. SQL을 정규식으로 tokenize하지 않는다.
- 현재 statement만 resolve하고 FROM/JOIN catalog 테이블, schema, alias, ON/WHERE/SELECT 컬럼, comma join, CTE 연쇄, 명시 CTE 컬럼, recursive anchor, derived table projection/alias column list, `*` 확장, scalar correlation, alias shadowing, LATERAL 앞 source, UNION branch를 구분한다. SELECT cursor 뒤 FROM source도 분석한다.
- unknown qualifier와 unknown/ambiguous catalog relation에는 추측 컬럼을 생성하지 않는다. derived expression은 명시 alias 또는 직접 projection만 노출한다. 중복 join 컬럼은 `u.id` 등으로 제시하며 inner scope 컬럼이 outer 동일 이름을 가린다.
- SQLite/MySQL의 database/schema 중복 메타데이터를 `main.main.table`처럼 삽입하지 않는다. PostgreSQL은 schema.table, MSSQL은 database.schema.table 후보를 지원한다. identifier quote/escaping은 dialect 및 사용자가 입력한 quote에 맞춘다.
- catalog 없는 `.sql` 파일에서도 common keyword/function 후보를 제공한다. 함수 자체에 DB 실행, metadata 조회, 파일/네트워크, 자격 정보 접근은 없다.
- 입력 250,000 UTF16, syntax node 20,000, nesting/projection 64, 후보 100 제한. 입력/노드 초과는 empty + `incomplete:true`, 후보 절단도 incomplete. 5,000 table prefix 100회 측정은 Node에서 평균 약 2.1ms였으며 native runtime latency 보장은 아니다.

## vendor

`design/sql/package.json`, lock, `vendor-entry.js`, `build.mjs`, notices/README와 `mods/ade/sql-parser-vendor.js` 추가. npm 고정 버전은 `@codemirror/lang-sql 6.10.0`, `@lezer/common 1.5.5`, `@lezer/lr 1.4.12`이고 모두 MIT다. esbuild 0.28.2는 build 전용이다.

업스트림 소스 SHA256을 확인한 뒤 editor indent/fold/highlight props와 language-service wrapper만 제거한다. 생성 grammar·tokenizer·dialect·error recovery는 유지한다. bundle은 약 77KB이며 DOM/Node/editor 서비스와 외부 import가 없다. 배포 bundle 안에도 runtime 라이선스 전문을 포함한다. `design/sql/.gitignore`로 node_modules를 제외한다.

## 검증

- `node --experimental-vm-modules design/ade/check_sql_completion.mjs` PASS: 빈 VM realm에서 local ESM만 import하고 FROM/JOIN, suffix replacement, quoted/schema-qualified names, CTE/recursive/derived/lateral/correlated query, alias shadowing, UNION isolation, comments/strings/dollar string, multi-statement, unknown schema, UTF16, immutable metadata, references, limits를 검증했다.
- `npm run check --prefix design/sql` PASS: lock 기반 bundle·license 재생성 일치.
- `node design/sql/check-native.mjs` PASS: Herdr 실제 JS runtime에서 parser 실행 및 table/column/CTE/derived/correlation/string/UTF16/reference 동작 확인. 임시 fixture만 사용하고 설치/UI 상태는 변경하지 않는다.
- `herdr-app check mods/ade` PASS (상위 공통 UI 생성 후).

실제 UI popup/keyboard와 SQLite metadata 통합 확인은 상위 작업의 검증 대상이다.

## 한계

검증 SQL compiler가 아닌 best-effort editor resolver다. catalog/alias 비교는 case insensitive이며 quoted case-sensitive 이름을 완전하게 구분하지 않는다. expression type inference, procedure body, table-valued function schema, parenthesized join group, dialect 전용 PIVOT/UNPIVOT/MATCH_RECOGNIZE는 처리하지 않는다. 이름 없는 computed projection은 노출하지 않고 recursive CTE는 explicit/anchor projection으로 제한한다. keyword/function fallback은 공통 문법의 작은 목록이다. 미완성 입력을 오류로 간주하는 syntax diagnostics는 추가하지 않았다.
