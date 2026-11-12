# Codebench 공통 컴포넌트

HTTP 실행의 공통 코어는 `design/idea/http-client.js`다. `sync_ui.py`가 ADE·codenav의 로컬 사본을 생성하며, UI와 실행 기록 어댑터는 각 모드가 소유한다. 블록 파싱·환경 탐색·ijhttp 스크립트·메모리 globals·private snapshot 정리를 중복 구현하지 않는다. 편집기와 리뷰의 gutter 구분선은 의미 색 `separator`와 1px 두께를 사용한다.

`tokens.json`의 `herdr.ux`는 현재 의미 색·치수·syntax의 원본, `ui.js`는 컴포넌트와 동작의 원본이다. 이전 IntelliJ 추출 데이터와 공개 이름은 호환을 위해 유지한다. 현재 설계 판단은 [UX 리디자인](../../docs/workflows/ux-redesign/03-architecture.md)에 있다. 모드에서는 생성된 `./idea-design.js`를 import한다. 모드 사이 상대경로 import나 생성 파일의 직접 수정은 하지 않는다.

Database도 같은 계약을 따른다. `TOOLS.database.headerActions`가 제목/추가·관리·새로고침을 소유하고, 본문은 SQL 콘솔 진입과 lazy tree를 그린다. 전역 연결 창은 공통 관리 목록과 상세 입력, compact driver/TLS selector를 사용한다. idea의 SQL은 모드 소유 SQLBuffer와 공통 CodeView 표시를 재사용한다. 실행 범위는 `uiDialog` 안의 `uiManagedList` 선택·원문 미리보기·명시 실행으로 구성하며 선택만으로 실행하지 않는다. codebench 후보 popup은 기존 동작을 유지한다.

전송은 `uiDialog`에서 왼쪽 옵션/오른쪽 preview, native Select/Popup과 `MenuController`/`uiMenu`로 만든 compact format/scope 선택을 제공한다. 복사·선택 행·전체 표 내보내기는 같은 extractor를 사용한다. 하단 결과는 job/statement별 공통 탭, 고정 header의 공통 grid와 한 내보내기 진입을 사용한다. staged 변경은 전용 반영/되돌리기 bar에서 처리한다. native 가상 목록과 Editor의 일반 키/포인터 이벤트는 plain wrapper에 둔다.

깊은 Islands tree를 `layout.set`으로 전달할 때는 `common.setLayout`의 직렬화 CLI 경계를 사용한다. 실제 host 객체 인자의 중첩 한도는16이다. native serializer가 생략하는 hidden:false/max:null은 의미가 같은 기본값과 비교해야 하며 render→layout.set 반복을 만들지 않는다. live terminal은 persistent output stack 안에 배치하고 종료 후에는 보존한 transcript를 표시한다. 기능/제약과 검증은 [Database 작업 기록](../../docs/workflows/database/00-progress.md)과 [데모 정합 작업](../../docs/workflows/ux-redesign/results/T37-database-editor-demo.md)을 참조한다.

작업 중 표시는 `uiSpinner(() => uiIcon("progress"), {size,tip})`를 사용한다. 아이콘은 `icons.json`과 Lucide subset에서 생성한다. 실제 working 상태에서만 GPUI native `.spin(1000)`을 붙이고 JS 타이머는 만들지 않는다. `uiIcon`은 호출마다 fresh element를 반환한다. 일반 동작 아이콘은 16px, 탐색은 20px이며 의미 역할·별칭은 registry에 둔다.

```sh
python3 design/idea/sync_ui.py
python3 design/idea/sync_ui.py --check
# 새 모드 디렉터리를 먼저 만든 뒤 같은 두 파일 생성
python3 design/idea/sync_ui.py --mod my-new-mode
python3 design/idea/sync_ui.py --check --mod my-new-mode
```

`--mod`는 반복 가능하다. 생략하면 codenav/activity를 검사·생성한다. `--check`는 파일을 쓰지 않고 누락·차이가 있으면 종료코드 1을 반환한다. 생성 파일은 토큰 전체를 담은 `idea-tokens.js`, 컴포넌트 `idea-design.js`, 아이콘 `ui-icons.js`와 로컬 `ui-icons/` 자산이다. `ui.js` 자체는 배포 전 원본이며 해당 디렉터리에서 직접 실행하지 않는다.

