# T20 편집기 구현 가능성과 변경 범위 조사

2026-11-06. 구현하지 않고 현재 source와 설치된 runtime 공개 선언만 조사했다. 대상은 `mods/activity/editor.js`, `mods/codenav/code.js`, 기존 R02/T02/T06 결과, 설치 `AGENTS.md`, `gpui-kit.d.ts`, `herdr.d.ts`다. 라이브러리 공식 문서 조사는 부모가 수행하므로 이 문서에는 최신 외부 제품 사양을 추정하지 않는다. REA·설치·런타임 변경·화면 조작은 수행하지 않았다.

후속: 사용자가 목표를 단일 편집 UI·미저장 LSP·소스 뷰어 대체로 구체화해 [심화 검토](../10-unified-editor-review.md)를 완료했다. Textarea wrapper는 단순 편집용 조건부 후보였으며 이 전체 목표의 우선안은 아니다. upstream native 기능과 설치 binding 경계를 추가로 확인했다.

## 판단

우리 제품이 소유하는 편집기 UI와 문서 수명을 만드는 것은 가능하며 이미 상당 부분 구현돼 있다. 그러나 **현재 mod 공개 API만으로 기존 native 입력 엔진을 완전히 제어하는 통합 코드 편집기를 만드는 것**과 **새 native 편집 엔진을 만드는 것**은 별개의 범위다.

현재 요구의 우선안은 기존 native Editor를 재사용하고, caret/selection/reveal/decoration에 필요한 host capability를 보강할 수 있는지 확인하는 것이다. runtime 수정 없이 가능한 것은 색·글꼴·줄 번호·folding·readonly·wrap, 저장/취소, Markdown preview와 바깥 UI 개선이다. 커서 기반 LSP·정확한 결과 행 이동·native 편집 영역의 진단 밑줄은 현재 JS API만으로 연결할 수 없다.

TextareaState 기반 wrapper도 별도 대안이다. native 다중 행 입력과 범위 설정을 재사용하므로 단순 텍스트 편집에는 실질적인 출발점이다. 하지만 현재 공개 API에는 현재 범위 조회·선택 변경 이벤트·내부 스크롤/외부 syntax decorations가 없어 전체 요구를 해결하는 대체품으로 즉시 선정할 근거는 부족하다. 처음부터 키 입력·IME·undo를 직접 만드는 방안보다 이 재사용안을 먼저 작은 실험으로 판정하는 것이 KISS/DRY에 맞는다.

## 현재 구현의 소유권

| 기존 부분 | 이미 있는 역할 | 통합 시 주의 |
| --- | --- | --- |
| `mods/activity/editor.js:99–138` | 같은 문서의 native buffer 유지, workspace별 dirty/saving buffer 보관, release | view를 바꾸는 것과 문서 identity를 바꾸는 것을 구분. 같은 문서 재선택에서 EditorState를 새로 만들면 undo/입력 상태가 사라질 수 있다. |
| `editor.js:159–191` | 실제 파일을 EditorState로 편집. 언어·font·syntax palette·line numbers/folding/readonly/wrap 지정 | 원문 400,000자 초과는 잘린 readonly buffer. 이 값은 현재 제품 정책이며 runtime 최대치로 단정하지 않는다. |
| `editor.js:269–300` | 로컬 optimistic write, 원격 write, 저장 당시 buffer에만 callback 반영, dirty/close 보호 | 편집 엔진 교체 시에도 재사용할 문서 수명이다. 새 save/cache 계층을 중복 생성하지 않는다. |
| `editor.js:356–407` | idea Edit/Preview, codebench edit/split/preview. preview는 같은 code.value() 사용 | Markdown 전환만으로 다른 buffer를 만들거나 저장 후 disk text로 되돌리지 않는다. |
| `mods/codenav/code.js:111–170` | 읽기 source의 파일/token/LSP 로드, stale 요청 억제, symbols/diagnostics | native Editor의 수정 중 buffer와 자동 연결되지 않는다. 현재 native 입력 위에 같은 증분 언어 기능이 구현돼 있다고 볼 수 없다. |
| `code.js:201`, `:314–389`, `:546`, `:683–746` | 자체 line reveal, 포인터·gutter 범위 선택/복사, caret/status publish, 색상·선택·진단 렌더링 | **읽기 viewer의 선택과 위치**다. 실제 편집 caret·insertion/undo 엔진으로 확대 해석하지 않는다. |
| `code.js:923–970`, `editor-surface.js:1–33` | source/diff 행 geometry, gutter, virtual viewport와 시각 조립 | 실제 텍스트 상태는 소유하지 않는다. 재사용 가능한 시각 요소와 편집 엔진을 분리해 유지한다. |
| `mods/codenav/common.js:84–98` | 일반 source는 CodeView, edit:true 등은 native EditorPane. dirty/saving 우선 보호 | 하나의 기본 편집기로 라우팅만 바꾸면 검색·Problems 행 이동과 source 전용 기능을 잃는다. R02의 이 제한은 현재도 유효하다. |

