# T28 Save/Preview command 전달 경계 조사

2026-11-06. 현재 자체 편집기의 문서 owner는 codenav EditableCode이며, 사용자 keymap의 action 식별자 `activity.save`/`activity.preview`를 보존해야 한다. 앱 본체·사용자 keyfile·파일/terminal에는 변경하지 않았다. 아래 결론은 공개 runtime 선언과 읽기 가능한 command 전달 source에 근거한다.

## 현재 문제

`mods/activity/editor.js:49–58`의 forwarding은 **그 editor copy가 shown일 때만** 명령을 받는다. idea에서 editor-code가 활성화되면 editor-text의 Activity copy는 hidden이므로 이 forwarding만으로 Save/Preview를 전달할 수 없다. files/search도 닫으면 shown Activity가 하나도 없을 수 있다(`layouts/idea.json:118`, `:152`, `:317`).

공개 source `/tmp/herdr-mod-editor-source-cfcf8364/src/mods.rs:668–680`의 `send_command`는 mod 이름이 맞는 copy 중 SHOWN_COPIES에 포함된 copy에만 broadcast한다. `:685–693`의 단일 copy 전달도 hidden copy를 거부한다. 설치 `herdr.d.ts:396–402`의 nextCommand는 command 문자열만 제공하며 global command id나 copy id를 공개하지 않는다. 이는 hidden copy에서 poll loop가 살아 있더라도 전달받지 못한다는 뜻이다.

## wrapper 중계의 가능 범위와 한계

Activity.main에 두 번째 nextCommand loop를 추가하면 기존 Files/Bar/EditorPane의 loop와 같은 copy queue를 경쟁 소비한다. 대상은 `mods/activity/files.js:72–85`, `bar.js:11–24`, `editor.js:49–59`다. wrapper와 child가 어느 명령을 먼저 가져갈지 의존하는 구현은 허용할 수 없다.

경쟁 자체는 wrapper가 제공한 `p.nextCommand`를 child가 기존 단일 loop에서 사용하도록 위임하면 피할 수 있다. 그러나 이는 전달 경계 두 개를 해결하지 못한다.

1. shown Activity copy가0이면 relay가 명령을 받지 못한다.
2. 여러 shown copy가 동일 command를 받으면 relay가 여러 번 실행될 수 있다. 공개 command event id가 없어 안전한 broadcast dedupe가 불가능하다. time bucket이나 owner session+command만으로 dedupe하면 연속 Save/Preview 사용자 입력을 누락시킬 수 있다. 특히 Preview는 toggle이라 중복 실행 시 원래 상태로 되돌아갈 수 있다.

현재 SDK 정보만으로는 wrapper를 추가하는 것만으로 ‘항상 정확히 한 번 전달’을 보장하지 못한다. 이 불완전한 중계를 완료된 해결책으로 설치하지 않았다. Activity child들의 기존 loop도 아직 변경하지 않았다.

## 확인해야 할 대안

- **현재 focus를 가진 custom editor의 유효 keymap context bridge:** 키를 Cmd+S로 고정하지 않고 실제 keys()의 activity.save/activity.preview 할당을 따라야 한다. 사용자 재할당/삭제 때 이전 scoped binding이 남아 새 할당을 가로채지 않는지 검증해야 한다. 공개 `cx.bind_keys`는 binding 설치 API이고 대응하는 제거 API는 확인되지 않았다. stale binding의 action에서 propagate할 때 다음 유효 native binding/기본 입력으로 이어지는지를 실제 host에서 검증하기 전에는 이 방식도 완료로 판정할 수 없다.
- **항상 shown인 유일 relay copy를 layout에 보장:** global command를 받을 owner가 실제로 항상 보이도록 구조 계약을 바꾸어야 한다. 단순 main wrapper 수정 범위 밖이며 현재 task에서 layout을 수정하지 않았다.
- **host의 command alias/interception:** 현재 mod SDK에는 활동하지 않는 mod namespace의 command를 다른 mod가 구독하는 공개 API가 확인되지 않는다. 앱 본체 변경 금지 조건에서 가정하여 호출하지 않는다.

owner 확인에는 `activity.editorState[slot]`의 owner/session/path와 현재 문서의 identity를 사용해야 한다. stale metadata나 다른 workspace/path의 owner로 command를 보내면 안 된다. database spec의 Save도 활성 SQLBuffer 문서로 연결돼야 하며 Preview는 markdown capability가 있을 때만 동작해야 한다.

부모에게 shown0·broadcast중복·queue경쟁의 세 경계와 대안을 전달했다. 부모가 focused input bridge 또는 항상 shown relay의 실제 지원 경로를 확정한 뒤 해당 경로의 회귀 검사를 추가해야 한다. 기존 hidden-editor forwarding만으로 문제를 해결했다고 보고하지 않는다.