`isIdea`, `IDEA`, `uiSize`, `ideaUI`, `popupSurface`의 기존 export를 유지한다. `IDEA`는 현재 설정을 읽는 getter다. idea에서 appearance.compact 미지정은 compact이며 명시적 false는 normal이다. 다른 레이아웃에서 isCompact는 false이고 색과 글꼴은 기존 theme을 사용한다. `uiColors()`는 canvas/surface/popup/foreground/secondary/disabled/border/separator/hover/selection/selectionInactive/selectionForeground/tabSelected/focus/accent/accentForeground/error/editor/lineNumber/currentLine/guide 역할을 제공한다.

## 조립 단위

소스/리뷰는 `mods/codenav/editor-surface.js`의 `editorGeometry`·`editorGutter`·`editorLine`·`editorViewport`·`editorSurface`를 공유한다. 문서/토큰/diff 상태/선택/댓글은 각 뷰가 소유하고, 숫자 열 수·마커·행 내용을 공통 표면에 제공한다. 텍스트 원점과 hit test는 같은 geometry를 쓴다. 탭이 숨겨진 표면에는 canvas 색 native path로 상단 코너를 실제로 마스킹한다.

IDEA의 `terminal-panel`은 `idea-content`의 아래 자식이다. 위의 `idea-upper`는 기존 sidebar/work-body/editor/tool-right를 함께 담아 하단 도구가 열릴 때 모두 위로 줄어든다. 기존 노드와 도구 stack/terminal payload는 이동만 하며 재구성하지 않는다. `memory.js`는 이 위 행의 세로 비율을 저장한다. codebench의 별도 split 계약은 유지한다.

`idea-upper`·`idea-content`·`sidebar`·`tool-right`의 실제 분할에는 `IDEA.splitterWidth`(6px)의 native divider rail을 예약한다. native resize handle이 인접 editor/tree/terminal의 pointer surface와 겹치지 않도록 하는 입력 영역이다. root/body의 gap과 stripe/status gutter는 추가하지 않는다. shell migration은 기존 panel 크기·min/max·순서·active/hidden·terminal payload를 보존한다.

리뷰 툴바는 같은 action 중복을 렌더에서 제거하고 소스 열기를 하나만 제공한다. 이전/다음 변경은 위/아래, 전체 파일 context는 이름과 체크 상태로 표시한다. 삭제 파일의 소스 열기, 변경이 없는 행 이동 등 불가능한 동작은 비활성이다.

툴 위치 설정은 위치별 목록과 위/아래 순서 버튼, 이동 대상, stripe 표시 체크를 제공한다. 위치·순서·표시는 Apply 전 로컬 draft이며 `codenav.toolOrder`는 위치별 안정적인 tool 이름 배열이다. 숨긴 항목도 설정 목록에는 남아 있고, 미지 항목/미지 위치는 저장 시 보존한다. 파일 drag/drop 및 drag preview UI는 제거했다.

키맵은 `uiManagedList`의 검색·단일 액션 선택과 상단 추가/변경/제거, 오른쪽 액션 상세·개별 chord 선택을 사용한다. 실제 키 기록 외에 `cmd-shift-o` 텍스트 입력도 가능하다. 할당 없는 액션은 추가만 활성화하며, 검색 결과 없음·저장 중 상태도 공통 목록과 disabled 동작으로 표시한다. `keymap-model.js`는 Apply 전 staged edits와 latest-file CAS를 검증하고 원래의 terminal forwarder만 동기화한다. Cancel은 미저장 변경을 버리며 모드 소유 shortcut의 제거/재할당은 소스의 하드코딩 fallback보다 우선한다. macOS Ctrl/Meta는 실제 유효 바인딩대로 구분한다.

`tokens.json`의 `herdr.editor.metrics`는 첨부 IDEA 화면을 기준으로 선택한 Herdr 편집기 배치 값이다(추출한 upstream 수치와 구분). `IDEA.editorBreadcrumbHeight`(compact28/normal32), `editorTextInset`(8/12), `editorGutterInset`(8), `editorMarkerWidth`(18)를 제공한다. 텍스트 시작 좌표는 렌더링·마우스 hit test·인라인 코멘트가 같은 값을 사용한다.

메뉴 및 도구 모음 전용 설정 편집 화면은 제거했다. 기존 `codenav.customization`과 action registry·toolbar-model의 runtime 소비는 호환을 위해 유지하며 저장값을 임의 삭제하거나 초기화하지 않는다. 툴 윈도우 배치와 표시 설정은 독립 `windows` 페이지, 단축키 편집은 `keymap` 페이지가 소유한다.

