# T14 실제 실행·SQL 하단 결과 도구

2026-11-05. 승인한 HTML 시안대로 실행 구성 및 SQL 실행 결과를 하단 run-results tool로 통합한다. 실제 실행 명령과 DB 엔진을 사용하며 샘플 타이머를 사용하지 않는다.

실행별 탭, 실행 원문·연결/폴더·상태·로그/결과 표를 유지한다. 현재 보고 있는 결과와 진행 중 job은 독립. 반복 실행마다 snapshot 기록, 실행 중 닫기 비활성, 완료 닫기·선택·keyboard. SQL source 문서는 중앙, table 직접 편집도 중앙, SQL console result만 하단 도구. 여러 결과는 탭으로 읽을 수 있으며 기존 추출기·행선택/복사·cancel·progress를 보존한다. codebench 기존 중앙 SQL 결과 동작 보존.

파일 소유: mods/codenav/run.js, mods/codenav/database-editor.js, 새 mods/codenav/execution-results.js(필요시). 실행 구성 편집도 공통 목록 관리 패턴으로 적용. 공유 컴포넌트 계약은 T13 담당과 합의. main.js/tool-windows.js는 부모 소유. 부모에게 view class/export, TOOLS 등록/command 요구를 전달. 부모가 sync/install 실제 앱 검증. 하위 결과 results/T14-native-execution-results.md. 하위 effort medium: 기존 실제 상태 소유자를 재사용하는 UI 통합, 범위 확장 필요시 보고.
