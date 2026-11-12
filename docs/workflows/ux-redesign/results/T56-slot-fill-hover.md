# T56 단독 도구 채움·관리 행 hover 동작

side column에 terminal만 남았을 때 fixed px 높이 때문에 남던 빈 영역을 수정했다. visible child가 하나이고 그것이 ADE 도구이면 native weight로 가용 높이를 채운다. 원래 split size/max는 해당 도구의 지원되는 content.props.adeSoloSizing에 보관한다. terminal은 native pane content 대신 자신의 ADE header props를 사용한다. 둘째 도구가 열리거나 도구가 숨겨지면 저장한 split size/max를 복원하고 marker를 제거한다. 처음부터 weight인 도구는 native 분배를 그대로 사용한다.

이 규칙은 toggle/selectTerminal/arrange와 ensureDatabaseRegion migration에 적용된다. 사용자의 terminal right-top / database right-bottom 위치, 물리 순서, native tab/pane content와 column 너비를 바꾸지 않는다. visible unknown child가 있으면 단독 도구로 취급하지 않아 unknown 공간을 침범하지 않는다. 새로운 임의 layout node 필드나 JS 외부 mutable size 저장소는 추가하지 않았다.

canonical adeManagedList에는 opt-in rowActions(row)를 추가했다. 현재 runtime은 deferred virtual row 안의 handler/button을 허용하지 않으므로, 이 옵션의 목록만 측정 높이에 맞는 일반 render 행 window를 사용한다. 기본 10행에서 시작하고 실제 높이로 조절하며 한 번에 최대 25행을 만든다. 넘칠 때만 범위·이전/다음 구간을 표시하며 연결되지 않은 scrollbar는 그리지 않는다. 기본 목록은 계속 native virtual list와 실제 scrollbar를 사용한다.

MenuController가 window/hover 상태를 소유한다. 휠로 옮긴 window는 일반 redraw에서 유지하고, End/Home/Page와 선택·정렬 변경은 대상 행을 보이게 한다. resize는 화면에 있던 선택을 유지한다. hover 또는 선택된 행에서 quiet native action button을 표시하여 선택 행은 키보드 focus로도 접근할 수 있다. callback은 action(rowId,event,cx)로 정확한 행을 받으며 native button이 row selection/activation 전파를 차단한다. 아이콘은 factory이고 handler는 일반 render에서만 등록한다. Context를 보관하지 않는다.

적용한 행 동작:

- 프로젝트: 열기, 직접 순서 draft에서 위/아래 이동.
- 전역 연결 profile: 복사/제거. 기존 Apply 전 draft와 credential 비복사를 유지한다.
- 실행 구성: 정확한 행의 복사/제거. 실행하지 않고 기존 구성 draft만 변경한다.
- 설정의 여섯 도구: 표시/숨김. detail 버튼도 같은 handler를 사용한다.
- 에이전트: 보기/현재 파일 첨부 진입. 자동 전송하지 않는다.

큰 단축키 목록과 파일/DB tree는 hover window로 바꾸지 않았다. ADE Collection에는 100행 목록과 행 확인 예제를 추가했다. design/idea/COMPONENTS.md에 계약을 기록하고 canonical sync로 codenav/activity/ade 사본을 생성했다. 새 시각 값은 기존 ADE control/row metrics와 semantic 색을 재사용한다.

검증:

- `node design/ade/check_frame_layout.mjs`: 단독 terminal/database/left tool의 weight 채움, props 직렬화 후 px/max 정확 복원, custom top/bottom 위치, native pane/unknown data 보존과 반복 안정성 통과.
- `node --experimental-vm-modules design/idea/check_ade_managed_rows.mjs`: 1,000행에서 최대 25개 생성, 실제 hover/native action의 exact row id, disabled/factory, End/Page/Home·순서/resize 선택 노출, 휠 위치 유지, deferred handler/fake scrollbar 없음, 기본 virtual 유지 통과.
- shared system, DB UI, 실행 구성, 설정, workspace, terminal 회귀 검사 통과. profile/config hover callback은 현재 선택과 다른 행을 대상으로 동작하며 적용 전 draft임을 검증했다.
- inert native fixture 일곱 개 통과: 100행 관리 목록, Collection, profile, 실행 구성, 설정 도구, 프로젝트 직접 순서, 에이전트 목록. unsupported/deferred-handler warning은 없었다.
- generated sync check와 `herdr-app check mods/ade`, `mods/codenav`, `mods/activity` 통과.

이 작업자는 설치·main 변경·CUA·사용자 profile/process 변경을 수행하지 않았다. 실제 native layout의 전체 높이와 pointer hover/keyboard focus를 관찰하는 최종 검증은 root가 수행한다.
