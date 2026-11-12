# T67 프로젝트 분석 준비와 외부 소스 의미 탐색

진행: 전체 구현. 사용자 요구는 새 파일마다 기다리지 않도록 프로젝트 수준 언어 서버/인덱스 준비, 외부 라이브러리에도 정보·정의·참조를 제공하는 것이다. YAGNI/KISS/DRY. 기존 LSP server pool, protocol, tokenizer, scoped UI와 readonly 보호를 재사용한다.

프로젝트 API: project_prepare {root,retry?}는 local absolute root의 비동기 준비를 시작/재사용, project_status {root}는 상태를 반환한다. 준비 상태는 scanning/preparing/ready/partial/error, 파일 수·잘림·root별 language/root/phase/error/busy를 포함한다. 서버 초기화와 지원 workspace query가 끝났다는 뜻으로 ready를 쓰며 모든 언어의 전체 인덱스 완성을 보장하지 않는다. foreground open을 막지 않는다. bounded scan/중복 합치기/동시 준비 제한·종료 정리를 검증한다.

외부 소스: materialize 시 원 URI+원 language/server root를 서버 쪽 메타데이터로 보관한다. immutable materialized text의 hover/definition/references/symbols를 original URI와 server로 라우팅하며 임시 경로를 독립 프로젝트로 열지 않는다. cached source에 저장/format/completion/text sync를 금지한다. URI/원 server 연결이 없으면 unsupported를 정직하게 표시한다. 엔진 재시작 후 재준비 가능하게 metadata를 안전한 cache 범위에 저장하되 source원문/비밀은 공유상태에 쓰지 않는다.

위임: engine 프로젝트 준비는 별도 project_analysis.go+test에 medium effort(명확한 bounded job 계약), 외부 소스는 engine LSP 관련파일에 medium effort(명확한 original URI routing 계약). root는 UI/공통 main route와 통합·배포·native 검증 담당. 변경 파일 경계를 지키고 commit/push/설치/엔진 재시작은 root만 한다.
