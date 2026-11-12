# T03 DB 변경 보존과 작업 피드백

2026-11-05. 구현·자동 검사 완료, 실제 화면 검증은 부모 통합 단계에서 수행한다. 부모가 지정한 기본 medium을 유지했다.

## 변경

- Apply 전에 열린 셀을 staging에 반영하고 전송 값을 깊은 snapshot으로 고정했다. applying·transferring 동안 셀 변경·삭제·Revert·추가 Apply·import를 차단한다. 성공 시 실제 제출한 staging entry만 제거하고 실패 시 재시도할 값을 유지한다.
- 표에 pending 수정·삭제 행 수, 삭제 행의 `−` 표시, PK 없는 행의 수정·삭제 제한 이유를 표시한다. Apply·transfer 진행과 성공의 실제 affected/출력 행 수를 표시한다.
- native SQL 편집 모드에서 전체 script 후보를 제공한다. 후보는 원문 줄 범위와 연결 문맥을 표시하며 viewer의 실제 선택 실행과 중첩 SELECT 경로를 보존한다. native selection 제약과 Run 단위 연결 수명을 설명한다.
- 새 실행 시작 시 이전 결과를 비우고 polling 중 완료 결과를 표시한다. 결과 선택 버튼에 행 수를 표시하고 엔진이 반환한 `statement`와 `elapsed_ms`로 출처·실행 시간을 확인하게 한다. API에 없는 statement 순번을 추정하지 않는다.
- export의 선택/로드/전체 테이블 범위를 구별하고 scope 변경 시 같은 extractor로 sample을 갱신한다. sample의 최대 20행과 pending 변경 제외를 안내한다. 연결·DB·schema·table을 transfer 대상에 표시하고 import header 처리 방식을 명시한다.

수정 파일은 `mods/codenav/database-editor.js`와 `design/idea/check_database_editor.mjs`다. model과 backend 변경은 필요하지 않았다. 새 i18n 키 17개는 부모에게 전달했다.

## 검증

| 명령 | 결과 |
| --- | --- |
| `node --experimental-vm-modules design/idea/check_database_editor.mjs` | 통과. 느린 Apply 중 Delete/Revert/setCell/import 차단, 열린 셀 확정·실패 후 staging 유지, native 전체 script·줄 범위, 선택/로드 export·preview 회귀 추가 |
| `node design/idea/check_database_model.mjs` | 통과. SQL 범위·dialect·추출기·import 기존 검사 |
| `herdr-app check mods/codenav` | 통과. native load/render 검사 |

실제 UI·install·사용자 DB 접속은 수행하지 않았다. 일반 탭 dirty/닫기 연동은 부모 소유 범위다. 여러 Run transaction과 whole-table export snapshot 일관성, DML SQL preview는 기존 경계를 유지한다. 엔진에 없는 처리 퍼센트나 statement 식별자를 만들지 않았다.
