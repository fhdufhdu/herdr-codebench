# T12 실행 결과 탭 구현 결과

2026-11-05. 상태: 검토 대기. 하위 구현 담당: run_output_tabs. 태스크 지정 effort는 medium이며 구현 중 변경하지 않았다.

## 변경 범위

- `/tmp/codebench-run-output-tabs.js`: 기존 `let runTimer`와 실행 관련 세 함수를 대체할 HTML 데모 JavaScript 조각.
- 이 결과 문서만 저장소에 작성했다. HTML·CSS·도구 전환·설치·화면 검증은 부모 담당이다.
- 실제 명령·백엔드·API는 실행하지 않으며 기존 2초 샘플 실행을 유지한다.

## 구현과 계약

- `runEntries`는 실행마다 이름·명령·폴더 snapshot과 실행 번호·상태·출력을 보존한다. 같은 구성을 반복해도 별도 결과가 생성된다.
- `activeRunId`와 `selectedRunId`를 분리했다. 이전 결과를 보는 동안 중지하거나 완료되어도 실제 실행 중인 결과만 갱신한다.
- 동시 실행은 하나로 제한한다. 실행 중에는 구성 선택·편집·시작을 비활성화하고 중지를 활성화한다. 구성이 비면 시작·선택을 비활성화하고 편집은 허용한다.
- `runTabStrip`의 기존 노드를 유지하며 각 결과 행을 추가·삭제·갱신한다. 탭 버튼과 닫기 버튼은 형제이며 실행 중 닫기는 비활성화한다. 선택 결과를 닫으면 오른쪽 이웃, 없으면 왼쪽 이웃을 선택한다.
- 탭에는 `role=tab`, `aria-selected`, roving tabindex를 설정한다. 좌우 방향키·Home·End가 선택과 초점을 이동한다. `runOutput`은 선택 탭을 `aria-labelledby`로 참조하는 tabpanel이다.
- 선택 또는 키보드 이동 때만 탭 행의 가로 위치를 노출한다. 백그라운드 완료 렌더링은 선택·초점·가로 스크롤을 바꾸지 않는다.
- 내용은 `textContent`로 출력하고 닫기 아이콘만 기존 신뢰된 `ICONS.x`를 사용한다.

## 부모 통합 지침

기존 `runConfigurations`와 목록 관리자는 유지한다. `setRunBusy`, `startConfiguredRun`, `stopConfiguredRun` 공개 함수명을 유지했다. 추가 함수는 `renderRunTabs`, `selectRunEntry`, `closeRunEntry`다. 추가 상태는 `runSequence`, `runEntries`, `activeRunId`, `selectedRunId`이고 기존 `runTimer`를 유지한다.

`runTabStrip`, `runEntryMeta`, `runEntryStatus`, `runOutput`을 준비하고 초기화 때 `renderRunTabs()`를 한 번 호출한다. 탭 strip에는 부모가 `run-tabs` 클래스를 지정한다. 생성되는 클래스는 `run-tab`, `active`, `running`, `run-tab-button`, `run-tab-close`, 출력 빈 상태의 `run-empty`다. `toggleRunDock`은 부모가 소유하며 시작 함수는 항상 `setBottomDock("run")`을 호출한다.

## 검증

- `node --check /tmp/codebench-run-output-tabs.js`: 통과.
- Node VM과 최소 DOM 대역을 사용한 상태 검증: 통과. 중복 시작 방지, 실행 중 닫기 방지, 구성 변경 후 snapshot 보존, 이전 탭을 보는 동안 중지·완료의 올바른 대상 갱신, 기존 탭 노드 유지, End 키 선택·초점 이동, 선택 탭 닫기 후 이웃 선택, 마지막 결과 제거, 빈 구성의 컨트롤과 접근성 이름을 확인했다.
- 실제 브라우저 표시·긴 탭 가로 스크롤·도구 열기/접기·기존 목록 관리자 통합 검증: 부모 담당으로 미실행.
- native mods를 변경하지 않아 생성 파일 동기화와 `herdr-app check`는 이 하위 조각에 해당하지 않는다.

차단 사항 없음. 실제 UI 검증과 부모 통합 검토 전 전체 완료로 표시하지 않는다.

## SQL 결과 통합 확장

사용자의 추가 결정에 따라 `/tmp/codebench-query-run-renderer.js`에 `renderQueryRun(entry)` 읽기 전용 렌더러를 작성했다. 부모가 보유한 SQL 실행 결과의 `columns: string[]`, `rows: primitive[][]`, `status` snapshot을 표시한다. `kind: "sql"`, 실행 SQL인 `command`, `output`의 생성·관리와 실행별 행 선택·내보내기는 부모 책임이며 이 함수는 상태를 변경하거나 이벤트를 등록하지 않는다.

공개 DOM 계약은 `queryRunView` 컨테이너, `queryRunTableHead` **thead**, `queryRunTableBody` **tbody**, `queryRunSummary` 요약이다. 헤더에는 기존 표와 동일한 # 순번 열을 먼저 두고 이후 snapshot 열을 표시한다. 모든 열 이름과 값을 `textContent`로 출력하며 null은 `NULL`과 기존 `.null` 스타일을 사용한다. 요약에는 실행 상태·행 수·열 수를 표시하고 실행 중 컨테이너에는 `aria-busy=true`를 적용한다. 빈 결과는 헤더와 0행 요약으로 표시한다.

스타일 근거는 `design/ux-redesign-demo.html`의 기존 `.grid-wrap`, 전역 `table`·`th`·`td`, `.null`, `.result-footer`와 `renderGrid()`다. 새 CSS나 의존성은 추가하지 않았다. 부모가 기존 표 스크롤·요약 클래스를 컨테이너에 배치한다. 도구 열기/접기·출력 pre와 표 전환도 부모가 소유한다.

SQL 확장 검증: `node --check /tmp/codebench-query-run-renderer.js` 통과. Node VM DOM 대역에서 열/행 값·마크업 문자열 그대로 표시·NULL·false/0/빈 문자열·실행 상태·빈 결과·frozen snapshot 불변 검증을 통과했다. 브라우저 검증은 부모 통합 후 수행해야 한다.
