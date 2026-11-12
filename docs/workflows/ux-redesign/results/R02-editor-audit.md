# R02 편집 진입점 조사

2026-11-05. `codex/ux-principles-redesign`의 소스와 설치된 런타임 타입을 조사했다. 이 결과 파일 외에 구현 파일은 변경하지 않았다. 실제 화면·실행 검증은 하지 않았다.

## 결론

일반 파일의 기본 편집기를 `activity.EditorPane`으로 통일하는 가장 작은 변경 지점은 `mods/codenav/common.js`의 `wantedChild()`다. `idea`에서 `kind === "file"`을 `CHILD.text`로 라우팅하면 파일 트리·검색·최근 파일·탭 복원·Problems의 파일 열기가 같은 편집기로 모인다. `codebench`의 기존 분기와 review·database·비텍스트 뷰어는 보존할 수 있다.

현재 native `EditorState`에는 요청 행·열로 이동하거나 현재 caret·selection을 읽는 공개 API가 없다. `CodeView`의 정확한 진단 위치 이동·언어 서버 탐색까지 보존하는 통합은 JS 라우팅 수정만으로 완료할 수 없다. U02의 동일 편집기 열기는 가능하다. 실제 행·열 reveal까지 요구하면 런타임 확장 또는 명시적인 범위 결정이 필요하다.

## 진입점과 저장·복원 경로

| 진입점 | 파일·함수 | 현재 동작 |
| --- | --- | --- |
| 파일 트리·새 파일·이름 변경 | `mods/activity/files.js`, `open()` 422 부근, 파일 작업 처리 330 부근 | `openInEditor({kind:"file",path,root,rel,on})`. 이름 변경 시 열린 spec 경로 갱신 |
| 프로젝트 검색 | `mods/activity/search.js` 103 | `openInEditor`에 1-based `line` 포함 |
| activity 공통 열기 | `mods/activity/common.js`, `openInEditor()` 98 | 공유 spec 저장, editor area 표시. area 없는 레이아웃에서는 activity pane 재사용 또는 오른쪽 pane 생성 |
| 명령·터미널 파일·최근 파일·드롭 | `mods/codenav/common.js`, `openPath()` 111, `openFiles()` 122, `status.js` 126–132, `termfiles.js` 89, `recent.js` 58 | 같은 공유 spec. path:line:col의 col은 0-based로 변환. multi-drop은 모든 파일을 탭에 등록 |
| 전체 검색·Go to Line·심볼·위치 기록 | `mods/codenav/everywhere.js`, `pick()` 240 | `openPath()`에 행·열 전달. line 모드는 사용자 입력 1-based, symbol/text/location은 내부 0-based에서 변환 |
| Structure·Problems | `mods/codenav/tools.js`, `jump()` 284, `Problems.activate()` 327 | `openPath()`로 위치 전달. Problems는 machine도 전달 |
| 탭 클릭·뒤/앞·닫은 탭 복원 | `mods/codenav/tabs.js`, `openTab()` 53, `step()` 149, `reopenClosedTab()` 114 | 저장 탭 spec을 `setEditorSpec()`에 전달 |
| 탭 등록·stack 선택 | `mods/codenav/tabs.js`, `routeEditor()` 164, `status.js` render | 항상 보이는 Status가 `wantedChild()`를 따라 stack 선택. 숨겨진 tab strip에만 의존하지 않음 |
| 구현 소유권 | `mods/codenav/main.js`, `mods/activity/main.js`, 각 `VIEWS` | editor-code는 CodeView, editor-text는 EditorPane. wrapper close는 구현 release 호출 |
| 레이아웃 | `layouts/idea.json` 298–348, `layouts/codebench.json` 156–203 | editor-code·editor-text·editor-review·editor-database 네 자식 공존 |

공유 문서는 `activity.editor[editorKey()]`에 저장된다. area가 있으면 key는 `@area:<space id>`, 없으면 tab id다. 두 mod의 `setEditorSpec()`는 `at`를 갱신하고 살아 있는 space/tab만 남긴다. machine과 path를 함께 문서 identity로 유지해야 한다.

`common.js` 79–99의 `VIEWER`와 `isCode()`는 `!spec.edit`이고 viewer 확장자가 아닌 file을 읽기 CodeView로 보낸다. CodeView `edit()` 497은 `edit:true`를 붙여 activity로 보낸다. activity `close()` 309는 edit 플래그를 제거해 읽기 뷰로 돌아가기도 한다.

