# T62 자동완성·서식 입력 경계

2026-11-09. CodeInput/CodeDocument에 서버 편집을 적용할 atomic API를 추가했다. engine/LSP 요청·completion UI는 별도 owner가 담당한다.

`CodeInput.applyEdits(edits,cx,{expectedRevision,selection?})`와 model의 동명 메서드는 `[{from,to,insert}]` UTF16 edits를 받는다. expectedRevision은 필수다. 오래된 revision, 범위 밖/소수 offset, grapheme·surrogate·CRLF 중간, 잘못된 삽입 surrogate, overlap/동일 시작 edit를 변경 전에 거절한다. 입력 순서는 복사 후 정렬하며 원본 배열을 바꾸지 않는다. 선택은 최종 문서 좌표를 명시하거나 CodeMirror ChangeSet으로 매핑한다. server range/selection을 임의 clamp하지 않는다.

여러 primary/additional edits는 한 ChangeSet, revision, onChange, undo 작업이다. readonly·released·native pending에서는 false이며 문서를 바꾸지 않는다. 동일 원문 편집/빈 목록은 no-op이다.

init callback은 onComplete({offset,revision},cx), onFormat({revision},cx)다. CodeCompletion의 canonical CtrlSpace는 모든 플랫폼에서 Control을 유지한다. Reformat은 macOS CmdAltL, 다른 OS CtrlAltL이다. callback이 있는 source의 language context에만 연결하며 자동 trigger/snippet 처리는 추가하지 않았다.

`onCommand(command,cx)->true`는 completion list가 up/down/page/newline/tab/escape를 소비하면서 native input focus를 유지하는 경계다. pending IME 중에는 이 hook을 부르지 않으며 key_char 전달을 하지 않는다. popup 내용과 item 수명은 LSP owner가 보관한다.

줄 주석은 optional onToggleComment({revision,selection},cx)와 toggleLineComment(prefix,cx,{expectedRevision})를 제공한다. owner가 언어에 맞는 줄 prefix를 전달한다. indentation을 보존하고 선택 줄을 한 undo로 토글한다. canonical Cmd/ 또는 Ctrl/이며 지원하지 않는 언어를 추측하지 않는다.

공개 layout API에는 키보드 caret의 정확한 window rect와 native horizontal offset getter가 없다. completion descriptor에 추정 좌표를 넣지 않는다. 현재 popup owner는 확정된 editor bounds 안에서 panel을 배치한다.

검증: check_ade_code_input.mjs에서 main+additional batch/원본 순서 보존/한 undo, stale·overlap·Unicode·잘못된 selection 무변경, IME guard, callback descriptor, keymap, comment atomic undo, popup command consumption을 확인했다. UI/engine completion·format 실제 검증은 root 담당이며 설치/CUA는 수행하지 않았다.
