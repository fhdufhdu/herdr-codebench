# T25 모드 전용 native 입력 경계

2026-11-06. 상태: 컴포넌트·독립 검사 구현 / 실제 IME·키 우선순위 검증 대기. 지정 effort medium 유지. Herdr 본체·기본 editor routing·설치본을 수정하지 않았고 CUA를 사용하지 않았다.

## 공개 계약

`mods/codenav/editor-input.js`의 `EditorInput`은 짧은 TextareaState 하나와 wrapper focus handle 하나만 소유한다.

```js
const input = new EditorInput();
input.init(cx, {
  onCommit(text, eventCx) { /* 문서 owner가 현재 선택 범위를 text로 교체 */ },
  onCommand(command, eventCx) { /* 문서 owner가 이동/삭제/undo 등을 처리 */ },
});
input.render(cx, { id: "source-input", font: "monospace", size: 13, width: 120, height: 24 });
input.focus();
input.pending();     // true = native 값이 비어 있지 않음. marked 상태 확정이 아니다.
input.pendingText(); // 현재 native pending 문자열. 문서 원문/선택의 소유자가 아니다.
input.release();
```

두 callback은 필수다. onCommit이 정상 반환하면 native 값을 guard 안에서 비운다. false를 반환하거나 예외가 발생하면 값은 남겨 입력을 잃지 않게 한다. callback이 component를 release한 경우 released state를 다시 만지지 않는다. readonly 문서는 부모가 sink를 표시/포커스하지 않는 등 문서 owner 경계에서 제어해야 한다.

문서·문서 caret/anchor/head·선택·undo/redo는 이 컴포넌트에 없다. 문서 pointer handler도 등록하지 않는다. 부모가 문서 pointer hit testing과 선택을 소유하고 이 짧은 native 입력부를 문서 caret에 배치한다. native pending 값만 폭 계산에 사용할 수 있다.

명령은 문자열이다: `move-left/right/up/down/home/end/pageup/pagedown`, 같은 방향의 `select-*`, `delete-backward/forward`, `word-left/right`, `select-word-left/right`, `delete-word-backward/forward`, `enter`, `indent`, `outdent`, `undo`, `redo`, `select-all`, `copy`, `cut`. 부모의 EditorBuffer API로 변환한다. Save/Preview는 후속 EditorCommands의 유효 사용자 키맵 경로로 분리했다. paste는 별도 custom binding을 만들지 않아 native clipboard 입력이 Change를 통해 문자열 그대로 전달되게 한다. 글자 입력을 key_char로 재구성하지 않는다.

## 구현과 IME 경계

init에서 TextareaState.new({value:"",rows:1}), set_rows(1), set_auto_grow(1,1), set_soft_wrap(false)를 호출한다. native Change에서 값 전체를 onCommit으로 전달하고 accepted callback 뒤에만 reset한다. set_value가 change를 다시 발생시켜도 resetting guard가 중복 commit을 막는다.

명령 binding은 application keymap에 설치하지만 context를 `HerdrEditorInput > Input`로 제한한다. 같은 module 내 여러 instance는 한번만 bind한다. wrapper는 plain div + track_focus + key_context + on_action을 사용한다. pending 중 custom action을 받으면 cx.propagate만 하고 문서 command나 reset을 실행하지 않는다. key-up redraw 후 pending 값이 있으면 wrapper context를 HerdrEditorPreedit로 바꾸어 문서 binding을 제외한다. native IME candidate·preedit 표시는 Textarea가 담당한다.

이는 **native Input보다 custom 명령이 실제로 먼저 선택되는지, pending일 때 propagate가 원래 native 동작까지 이어지는지의 증명은 아니다.** parent의 실제 키 입력 검증이 필요하다. 특히 preedit가 시작된 직후 아직 key-up redraw가 오기 전의 명령과, OS 후보창에서의 Enter/Arrow/Escape를 별도로 확인해야 한다.

## API·공개 source 근거