`tabs.routeEditor()` 181은 새 file 탭을 등록할 때 kind·path·root·rel·on만 저장한다. `editor-history.js`의 `fileSnapshot()`도 edit·dirty·native handle을 저장하지 않는다. 따라서 신규 진입점에만 edit:true를 추가하면 복원된 탭이 다시 읽기 뷰로 간다. 기본 소유권을 routing에서 결정해야 한다. 기존 persisted edit:true·asText:true도 허용하고 탭 identity와 MRU 저장 포맷은 유지한다.

## 편집기와 Markdown의 현재 지원

`mods/activity/editor.js`의 `loadFile()` 154는 EditorState를 만든다. 줄 번호·brace folding·문법 색·줄바꿈 비활성화·readonly를 설정한다. `sync()` 99는 같은 문서 재선택에서 native buffer와 undo를 보존한다. 로컬·원격 파일을 모두 읽고 저장한다.

Markdown 확장자는 md·markdown·mdx다. 현재 `init()` 47의 기본값은 split이다. `MD_MODES` 17은 edit → split → preview 세 상태다. `markdownButton()` 344와 activity.preview가 같은 상태를 바꾼다. `render()` 381은 `TextView.markdown(..., this.code.value())`를 사용하므로 저장 전 내용의 리치 미리보기를 이미 지원한다. MDX 실행이나 HTML 브라우저 렌더링의 지원 근거는 없다. mdMode는 새 파일 로드에서 초기화되지 않아 다음 Markdown도 이전 모드로 열린다.

CodeView `richView()/toggleRich()` 583은 별도로 디스크 text를 path별 Set으로 preview한다. 새 기본 편집기의 preview 상태를 이 Set에 연결할 필요는 없다.

`loadFile()`는 400,000자를 넘으면 잘린 readonly native buffer를 만든다. `readTextFile()` 자체는 UTF-8 1 MiB까지 지원한다. 읽기 실패·부재·NUL·큰 파일은 오류 또는 binary viewer로 처리한다. 큰 Markdown preview는 잘린 buffer의 내용이라는 점을 표시해야 한다.

## 권장 계약과 최소 마이그레이션

1. idea의 file spec은 edit 플래그 유무와 관계없이 EditorPane 소유다. `wantedChild()`의 idea file routing을 바꾸고 codebench 분기는 유지한다. database·유효 review·dirty 보호 우선순위를 검토한다. stack 자식·패널 구조의 삭제나 재생성은 필요하지 않다. 빈 island는 현재 CodeView empty state를 재사용할 수 있다.
2. idea에서 새 Markdown 문서는 edit 기본값, 눈 버튼과 명령은 edit ↔ preview다. 동일 문서 재선택·preview 왕복에서는 기존 EditorState·dirty·undo를 유지한다. 다른 문서를 새로 열면 edit으로 시작한다. codebench의 split 순환은 유지할 수 있다.
3. `EditorPane.close()`의 idea file 동작은 탭 닫기다. 과거 edit:true spec의 첫 close가 읽기 뷰 전환으로 소비되지 않게 한다. codebench의 기존 edit 종료 동작은 유지한다.
4. `mods/codenav/actions.js`, `actionPresentation()` 120 부근은 현재 editable을 document.edit, source를 !document.edit로 판정한다. routing만 바꾸면 Save가 disabled이고 CodeView 전용 명령이 enabled로 남는다. 실제 owning view·readonly·viewer·loading을 기준으로 실행 가능 여부를 판정한다.
5. rich-view와 activity.preview의 키맵·사용자 정의 호환성을 확인하고 idea 눈 버튼·메뉴·키보드를 실제 소유자 activity.preview에 연결한다. 기존 rich-view를 호환 명령으로 전달할 수 있다. codebench의 CodeView 명령은 유지한다. Ctrl+Shift+V 하드코딩 tooltip 대신 유효 keymap 표시를 사용한다.
6. image/PDF/media viewer·git diff·review·database와 좌우아래 tools는 독립 역할을 유지한다. `editor-surface.js`는 읽기 source/diff의 시각 조립만 담당하므로 native 편집기 통합을 위해 합칠 필요가 없다. 공통 UI 변경은 canonical design/idea에서 생성한다.

## 공개 런타임 한계와 회귀

설치된 `/Users/estsoft/.config/herdr-app/gpui-kit.d.ts` 21430–21459의 EditorState는 value·set_value·on(change/submit/focus/blur/paste_other)·release만 공개한다. 생성 옵션은 language·font·line numbers·folding·readonly·soft wrap·syntax다. InputState·TextareaState의 선택 메서드가 EditorState에도 있다고 가정하면 안 된다. EditorState의 focus·caret getter/setter·selection event·line reveal·diagnostic decoration·find 실행·undo 명령 API는 선언되어 있지 않다.