idea의 Markdown은 헤더에서 `uiModeSwitch`로 원문·미리보기를 선택한다. 네이티브 편집 중에는 편집·미리보기 label을 사용하며 같은 buffer·undo·dirty 상태를 유지한다. source viewer의 별도 편집 진입과 일반 파일의 탐색 경로를 보존한다. codebench는 기존 눈 버튼과 edit·split·preview 전환을 유지한다. Git edge marker는 공통 editor-surface에서 absolute 장식으로 그리며 숫자·이동 아이콘·텍스트 원점에 영향을 주지 않는다. `lineAdded`/`lineModified`/`lineDeleted` 의미 색과 `editorChangeMarkerWidth`/`Radius` 치수를 사용한다.

프로젝트 정렬은 상단 오른쪽의 셀렉트로 표시한다. native Select·Popup이 열림 상태와 trigger/list 포커스 경계를, 공통 `uiButton`·`uiMenu`가 외형과 옵션 이동·Enter·Esc를 담당한다. 세 정렬 기준과 직접 지정 순서 보존은 `project-order.js`를 사용한다. 도구 창 위치는 왼쪽 위·아래, 오른쪽 위·아래, 하단의 기존 슬롯을 유지한다.

| 함수 | 소유 영역 |
| --- | --- |
| `uiButton(id,label,action,{primary,disabled,small})` | 텍스트 버튼, 클릭, 비활성 |
| `uiIconButton(id,graphic,action,{tip,active,disabled,size})` | 실제 아이콘 element의 버튼; 내부 클릭 전파 차단 |
| `uiModeSwitch(id,items,current,onChange)` | native Button 그룹으로 현재 문서 모드와 가능한 목적지를 함께 표시 |
| `uiInputBox(input,{focused,error,mono})` | 입력 element 바깥 배경·오류/포커스 틀 |
| `uiListRow(id,children,{selected,focused,disabled,onClick,interactive,indent})` | 밀도·행 선택·들여쓰기; indent는 px. virtual renderer는 handler 없이 interactive로 hover만 사용 |
| `uiCheckbox(id,label,action,{checked,disabled})` | 체크·비활성 상태와 클릭. checked 상태는 호출자가 소유 |
| `uiStripeButton(id,graphic,action,{active,tip,side})` | stripe hit area와 inset 선택 배경·아이콘·tooltip. side는 left/right, 인접 island inset을 고려해 시각 여백 대칭 |
| `uiTreeRow(id,label,{depth,selected,expanded,graphic,shortcut,onClick,disabled})` | depth×14 들여쓰기·펼침 표식·선택. expanded 미지정은 leaf, 실제 펼침 상태는 호출자가 소유 |
| `uiSettingsShell(id,{title,sidebar,content,footer,width,height,sidebarWidth})` | 설정 제목/좌측열/본문/하단 영역과 명시 크기. 기본900×700/좌측145. 갤러리 settings variant는640×420을 명시하고 개인 설정을 쓰지 않음 |
| `uiSeparator()`, `uiCaption(text)` | 구분선·보조 설명 |
| `uiToolbar(id,children)` | 툴바 크기·정렬 |
| `uiToolHeader(id,title,{actions,content})` | 제목 또는 대체 content와 오른쪽 액션 |
| `uiTab(id,children,{selected,active,onSelect,onClose,closeIcon,tip})` | Islands 채움, 클릭 선택, 가운데 클릭 닫기, 닫기 아이콘 |
| `uiTabStrip(id,items,active,viewport)` | `{id,content}` 탭의 실제 폭을 측정하고 활성 탭을 보이게 이동; `TabViewport`는 init에서 생성, 수동 휠 이동은 일반 redraw에서 유지 |
| `uiEmptyEditor(hints,footer)` | 빈 에디터의 공통 배경·중앙 정렬·보조색 안내. hints는 `[번역한 이름, 단축키]` 목록이며 실제 동작은 호출자가 소유 |
| `uiPopupSize(count,{width,maxHeight,extraHeight})` | `{width,height}` 명시 크기 계산 |
| `uiDialog(id,{title,body,footer})` | 제목·flex 본문·footer. 기본 높이360, 호출자가 `.h(높이)`로 실제 필요 크기 지정 |
| `uiIslandBottom()` | 레이아웃이 소유한 섬 아래 마감. 외부 gap을 추가하지 않음 |
| `uiEditorFooter(children)` | Markdown 등 편집기 로컬 모드의 하단 제어. 호출자가 실제 상태/핸들러를 소유 |
| `uiDiagnosticColors(severity)` | editor.attributes의 진단 EFFECT_COLOR/ERROR_STRIPE_COLOR와 editor.colors의 INFORMATION_HINT/HINT_BORDER. 브레이크포인트·컨트롤 오류 색과 구분 |
| `uiDiagnosticUnderline(element,{width,offset,severity})` | 문법 색·행 높이·텍스트 폭을 유지하는 native 물결 path. offset으로 토큰 경계의 파형을 연결 |
| `uiDiagnosticCard(id,diagnostics,{path})`, `uiDiagnosticTooltip(id,trigger,diagnostics,{path})` | 출처·코드·메시지와 경로 표시. 폭560/최대 높이320, 긴 본문 스크롤. native HoverCard의 500ms 열기/150ms 닫기와 창 경계 배치 사용 |
| `uiDiagnosticLabel(diagnostic,{summary})` | 목록 summary는 첫 비어 있지 않은 줄만 표시하며 강제 개행을 정규화한다. 카드/복사에는 전체 메시지 보존 |
| `uiSelectableText(id,text)` | 진단 문자열의 타입 문법/HTML을 escape한 native TextView. 실제 드래그 선택·복사를 지원하고 내부 자동 스크롤은 사용하지 않음 |

