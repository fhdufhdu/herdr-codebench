# T41 새 실행·결과 흐름

새 `mods/ade/execution.js`로 실제 실행 구성/소유 process/하단 로그 UI를 작성한다. 기존 화면/controller 로직을 복사/상속하지 않는다. native hc process API는 적절히 이용한다.
- export ExecutionResults 클래스 init(props,cx),render(cx),release(),refresh(cx); RunConfigurations 클래스 동일 overlay용; functions runConfiguration(context,config,cx),stopExecution(id),executionState(context),selectedConfiguration(context).
- context `{id,root,machine,name,branch}`와 workspace.js projectKey 재사용. 저장 namespace ade.execution/ade.run-configurations로 기존 사용자값 보존.
- runConfiguration은 config {id,name,command,cwd?}의 shellcommand를 hc 독립 background/no-parent/no-notify process로 launch, 고유 소유 label 검증 후에만 read/interrupt/kill. 어떤 기존 terminal도 재사용/입력하지 않는다. 로그는 최근2000줄 bounded, 완료/실패/취소 상태+exitcode 보존. 삭제/닫기는 실행중 process 자동kill금지. 재시작은 재실행 금지; ownership recover 또는 unknown 명시.
- 하단은 실행별 탭, 실제 출력 read 중 상태, 빈/오류/취소/재시도. 무한 redraw/과도한 polling금지, 필요한 running 관찰만 task timer사용. 기록20개bounded.
- RunConfigurations는 승인된 목록+상단 add/remove/copy/up/down+우측상세, Apply/Cancel draft. main integration root만. canonical ade primitives. 공통입력/MenuController와 적절히 조합, 기존 codenav controller import금지.
- 소유 파일 execution.js 및 자신의 tests/result. install/CUA/실제 process시험은 root와 조율; 본인 fixture process만 자동시험가능. 앱/코어 종료금지.
- effort medium, API 계약/소유성 검증을 명확히 구현. 모델 변경없음.
