# T42 ADE 편집기 첫 단위

2026-11-06. `mods/ade/text-editor.js`의 새 `EditorSurface`와 작은 순수 `editor-document.js`를 구현했다. 기존 EditableCode/controller를 복사하거나 상속하지 않았다. 설치·기존 사용자 파일 쓰기·실제 UI 조작은 이 하위 작업에서 수행하지 않았다. 이 결과는 완전한 코드/LSP 편집기 완료 판정이 아니다.

## 첫 수직 단위

파일별 retained native TextareaState 하나가 전체 문서·선택·입력·IME 표시를 소유한다. change마다 native 값을 읽으며 set_value로 다시 덮지 않는다. 소스/Markdown 미리보기·탭·프로젝트 전환 뒤 같은 상태를 보관한다. 문서 원문은 shared에 저장하지 않는다. `workspace.js`의 currentProject/documentState와 path-first selectDocument/closeDocument를 사용한다.

탭·프로젝트/브랜치/경로 행·저장/다시 읽기·Markdown source/preview는 ADE canonical primitives로 구성했다. dirty 표시, Save/Discard/Cancel 닫기·다시 읽기 경고, 실제 읽기 실패, CAS 저장 실패를 표시한다. 저장 중 추가 편집은 dirty로 남는다. 저장 후 계속하기는 같은 선택·동일 요청일 때만 실행한다. 다른 프로젝트에서 늦게 끝난 read/save는 새 문서에 적용되지 않는다. 닫기·release 뒤 응답은 폐기한다. 원격은 readTextFile의 on을 사용하고 UI를 읽기 전용으로 둔다. 쓰기 API에 on이 없으므로 원격 파일을 로컬 경로에 쓰지 않는다.

init에서 시작한 task의 AsyncContext를 보관한다. render의 ensure는 문서 descriptor만 등록하고 microtask 뒤 retained context에서 읽기와 native 상태 생성을 시작한다. render 중 notify는 없다. 모든 native state와 focus handle은 release에서 해제한다.

macOS Save는 effective keymap의 Meta S에 맞는 cmd-s, 다른 OS는 ctrl-s다. Ctrl/Meta 전체 변환은 하지 않는다. native navigation/selection/clipboard/undo/redo/IME 키를 별도 handler로 가로채지 않는다.

## 공개 API 경계

설치된 `~/.config/herdr-app/gpui-kit.d.ts:21399`의 TextareaState는 value/content/change, replace, set_selected_range, focus, soft-wrap와 rows를 제공한다. native Textarea는 gpui-base export다. 전체 문서를 입력하므로 이전의 짧은 IME sink에서 생긴 preedit 폭/잘림 문제를 JS가 재현할 필요가 없다. 실제 한글 조합, undo/redo, 붙여넣기와 preview 왕복의 native 행동은 root의 실제 키 시험이 필요하다.

현재 공개 API에는 selection/caret getter와 selection event, composition 상태/이벤트, undo/redo 명령·transaction, 코드 syntax renderer, 행별 decoration, reveal/viewport 조회가 없다. 이번 단위는 caret 기반 LSP hover/completion/navigation이나 동기화된 gutter를 구현했다고 주장하지 않는다. active()가 반환하는 문서의 state.value()는 전체 텍스트 진단 연결 경계다. root의 LSP 연결은 별도 구현이다.

후속 custom renderer는 CodeMirror의 순수 Text/ChangeSet/EditorSelection과 grapheme 라이브러리를 재사용해 새 문서·selection/history owner와 native virtual rows를 구성할 수 있다. OS 입력은 native 조합 boundary를 재사용할 수 있다. 그러나 설치 API에는 shaped-text x↔offset hit testing도 보이지 않는다. Unicode/emoji/ligature와 실제 caret/pointer 정합을 단순 문자 개수로 보장할 수 없다. native full-text 입력 시험 후 필요한 범위를 정하고, 직접 구현 시 입력·선택·history의 한 소유자와 조합 표시 공간을 먼저 검증해야 한다.

## 검증

- `node --experimental-vm-modules design/idea/check_ade_editor.mjs` 통과: 프로젝트 identity와 지연 read 분리, CAS snapshot, 저장 중 추가 편집, CAS 충돌 보존, dirty 닫기 경고, 원격 쓰기 차단, release 후 늦은 read 폐기, HTML source escaping.
- `python3 design/idea/sync_ui.py --check`와 `node --experimental-vm-modules design/idea/check_system.mjs` 통과. 기본 sync 대상은 codenav/activity이므로 ADE 생성 검증은 root의 `--mod ade` 검사에 포함해야 한다.
- 당시 `herdr-app check mods/ade` 통과했지만 main이 아직 새 EditorSurface를 import하지 않은 상태였다. 새 surface의 native render 검증 근거로 사용하지 않는다.
- source/preview/remote/dirty-close/error native fixture를 임시 폴더에 만들려던 명령은 자동 승인 검토에서 민감 파일 참조로 거절됐다. 실제 명령은 ADE JS·아이콘 복사와 fixture 생성만 포함했다. 우회하지 않았다. root가 통합된 모드의 실제 native check·설치·UI를 검증한다.
