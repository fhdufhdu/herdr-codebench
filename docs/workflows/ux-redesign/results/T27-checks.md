# T27 자체 편집기 통합 검사

2026-11-06. 부모가 구현 중인 EditableCode의 실제 production 모듈을 검사하는 `design/idea/check_editable_code.mjs`를 추가했다. 이 검사와 결과 문서만 수정했으며 편집기 source·기본 routing·설치·앱 본체·사용자 문서는 변경하지 않았다.

## 검사 구조

VM은 다음 production 모듈을 source extraction·대체 class·메서드 override 없이 직접 로드한다. 실제 로드 여부도 assertion으로 확인한다.

- editable-code.js / code.js
- editor-buffer.js / 생성 editor-state-vendor.js
- editor-input.js / scroller.js
- editor-model.js / editor-surface.js

actions/toolbar-model 등의 순수 의존성도 원래 모듈을 로드한다. native state/요소, 파일 IO/CAS·watch, LSP transport, 문서 외부의 common geometry/UI·comments 등 주변 경계만 deterministic fixture다. 실제 문서 수정·선택·undo/redo·부모 class의 source 렌더·async guard 로직을 재구현한 fixture가 아니다. LSP mock은 요청 text/owner/revision을 관찰하고 원하는 시점에 응답을 지연·실패·변조하여 component 경계 검사를 수행한다. 실제 engine나 language server를 실행했다고 주장하지 않는다.

## 보호 범위

| 영역 | 실제 검사 |
| --- | --- |
| 입력과 단일 문서 owner | EditorInput committed Unicode가 EditorBuffer에 반영되고 native sink가 reset됨. pending native preedit 중 scoped delete command는 문서를 변경하지 않음. |
| 선택·명령 | 단일/확장 선택, select-all/copy/cut, native scoped action→문서 이동, 실제 CodeView pointer drag→buffer selection, search hit와 line reveal. |
| history·편집 | Unicode replace 뒤 undo/redo, multiline indent의 단일 transaction undo, outdent, CRLF 문서의 Enter 정책. |
| source 렌더 hooks | 실제 CodeView.row에서 editable 긴 한 줄3501자가 기존2000자 limit으로 잘리지 않음. viewport pixel/IME clipping 검사는 아님. |
| 저장 CAS | 현재 original snapshot으로 write 호출, 성공 후 clean, 늦은 저장 중 추가 입력은 dirty 유지, 외부 writer conflict에서 disk/original을 덮어쓰지 않음. |
| workspace 수명 | A 저장 완료가 B의 buffer/original/dirty/saving·공유 상태를 덮어쓰지 않음. 같은 local URI는 workspace가 달라도 같은 dirty document/owner를 재사용. |
| 닫기·이동 | dirty 문서의 이동은 pending, Cancel은 기존 spec/buffer 유지. 저장 도중 close token이 바뀌면 이전 token으로 승인하지 않음. 현재 clean token의 명시 승인만 command 전달. |
| clean 재열기 | 비활성 clean A의 disk가 바뀐 뒤 A로 돌아오면 새 원문을 읽음. clean lease의 passive close가 지연되면 그 완료 전에는 같은 URI를 다시 읽거나 새 owner를 만들지 않음. |
| 미저장 LSP snapshot | 실제 languageRequest가 document_sync→semantic 요청 순서로 동일 owner/revision과 unsaved text를 전달. disk나 shared.json에 원문을 저장하지 않음. |
| async language guard | sync 대기 중 text revision 변경, 응답의 잘못된 owner/revision 거부. 늦은 diagnostics는 현재 decoration을 되살리지 않음. 같은 revision에서 caret만 이동해도 이전 hover 응답을 표시하지 않음. |
| debounced analyze | 실제 commit→180ms timer→tokens/info/symbols 흐름이 memory text를 사용. 이전 revision의 늦은 token 응답은 paint 상태에 적용되지 않음. |
| 지원 경계 | remote identity가 IO에 전달되고 remote buffer는 readonly/복사 가능·저장/입력 거부. Markdown preview 왕복에 같은 dirty buffer·undo 유지. |
| 해제 | 실제 입력 state/focus handle release, 언어 session의 passive document_close, released request publication 거부. |

## 검사로 발견한 문제와 처리

