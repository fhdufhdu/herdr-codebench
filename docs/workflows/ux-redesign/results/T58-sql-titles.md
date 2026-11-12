# T58 SQL 실행 결과 제목

2026-11-09. SQL 결과 탭의 connection/선택 범위/상태 조합을 실제 동작·대상 기반 제목으로 교체했다. 예: `SELECT customers · #3`, `UPDATE orders · #4`, `SELECT customers + UPDATE orders · 2구문 · #5`. source 이름·진행·완료/실패·elapsed는 결과 본문의 보조 metadata에 유지한다. shell 실행 제목은 변경하지 않았다.

database-model의 bounded lexer는 64KiB/4096 token 안에서 action과 target identifier만 읽고 문자열 literal·주석·dollar-quoted body는 건너뛴다. qualified/quoted identifiers, SELECT JOIN, INSERT/UPDATE/DELETE, DDL, WITH의 바깥 action과 복수 실행 단위를 요약한다. full parser를 추가하지 않았다. 알 수 없는 구문을 SELECT로 추측하지 않고 SQL로 표시한다. 제목 폭은 제한하며 복수 구문 수를 유지한다.

프로젝트별 runNumber는 새 job을 처음 게시할 때만 증가하고 polling에서는 유지한다. history eviction/닫기 뒤에도 다음 번호가 이어진다. shared에는 기존 job metadata와 안전한 queryLabel/sourceName/runNumber만 있으며 원문 SQL·literal 값·결과 rows는 넣지 않는다. 전체 SQL tooltip은 DatabaseResults가 engine job에서 받아 보관한 local result.statement에서만 만든다. 조회되지 않았거나 engine이 원문을 반환하지 않은 실패 job에 가짜 SQL을 만들지 않는다.

기존 기록은 local fetched statement가 있으면 같은 lexer로 안전한 제목을 복원한다. 없으면 SQL/table/실제 시작 시각 또는 job id의 짧은 suffix를 사용하며 쿼리 action을 지어내지 않는다. 여러 result set의 원문은 local tooltip에서 함께 확인한다. UI는 공통 ResultsHost와 standalone DatabaseResults 모두 같은 title helper를 사용한다.

검증: `check_ade_database_model.mjs`, `check_ade_database_editor.mjs`, `check_ade_results.mjs`, `herdr-app check mods/ade` 통과. lexer의 literal/comment/CTE/다섯 driver quoting, JOIN·복수 구문, 반복 실행 번호 차이, raw literal의 shared 부재, legacy fallback과 ResultsHost 제목 매핑을 검사했다. 설치/CUA/DB profile 변경은 이 하위 작업에서 수행하지 않았다. root의 실제 실행·통합 화면 검증은 별도다.