진단 카드의 `actions`는 `{id,label,action,disabled}` 목록이다. source와 Problems는 `diagnostics.js`에서 같은 복사/AI 액션을 공급한다. Problems 행은 한 줄 요약·clip·고정 행 높이를 유지하고 전체 내용은 선택 가능한 hover 카드에서 표시한다. 선택 가능한 텍스트는 mouse-down/click 전파를 막아 목록이 텍스트 포커스를 가져가거나 선택 도중 파일을 열지 않게 한다. 행 선택·파일 열기는 아이콘/줄 번호 영역에서 할 수 있다. 항목별 버튼과 `header.Problems`의 전체 버튼은 같은 포맷을 쓴다. 전체는 현재 File/Project 범위·필터 결과이며 공개된 다른 workspace의 진단을 섞지 않는다. AI picker가 닫혀도 Status가 실제 첨부 task를 소유한다. 첨부는 대상 AI 입력창으로 paste하고 사용자가 전송 전 확인한다.

모든 action/onClose는 `(event,cx)`를 받는다. 자식 element와 입력 상태는 호출자가 소유한다. 입력/검색/저장/오류 상태를 이 모듈이 가짜로 생성하지 않는다. 컨트롤 행은 UI 글자 크기가 커지면 최소 높이도 늘려 잘림을 줄인다. `IDEA`의 기본 compact 값은 panel radius4/gap2, row26, input28, tab36/fill32, header32, toolbar36/button28, stripe40/icon20, status24다. normal·compact 수치는 `herdr.ux.metrics`가 소유하며 제품 설계 선택이다. idea의 버튼·아이콘 버튼·stripe는 native Button의 activation·focus·disabled·접근성 이름을 사용한다. 제어의 최소 hit 영역24는 glyph 크기와 구분한다. focus 경계 공간은 항상 예약한다.

## 메뉴 수명과 키보드

```js
import { View, div } from "gpui-kit";
import { MenuController, uiMenu } from "./idea-design.js";

export default class Actions extends View {
  init(_props, cx) {
    this.menu = new MenuController(cx, 0); // init에서만 생성
    this.menu.focus.focus();
  }
  close() { this.menu.release(); }
  render(cx) {
    const rows = [
      { id: "open", label: "Open", shortcut: "1", action: (event, cx) => this.open(event, cx) },
      { separator: true },
      { id: "save", label: "Save", disabled: this.saving, action: (event, cx) => this.save(event, cx) },
    ];
    return uiMenu("actions", rows, this.menu, cx, {
      width: 320, maxHeight: 400,
      onClose: (event, cx) => this.dismiss(event, cx),
    });
  }
}
```

`this.menu.at`은 원본 rows의 index다. 구분선·비활성 행은 ↑↓/Home/End/PageUp/PageDown에서 건너뛴다. Enter와 클릭은 현재 항목을 실행하며 Escape는 onClose만 호출한다. 숫자1–9는 명시적 `row.shortcut`과 먼저 매칭한다. 명시 숫자가 하나도 없을 때만 활성 항목 순번을 사용한다. 명시 숫자가 존재하면 빠진 번호가 다른 항목을 실행하지 않는다. 텍스트 shortcut 표시는 별도로 key binding을 등록하지 않는다.