1. `inputCommand('select-all')`이 일반 select-* 이동 분기에 먼저 들어가 `move('all')`로 RangeError를 발생시켰다. 실제 production 검사 실패를 부모에게 전달했고 부모가 전용 branch 우선순위로 수정했다. 현재 command 검사에서 재발을 보호한다.
2. clean inactive 문서가 cache에 남아 A→B 뒤 외부 변경된 A로 복귀해도 이전 text를 사용했다. 원문 재검증 assertion 실패를 부모에게 전달했고, 부모가 clean 문서 퇴역/lease close·URI key·재열기 대기 수명을 수정했다. 현재 외부 원문과 지연 close assertion으로 보호한다.

두 수정 모두 부모가 source에 반영했다. 검사 담당자는 해당 source를 직접 수정하지 않았다.

## 실행 결과와 한계

다음 명령이 현재 production source를 그대로 로드하여 통과했다.

```sh
node --experimental-vm-modules design/idea/check_editable_code.mjs
node --check design/idea/check_editable_code.mjs
git diff --check -- design/idea/check_editable_code.mjs docs/workflows/ux-redesign/results/T27-checks.md
```

이 검사는 OS 한글 IME의 실제 marked-text event, native Input key 우선순위·focus/candidate 위치, clipping·font/line-height·caret paint, 실제 엔진 stdio/server version 동기화의 증거가 아니다. proxy 요소는 native 메서드의 지원 여부를 검증하지 못한다. 부모의 native check·실제 UI 조작과 T26 engine 검사가 별도로 필요하다. 기본 file routing 활성화나 기존 viewer 제거의 승인을 이 검사 PASS만으로 대신하지 않는다.

## SQL console/DDL의 동일 편집기 통합 검사

부모가 DatabaseEditor의 idea SQLBuffer를 production EditableCode로 연결한 뒤 `design/idea/check_database_editor.mjs`를 새 native 입력 경계에 맞게 갱신했다. 기존 fixture에 Textarea.new, set_rows/set_soft_wrap, bind_keys/propagate를 추가했다. 저장소 모듈은 모두 그대로 로드하며 SQLBuffer·EditableCode·EditorInput·EditorBuffer를 대체하지 않는다. 이전 idea 검사에서 직접 legacy native EditorState에 값을 넣던 부분은 실제 SQLBuffer의 scoped selection 명령과 native committed-text callback 경로로 옮겼다. 기존 row mutation·transfer·결과 탭·비동기 복구 검사는 유지했다.

추가 assertion은 다음을 검증한다.

- idea SQLBuffer가 실제 EditableCode를 상속하며 별도 native EditorState를 생성하지 않음. Unicode commit이 doc.text·textDirty·text 없는 보호 metadata에 반영되고 일반 render에서 model/selection/history를 유지함.
- 편집 중 실제 buffer range를 기준으로 Selection SQL을 만들고, caret 위치의 statement와 Entire script의 정확한 줄 범위를 제공함.
- `cmd-enter`가 `HerdrSqlEditor > HerdrEditorInput > Input` context에 연결됨. 실제 action handler와 keyDown은 승인 picker를 열고 즉시 db_query를 전송하지 않음. pending native preedit에서 keyDown은 실행 picker를 열지 않음.
- Save SQL draft의 expected snapshot·CAS 생성/덮어쓰기·외부 변경 충돌, 저장 중 추가 입력의 dirty 유지.
- 저장 전후 undo/redo가 doc.text/textDirty를 갱신함. 명시적 discard는 저장된 원문으로 model을 한 번 교체하고 버린 원문을 이전 undo history로 되살리지 않음.
- idea DDL은 같은 source 렌더/입력 owner를 사용하되 readonly이고 선택/복사 가능함.
- codebench는 SQLViewer와 legacy native EditorState·Edit/Select and Run 전환을 유지함. native caret를 추정하지 않고 기존 statement별 실행 범위를 제공함.

`node --experimental-vm-modules design/idea/check_database_editor.mjs` 전체 검사가 통과했다. 이 검사에서도 OS command-context 우선순위와 IME/native paint의 실제 동작은 별도 UI 검증 대상이다. 검사 담당자는 database-editor.js 등 source나 설치 파일을 수정하지 않았다.
