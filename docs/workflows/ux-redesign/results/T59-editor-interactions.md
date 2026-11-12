# T59 기본 편집 조작·찾기/치환

2026-11-09. CodeInput/CodeDocument와 입력 검사를 확장했다. 기존 controller를 복사하거나 text-editor/LSP owner를 수정하지 않았다. 기존 CodeMirror Text/ChangeSet/EditorSelection과 grapheme library를 재사용한다.

## 지원하는 조작

- native MouseButtonEvent.click_count(설치 d.ts :494)의 2를 사용한 단어 선택, 3 또는 줄 번호 클릭의 줄 선택. word/line drag는 같은 단위로 확장한다. 단어는 Unicode 문자·숫자·mark·underscore/dollar 식별자이며 punctuation/emoji는 grapheme 하나다.
- 기본 arrow/Home/End/Page, shift 선택, Mac Cmd 문서/줄 시작·끝, Option 단어 이동·선택·삭제. 다른 OS는 Ctrl 단어 이동·선택·삭제를 사용한다. Mac Control A/E와 Cmd의 의미를 구분한다.
- select all, copy/cut/paste, undo/redo, Backspace/Delete, Mac Cmd Backspace/Delete의 줄 처음/끝까지 삭제. readonly source도 wrapper focus에서 선택/복사/이동을 지원한다.
- Tab은 caret에 tab을 삽입하거나 선택에 걸친 줄을 한 번에 들여쓴다. ShiftTab은 tab 또는 최대 네 leading spaces를 내어쓴다. 여러 줄 변경도 단일 ChangeSet/history transaction이다. Enter는 앞선 leading whitespace를 이어받는다. CRLF를 중간에서 나누지 않는다.

OS IME pending 값이 있으면 pointer 선택·navigation/context callback·문서 편집 command를 실행하지 않는다. typed text를 key_char로 재조립하지 않는다.

## 찾기·치환

감사 당시 찾기/치환은 없었고 vendored dependency는 @codemirror/state뿐이었다. 필요한 literal 검색은 작은 native bar와 기존 Text/ChangeSet으로 구현했다. DOM search/view dependency는 추가하지 않았다.

Find는 CmdF/CtrlF, Replace는 effective keymap의 Mac CmdR 및 다른 OS CtrlH다. macOS CmdH 시스템 Hide는 보존한다. Cmd/Ctrl G와 Shift G, 검색 필드 Enter/ShiftEnter로 다음/이전 결과를 순환한다. Aa는 대소문자 구분이다. query는 literal로 escape하고 Unicode regex match의 원래 UTF16 offset을 사용하며 선택·치환 범위는 grapheme 경계에 맞는 결과만 받는다.

현재 결과 바꾸기와 모두 바꾸기를 제공한다. replacement의 dollar 문자를 특수 replacement expression으로 해석하지 않는다. 전체 치환은 한 번의 undo로 복구한다. 동일 원문으로 치환하는 작업은 불필요한 revision을 만들지 않는다. readonly는 Find만 지원한다. 검색어·치환어·결과는 native view local state이며 shared에 저장하지 않는다.

Find 입력은 source key context의 sibling이므로 query의 CmdA/Tab/typing이 문서를 변경하지 않는다. 검색/치환 bar는 최소 field 폭과 wrapping을 사용하며 editor resize에 맞춰 source viewport를 다시 측정한다. focus와 InputState는 init에서 만들고 release한다.

## Owner 경계

Cmd(macOS)/Ctrl(다른 OS) 클릭은 onNavigate({kind:"definition",offset,revision},eventCx) descriptor만 보낸다. 우클릭은 selection을 정확한 glyph offset에 맞춘 뒤 onContextMenu({offset,revision,position:{x,y}},eventCx)를 보낸다. 모두 pending IME를 보호한다. definition/references fallback, popup, 언어 서버 요청은 T60의 text-editor owner가 담당한다.

현재 범위에 없는 기능은 regex/whole-word 검색, multiple cursor, language-aware indentation/format/auto-pair다. LSP completion capability와 navigation menu는 별도 owner 작업이다. 자연어 단어 분할을 위한 별도 parser를 넣지 않았다.

## 검증

`node --experimental-vm-modules design/idea/check_ade_code_input.mjs` 통과: Unicode/combining/ZWJ word selection, punctuation, word drag, 줄 선택, platform modifier, pending pointer guard, descriptor offset/revision/position, readonly copy, 단어 삭제, multiline indent 단일 undo, CRLF 이동/삭제/Enter, literal 검색/대소문자/양방향 wrap, 입력과 문서 상태 분리, replacement literal, 전체 치환 atomic undo를 확인했다.

`make_ade_source_probe.mjs --interactions` 및 `--find`가 독립 native 상태를 생성한다. 실제로 find/replace bar와 query가 열린 fixture의 `herdr-app check` 및 전체 ADE check가 통과했다. native eager check는 OS 더블클릭·실제 키 우선순위·화면 resize/focus 검증을 대신하지 않는다. 설치/CUA는 root 담당이며 이 하위 작업에서 수행하지 않았다.
