# T44 ADE 문서·선택·OS 입력 통합 결과

2026-11-06. 새 CodeDocument/CodeInput을 작성하고 EditorSurface source를 연결했다. 기존 EditableCode/controller/editor-input을 import·복사·상속하지 않았다. canonical `design/editor/build.mjs --mod ade`로 생성한 CodeMirror Text/ChangeSet/EditorSelection과 unicode-segmenter를 사용한다.

## 한 소유자

CodeDocument가 immutable 문서 tree, grapheme 경계 UTF16 selection, revision, transaction, undo/redo를 소유한다. CRLF·emoji/ZWJ·combining 문자열을 보존한다. source renderer, pointer 선택, arrow/Home/End/PageUp/PageDown, shift 확장, Enter/Tab/delete, clipboard가 같은 문서를 사용한다. macOS Cmd와 Ctrl의 의미를 명시적으로 구분한다.

공개 API는 init(text,cx,{onChange,onSelection,onSave,onExecute,readOnly}), value(), selection() `{anchor,head,start,end}`, revision getter, transaction(from,to,text,cx), setSelection(range,cx), focus(), reveal(), release(), render(cx)다. setSelection/reveal은 살아 있는 입력의 native 표시 범위도 갱신한다. syntax spans `tokens=[{from,to,color}]`, diagnostics `[{from,to,severity,message}]`는 동일 glyph에 적용된다. 진단은 semantic severity underline과 그룹별 selectable hover text를 제공한다. 편집은 이전 revision의 decoration을 지운 뒤 새 snapshot callback을 보낸다. onExecute가 있는 SQL 입력만 별도 context에서 CmdEnter/CtrlEnter를 처리하며 pending native text가 있으면 실행하지 않는다. 일반 파일의 CmdEnter binding을 바꾸지 않는다.

## 실제 표시와 위치 이동

행은 측정된 viewport에 들어가는 수만 ordinary render에서 만든다. 큰 파일도 전체 행의 native element를 만들지 않는다. wheel/이전·다음은 표시할 native 행 window를 이동하며, selection/arrow/Page 이동은 자신의 caret이 window 밖이면 표시 범위를 갱신한다. native horizontal scrolling과 각 glyph의 실제 bounds/local x를 사용하므로 Unicode 포인터 위치를 문자 개수로 추정하지 않는다. 행·열·폰트 측정 callback도 ordinary render에서 등록한다.

이 경로를 선택한 이유는 설치 d.ts :21235의 deferred renderer 계약이다. native virtual/list callback 안에서는 on_click/on_size_change 등 handler 등록이 금지되고 throw한다. source row의 glyph hitbox와 IME/input은 이 handler가 필요하다. 이전 blank는 이 계약을 놓친 구현 오류였으며, sizing 추측만으로 해결됐다고 볼 수 없다. source에서 native deferred list와 임시 virtualRows flag는 제거했다. 일반 native overflow에는 programmatic offset API가 없으므로 그 동작을 가장하지도 않는다.

root가 300행 실제 native probe에서 다음을 확인했다.

- 초기 1–18행 표시: `/tmp/ade-source-probe-crop.png`.
- CmdDown 뒤 283–300행과 caret300 표시: `/tmp/ade-source-end-crop.png`.
- CmdUp+Down 뒤 caret2, wheel 뒤 표시60–77/caret2 유지: `/tmp/ade-source-wheel-crop.png`.

이는 실제 paint·window 이동 증거이며 eager check만의 통과가 아니다. 재현용 `design/idea/make_ade_source_probe.mjs`는 public source만 임시 폴더에 복사하고 설치하지 않는다.

## OS 입력·설정

TextareaState는 OS text/IME boundary다. committed change 문자열 전체를 문서 transaction으로 삽입한 뒤 reentrancy guard 안에서 비운다. key_char로 typed text를 재구성하지 않는다. native pending 중 문서 명령을 실행하지 않는다. public composing getter가 없으므로 pending 값은 보수적 신호다. pending Save는 commit이 문서에 반영된 뒤 실행하며, 마지막 조합 음절 없이 clean으로 만들지 않는다.

source caret의 native input은 처음부터 최소128px 또는 fontSize 네 글자+12px의 폭과 충분한 px 행 높이를 가진다. pending 폭은 같은 폰트의 native element로 측정한다. ADE editorFont/editorSize가 global font_family/font_size보다 우선하며 size는8–40이다. 폰트 변경은 native 폭 측정만 초기화하고 pending text·문서·selection·revision을 보존한다. 표시 밖 caret의 입력 state도 mount를 유지하고 입력/이동 시 해당 caret을 다시 표시한다.

root는 앞선 eager native renderer에서 첫 ㅇ→아→안의 잘림 없음, 단계별 AX settle을 둔 연속 안녕하세요, CmdA/paste/save 실제 파일 쓰기를 확인했다. bounded renderer에서도 같은 OS boundary를 사용하지만 배치 설치 후 IME와 wheel 뒤 재입력 focus를 다시 확인해야 한다.

## 검사

- `check_ade_code_input.mjs`: Unicode selection/history/CRLF, native commit 단일 삽입/reset 재진입, pending Save의 최종 문자열, clipboard/키 의미, semantic diagnostic grouping, preference/측정 초기화, 1000행의 bounded native row 수, 위치 이동과 wheel 뒤 arrow reveal, release 통과.
- `check_ade_editor.mjs`: 파일 identity/read/CAS/dirty/remote/release 회귀 통과. surface 검사에서는 adapter를 mock하며 위 입력 검사가 실제 모듈을 실행한다.
- codenav 기본 및 ADE vendor `--check` 통과. `herdr-app check`와 source probe check 통과. native checks가 실제 키/paint 검증을 대신한다고 주장하지 않는다.