기본 실행은 onClose 후 action 순서다. 복사·비동기 작업이 끝난 뒤 닫아야 하면 `closeOnActivate:false`를 전달하고 action이 성공 후 닫도록 한다. Escape는 이 경우에도 onClose를 호출한다. controller.key 직접 호출도 같은 옵션을 받는다.

긴 검색 목록처럼 메뉴 이외 renderer가 선택을 소유하면 다음 형태로 같은 handle을 사용한다. 선택 변경은 event 안에서 수행하고 renderer 안에서 notify하지 않는다.

```js
// init에서 MenuController 생성. 선택 변경 이벤트:
this.menu.at = nextIndex;
this.menu.ensureVisible(nextIndex); // center, 기본값은 현재 at
cx.notify();
// render에서 실제 v_virtual_list에 연결:
v_virtual_list(id, rows.length, rowHeight, i => rows[i].id, renderRange)
  .h_full().track_scroll(this.menu.scroll);
```

`uiPopupSize`의 기본 extraHeight는14(양쪽 padding6+border1)다. popup 호출부의 width도 uiMenu의 width와 같게 맞춘다.

메뉴는 가변 높이 virtual list(행22/구분선9), 명시적 popup와 list 높이, `track_scroll` 및 동일 id Scrollbar를 조립한다. 빈 rows도 최소 한 행 높이를 보존한다. 최초 selected가 0보다 크면 constructor에서 그 index로 스크롤을 요청한다. 데이터가 재정렬되면 호출자가 안정적인 id로 선택 index를 다시 맞추고 ensureVisible을 호출한다. release는 반복 호출해도 안전하다.

## 새 화면 검증 예제

정상 목록에는 실제 rows를 넣는다. 메뉴의 아이콘은 반드시 `icon: () => toolImage(name, 16)`처럼 factory로 전달한다. Native element를 미리 만들어 deferred renderer에 재사용하면 실제 앱에서 행 전체가 비어 보인다. uiMenu는 잘못된 eager icon을 즉시 거부한다. 빈 화면은 `uiCaption("No results")`, 로딩은 현재 작업의 실제 busy일 때 `uiCaption("Searching…")`, 오류는 실패 상태에서 `uiCaption(message)`와 `uiButton("retry","Retry",retry)`를 쓴다. 포커스 상태는 입력 상태가 보고한 사실을 uiInputBox에 전달한다. 상태 이름만 바꿔 실제 작업 성공을 표시하지 않는다.

설치 후 검증은 compact/normal와 UI13/확대 글자에서 수행한다. 빈 메뉴, 전부 비활성, 구분선 사이 항목, 100개 긴 목록의 End/Home/PageUp/PageDown, 숫자 명시shortcut, Enter/Escape, 클릭·가운데 클릭 탭닫기, 비동기 실패 후 메뉴 유지, 섬 끝 배경을 확인한다. unit mock만으로 GPUI 실제 높이·포커스·Retina 픽셀 일치를 주장하지 않는다.

## 개발자 갤러리

`mods/codenav/design-preview.js`는 생성된 공통 컴포넌트를 직접 조립한 실행 가능한 참고 화면이다. `designpreview` view와 개발자 명령 `codenav.design-system`이 등록되어 있다. Find Action(⌘⇧A)에서 `design-system`을 검색하면 열린다. 제품의 기본 메뉴·툴바에는 갤러리를 노출하지 않는다.

```js
openOverlay({ mod: "codenav", props: { view: "designpreview" },
  kind: "dialog", frame: "none", width: 820, height: 680 });
```

본문은 스크롤하며 현재 설정의 밀도·치수·UI 글꼴, 11/13/16 텍스트, 의미별 색, 정상/주요/비활성 버튼, 아이콘 버튼, 정상/포커스/오류/monospace 입력, 선택/비활성 선택/비활성/들여쓰기 행, 탭, 툴바, 툴 제목과 섬 아래 마감을 보여준다. 명시된 입력 테두리는 상태 예제이며 실제 작업의 실패나 성공을 나타내지 않는다. 빈/로딩/실패 예제도 명확히 sample로 표시한다.

