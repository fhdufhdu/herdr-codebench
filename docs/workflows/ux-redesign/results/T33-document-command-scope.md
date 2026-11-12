# T33 문서 전체 Save/Preview shortcut 범위 수정

2026-11-06. 부모의 실제 UI 재현에서 자체 편집 native sink의 Save는 성공했으나 미저장 Markdown을 Preview로 바꾼 뒤 Save는 disk에 반영되지 않았다. 원인은 T28 bridge의 predicate가 `keyset token > HerdrEditorInput > Input`이어서 native input이 없는 Preview나 다른 descendant control focus에서는 command가 매칭되지 않는 데 있었다.

## 변경

- `editor-commands.js`의 binding predicate를 현재 keyset token 단독으로 변경했다. 실제 effectiveShortcuts 기반 chord/sequence, keyset 변경 시 context 교체, render 밖 지연 bind, stale handler 재확인, pending IME propagate, release 취소 보호는 유지한다. 사용자 keyfile과 원문은 읽거나 변경하지 않는다(키 목록은 keys()로 읽음).
- wrapper를 문서 전체 크기인 flex_1/size_full/min_w0/min_h0로 조립한다. 새로운 문서나 caret owner를 만들지 않는다.
- EditableCode.render에서 `commandKeys.render(super.render(cx),cx)`로 전체 문서 표면을 감싼다. inlineCaret는 원래 EditorInput만 반환하고 renderCx 임시 캡처를 제거한다. 따라서 작은 native IME sink의 폭/높이를 full-size wrapper로 늘리지 않는다.
- 처리된 command에서 notify를 보장한다. 기존 rich-view command는 내부 Preview 상태만 바꾸므로 이 notify가 있어야 key action 직후 repaint가 일어난다.
- database-editor.js는 수정하지 않았다. SQLBuffer는 부모가 별도 plain outer div에 HerdrSqlEditor context를 붙여 문서 command context를 덮어쓰지 않게 조립한다.

## 검사

`check_editor_commands.mjs`는 predicate에 input descendant 조건이 없고 full-document wrapper 크기를 갖는지 검증한다. 기존 Ctrl/Meta·shift·sequence·재할당/제거·우선순위·deferred race·stale·IME pending·release·focused callback 검사를 유지하고 handled command의 notify도 확인한다.

`check_editable_code.mjs`는 production EditableCode.render를 실제 호출하여 다음을 확인했다.

- 미저장 Markdown→Preview에서 root context에 Save가 매칭되고 actual Save callback이 expected snapshot CAS로 disk fixture에 저장한다.
- Preview 상태와 동일 EditorBuffer를 유지하며 dirty가 해제된다.
- Preview shortcut이 같은 buffer로 원문으로 돌아온다.
- inlineCaret는 HerdrEditorInput만 소유하며 별도 command wrapper를 갖지 않는다.
- 유효 Save를 sequence로 재할당하면 문서 전체에서 이전 Cmd+S는 매칭되지 않는다.

통과한 명령:

```sh
node --experimental-vm-modules design/idea/check_editor_commands.mjs
node --experimental-vm-modules design/idea/check_editable_code.mjs
node --check mods/codenav/editor-commands.js
node --check mods/codenav/editable-code.js
```

native ancestor context의 실제 우선순위, descendant focus·한글 IME·Preview에서의 실제 사용자 키 입력은 부모가 확인한다. VM의 CAS 성공을 실제 사용자 파일 저장 성공으로 보고하지 않는다. 이번 작업에서 설치/CUA·사용자 파일·DB source는 변경하지 않았다. T28의 inline-input 전용 연결 계약은 이 문서의 문서 전체 scope로 대체된다.

## 후속: native Input의 context 우선순위

부모의 실제 SQLBuffer 검증에서 붙여넣기는 문서에 반영됐으나 Cmd+S는 저장되지 않고 Cmd+Enter는 줄바꿈을 삽입했다. document token 단독 binding은 Preview를 포괄하지만 native Input 내부에서는 더 얕은 context에 매칭되는 문제가 있었다.

읽기 전용 공개 source에서 다음 근거를 확인했다. 이 source 계열의 우선순위 규칙은 설치 바이너리의 모든 동작을 실행 검증한 증거와 구분한다.

- `/tmp/herdr-shift-source-20261103/vendor/gpui-pre/src/keymap.rs:151–159`는 더 깊은 context를 우선하고 동일 depth에서는 나중 등록 binding이 우선한다고 명시한다. context가 없는 global binding도 가장 깊은 depth로 취급한다(`:274–279`).
- 같은 source의 `keymap/context.rs:260–270`은 predicate가 일치하는 가장 깊은 context depth를 찾는다. `window.rs:6078–6091`은 우선순위 binding을 실행하고 action이 전파를 중지하면 다음 후보로 진행하지 않는다.
- `/tmp/herdr-mod-editor-source-cfcf8364/vendor/gpui-kit/crates/base/src/input/base/state.rs:136`은 native 입력 context를 Input으로 정의한다. Enter/secondary-enter도 여기에 등록된다(`:158–180`). multiline의 submit_on_enter 기본값은false(`:842`)이고, 해당 모드의 Enter는 newline을 삽입한다(`:2058–2063`). 관찰된 SQL 줄바꿈과 일치하는 경로다.

