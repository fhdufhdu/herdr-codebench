# T28 모드 전용 편집기 통합

09 문서의 사용자 승인 후 구현 단계. 앱 본체를 변경하지 않는다. 부모가 codenav code/common/main/actions/status, activity의 저장 명령 routing, database-editor SQLBuffer, 검사·설치를 소유한다. 엔진 LSP 파일은 T26 소유자가 완료 후 인계한다.

idea의 로컬 텍스트 파일을 같은 source 표면의 편집기로 열고, Markdown 원문/미리보기에서 buffer·undo·LSP 수명을 공유한다. SQL console은 별도 viewer/edit 전환 없이 caret·선택 범위 실행을 제공한다. DDL은 같은 표면의 readonly 상태다. codebench·미디어·원격 편집 경로를 보존한다. 저장·외부 변경 CAS·dirty close·workspace·키맵·폰트·IME·미저장 진단을 검사한다.

완료 근거는 모델/입력/통합/DB 회귀, canonical check, 변경 모드 native check, batch 설치 및 실제 임시 문서·SQLite 왕복이다. 기존 사용자 터미널과 실제 DB를 시험 데이터로 쓰지 않는다. 지원하지 않는 completion/rename/format을 완료 항목으로 표시하지 않는다.
