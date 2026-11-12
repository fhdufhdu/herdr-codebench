# T17 승인 데모와 실제 Database UI 정합

현재 상태: **변경점 감사 완료 / 구현 보류**. 후속 사용자 지시 ‘먼저 변경점 찾기’가 아래의 초기 구현 지시보다 우선한다. 중지 전 `database.js`의 selector/배치에 부분 변경이 있으며 문법 검사만 통과했다. 설치·회귀 검증 완료 상태가 아니다. [감사 결과](../results/T17-database-design-alignment.md).

2026-11-06 사용자 지시: DB UX/UI/디자인이 데모와 크게 다름. 실제 기능을 보존하며 design/ux-redesign-demo.html의 연결 관리/탐색/SQL source/하단결과 구조를 사용한다. prototype 샘플 데이터·타이머를 실제 모드에 넣지 않는다.

소유: mods/codenav/database.js, mods/codenav/database-editor.js, 관련 DB검사, results/T17-database-design-alignment.md. canonical ui.js와 tools/settings/actions, 생성물/설치 파일 수정금지. 공통 component확장필요는부모에게요청. 연결관리 compact native Select로5 driver 선택/TLS 선택(데모와배치맞춤), 공통관리목록/상세 여백·disabled/busy/empty/error. SQL툴바 주요행동1개, 범위확인→실행, 연결문맥, 현재원문·편집전환 보존. 결과는공유하단 tool(header중복금지), 통합execution tabs·표toolbar·접힌SQL. 표직접편집중앙·staging/PK/추출기/typedvalue·keychain·global profile보존. codebench 기존UI분기는유지.

실제앱관찰은부모 CUA단독수행. source만읽어불일치핵심리스트를먼저부모에보고한뒤 구현. 변경범위적절히판단 YAGNI/KISS/DRY. 하위 effort medium. 회귀검사·실native eager검사후 부모일괄설치. 추측프로덕트추가금지.