T02는 저장/space 전환과 Markdown buffer 보존을 개선했으며 T06은 명시적인 Source/Preview, Edit/Preview 선택을 추가했다. 이 작업은 caret/reveal 공개 API를 추가한 것이 아니다. T06의 source viewer 유지 결정도 통합 편집기 완료로 바꾸어 해석하지 않는다.

## 공개 API로 확인한 사실

| 항목 | 선언과 지원 | 지원한다고 가정할 수 없는 항목 |
| --- | --- | --- |
| `EditorState` | 설치 `gpui-kit.d.ts:21430–21459`: value, set_value, on(change/submit/focus/blur/paste_other), release. 생성 옵션 language/value/font/line_numbers/folding/readonly/soft_wrap/syntax. readonly는 사용자 편집을 막고 선택/복사를 허용한다고 명시. | caret·selection 조회/설정, selection event, reveal line/range, 외부 token spans/diagnostic decorations, undo/redo 명령, 개별 text edit API는 공개되지 않음. |
| `InputState` | `:21330–21366`: content/tokens, set_selected_range, replace, token replacement, value/set_value, focus, change 등 이벤트. | InputState의 메서드가 EditorState에도 있다는 가정. 현재 selection getter나 selection-change 이벤트도 없음. |
| `TextareaState` | `:21398–21424`: Input과 같은 범위·text/token API에 set_rows/set_auto_grow/set_soft_wrap/focus 추가. Textarea.new는 NativeElement. | 현재 caret/range 조회, line reveal, 내장 viewport scroll 위치, code folding/line numbers/language syntax 옵션, 외부 diagnostic API는 공개되지 않음. |
| 범위와 token | `:20670–20684`: InputRange는 half-open JavaScript UTF-16 offset. InputContent는 text와 InlineTokenSpan 배열. | InlineToken은 id/text/label을 가진 inline 입력 token이다. 언어 구문분석 토큰·문법 색 span API의 동의어가 아님. syntax highlighter의 범위를 그대로 이 token 배열에 넣으면 동일하게 동작한다는 근거 없음. |
| 입력 이벤트 | `:21316–21319`: InputEvent payload는 secondary/shift만 공개 | change/focus 이벤트에서 caret/selection/현재 수정 range를 읽을 수 있다는 가정. |
| `TextView` | `:20700–20709`: HTML/Markdown 표시, selectable/scrollable, link callback. HTML의 CSS는 미지원이라고 명시. | contenteditable, 실행 가능한 HTML/JS/CSS 환경, DOM, 편집 caret·범위 getter/setter. Markdown 표시 컴포넌트이지 browser/editor host가 아님. |
| 일반 GPUI wrapper | `:720–750`: plain div/h_flex/v_flex의 pointer/key 이벤트·size/focus 경로. `:345–348`: clipboard text 읽기/쓰기. | 키 이벤트만으로 OS 텍스트 입력·IME composition·marked text·텍스트 shaping·편집 undo manager를 완전히 구현할 수 있다는 보장. 공개 JS 입력-handler/IME bridge는 이번 조사 범위에서 확인되지 않음. |
| 파일 IO | 설치 `herdr.d.ts:23–28`: UTF-8 read 1MiB까지, local write는 expected snapshot 비교/atomic replace | runtime 편집기나 Textarea 자체가 1MiB까지 성능을 보장한다는 의미는 아님. 원격 write의 전체 원자성도 별도 문제. |