- 설치된 `~/.config/herdr-app/gpui-kit.d.ts:21399`의 TextareaState는 value/set_value/on/change/focus/release·rows/auto-grow/soft-wrap을 제공한다. marked range/composing getter나 composition event는 공개하지 않는다. 따라서 pending()은 값 유무의 보수적 신호이며 ‘조합 중’을 정확히 판정했다고 주장하지 않는다.
- 같은 d.ts:301의 cx.bind_keys, :806 on_action, :816 key_context와 focus handle을 사용했다. wrapper에만 key handlers를 설치하며 native Textarea 자체에 unsupported handler를 붙이지 않는다.
- 읽기 전용 공개 source `/tmp/herdr-mod-editor-source-cfcf8364/vendor/gpui-kit/crates/base/src/input/base/state.rs:4380`의 replace_and_mark_text_in_range는 marked/preedit를 갱신하지만 Change를 emit하지 않는다. replace_text_in_range는 :4373에서 Change를 emit한다. 이것이 commit 시에만 sink를 비우는 설계의 근거다.
- 같은 source :4352는 replace_text commit에서 ime_marked_range를 먼저 제거하고 :4373에서 Change를 emit한다. 인접 주석은 macOS insertText 확정이 unmarkText 없이 올 수 있어 여기서 composition transaction을 종료한다고 명시한다. 이 source에서 commit reset은 marked 상태가 끝난 뒤 수행하는 구조다. :4131의 unmark_text 자체는 Change를 emit하지 않으므로 OS가 replace_text 없이 unmark만 사용하는 다른 경로는 실제 UI에서 확인해야 한다. 공개 source와 설치 binary의 정확한 동일성은 확인하지 않았으며 이벤트를 추정해 성공 처리하지 않는다.

## 저장한 검증과 실행 결과

```sh
node --check mods/codenav/editor-input.js
node --experimental-vm-modules design/idea/check_editor_input.mjs
python3 design/idea/make_editor_input_fixture.py --check
```

모두 통과했다.

`check_editor_input.mjs`는 실제 컴포넌트 module을 실행하며 native host만 대역으로 바꾼다. 한글 preedit가 Change를 emit하지 않는 이벤트 모델에서 여러 preedit update 중 commit/reset 0회, 확정 한글 commit 1회, emoji/family ZWJ·CRLF·tab을 포함한 multiline paste 문자열 보존, reset 재진입 방지, pending action의 문서 이동 거절/propagate, 문서 명령이 native 값을 변경하지 않음, 문서 pointer 소유 없음, callback false/예외/도중 release의 유실 방지, native state/focus handle 해제를 확인한다. 이 검사는 OS IME를 합성한 것이 아니다.

`make_editor_input_fixture.py`는 standalone temp mod를 생성하며 설치하지 않는다. empty / `set_value("ㅎ🙂")` pending / native `replace("한글🙂\\n둘째 줄")`의 세 실제 native init/render를 `herdr-app check`로 검사한다. context predicate 문법, bind_keys와 native Textarea/handler/focus API가 설치 runtime에서 허용됨을 확인했다. **실키 우선순위·OS IME commit·native replace의 최종 callback 흐름까지 eager pass만으로 검증했다고 주장하지 않는다.** fixture는 문서/commits/commands/pending 텍스트를 화면에 보여 parent UI 검사에도 사용할 수 있다.

마지막 fixture 출력 경로는 `/var/folders/pd/b2x6km0n1595w41vbl3_8jgh0000gn/T/codebench-editor-input-4_u5sqff`다. `empty` 하위 mod가 수동 IME probe다. 실행마다 새 임시 경로를 출력한다.

## 부모 실제 UI 검증 항목

1. 한글 ‘ㅎ→하→한→한글’ 조합 도중 문서 mutation/reset이 없고 확정 뒤 정확히 한 번 들어오는지 확인한다. Space·Enter·후보 클릭·focus 이동 확정을 각각 확인한다.
2. preedit 중 Arrow/Backspace/Enter/Escape가 native IME에 전달되고 문서 caret/undo를 조기에 바꾸지 않는지 확인한다. unmark-only commit 가능성을 관찰한다.
3. 조합이 없는 Arrow/Delete/Enter/Undo/Redo가 빈 native 버퍼의 caret/history 대신 문서 owner에 정확히 한 번 도달하는지 확인한다.
4. multiline paste·emoji/ZWJ·선택 교체가 문서의 단일 변경으로 반영되는지 확인한다. copy/cut은 문서 selection을 사용하고 paste는 native 경계를 거치는지 확인한다.
5. prefix / visible native preedit / suffix 조합에서 OS 후보창 위치·폰트·폭·줄 높이·focus를 확인한다. native 입력부의 pointer가 문서 caret의 별도 소유자가 되지 않도록 부모 hit testing을 점검한다.