최소 수정으로 각 effective Save/Preview chord에 다음 두 predicate를 같은 guarded action으로 등록했다.

1. 현재 keyset token 단독: 문서/Preview focus 유지.
2. `<현재 keyset token> > Input`: native 입력 descendant의 깊이에도 매칭.

IME pending·stale handler·사용자 재할당·삭제·sequence·render 밖 bind·release 보호는 공유 action handler 그대로 유지한다. 두 predicate는 같은 keyset token에 속하므로 이전 키맵 context를 다시 활성화하지 않는다. SQLrun의 같은 수정은 database-editor.js 소유자인 부모가 수행하며, 이 작업에서는 DB source를 수정하지 않았다.

`check_editor_commands.mjs`는 각 chord에 root/Input-depth 별칭이 모두 있고 같은 action을 사용하는지 확인한다. 기존 보호 검사와 `check_editable_code.mjs`는 모두 통과했다. 이 자동 검사만으로 native 실제 우선순위를 합성했다고 보고하지 않는다. 부모가 실제 Cmd+S/SQL Cmd+Enter/Preview/사용자 재할당/IME를 다시 확인해야 한다. 설치나 사용자 keymap 변경은 수행하지 않았다.

## 후속 native 실패와 조사 중지

부모의 후속 실제 UI 검증에서 SQL source를 좌표로 클릭한 뒤 Cmd+A가 `herdr-editor-input::select-all failed unknown command` toast를 발생시켰고, Cmd+S/SQL Cmd+Enter도 정상 동작하지 않았다. 따라서 Input-depth 별칭 추가와 VM PASS만으로 이 경로가 해결됐다고 판정할 수 없다. 이 후속 조사에서는 source를 수정하지 않았다.

읽기 전용으로 확인한 추가 근거는 다음과 같다.

- 공개 Herdr `src/window.rs:4737` 계열의 최상위 ShellAction handler는 남은 action을 run_action으로 보낸다. custom action 이름의 unknown-command toast는 binding 선택 이후 action이 앱 fallback까지 도달했다는 근거다. 단순히 binding이 전혀 매칭되지 않았다는 설명과는 다르다.
- 공개 gpui-kit `materialize.rs:1914–1935` 계열은 plain wrapper에 한 ShellAction listener를 만들고 id별 callback을 찾으며 미일치 action만 propagate한다. native Textarea는 자신의 state focus handle로 focus를 받는다. 실제 binding match와 wrapper callback의 소비 여부는 별도 확인이 필요하다.
- `engine/quickjs/mod.rs:4291` 계열 dispatch_simple_event는 superseded/released callback을 실행하지 않지만, 이 사실만으로 이번 toast 원인을 확정할 수 없다. EditorInput/EditorCommands의 pending/alive guard도 propagate할 수 있으므로 callback 진입·guard 결과·실제 focus path를 구분해야 한다.

정확한 원인은 확정하지 않았다. 부모에게 사용자 원문 없이 action id·handler 진입·alive/pending/resetting만 관찰하는 독립 probe로 두 경계를 분리할 필요를 전달했다. id/track_focus 추가나 더 깊은 context만으로 해결된다고 제안하지 않았다.

이후 사용자가 기존 내부 UI/logic을 재사용하지 않고 승인 데모를 기준으로 영역별 새 구현을 지시하여, 부모 요청에 따라 이 shortcut 조사를 중지했다. 추가 source·설정·키맵·설치·CUA 변경은 수행하지 않았다. 기존 T33 native 경로는 미해결 기록으로 남기며 새 구현의 성공 근거로 재사용하지 않는다.

## 재시작 후 실제 실패 재현

Input-depth 별칭만으로 해결됐다고 판정하지 않는다. 재시작 뒤 시험 SQLite SQLBuffer의 원문을 좌표로 클릭하고 Cmd+A를 입력하자 `herdr-editor-input::select-all failed / unknown command` 알림이 나타났다. Cmd+S와 Cmd+Enter도 아직 성공하지 않았다. AX text field 클릭은 문서 포커스를 확실히 주지 않았고 붙여넣기만으로는 선택/단축키 성공을 판단할 수 없었다. 명령 바인딩 선택과 실제 wrapper action 전달 경계를 다시 조사한다. 이후 Mac 잠금으로 native 입력 프로브 검증은 일시 중단됐다.
