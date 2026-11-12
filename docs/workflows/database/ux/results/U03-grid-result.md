# U03 데이터 그리드 결과

## 구현

- 셀 클릭으로 포커스 위치를 저장하고 의미 색 `focus`로 테두리를 표시한다. 방향키와 Home/End는 현재 페이지 안에서 셀을 이동하며 기존 `Scroller`로 가로·세로 가시성을 유지한다. 행 번호 클릭도 해당 행의 셀 포커스를 갱신한다.
- F2/Enter는 포커스 셀의 기존 편집기를 연다. 편집기 Enter는 값을 로컬 변경에 보관하고 다음 행으로 이동한다. Escape는 입력 중인 값을 버리고 그리드 포커스를 복구한다. 실제 DB 변경은 기존 Apply Changes가 실행한다. 수정 셀은 `lineModified` 의미 색 테두리로 표시한다.
- NULL은 기존 보조색과 `NULL` 표시를 유지하고 빈 문자열은 비워 둔다. 문자열의 CRLF/LF/CR은 화면에서 `↵`로 치환한다. 편집기, 데이터 모델, 공통 복사·내보내기 경로는 원문을 유지한다. 숫자 값은 오른쪽에 정렬하고 PK 컬럼 헤더에 `⚿`를 표시한다.
- 테이블 하단은 현재 페이지의 절대 행 범위를 표시한다. 정상 페이지의 `truncated` 플래그는 쿼리 결과 제한 경고로 표시하지 않는다. SQL 콘솔의 제한 경고는 유지한다.
- 셀 우클릭은 기존 `DatabaseQueryMenu` 팝업과 공통 `MenuController`를 재사용한다. Edit Cell, Copy Rows, Data Extractor…, Export Data…, View DDL을 제공하며 원래 선택된 행을 우클릭하면 다중 선택을 유지한다. 메뉴 명령은 활성 문서 경로를 재검증하여 소유 편집기로 전달한다. 읽기 전용 결과와 PK가 없는 테이블의 편집, 적용 중 또는 삭제 예정 행 편집은 차단한다.
- 새 모델 계층, 열 크기 조절, 엔진 변경은 추가하지 않았다. `database-model.js`와 기존 extractor를 그대로 재사용한다. 부모 소유 i18n에 `Edit Cell`, `Data Extractor…`, `View DDL`을 전달했다.

## 실행한 검증

- `node --experimental-vm-modules design/idea/check_database_editor.mjs` 통과. 새 회귀 검증은 셀 경계 이동, F2/Enter, Enter 제출 후 다음 행, Escape 취소, 읽기 전용/PK 가드, 개행 표시와 원문 복사·편집, 숫자 정렬, PK 표시, 페이지 범위, 선택 유지와 메뉴 명령의 문서 경로 검증을 포함한다.
- `node design/idea/check_database_model.mjs` 통과.
- `python3 design/idea/sync_ui.py --check` 통과.
- `node --experimental-vm-modules design/idea/check_system.mjs` 통과.
- `herdr-app check mods/codenav` 통과.

## 남은 native 확인

부모가 설치와 실제 UI 조작을 단독으로 소유한다. 이 작업자는 설치나 CUA를 수행하지 않았다. 실제 InputState의 Enter 제출 이벤트 전파와 Escape 처리, 포커스 테두리와 변경 테두리, `⚿` 글리프, 화면 밖 셀 이동과 우클릭 팝업 위치, idea/codebench 두 레이아웃은 부모의 실제 UI 확인이 필요하다. VM은 native 이벤트 순서와 픽셀 배치를 증명하지 않는다.
