# T37-database-editor-demo

2026-11-06. 사용자 DB 데모 정합 재요청 및 실행 로그 누락 보고. 이어 진행/구현 허가됨.

DB source·결과표·실행 범위·전송 정합 root 담당. 수정 mods/codenav/database-editor.js, 관련 검사, 공통 canonical 필요한 selector. 연결 문맥/행동줄 분리, primary 실행 범위 선택 좌측, block 즉시실행 제거. 후보 선택+정확한 SQL preview+명시 실행 dialog. 결과는 하단 job/statement tabs(backend transaction/job 유지). 고정 header·열폭·선택·편집/NULL·변경 bar·공용 extractors. 전송은 format/scope compact selector와 왼쪽 options/오른쪽preview, 한 내보내기 entrypoint. codebench 기존 분기 보존. DB.js agent소유, run-process/layout logagent소유. native SQLite 통합과 실제 로그 CUA는 root. effort root 현재설정 유지.

완료: 현재 기능 보존 회귀·canonical sync/system·native eager 검사, root 실제 SQLite/자체 실행 UI 관찰. 구현 성공과 실제 확인 구분. 결과 results/T37-database-editor-demo.md. YAGNI·KISS·DRY.
