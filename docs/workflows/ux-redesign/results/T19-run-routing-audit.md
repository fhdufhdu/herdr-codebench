# T19 실행 위치·실시간 출력 P0 감사

2026-11-06. 상태: 감사 결과 검토 대기. **코드·검사·설치본 수정 없음.** 부모가 전달한 사용자 화면 설명은 ‘데모시연 / docker compose up --build 실행 시 오른쪽 terminal이 선택되고 하단 결과는 untracked·0ms·명령만 표시됨’이다. 이 문서는 해당 설명과 source/설치된 native guide·d.ts를 대조한 조사이며 실제 앱을 직접 조작하거나 그 화면을 재관찰한 보고가 아니다.

## 결론

하단 결과를 실행 도구로 소유시키지 않고 **기존 terminal tab에서 실행한 뒤 그 terminal 화면을 주기적으로 복사**하도록 구현한 것이 첫 번째 구조적 차이다. terminal 자동 선택은 명시된 코드 경로다. 두 번째 P0는 복구의 ‘현재 copy에서 claim이 없다’를 ‘원래 실행 추적자가 사라졌다’로 해석하여 새 실행을 untracked로 바꾸고, 그 결과 원래 출력 monitor까지 종료할 수 있다는 점이다. 이 상태 전이 경로는 source로 확인된다. 실제 host에서 module instance가 copy별로 분리되는지는 현재 문서만으로 확정하지 못했다.

## 확정한 source 사실