`Open 100-row menu…`는 같은 view의 `variant:"menu"`를 논리 320×360 팝업으로 연다. 메뉴는 공통 컨트롤러의 긴 목록·비활성 건너뛰기·숫자 shortcut·선택 스크롤을 검증하는 예제다. 활성화하면 로컬 상태 문구만 바꾸고 유지되며 Escape로 닫는다. 갤러리는 settings/shared를 쓰거나 외부 명령·파일·네트워크 작업을 실행하지 않는다. 각 instance의 release에서 메뉴 handle을 해제한다.

## 레이아웃 공통 키맵

전체 검색 기본값은 `cmd-shift-space`(⌘⇧Space)다. `terminal` override는 `codenav.key:cmd-shift-space`로 전달하고 Status가 IDEA에서 전체 검색을 연다. 다른 레이아웃은 원래 키를 터미널에 전달한다. Herdr modifier 시퀀스의 입력 중 오작동을 피하기 위해 기존 `shift shift` 기본값은 제거했다. 설치 스크립트는 이전의 정확한 기본 action만 마이그레이션하고 개인 바인딩을 보존한다. 설정 키맵과 빈 편집기 안내는 실제 `keys()` 바인딩을 표시한다.

설치 시 빠진 바인딩만 병합하며 기존 키 충돌은 보존·출력하고 변경 전 파일을 백업한다. Herdr 최초 실행 전에는 기본 키맵을 대신 생성하지 않고 최초 실행을 안내한다.

회귀 검사: `node design/idea/check_shortcuts.mjs`, `node --experimental-vm-modules design/idea/check_settings.mjs`.

## 툴 윈도우 설정

툴 윈도우의 위치·stripe 표시·순서·레이아웃 복원은 IdeaSettings의 독립 `windows` 페이지가 소유한다. `openToolSettings()`와 `codenav.tool-settings`의 `openIdeaSettings("windows")` 진입도 이 페이지를 연다. 왼쪽은 `uiManagedList`의 검색·단일 선택·상단 표시/숨김·위아래·복원 액션, 오른쪽은 선택한 도구의 표시 체크와 다섯 위치 selector를 제공한다. 검색 중 순서 이동은 비활성이고 위치 내부에서만 재정렬한다. 제거된 `toolbars` 편집 화면이나 별도 툴 설정 dialog로 이중 구현하지 않는다.

위치/표시는 다른 설정과 같은 draft 및 Apply/OK/Cancel 수명을 따른다. 일반 Apply에서는 수정된 툴의 위치만 arrange에 전달한다. 명시적 레이아웃 복원은 Apply 후 현재 draft의 전체 알려진 위치를 적용한다. 표시만 바꿀 때는 레이아웃을 재배치하지 않으며 알 수 없는 미래 설정과 동시에 바뀐 다른 항목을 유지한다.

회귀 검사: `node --experimental-vm-modules design/idea/check_settings.mjs`.

## 현재 파일 선택

`uiListRow`와 `uiTab`은 호출자가 전달한 selected를 배경과 접근성 선택 상태에 함께 반영한다. 파일 탭은 파일/머신의 안정적인 id를 사용하며 현재 탭 이름을 semibold로 표시한다.

Project는 에디터/리뷰의 현재 파일이 바뀔 때 선택과 anchor를 맞추고 상위 폴더를 펼쳐 읽는다. 에디터에 포커스가 있을 때는 공통 비활성 선택 색을 유지한다. 같은 파일의 일반 redraw는 수동 다중 선택·폴더 접기를 덮어쓰지 않는다. 경로 경계·머신·스페이스가 다른 파일은 선택하지 않으며, 이전 파일의 비동기 폴더 읽기는 새 선택을 바꾸지 않는다. 일반 트리의 스크롤 위치는 유지한다.

회귀 검사: `node --experimental-vm-modules design/idea/check_file_selection.mjs`.

탭 등록·스택 선택·빈 탭 줄의 표시 여부는 항상 보이는 Status의 `routeEditor`가 담당한다. 숨겨진 탭 줄도 탐색기에서 파일을 열면 복귀한다. 지연 콜백은 현재 스페이스와 현재 파일/리뷰를 다시 확인하고, 닫힌 탭의 이전 클릭 콜백은 파일을 다시 열지 않는다. 리뷰의 현재 파일은 스페이스와 저장소 경계를 모두 검사한다.