- CodeView `reveal()` 201은 자체 Scroller와 selection으로 목적지 이동을 구현한다. activity `sync()` 106은 API 부재를 명시하고 line/col을 replay하지 않는다. routing만 바꾸면 검색·Problems·Structure 파일은 열려도 결과 행이 화면에 나타나지 않는다. header line 표시는 reveal의 대체가 아니다.
- CodeView `load()` 115–171과 `publish()` 546이 symbols·diagnostics·caret·problemFiles를 소유한다. EditorPane에는 동등한 LSP 로드·publish·unsaved text 전달이 없다. Structure·Problems·status·Recent Locations가 비거나 이전 디스크 snapshot을 보여 줄 수 있다. hidden stack child가 계속 render된다고 가정하지 않는다. 계속 render되어도 실제 native caret와 unsaved buffer는 읽을 수 없다.
- definition·implementation·references·documentation·F2·in-file find·location history·comments gutter·HEAD change markers·Spring markers·HTTP request gutter가 native로 자동 이관되지 않는다. CodeView 삭제는 codebench와 이 기능들의 실행 경로도 제거한다.
- `Status` nav-back/nav-forward 139는 active child가 editor-code일 때만 CodeView location history를 쓴다. native에서는 tab history가 된다. owner와 shortcut을 함께 검토한다.
- 정확한 line navigation 보존의 최소 runtime 요구는 editor position 조회·설정과 reveal이다. unsaved 언어 기능 보존에는 revision별 text 전달과 LSP snapshot scope, selection 관련 API가 추가로 필요하다. 없는 메서드를 추측 호출하면 안 된다.

## 저장·취소·동시성

기존 EditorPane dirty prompt, activity.closeRequest token 승인, tabs.resumeClose 재검증을 재사용한다. 설치된 `herdr.d.ts` 25–28의 local `writeTextFile(path,text,expected)`는 stale snapshot을 거부하고 atomic replace한다. remote는 `mods/activity/io.js` 86–105에서 MD5 비교 후 write한다. 원격 비교와 write 전체의 원자성 보장은 없다.

- `sync()` 110–120은 space 전환 시 dirty native buffer를 workspaceBuffers에 보관한다. 파일별 cache는 아니다. 같은 space의 다른 파일로 이동할 때 Save/Discard/Cancel prompt가 현재 계약이다.
- `save()` 260은 시작 당시 editor·spec·workspace를 캡처하고 추가 입력이 있으면 dirty를 유지한다. 이 snapshot guard를 보존한다.
- sync는 dirty만 검사하고 saving은 검사하지 않는다. 저장 중 undo 등으로 dirty가 false가 된 뒤 다른 파일로 이동하면 이전 buffer가 release될 수 있다. 이전 save callback이 새 문서 상태를 만지는 경로를 검증해야 한다.
- workspaceBuffers는 code·original·dirty·mdMode를 보관하지만 saving은 보관하지 않는다. 저장 중 space 이동에서 instance-global saving·pending과 보관 buffer가 섞이는 위험이 있다. callback은 저장 당시 buffer·workspace에만 결과를 적용해야 한다.
- wantedChild는 database를 dirty 보호보다 먼저 반환한다. dirty file에서 database로 이동할 때 Save/Discard/Cancel이 보이지 않을 수 있다.
- conflict note는 재열기를 안내하지만 같은 문서 재선택은 dirty buffer를 유지한다. 실제 복구는 Discard로 disk reload하거나 pending navigation 처리다. buffer를 잃지 않는 구체적 복구 경로가 필요하다.
- dirty buffer는 메모리에만 존재한다. 앱 종료·mod HMR 복구 persistence는 없다. 설치를 묶어 HMR을 최소화한다.

## 구현 후 검증 기준

- 파일 트리·검색·전체 검색·최근 파일·닫은 탭 복원·드롭·Problems의 동일 identity와 owning view. line/col 실제 reveal은 별도 판정한다.
- Markdown 첫 열기 edit, 눈 버튼 왕복의 unsaved 내용·dirty·undo 보존, 새 문서 edit 기본값, 빈 파일·긴 파일·한글·원격 문서.
- Save/Discard/Cancel로 파일 이동·Close·Close Others·Close All·review/database 이동. dirty 문서와 active tab 표시의 일치.
- 저장 중 추가 입력·undo·파일 이동·space 이동·원격 실패·외부 변경 conflict가 올바른 buffer만 갱신하는지 확인.
- image/PDF/media/binary/diff, codebench edit 종료·Markdown split·키맵, terminal data와 panel geometry 회귀.
- sync_ui.py --check와 check_system.mjs, 관련 check_tabs·check_editor_history·check_actions·check_shortcuts·check_diagnostic_ui·check_editor_context 검사. 변경 mod herdr-app check와 실제 앱 검증은 별도 필수다.