| 사실 | 근거 / 사용자 영향 |
| --- | --- |
| idea 실행도 terminal tab을 만들거나 선택한다. | [run.js:123](../../../../mods/codenav/run.js#L123)의 `configTab` 다음 새 실행은 [126](../../../../mods/codenav/run.js#L126)의 `run("tab.new")`, 기존 구성은 [135](../../../../mods/codenav/run.js#L135)의 `run("tab.select")`다. 하단 tool을 열더라도 먼저 terminal UI 선택이 발생하는 경로가 남는다. |
| 실제 명령은 그 terminal의 shell로 전송된다. | [run.js:137](../../../../mods/codenav/run.js#L137)의 terminal 선택 뒤 [156](../../../../mods/codenav/run.js#L156)의 `hc send`로 실행한다. 하단 도구 자체가 프로세스를 시작/소유하는 구조가 아니다. |
| 하단 shell 결과는 live native terminal이 아니다. | [database-editor.js:548](../../../../mods/codenav/database-editor.js#L548)에서 readonly text EditorState를 만들고 [664](../../../../mods/codenav/database-editor.js#L664)의 명령+output 문자열을 [670](../../../../mods/codenav/database-editor.js#L670)의 Editor로 표시한다. [run.js:101](../../../../mods/codenav/run.js#L101)의 worker가 300ms마다 `hc read --lines 2000` snapshot을 넣어야만 갱신된다. ANSI/TTY 출력·native terminal selection/scroll의 직접 표시가 아니다. |
| 새 기록은 owner claim보다 먼저 공개되고 view를 연다. | [execution-results.js:29](../../../../mods/codenav/execution-results.js#L29)의 beginExecution은 shared에 queued/output빈문자열 기록을 저장하고 `toggleTool("run-results", true)`를 호출한 뒤 반환한다. caller의 claim은 [run.js:153](../../../../mods/codenav/run.js#L153)에서 그 다음에 수행된다. 새 view init의 관측을 claim보다 먼저 막는 계약이 없다. 실제 재진입 시점은 미측정이다. |
| RunResults는 init 즉시 복구를 수행한다. | [database-editor.js:549](../../../../mods/codenav/database-editor.js#L549)에서 recoverExecutions를 호출하고 1초마다 반복한다. [575](../../../../mods/codenav/database-editor.js#L575)는 현재 module Set의 claim 실패만 기존 owner 판단 근거로 사용한다. |
| 현재 실행 중인 shell에 footer가 없으면 복구가 untracked로 만든다. | footer는 명령 종료 뒤 printf되므로 long-running `docker compose up` 중에는 없는 것이 정상이다. [execution-results.js:73](../../../../mods/codenav/execution-results.js#L73)는 live terminal에 footer가 없을 때 state를 반환하지 않는다. 복구는 [database-editor.js:590](../../../../mods/codenav/database-editor.js#L590)에서 output을 버리고 `state: status.state || "untracked"`, `continuityLost: true`를 저장한다. 따라서 footer 부재는 새 실행의 유효성 부재를 의미하지 않는데도 복구 경로에서는 추적 불가로 바뀐다. |
| 복구가 untracked로 바꾸면 원래 monitor도 종료할 수 있다. | [run.js:105](../../../../mods/codenav/run.js#L105)는 shared 기록을 읽고 executionBusy가 false면 즉시 return한다. executionBusy는 queued/running만 true다([execution-results.js:15](../../../../mods/codenav/execution-results.js#L15)). 정상 출력 collector가 다음 read를 수행하기 전에 종료될 수 있다. |
| 0ms·명령만 보이는 표시와 위 경로가 부합한다. | beginExecution의 output은 빈 문자열이고 elapsed_ms가 없다. 복구 untracked 쓰기는 output/elapsed를 채우지 않는다. 첫 300ms 출력 수집 전에 이 전이가 일어나면 기존 로그 유실 안내·0ms·명령만 남는다. **화면 현상의 가능한 정확한 코드 경로이며 실제 타이밍을 측정한 확정은 아니다.** |
| toolbar callback만 하단으로 바꾸어서는 해결되지 않는다. | [tools.js:159](../../../../mods/codenav/tools.js#L159), [status.js:147](../../../../mods/codenav/status.js#L147)는 idea callback을 run-results로 바꿨지만 run.start 안의 tab.new/select와 terminal send는 그대로다. |

## module-local claim에 대한 확정과 추정

확정: [execution-results.js:10](../../../../mods/codenav/execution-results.js#L10)의 polling은 일반 module-local Set이다. native `shared/setShared`에 owner 정보가 없으므로 다른 module instance에서는 소유권을 볼 수 없다. 실제 runtime이 같은 module instance를 공유해야만 현재 보장이 성립한다.

설치된 `~/.config/herdr-app/AGENTS.md:992`는 shared/setShared가 모든 mod에서 보이고 설정 시 전체 redraw됨을 명시한다. `herdr.d.ts:389`도 shared 값이 persisted라고 명시한다. AGENTS.md:997은 localStorage가 mod copy별임을 명시한다. 반면 AGENTS.md:1015의 ‘다른 copy가 shared promise를 깨우더라도 task cx는 원래 copy를 그린다’는 문장은 **task context 소유** 설명이며 module cache/Set 공유를 보장하는 문장이 아니다.

따라서 ‘toolbar/status copy와 새 RunResults copy가 별도 module instance/VM이라 fresh view가 현재 작업을 즉시 회수했다’는 가설은 source와 사용자 현상에 잘 부합하지만 현재 guide/d.ts만으로 확정하지 않는다. 같은 instance라고 해도 queued 공개→tool 열기→claim 순서의 초기화 경합 가능성이 별도로 남는다. 또 guide:795에 따르면 copy는 처음 보일 때 시작하고, 파일 변경 시 모든 copy의 기존 task/timer가 중단된다(guide:789). cold-open과 HMR 재개를 동일 Set 상태로 가정하면 안 된다.

기존 fixture는 하나의 import graph에서 original owner와 result view를 함께 만들었으므로 module 공유 가정을 검증한 셈이다. double-VM 복구 검증도 ‘이전 owner가 사라진 뒤 새 VM’을 검증했으며 **실제 현재 실행 owner와 별도 copy의 새 복구 view가 동시에 살아 있는 경우**는 검증하지 않았다. 이 테스트 전제가 이번 P0를 놓쳤다.

## native live terminal 표시 API 조사

설치된 API에서 확인한 지원 범위는 다음과 같다.

- `AGENTS.md:219`는 layout block의 content로 `{ "terminal": "t7" }`를 명시한다. 이는 `{ "tab": "active" }`와 별개이며 특정 terminal을 직접 표시할 수 있다. composition terminal block은 tab pane이 아니라는 설명도 있다(guide:242).
- `herdr.d.ts:219`는 layout terminal block 클릭 시 그 block으로 focus가 가고, pane.focus가 visible layout terminal block을 우선한다는 실제 focus 계약을 명시한다.
- `herdr.d.ts:334`의 OverlaySpec.layout도 `{terminal:"t7"}` block을 지원한다. guide:970에는 titlebar mod와 live terminal block을 같은 layout column에 놓는 예제가 있다. 다만 사용자 요청은 하단 도구이므로 overlay를 여는 것으로 대체하면 위치 요구를 만족하지 않는다.
- `herdr.d.ts:214`의 `terminals()`는 모든 core terminal의 live 상태를 읽는다. terminal은 반드시 visible tab pane에 있어야 하는 것은 아니며 guide:147은 label 없는 terminal이 일반 화면에 나타나지 않는다고 설명한다.
- 설치된 `gpui-kit.d.ts`의 공개 gpui-kit/gpui-base/herdr 함수에서 **mod가 반환하는 Element 안에 끼우는 `Terminal.new`/`terminalView` factory는 찾지 못했다.** 현재 문서가 보장하는 재사용 경계는 layout-level terminal block이다. 일반 GPUI div/Editor로 terminal factory를 가정하면 안 된다.
- 그러므로 live terminal을 하단에 보여주는 경로는 기존 layout composition을 사용하는 방향이다. 기존 RunResults가 반환하는 readonly Editor를 새 ‘native terminal element’로 단순 치환할 수 있다고 주장할 근거는 없다.

이 조사는 API 확인에만 그쳤다. native app command 실행·layout 변경·새 프로세스 시작·engine/API 설계 또는 구현은 하지 않았다.

## 수정 방향과 기능 영향

### P0: 실행 위치와 소유권

idea 실행은 선택한 run configuration에 대한 **실행별 실제 작업/terminal**을 식별하고, 그 출력을 하단 실행 결과 도구가 직접 표시해야 한다. 시작할 때 일반 terminal tab을 자동 생성/선택하는 현재 경로를 그대로 둔 채 text mirror만 추가하는 방식은 사용자 요구를 충족하지 않는다. codebench의 기존 terminal 실행 경로는 보존한다.

native API가 허용하는 layout terminal block을 기존 하단 island/tool 안에 배치하는 방향을 우선 검토한다. 공통 tool header와 execution tab/metadata는 유지하고, 선택된 shell 실행의 live 출력과 SQL 표를 같은 도구의 각 소유 body로 표시한다. 기존 panel 크기/순서/active/hidden 상태와 현재 terminal 데이터를 보존해야 한다. engine endpoint나 새 terminal API를 추가하는 제안은 이 감사 범위에 포함하지 않는다.

명령·폴더·환경·원래 shell semantics와 remote workspace를 보존할 수 있는 기존 실행 경로를 확인해야 한다. actual terminal의 명령 전송/프로세스 lifecycle과 UI tab 선택을 분리한다. 단순히 terminal tab을 숨기거나 처음 terminal 선택 후 다시 editor를 선택하는 처리는 실제 실행 주체를 여전히 잘못 두므로 최종 해결로 간주하지 않는다.

### P0: 현재 실행을 복구 대상으로 오인하지 않기

fresh RunResults가 module-local Set을 보지 못했다는 이유만으로 현재 live 실행을 즉시 untracked로 전환해서는 안 된다. 소유권은 source와 result view가 실제로 공유하는 경계에서 확인해야 하고, 새 기록은 작업 소유가 성립한 상태에서 공개되어야 한다. 종료 footer가 아직 없다는 것은 long-running 작업의 정상 상태일 수 있다. 기존 실행을 재전송하지 않는 복구 원칙은 유지하되 실제 stale 상태와 cold-open 초기화를 구분해야 한다.

untracked는 정말 실행 동일성/관측이 유실된 경우의 예외 상태로 남기고 정상 실행의 기본 화면으로 사용하지 않는다. 안전을 이유로 정상 로그 수집을 끊는 현재 state 전이를 먼저 제거해야 한다. native 프로세스/terminal에 실행 단위 소유권이 생기면 일반 interactive shell 재사용 때문에 생기는 동일성 모호성도 줄일 수 있다.

### 검증에서 추가할 필수 사례

1. 앱을 막 연 상태에서 처음 실행 결과 도구를 여는 long-running 명령: 실행 즉시 하단에 running/출력 표시, 중앙 source 유지, 일반 terminal tab 선택 command 0회.
2. toolbar/status/RunConfigs 등 서로 다른 native copy에서 실행 후 별도 RunResults copy가 열리는 경우: owner와 view가 실제 module instance를 공유하지 않아도 현재 실행을 탈취하거나 untracked로 만들지 않음.
3. `docker compose up --build`처럼 계속 출력하고 종료 footer가 오래 없는 작업: running 유지·live stdout/stderr·정확한 stop, 다른 결과 탭을 봐도 현재 작업 수집 유지.
4. terminal ANSI/진행 표시/scroll/selection과 resize가 하단 실제 native 출력에서 동작. readonly Editor text mirror를 보고 통과 처리하지 않음.
5. 실제 HMR/앱 재시작으로 owner가 사라진 경우만 복구. 재실행/명령 재전송 0회, 선택 결과·코드벤치·SQL 표·기존 terminal 데이터 보존.
6. long-running 상태에서 fresh-view 복구 worker가 먼저 실행되는 타이밍을 고정한 회귀 검사. 기존 source worker가 `!executionBusy`로 종료되지 않음을 확인.

실제 copy/VM 분리 여부와 cold-open 이벤트 순서의 계측은 아직 수행하지 않았다. source 수정 전 부모의 관찰/계측에서 확정할 항목이다. 이번 추가 감사 이후 source/check/generated/install 파일을 변경하지 않았다.