IDEA에서 마지막 탭을 닫으면 editor-area는 유지하고 editor-tabs만 숨긴다. 빈 화면은 code child의 `emptyEditor`를 사용하며 제목·탭 도구줄 없이 중앙 안내를 보여준다. 파일 drag/drop은 지원하지 않는다. codebench는 마지막 탭을 닫으면 영역을 숨기는 기존 동작을 유지한다. 회귀 검사: `node --experimental-vm-modules design/idea/check_tabs.mjs`.

언어 서버 설정은 `lsp-install-guide.js`의 OS별 순수 안내 모델과 `lsp-setup.js`의 공통 settings shell을 사용한다. 언어별 선택과 로컬 폴더, LLM용 안내 복사, 실제 감지/초기화를 구분한다. 설치 명령을 자동 실행하지 않으며 선택·폴더 변경/닫기 뒤 오래된 응답은 버린다.

승인된 관리 목록은 `uiManagedList(id,rows,controller,cx,{selectedId,onSelect,onActivate,onClose,actions,search,caption})`를 사용한다. row는 `{id,label,detail,icon:()=>graphic(),disabled}`이며 action은 `{id,label,icon:()=>graphic(),action,disabled,shortcut}`다. 상단 툴바 한 번, 방향키/Home/End/Page 선택, Alt 위·아래 이동 액션과 MenuController 스크롤을 공유한다. caller는 init에서 controller/input을 만들고 release한다. 검색 중 재정렬·경계 이동 비활성은 caller가 판단하고 draft/저장/취소는 원래 소유자에 둔다. native 버튼에 element label을 넣으면 `accessibilityLabel`에 문자열을 함께 제공한다. selectable TextView의 이벤트는 plain wrapper에 둔다.


## 새 ADE 프레임 컴포넌트

`herdr.ade.metrics`와 `adeUI/adeButton/adeStripeButton/adeRow/adePanel/adeTab/adeNote`는 승인 HTML 프레임을 새 native 모드로 조립하는 경로다. 기존 idea/codebench caller의 동작을 변경하지 않는다. 색은 `herdr.ux.colors`, 아이콘은 canonical Lucide 원본을 공유한다. `mods/ade`의 상단 디자인 시스템 버튼은 로컬 예제 갤러리를 연다. `TOOLS.headerActions`가 각 도구의 제목 액션과 실제 frame 명령을 소유한다. 실제 조작 검증은 최신 사용자 허용 범위에서 ADE 프리뷰에 한정하고 기존 터미널에는 입력하지 않는다.

`adeManagedList`의 기본은 native virtual list다. 작은 관리 목록의 실제 행 hover 동작이 필요하면 `rowActions: row => [{id,label,icon:()=>graphic(),disabled,action:(rowId,event,cx)=>…}]`를 제공한다. 이 경로는 측정한 높이에 맞는 최대 25개 행만 일반 render에서 만들며 deferred renderer 안에 핸들러/버튼을 넣지 않는다. hover 또는 선택된 행에서 quiet native 버튼을 표시하고 그 외에는 보조 정보를 표시한다. 동작에는 정확한 rowId를 전달하고 행 클릭/활성화 전파를 차단한다. 선택된 행의 버튼은 native 키보드 focus로도 접근한다.

행 window는 init에서 만든 MenuController가 소유한다. 휠 위치는 일반 redraw에서 유지하고, 선택/순서 변경과 End/Home/Page 이동은 선택 행을 보이게 한다. 넘칠 때만 범위·이전/다음 구간을 표시하며 연결되지 않은 scrollbar를 그리지 않는다. 큰 단축키 목록과 파일/DB tree는 이 opt-in을 사용하지 않는다. ADE collection에 100행 hover/키보드/휠 예제가 있다.


### ADE 파일 상태·리뷰 후속 (2026-11-09)

`adeRow`의 `labelColor`는 글자 영역에만 적용하며 선택 배경/포커스/상세 문구는 공통 컴포넌트가 소유한다. `herdr.ux.colors.fileModified/fileAdded/fileUntracked/fileRenamed/fileDeleted/fileConflict/fileIgnored`가 자체 Git 팔레트다. 프로젝트 트리는 상태 문구를 병기하고 수정된 자식의 상태를 부모 폴더에 반영한다. Git 상태는 프로젝트별 5초 snapshot이며 paint/가상 행 callback에서 프로세스를 실행하지 않는다. Git 미사용·명령 실패 시 기본색으로 표시한다. ADE collection에 같은 행 예시가 있다.