`caret_style`이라는 generic element 메서드가 있다는 이유로 Editor caret API가 있다고 볼 수 없다. 선언 `:21607–21618`의 구체 예시는 OtpInput이 소유한 caret template이며, native text editor의 현재 위치를 JS로 노출하지 않는다. key handler도 모든 component에 직접 연결되는 것이 아니다. `:732–746`은 Input/Editor 등에 붙인 일반 key/pointer handler가 실제 wired되지 않을 수 있으므로 plain wrapper와 focus 경로를 사용하라고 명시한다.

## 접근법 비교

| 접근 | 현 runtime에서 가능한 범위 | 필요한 선행조건 | 판정 |
| --- | --- | --- | --- |
| ① 기존 Editor 확장·재사용 | 이미 쓰는 native 입력·buffer·기본 syntax/line numbers/folding, Markdown preview, 저장/취소와 외부 shell 개선 | 현재 위치·범위와 selection 변화, 목적지 reveal, 외부 진단/span 표시를 host가 공개할 수 있는지 확인. 이 문서는 새 API signature를 설계하지 않음. | **우선 검토.** 기존 기능과 문서 수명 재사용이 가장 크다. JS만으로 부족한 capability를 명시하고 런타임 변경 가능 여부로 범위를 결정. |
| ②-a Textarea 기반 자체 wrapper | native multiline 입력, value 변화, 알려진 UTF-16 range 설정/치환, wrap, 외부 제목·도구줄·저장/preview 조립 | 아래 실험으로 범위 설정의 scroll 동작과 IME/undo 보존 확인. 현 caret/selection·viewport·syntax decoration 부족은 별도 해결 필요. | **기본 편집용 조건부 후보.** 기존 native 입력을 재사용하므로 from-scratch와 다르다. 현재 기능 전부를 유지하는 통합 코드 편집기의 즉시 대체품은 아님. |
| ②-b CodeView 위에 JS 편집 엔진 직접 구현 | 현재 source geometry·선택·진단·LSP·gutter를 재사용해 시각 prototype는 가능 | text model/증분 edit/undo, UTF-16↔glyph↔grapheme, OS 입력/IME·selection·접근성·scroll 동기화가 필요. 공개 입력 bridge의 적합성부터 검증 | **현재 요구에는 비권장.** 이미 native가 담당하는 복잡성을 다시 소유하게 된다. syntax 라이브러리 하나 추가로 해결되지 않음. |
| ②-c native host에서 기존 편집 라이브러리 재사용 | mod 바깥 host를 수정할 수 있다면 새로운 제어 API·decoration·입력 동작을 통합할 가능성 | host source/빌드·배포 권한과 기존 편집 엔진의 확장점 확인, 라이브러리 호환·라이선스·플랫폼 검토 | **조건부 가능.** 자체 Rust 편집 엔진을 새로 쓰기보다 기존 native 편집 라이브러리/현재 엔진의 확장을 우선한다. 이번 읽기 조사만으로 호환성·공수 확정 불가. |
| ③ Monaco/CodeMirror 웹 임베드 | 현재 mod에는 직접 사용할 DOM/WebView가 없음 | browser host, JS/CSS/worker 등의 실행 환경과 host bridge를 새로 제공해야 함. 각 라이브러리의 실제 요구는 부모 공식자료 조사에 따름. | **현 mod 단독으로 미지원.** standalone browser 열기는 제품 내부 임베드와 다르다. TextView.html로 대체할 수 없음. host 확장 사업으로 선택한 경우에만 재평가. |

설치 AGENTS.md:35–43은 mods에서 HTML/CSS/WebView/Node API를 사용할 수 없고 JS가 GPUI를 기술한다고 명시한다. 라이브러리 적극 활용은 이 경계를 건너뛸 근거가 아니다. DOM 없는 순수 text model/parser/highlighter를 번들로 가져오는 가능성과 browser editor 전체를 실행하는 것은 구분해야 한다. 해당 라이브러리의 runtime 의존성·메모리·증분 처리 적합성을 확인하기 전에는 이식 가능하다고 단정하지 않는다.