## 후속 구현: focused-input effective-keymap bridge

부모가 focused-input 방식을 선택하여 `mods/codenav/editor-commands.js`의 EditorCommands를 구현했다. Activity.main의 loop는 추가하지 않았다. activity/editor.js의 임시 codenav forwarding만 제거하고 native editor 자신의 Save/Preview 처리와 기존 codebench 동작을 유지했다.

EditorCommands는 `keys()`와 실제 `effectiveShortcuts('activity.save'/'activity.preview', bindings, {layout:'idea',mod:'codenav'})`를 사용한다. 기본 Cmd+S나 Preview shortcut을 별도로 가정하지 않는다. normalization은 기존 normalizeChord를 재사용하며 Ctrl/Meta 구분, ASCII shifted key, 다중 stroke sequence를 그대로 유지한다.

현재 effective command/chord 목록 전체를 정확하게 hex encoding하여 고유 key_context token으로 사용한다. hash collision이나 시간 bucket에 의존하지 않는다. binding predicate는 `<keyset token> > HerdrEditorInput > Input`이다. 사용자 keymap이 바뀌면 render에서 즉시 새 token을 광고하므로 제거/재할당된 옛 app binding은 더 이상 이 wrapper와 매칭되지 않는다. 새 bind_keys는 render에서 호출하지 않고 timer.after(0)에서 수행하며, 최신 token만 설치하고 release된 작업은 취소한다. event handler도 실행 직전 최신 keymap을 확인하여 오래된 render handler에서 잘못된 명령이 실행되지 않게 한다.

명령 action id에는 save/preview와 해당 chord의 식별값이 들어간다. focus를 가진 input wrapper만 callback을 실행하므로 shown activity broadcast·copy별 전역 relay·시간 기반 dedupe가 필요 없다. native pending text가 있으면 문서 명령을 실행하지 않고 propagate한다. 일반 callback이 처리하면 stop_propagation한다. callback이 false를 반환하면 명시적으로 전파한다.

### 부모 연결 계약

```js
import { EditorCommands } from './editor-commands.js';

// EditableCode.init에서 실제 EditorInput 생성 후:
this.commandKeys = new EditorCommands();
this.commandKeys.init(cx, {
  onCommand: (command, _event, eventCx) =>
    this.command(command === 'preview' ? 'rich-view' : 'save', eventCx),
  pending: () => this.input.pending(),
});

// inlineCaret가 생성한 input element만 감싼다.
const element = this.commandKeys.render(this.input.render(cx, inputOptions), cx);

// release:
this.commandKeys.release();
```

wrapper는 plain div().flex().flex_none()이며 width/height/size_full을 지정하지 않는다. native input의 작은 caret/IME viewport를 행 전체 크기로 바꾸지 않는다. SQL의 바깥 HerdrSqlEditor context도 별도 ancestor로 유지할 수 있다. 이 bridge는 input focus에만 적용한다. rich preview 등 input 밖의 UI action alias와 실제 owning document/session의 연결은 부모가 별도로 처리한다. bind_keys 실패는 bridge.error에 남기며 old context로 되돌아가 잘못된 key를 실행하지 않는다.

### 후속 검증

`design/idea/check_editor_commands.mjs`는 production bridge와 실제 action/keymap resolver를 함께 로드하여 다음을 검증했다.

- 빈/삭제된 keymap에 hardcoded shortcut이 생기지 않음.
- Ctrl/Meta/shift normalization·sequence·global/layout/mod 우선순위, 다른 action으로 재할당된 chord 미가로채기.
- render 중 bind 금지, 즉시 context 교체, deferred 설치의 최신 요청만 반영, stable render의 app keymap churn 없음.
- 오래된 event handler의 재확인·IME pending 전파·release 취소·focused callback 1회 실행.
- 자연 크기 wrapper에 w/h/size_full 추가 없음.

다음 검사가 통과했다.

```sh
node --experimental-vm-modules design/idea/check_editor_commands.mjs
node --experimental-vm-modules design/idea/check_editor_context.mjs
node --check mods/codenav/editor-commands.js
node --check mods/activity/editor.js
git diff --check -- mods/codenav/editor-commands.js mods/activity/editor.js design/idea/check_editor_commands.mjs
```

또한 production EditorCommands/EditorInput/actions만 복사한 임시 synthetic mod를 실제 `herdr-app check`에서 init/render/release하여 통과했다. fixture는 성공 후 삭제했다. 이 eager check도 native key-context specificity·실제 sequence dispatch·IME와 global action fallback을 사용자 키 입력으로 검증한 것은 아니다. 부모의 실제 UI 검증이 필요하다. 사용자 keyfile·터미널·문서·설치는 변경하지 않았다.
