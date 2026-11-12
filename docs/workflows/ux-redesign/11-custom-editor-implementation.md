# 모드 전용 자체 편집기 구현

2026-11-06. 사용자 구현 지시와 후속 정정이 기준이다. **Herdr 앱 본체는 변경하지 않는다.** native Editor API 확장을 기다리는 경로를 제외하고, 모드가 문서·선택·undo·렌더링·LSP를 소유하는 편집기를 구현한다. native 다중행 입력은 OS 입력/IME를 전달하는 작은 입력부로 재사용한다. 이 입력부의 native caret가 문서 caret의 별도 소유자가 되지 않게 한다.

현재 단계는 실제 synthetic 문서에서 입력 경계를 먼저 검증하고, 통과한 기능을 실제 파일 편집기로 통합하는 것이다. 기존 source 뷰어·native 편집기·codebench 경로는 회귀 통과 전까지 보존한다. 앱 저장소는 공개 기능과 입력 동작 확인 용도로만 읽는다.

## 공통 계약

### 문서 모델

`mods/codenav/editor-buffer.js`의 `EditorBuffer`가 UTF-16 원문·anchor/head·revision·undo/redo를 소유한다. DOM 없는 `@codemirror/state`의 Text/ChangeSet/selection을 번들링해 재사용한다. 생성 vendor를 직접 수정하지 않으며 버전·license·빌드 명령을 저장한다. 한글/emoji의 surrogate를 가르는 범위는 거부하고 grapheme 이동에 검증된 라이브러리를 사용한다.

공개 표면: constructor(text), text/length/lineCount/revision/anchor/head/from/to/selectedText/readOnly getter, `line(number)`(0-based, `{from,to,text}`), `position(offset)`→`{line,col}`, `offset(line,col)`, `select(anchor,head=anchor)`, `replace(text,{group?})`, `apply(edits,{anchor?,head?,group?})`, `move(direction,{extend?,word?})`, `erase(direction,{word?})`, `undo()`, `redo()`. `apply`의 edits는 `{from,to,insert}`이며 같은 변경 전 문서의 좌표다. text 변경 때만 revision 증가. readonly는 선택/복사를 허용하고 mutation은 거부한다. 반환값은 변경 여부 boolean이다. 생성/사용 양쪽이 실제 계약 검사를 따른다.

### 입력 경계

native `TextareaState`를 짧은 committed-text/IME 입력부로 재사용한다. source의 marked text 단계가 실제 change 이벤트와 분리되는지, custom context binding이 이동/삭제/undo를 문서 owner로 전달하는지 실제 native fixture에서 확인한다. composition 중 값을 강제로 reset하거나 매 키 입력을 ASCII key_char로 대체하지 않는다. 입력부가 모르는 selection을 추정해 문서 caret로 쓰지 않는다.

입력 실험 결과가 불충분하면 기본 편집 경로로 활성화하지 않는다. 알려지지 않은 bridge/상태를 성공으로 하드코딩하지 않는다. UI 실제 조작은 부모가 단독으로 수행한다.

### 미저장 LSP

기존 engine와 HTTP 인증·서버 수명은 유지한다. `document_sync`/`document_close`에 문서 owner/revision/text의 명시적인 메모리 수명을 추가하고 semantic 요청은 해당 owner/revision을 사용한다. legacy saved-file 요청이 열린 편집 원문을 덮어쓰지 않게 하며 다른 owner가 같은 URI를 차지하면 명시적 충돌을 반환한다. stale/동일 version의 다른 text는 거부한다. 원격 path를 local LSP에 보내지 않는다. 미저장 내용은 디스크/shared.json에 저장하지 않는다.

진단은 LSP version과 현재 문서 version을 함께 확인하며 버전 없는 진단은 확인 수준을 응답에 드러낸다. 변경 뒤 이전 진단을 최신 진단으로 표시하지 않는다. 기존 disk 탐색의 응답 형식은 유지한다. 새 계약은 엔진 담당자가 문서로 구체화하고 부모 검토 후 UI와 연결한다. LSP stdio 시험은 기존 실제 child-process fake server를 확장한다. 별도 HTTP dependency simulation은 이 stdio 경계를 대신하지 못한다.

## 태스크와 소유

| 태스크 | 소유 | 완료 기준 |
| --- | --- | --- |
| T24 document model | editor-buffer.js, generated editor vendor, design/editor/, check_editor_buffer.mjs, 결과 문서 | 실제 모델 unicode/edit/undo/selection 검증, bundle은 DOM/Node 의존 없음 |
| T25 native 입력 실험 | editor-input.js, 독립 fixture/결과 문서 | init/release·IME/commit/키 context·pointer/포커스의 지원/미지원 근거. 앱 본체/기본 routing 수정 없음 |
| T26 buffer-aware LSP | engine의 LSP 관련 source/test, engine README, 결과 문서 | 미저장 text를 서버가 관측, disk 미변경, stale/owner/close/restart/UTF-16/진단 검증. 실제 사용자 서버/engine 교체 없음 |
| 부모 통합 | editable-code.js, code.js 최소 hook, routing/actions/등록·검증·설치 | synthetic 실제 입력 후 파일·저장·LSP·이동·Markdown·SQL 회귀. 지원하지 못한 부분은 명시 |

하위 작업은 확정 계약의 일반 구현으로 reasoning effort medium을 유지한다. 원인 불명확한 실제 입력 실패는 분석 근거를 모아 부모에게 전달하고 추정으로 API를 추가하지 않는다. 같은 파일은 중복 소유하지 않는다. YAGNI·KISS·DRY를 적용한다.
