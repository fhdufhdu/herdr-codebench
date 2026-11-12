# T44 ADE 문서·선택·OS 입력 통합

새 CodeInput과 CodeMirror 순수 문서 모델로 ADE source UI·입력·선택·history와 LSP 위치를 한 owner에 연결한다. 기존 EditableCode/controller/editor-input을 복사·상속·import하지 않는다. vendor library만 canonical `design/editor/build.mjs --mod ade`로 생성한다.

- 공개 API: init(text,cx,{onChange,onSelection,onSave,readOnly}), value(), selection() UTF16 anchor/head/start/end, revision, transaction(from,to,insert,cx), setSelection(range,cx), focus(), release(), render(cx).
- OS 텍스트는 native TextareaState의 committed change로만 수신한다. key_char로 typed text를 재구성하지 않는다. native preedit 동안 문서나 입력부를 초기화하지 않는다. 입력 viewport는 첫 조합부터 미리 확보하고 native 조합 텍스트의 측정 폭과 clearance를 반영한다.
- CodeMirror Text/ChangeSet/EditorSelection과 grapheme segmentation을 사용한다. 자체 선택·navigation·transaction/undo-redo·clipboard를 source UI와 동일 state로 처리한다. native grapheme hitboxes가 필요한 source는 ordinary render의 bounded 행 window를 사용한다. native deferred list callback은 handler 등록을 금지하므로 source handler를 그 안에서 생성하지 않는다.
- root가 같은 문서의 text/revision/selection을 LSP에 연결한다. syntax spans는 같은 source renderer에 적용한다. 설치·실제 Korean IME/selection/undo/Markdown 왕복은 root가 수행한다.
- 파일 범위: code-input.js, code-document.js, generated vendor, text-editor.js 교체 부분, canonical vendor build의 선택적 --mod 지원, 관련 검사·결과. effort medium 유지.