부모가 확인한 공식 자료도 이 host 경계와 일치한다. CodeMirror의 `@codemirror/view`는 DOM component이며 EditorViewConfig의 parent는 Element/DocumentFragment, root는 Document/ShadowRoot다. [CodeMirror 공식 reference](https://codemirror.net/docs/ref/)와 [기본 구성 예제](https://codemirror.net/examples/basic/)는 EditorView와 extensions를 조립하는 사용법을 제공한다. Monaco는 browser editor이고 언어 서비스가 web workers를 사용하며, file:// 사용과 VS Code extension 직접 사용에도 제한이 있다. [Monaco 공식 README/FAQ](https://github.com/microsoft/monaco-editor)와 [ESM 통합 문서](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md)는 DOM container와 worker bundling을 요구하는 통합 예제를 보여 준다.

따라서 판정은 라이브러리 도입 자체가 불가능하다는 뜻이 아니라 **현재 Herdr mod에는 필요한 browser host가 없으므로 임베딩 계층을 먼저 제공해야 한다**는 것이다. 그 계층이 생기면 검증된 EditorView/extensions 또는 Monaco engine을 재사용하는 선택을 다시 평가할 수 있다. 이번 조사에서 WebView·worker bridge를 추가하거나 두 라이브러리를 실행하지 않았다.

## Textarea wrapper의 실질적 가능성과 한계

기본 텍스트 입력과 Markdown 편집만 요구한다면 native Textarea를 감싸고 기존 EditorPane의 파일 수명·저장/취소·preview를 연결하는 것은 현실적인 작은 후보이다. 한글 입력과 native undo를 직접 재구현하지 않는다는 장점이 있다. 다만 기존 native 입력 엔진에서 사용자 undo/IME가 어떤 방식으로 보장되는지는 공개 인터페이스만으로 테스트 완료를 주장할 수 없으며, 특히 programmatic set_value/replace가 undo를 어떻게 다루는지는 별도 확인해야 한다.

| 필요한 기능 | Textarea에서 확인 가능한 대응 | 남은 제한·검증 |
| --- | --- | --- |
| 다중 행 buffer | value/content, set_value, change 이벤트, wrap/rows 지원 | 전체 string 조회/교체를 매 타이핑에 수행하면 큰 파일 비용이 생긴다. edit range/revision 이벤트가 없으므로 증분 변화 계산·큰 파일 성능은 별도 설계 대상. |
| 알려진 선택 범위·치환 | UTF-16 offset으로 set_selected_range와 replace 사용 가능 | caret/range **조회**는 없어 사용자가 이후 옮긴 커서에 추종할 수 없다. emoji/한글 grapheme과 LSP position encoding 변환도 문서 identity/revision과 함께 처리해야 한다. |
| 특정 행으로 이동 | 현재 text에서 행 시작 offset을 계산해 range 설정할 가능성 | set_selected_range가 해당 행을 **실제로 화면에 reveal/scroll**하는지는 선언에 보장 없음. 실제 native 실험 필요. selected range 설정만 보고 Go to Line 지원 완료로 판정하지 않는다. |
| 줄 번호 gutter | text의 line count로 외부 줄 번호를 그릴 수 있음 | wrap·내부 scroll·실제 line layout 위치를 읽는 공개 API가 없어 모든 화면에서 정확히 맞는 gutter 동기화는 입증되지 않음. plain wrapper 외부 scroll과 내부 입력 viewport는 동일하다고 가정할 수 없다. |
| syntax coloring | Input inline token template는 존재 | 자유로운 코드 text span 색 지정 API는 확인되지 않음. 입력 text를 숨기고 syntax layer를 겹치는 우회는 cursor/IME/accessibility·scroll/selection 동기화가 필요하여 KISS 해법으로 권장하지 않는다. |
| 진단 밑줄·LSP | 외부 Problems/정보 패널에 진단을 표시하는 것은 기존 기능 재사용 가능 | 입력 text 안에 외부 range decoration 삽입·hover hit test·커서 기반 definition/completion은 공개 API 부족. 편집 입력과 무관한 별도 source 복사본의 밑줄을 동등 기능으로 보고하지 않는다. |
| 긴 파일 | Textarea에 선언상 명시적인 문자 수 제한은 없음 | 무제한 처리 보장이 아니다. 현재 파일 read1MiB/EditorPane400k readonly 정책을 유지한 실험부터 필요. 줄수·한 줄 길이·wrap·IME·programmatic replace 성능을 확인해야 함. |

단기 실험은 소형/긴 multiline value, 한국어 조합, emoji 포함 range 설정, 선택 후 replace, undo/redo, 맨 끝 행 range 지정 시 실제 scroll, wrap 전후 gutter 위치와 scroll을 대상으로 하면 충분하다. 이 실험은 구현 재개 이후의 작업이며 이번 감사에서 수행하지 않았다. 결과가 좋아도 현재 selection getter와 decorations 부재를 해결하지는 않는다.

## 현재 요구별 필요한 변경 항목

| 현재 요구 | 이미 유지할 것 | 변경 또는 결정이 필요한 최소 범위 |
| --- | --- | --- |
| 커서와 선택 범위 | native Editor 사용자 입력/선택; CodeView 읽기 범위 선택 | 하나의 editable 문서를 소유할 입력 엔진 선정. 현재 caret/range 조회·변화·설정 가능 여부를 확정하고 status/명령/context를 그 소유자에 연결. 단순 가짜 caret state를 별도 유지하지 않음. |
| 줄 이동/검색/Problems jump | CodeView reveal와 검색/탭의 path/on/line/col identity | editable 엔진의 실제 reveal 보장. 미지원이면 파일 열기와 정확한 위치 이동을 구분하고 통합 완료 판정을 유보. |
| 진단 | 기존 diagnostics 모델·밑줄 renderer·Problems·copy/AI 동작 | unsaved text의 revision별 진단과 입력 영역 decorations 연결. native가 decorations를 공개하지 않으면 밖의 Problems 표시까지만 범위를 명시. |
| LSP | 기존 engine 요청·identity/stale guard·symbols/definition/references 등 | 실제 caret/selection, 변경 중 buffer와 language server snapshot 연결. 원격 지원과 local-only 기능을 기존 경계대로 보존. 새 LSP 엔진/API를 이 감사에서 만들지 않음. |
| Markdown 원문/preview | T02/T06의 같은 native buffer, Edit/Preview, codebench split | native 입력 엔진이 바뀌어도 preview가 unsaved value를 읽고 undo/dirty를 보존. Source viewer와 editable mode의 label·저장 소유권을 혼동하지 않음. MDX 실행/웹앱 렌더링은 현재 요구 밖. |
| 저장·취소·닫기 | optimistic write, 추가 입력 dirty, workspace buffer·close token | 엔진 교체 시 기존 EditorPane 문서 수명 재사용. 경로+machine+workspace+revision 확인. 새 persistence/cache와 speculative multi-document framework 추가는 필요하지 않음. |

기능이 같아 보이는 source 선택기와 editable caret를 DRY라는 이유로 억지로 합치지 않는다. 공통화는 문서 identity·진단 모델·gutter/색 같은 실제 공유 부분에 한정한다. YAGNI에 따라 요구에 없는 VS Code급 확장 API·minimap·multicursor·자체 parser/editor core는 이번 변경 목록에 포함하지 않는다.

## 다음 결정에 필요한 근거

1. 현재 Editor의 필요한 capability를 host가 제공할 수 있는지 먼저 확인한다. 가능하면 현재 native library/engine 확장으로 요구를 충족하고 기존 저장/Markdown 동작을 재사용한다.
2. host 확장이 어렵다면 Textarea wrapper의 작은 native 실험으로 기본 편집 요구를 어디까지 충족하는지 판정한다. plain multiline 편집으로 범위를 좁힐 수 있는지와 LSP/진단/정확한 위치 이동의 미지원 부분을 함께 결정한다.
3. 웹 임베드를 택하려면 DOM/WebView 제공 자체가 별도 host 작업임을 범위에 포함하고, 부모가 조사한 라이브러리 공식 요구에 맞추어 평가한다. 현재 mod 코드에 라이브러리를 복사하는 단계부터 시작하지 않는다.

실제 구현 전에는 현재 native와 CodeView를 모두 보존한다. codebench 레이아웃·키맵·terminal data·panel geometry, local/remote identity, viewer/review/database 라우팅은 별도 계약으로 유지한다. 이번 결과는 가능성 조사이며 수정·설치나 API 지원이 추가되었다는 보고가 아니다.