검증 전에는 기존 source/native 편집 경로를 이 컴포넌트로 기본 대체하지 않는다. 실제 사용자 서버·파일·공유 저장소에 입력 원문을 기록하지 않았다.

## inline 장식·플랫폼 키 보완

부모 통합 요청에 따라 render 기본 폭을 2px로 바꾸고 wrapper와 Textarea에 공개 SDK의 p(0), border(0), rounded(0), transparent bg, min_w(0), min_h(0), 동일 font/text_size/line_height(height)를 명시했다. native state나 문서 selection은 이 스타일 변경으로 수정하지 않는다. 한글 preedit의 실제 폭은 부모가 pendingText와 문서 font geometry에 맞춰 width로 전달한다. 입력부가 임의의 Unicode 글자 수로 문서 caret 폭을 추정하지 않는다.

실제 플랫폼은 init 시 `herdr.window()?.platform`에서 읽는다. macOS는 Cmd 편집 단축키·Alt 단어 이동/삭제를 사용한다. Cmd-left/right는 move-home/end, Cmd-up/down은 move-doc-start/end이고 shift 선택을 함께 제공한다. Ctrl-A/E는 macOS의 line start/end에 대응하며 select-all로 처리하지 않는다. Ctrl-K/C/X/S/Z/Y/Left를 Cmd와 동일하게 묶지 않는다. Windows/Linux는 Ctrl 편집·Ctrl 단어 이동/삭제·Ctrl-home/end 문서 경계를 사용하고 Cmd 편집은 설치하지 않는다. window가 없는 headless 상황에서는 공통 방향키 등의 binding만 사용하고 플랫폼 modifier 의미를 추정하지 않는다.

추가 공개 명령은 `move-doc-start`, `move-doc-end`, `select-doc-start`, `select-doc-end`다. 부모가 기존 buffer.move('doc-start'/'doc-end', {extend})로 연결할 수 있다. `EDITOR_INPUT_BINDINGS`는 플랫폼 공통 목록이며 `editorInputBindings(platform)`이 실제 플랫폼별 frozen 목록을 반환한다. 설치 여부는 플랫폼별로 기억해 headless 생성 뒤 실제 플랫폼이 확인되는 경우도 잘못된 modifier로 고정하지 않는다.

검사에 macOS/Windows/Linux/unknown 매핑, Ctrl/Meta 의미 분리, native/wrapper 장식 제거 인자, 2px empty/52px 한글 pending 값을 추가했다. native fixture는 실제 2px empty·64px 한글/emoji 값·360px multiline replace 세 상태의 API init/render를 확인했다. VM 검사와 native eager 세 사례 모두 재통과했다. 공개 스타일 인자가 native 내부 paint에서도 기대한 정렬을 만드는지, 특히 좁은 caret 폭·IME 후보 위치·조합 폭은 부모의 실제 화면 검증 사항으로 남는다. 앱 본체·editable-code.js·code.js·설치본과 CUA를 변경하지 않았다.

## 실제 한글·글꼴 후속 수정

사용자가 보고한 preedit 미표시, 글자 끝 잘림, 첫 프레임 잘림을 단계별로 수정했다. native Textarea는 marked text를 직접 표시하고 commit 뒤에만 sink를 비운다. native line_height는 숫자가 font 배수이므로 행 높이를 `${height}px`로 명시했다. native TextElement의 RIGHT_MARGIN=10px를 고려한 12px clearance와 문서 caret advance를 분리했다. 빈 상태부터 native viewport를 넉넉히 예약하여 첫 marked event가 script redraw보다 먼저 그려져도 2px 폭에 잘리지 않게 했다.

preedit text/font/size/height가 바뀌면 동일한 native text를 offscreen 실측한다. 실측 결과는 문서상 inline advance에 사용하며 미리 확보한 native viewport를 뒤늦게 축소하지 않는다. 사용자는 최종본을 직접 입력하고 ‘아 잘된다’고 확인했다. 부모도 실제 Herdr 실험 창의 JetBrains Mono14와 Helvetica21에서, 특히 Helvetica21 물리 키 d→k→s의 밑줄 있는 ㅇ→아→안을 관찰했다. 이는 production 통합의 Save 키 우선순위나 모든 OS/임의 글꼴 검증을 의미하지 않는다.
