# T05 DB 문서 수명 안전성

2026-11-05. U04·U07. 부모가 위임한 추가 구현, effort medium 유지.

- 소유 범위는 `database-editor.js`, `tabs.js`, DB editor·tabs 기존 회귀 검사와 이 태스크·결과 문서다.
- DBEditor는 원문·데이터 없이 문서별 dirty/busy 상태를 공유한다. close/closeAll/비활성 탭 close는 보호 대상 문서를 열고 이유를 알린 뒤 전체 닫기를 보류한다. 일반 파일 save prompt 경로를 보존한다.
- SQL 초안은 명시적 Save/Discard를 제공한다. 테이블은 Apply/Revert로 사용자가 변경을 정리한다. 닫기에서 서버 Apply를 실행하지 않는다.
- 문서 이동 시 열린 셀을 기존 문서 staging에 확정한다. applying 동안 mutation 차단을 유지한다.
- metadata는 layout·owner별 수명을 가진다. init은 같은 layout의 이전 owner 기록을 정리하고 release는 자신의 기록만 정리한다. 복원 metadata만으로 영구 close 차단을 만들지 않는다. render에서 shared를 직접 쓰지 않는다.
- 기존 uiTab children에 dirty 표시를 추가하고 기존 semantic 상태·알림을 재사용한다.
- 기존 API만 사용한다. 설치·CUA는 수행하지 않으며 editor/model/tabs/native 자동 검사와 결과를 보고한다.
