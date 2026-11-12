# T03 DB 변경 보존과 작업 피드백

- 요구사항 U07, 기존 DB 12개 요구 보존. effort medium. 새 API 없이 현재 UI 상태와 실제 엔진 결과를 사용한다.
- 수정 범위 mods/codenav/database-editor.js, 필요한 database-model.js와 design/idea/check_database_editor.mjs·check_database_model.mjs, 결과 results/T03-database.md. 부모의 common UI·아이콘·i18n·database.js·tabs.js는 변경하지 않는다.
- Apply 시작 시 셀 편집 확정·snapshot 고정, 동일 문서 applying 동안 Delete/Revert/setCell/insert 등 모든 mutation 진입점 차단. 실패 시 staging 유지, 성공 시 다른 변경 유실 방지. 느린 Apply 회귀를 검사한다.
- 표 하단에 pending 수정·삭제 수와 읽기 전용 이유를 설명한다. 기존 공통 컴포넌트와 uiColors 의미색을 사용한다.
- SQL 후보에 전체 script 후보를 포함하고 실행 범위·줄 범위와 source 문맥을 표시한다. native edit의 selection 불가 제약을 정확히 안내한다. 기존 CodeView 선택 경로를 임의 제거하지 않는다.
- 결과 번호·statement 출처, 행 수·경과 시간, export 선택/로드/전체 범위와 preview sample·서버 원본 의미를 설명한다. 실제 결과·메타데이터가 제공하는 범위에서만 구현한다.
- 여러 Run transaction, 새 API·driver·full snapshot export·DML preview는 이번 구현 범위 밖이다. 추가 번역 키는 부모에게 전달한다.
- JS model/editor 검사와 native check를 수행하고 실제 UI는 부모가 단독 검증한다.