리뷰의 오른쪽 비교 대상은 선택 불가 `현재 프로젝트` 텍스트다. 기준만 선택할 수 있고 좌우 교환은 제거했다. 최근 문서 LSP는 같은 프로젝트의 열린 탭 최대8개(현재+최근7개)를 유지하고, 프로젝트·리뷰 전환/닫기에서 정리한다. 리뷰는 현재 새 소스와 일치하는 줄에서 정보·정의·참조를 지원하며 삭제된 과거 줄은 현재 문서 분석으로 해석하지 않는다. 과거/현재 색상은 각 원문의 순수 tokenizer 결과를 사용한다. 코멘트 선택 상세와 수정 폼에 삭제 버튼을 표시한다.


### 프로젝트 분석 준비 (T67)

ADE appbar의 compact 분석 상태는 로컬 프로젝트를 열 때 비동기 `project_prepare`를 시작하고 status를 관찰한다. 준비/인덱싱 표시는 서버가 전달한 busy를 사용하고 같은 snapshot에는 notify하지 않는다. 상태 버튼은 공통 dialog의 언어·root별 진행/실패 목록, 제한 도달 여부, 명시적 재시도와 설명을 연다. 원격 root는 로컬 엔진에 전송하지 않는다. 전체 인덱스 완성을 추측해100%로 표시하지 않는다.

materialized 외부 소스는 readonly CodeInput과 같은 LspSession 탐색 UI를 사용하지만 buffer lease/sync는 만들지 않는다. 원본 URI가 있는 immutable 응답의 late callback guard만 로컬 snapshot tag를 사용한다. 서버가 제공하지 않는 외부 진단은 `진단 미지원`으로 표시하고 정보·정의·참조는 별도 제공한다.

ADE dialog overlays use `adeDialog` (opaque ADE panel, shared header/body/footer) rather than legacy `uiDialog`, whose popup surface only applies to the idea layout. The native collection includes an opaque dialog sample. Project status labels describe language-server preparation rather than full-project indexing. Initial document sync has no edit debounce; subsequent edits retain 250 ms coalescing.

Review file lists offer flat paths and a directory tree over changed files only. Both reuse adeManagedList/MenuController; virtual rows carry plain labels, icon factories and numeric indent, never eager native label elements. View choice persists; folder collapse changes only the tree projection, leaving diff/comment selection intact.

Review trees match ProjectTree: leading chevron factory before folder/file icon, 16px indent and a 16px leaf spacer. Managed-list callers can provide deferred leading graphics and intercept tree Left/Right before standard menu navigation. Review file/diff widths belong to the native h_resizable group, stable per project, with no JS drag-render loop.

### ADE source gutter actions

`adeGutterAction` reserves 24px to the right of line numbers, uses the source row height, an icon factory and semantic success/secondary colors. Empty rows reserve the same width. Editor and current-source review rows share it; historical/deleted rows do not offer live navigation. Navigation markers are generated from the existing codenav editor model, and asynchronous Spring markers/targets are revision guarded. Permanent LSP readiness belongs to the branch-side project analysis control; editor footer content is only an explicitly requested quick-info result.


### ADE 커서 자동완성

`adeCompletionPopup`은 코드·SQL 공통 후보 목록이다. 호출자가 보유한 MenuController와 고정 bounds, semantic popup 배경을 사용한다. CodeInput은 native 입력 커서의 glyph slot에 항상 같은 Popup wrapper를 유지하고 content만 바꾼다. 열릴 때 입력 노드를 재배치하면 포커스가 끊기므로 조건부 wrapper를 만들지 않는다. 기본 위치는 커서 아래이며 편집기 하단 공간이 부족하면 위로 전환한다. 후보 목록이 입력 포커스를 빼앗지 않고 Up/Down·Enter/Tab·Escape는 현재 편집기가 처리한다. IME 조합 중에는 요청하지 않고 revision·커서·문서 변경 시 이전 응답을 폐기한다.

### ADE 관리 목록 상태 그룹

`adeManagedList`의 `{id,label,detail,heading:true}` 행은 `adeListHeading`으로 표시한다. 제목과 개수만 담고 클릭·방향키 선택·Enter 활성화 대상에서 제외한다. 일반 행의 단일 클릭 이동과 가상 스크롤 높이는 유지한다. 에이전트는 Herdr 상태 순서 `working`, `blocked`, `done`, `idle`로 그룹화하며 빈 그룹은 표시하지 않는다.
