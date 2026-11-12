# T22 단일 편집기·LSP 현재 계약 심화 조사

2026-11-06. 읽기 전용 소스 조사. 소스·설치본·LSP 설정을 변경하거나 실제 서버를 시작하지 않았다. 새 API 형식이나 구현 아키텍처를 제안하지 않고, 현재 제공되는 계약과 단일 editable editor에 필요한 능력·검증 순서만 분리했다. 파일 줄 번호는 조사 시점 기준이다.

## 결론

현재 구성은 **저장된 로컬 파일을 읽는 탐색용 LSP client**와 **LSP를 연결하지 않은 native editable buffer**가 분리돼 있다. 편집 가능한 화면으로 바로 열도록 라우팅만 바꾸면 LSP·진단·Structure·caret UX를 함께 옮긴 것이 아니다.

- `codenav/code.js`는 디스크 텍스트로 자체 행·선택·스크롤·진단·문서화를 그린다. hover/정의/참조/심볼은 실제 LSP 요청이다.
- `activity/editor.js`는 `EditorState`가 소유한 editable buffer·native 입력/undo·저장·dirty 전환 보호를 사용한다. change 이벤트에서 LSP 요청이나 텍스트 동기화를 하지 않는다.
- Go engine의 `didOpen/didChange`는 편집 이벤트가 아니라 **semantic 요청 직전의 디스크 재읽기**에서 발생한다. 미저장 텍스트는 이 경로에 들어오지 않는다.
- completion/rename/format 요청과 `TextEdit`/`WorkspaceEdit` 적용 파이프라인은 없다. 서버가 `workspace/applyEdit`를 요청하면 명시적으로 거부한다.
- 설치된 `EditorState` 공개 계약에는 caret/selection/reveal/range edit/undo transaction/diagnostic decoration API가 없다. JS에서 `set_value`만 호출해 이 기능을 대체하면 동일 UX·undo를 보존했다고 검증할 수 없다.

## 1. 현재 표시·문서 소유권

| 구간 | 현재 계약 | 단일 편집 시 영향 | 근거 |
| --- | --- | --- | --- |
| 열린 문서 지정 | `shared("activity.editor")[editorKey()]`의 spec: path/on/kind/root/line/col 등. editor area는 `@area:<space id>`로 workspace 구분 | 문서 선택·탭·외부 이동의 기존 진입점 재사용 가능 | `mods/codenav/common.js:62–79` |
| viewer/edit routing | 일반 텍스트는 `!spec.edit`일 때 code child, edit flag/미디어는 text child. dirty/saving/닫기 확인 중에는 text child 유지 | code child 제거 전 dirty 보호와 review/database/media 분기 유지가 필요 | `common.js:82–99` |
| 읽기 화면→편집 | `Code.edit()`는 spec에 `edit:true`와 행을 넣고 text child 선택 | native editor는 line/col을 실제로 reveal하지 못하므로 현재도 caret 이동 인계가 완성되지 않음 | `mods/codenav/code.js:497–502`; `mods/activity/editor.js:103–109` |
| editable buffer | `EditorState.new`가 원문/문법/line numbers/folding을 보유. 동일 문서 재선택은 native state를 교체하지 않음 | native 입력·선택·copy·undo 유지에 사용할 기반 | `activity/editor.js:103–109`, `:168–190`, `:407` |
| workspace 전환 | dirty/saving buffer를 `workspaceBuffers`에 workspace key별 보관. 같은 workspace의 다른 파일은 미저장 변경 확인을 거침 | 모든 파일 탭이 독립 buffer/undo를 갖는 문서 저장소가 이미 있는 것은 아님. clean 파일 변경은 release/reload | `activity/editor.js:110–136`, `:143–155` |
| 저장 상태 공개 | `activity.editorState[key]`는 path/on/dirty/saving만 공개 | 텍스트·revision·selection·caret는 이 shared 계약에 없음 | `activity/editor.js:62–69` |

여기서 제거 대상인 code viewer와 `activity/viewer.js`의 이미지/PDF/media/binary viewer는 구분해야 한다. 후자는 일반 소스 편집기로 대체할 대상이 아니며, 현재 라우팅에서 별도 기능을 제공한다.

## 2. end-to-end 실제 흐름표

| 단계 | 현재 실행 흐름 | 재사용 가능 / 없는 부분 | 근거 |
| --- | --- | --- | --- |
| 파일 열기 | spec→Code.sync→readTextFile→lines/token/UI, 별도 edit 진입 시 EditorPane→readTextFile→EditorState | 파일/machine 식별·읽기·native state 생성 재사용. 두 읽기 화면을 같은 buffer로 공유하지 않음 | `code.js:72–166`; `activity/editor.js:145–191` |
| 사용자 입력 | `EditorState.on("change")`→`value() !== original`로 dirty 계산→dirty 전환 시 shared state 공개 | native buffer 값 읽기 가능. revision 증가·변경 range·caret 획득·LSP 전송 없음. dirty가 이미 true인 후속 change는 일반적으로 별도 notify도 하지 않음 | `activity/editor.js:180–190` |
| 미저장 텍스트→서버 | 연결 없음 | 없는 핵심 capability. Request에 Text 필드가 있다는 사실은 semantic LSP sync 지원이 아님 | `engine/lsp.go:31–46`; `engine/main.go:321–343` |
| LSP 프로세스 확보 | `lsp(method,body,sleep)`→로컬 loopback 인증 HTTP→Go `Server`→언어/root별 process 캐시→initialize | 설치검증·프로세스 재사용·기동·실패 복구·RPC 전송 재사용. 원격 machine별 서버 라우팅은 없음 | `mods/codenav/lsp.js:11–18`, `:60–100`; `engine/lsp.go:283–350` |
| didOpen/didChange | semantic dispatch가 `srv.Open(ctx,req.Path)` 호출. `Open`은 `os.ReadFile`, UTF-8 정규화, 이전 disk text와 비교. 최초 version1/didOpen; 변경 때 version+1/didChange | saved text sync만 구현. Full sync는 전체 text, incremental 서버에는 이전 문서 전체 range를 새 text로 교체하는 1개 change 사용 | `engine/main.go:339–348`; `engine/lsp.go:823–869` |
| 진단 수신 | server `publishDiagnostics`→`diagnostics[uri]` 캐시. version은 파싱하지 않음 | 실제 서버 publish 수신 재사용. buffer revision과 대응하거나 오래된 진단을 제외하는 계약 없음 | `engine/lsp.go:673–690` |
| 진단 표시 | Code load 후 300/1500/4000/8000ms 순차 대기하며 diagnostics HTTP 조회→items/busy→Code.diags→native UI 장식과 shared publish | 기존 severity/source/code/범위, Problems 목록과 tooltip 재사용 가능. editable EditorState에 decoration 전달 경로 없음 | `code.js:162–178`, `:547–568`, `:683–746`, `:981`; `engine/main.go:397–423` |
| hover/definition/references | Code의 자체 sel→path/line/col→HTTP→Open(disk)→LSP Call→결과 transform→현재 context 확인→문서화/결과 목록/이동 | 로컬 saved-file navigation 재사용. editable caret에서 요청 위치를 얻는 연결 없음 | `code.js:397–463`; `engine/main.go:349–384` |
| completion/rename/format | 경로 없음 | 새 서버 method를 호출하는 것만으로 끝나지 않음. 결과 처리·편집 적용·undo/dirty/save도 모두 필요 | `engine/main.go:235–244`, `:348–446`; `engine/lsp.go:748` |
| TextEdit 적용 | 일반 LSP edit apply 없음. `workspace/applyEdit`는 `applied:false`, 이유 `read-only navigation client` 반환 | 적용 범위·revision 검증·다중파일·문서생성/이동·undo 정책 없음 | `engine/lsp.go:727–728` |
| undo | native editor 내부 입력에 맡김. public API에는 undo grouping/transaction/range replacement 없음 | native 입력 undo를 유지하는 것이 기본. `set_value`의 undo 보존 의미는 공개되지 않음 | 설치 `~/.config/herdr-app/gpui-kit.d.ts:21430–21459` |
| save | buffer value snapshot→local writeTextFile(path,text,original) 또는 remote compare-write→성공 시 original 갱신, 저장 중 추가 입력은 dirty 유지→close approval/탭 전환 처리 | CAS 저장·실패 표시·dirty/close/배경 workspace 보호 재사용. didSave 없음; 저장 뒤 viewer watch/후속 semantic 요청에 의해 disk sync 발생 | `activity/editor.js:268–313`; initialize `engine/lsp.go:748` |

`Request.Text`가 실제로 사용되는 경로는 `tokens`의 syntax 입력과 Spring 분석 일부다. `tokens`는 LSP semantic tokens가 아니라 `syntaxTokens(text,path)`다. remote 파일도 로컬 engine에 원문을 보내 lexical tokenizing은 할 수 있지만 이것이 remote LSP 지원을 뜻하지 않는다 (`code.js:140–143`, `main.go:321–331`).

## 3. 요청 지원 범위

| 기능 | 현재 지원 | 주의점 |
| --- | --- | --- |
| hover | `textDocument/hover`→markdown | IDEA는 명시적 documentation 요청에서 실행하고 일반 pointer hover에서는 반환. 기존 viewer가 editor mouse-hover LSP를 이미 구현한 것은 아님 (`code.js:400–404`) |
| definition/typeDefinition/implementation | definition HTTP route의 kind 분기 | `Location`과 `LocationLink` 양쪽을 normalize, library URI materialize 지원. 읽기 전용 외부 소스 처리 포함 (`main.go:363–383`, `lsp.go:923`, `:1044–1095`) |
| references | includeDeclaration=true, 결과 500개 제한 | 전체 결과 수나 paging 계약 없음 (`main.go:366–381`) |
| document symbols | documentSymbol→flatten | hierarchical symbols를 기존 Structure 모델로 변환 (`main.go:385–396`, `:481`) |
| workspace symbols | workspace/symbol, 최대300개 | 이 route도 먼저 req.Path로 server/Open을 수행. 단순 workspace query만으로 작동하는 독립 계약이 아님 (`main.go:339–343`, `:424`) |
| diagnostics | push 수신 후 HTTP polling | pull `textDocument/diagnostic`, relatedInformation, version filtering 없음 |
| Spring/super/type navigation | parser/index와 관련 LSP 사용 | 별도 현 기능으로 보존 대상. 일반 completion·rename 지원으로 간주하지 않음 |
| completion/resolve/signatureHelp | 노출 route 없음 | completion popup/선택/accept/additionalTextEdits/snippet 적용도 없음 |
| rename/prepareRename | 노출 route 없음 | 다중문서 edit 안전 적용 없음 |
| formatting/rangeFormatting | 노출 route 없음 | 반환 edit의 buffer 적용·undo grouping 없음 |
| codeAction/executeCommand | 노출 route 없음 | diagnostics quick fix 적용 없음 |
| didSave/didClose | 전송 없음 | 초기화에서 didSave:false. UI 파일/탭 닫힘을 서버 document lifecycle과 연결하지 않음 |

server capabilities는 저장하지만 현재 일반 navigation 요청에서 개별 provider 지원 여부를 UI에 제공하거나 분기하지 않는다. 노출된 `info`는 lang/root/installed/command/state/busy 위주다. 따라서 설치됨과 해당 기능 지원됨은 같지 않다 (`lsp.go:768`, `main.go:275–304`).

## 4. revision·위치·machine·stale 계약

| 항목 | 이미 있는 보호 | 부족하거나 위험한 점 |
| --- | --- | --- |
| 문서 identity | `documentIdentity=[space,on,kind,path]`, sync의 loadedKey, 요청 context의 seq/space/identity 검사 | text revision이 아님. 같은 문서 미저장 입력은 Code의 seq/identity를 바꾸지 않음 (`editor-model.js:2–5`, `code.js:78–100`) |
| semantic stale 응답 | hover는 sel 객체+generation, definition도 sel+generation, references는 requestContext+generation | references는 sel 객체를 추가로 비교하지 않아 caret만 바꾸고 새 references 요청을 하지 않으면 이전 위치 결과가 나올 수 있음. 통합 시 revision/position 기준을 별도로 검토 (`code.js:405–408`, `:419–424`, `:453–460`) |
| server document version | Open의 doc.text/version, docMu로 sync 직렬화 | 버전은 engine disk snapshot의 증가수다. UI editor revision을 받거나 결과에 되돌려주지 않는다. Open lock 해제 후 semantic Call까지는 별도 구간이므로 동시에 오는 요청을 특정 문서 snapshot에 귀속하는 계약도 없음 |
| diagnostics stale | UI load context가 파일/space 전환 응답을 막음 | publishDiagnostics version 미수집, Open 변경 후 이전 진단 캐시 즉시 제거 안 함. 새 disk sync 직후 diagnostics 요청이 직전 문서 진단을 반환할 수 있음. 고정 횟수 polling 종료 뒤 늦게 도착한 진단은 추가 요청 없으면 표시되지 않음 |
| 위치 단위 | JS offsetAt은 UTF-16 string offset, tab/CJK display column을 UTF-16으로 변환. Go initialize utf-16만 광고·검증. change endPosition도 UTF-16. LSP request line/col은0-based | native caret/selection의 단위는 API에 아예 노출되지 않으므로 viewer의 단위가 native 입력에도 자동 적용된다고 보장할 수 없음. surrogate pair/CRLF/emoji/탭/결합문자 검증 필요 (`common.js:226–252`, `lsp.go:748–792`, `code.js:397`) |
| UI navigation 단위 | LSP result line0→spec line+1, col은 UTF-16 그대로. openPath의 표시 문자열은 col+1을 다시0-based로 파싱 | native EditorPane은 spec.line/col을 native caret로 적용할 공개 API가 없어 Problems/Structure/definition 이동을 편집 화면으로 전환만 하면 점프 UX가 소실됨 (`code.js:211–228`, `common.js:114–119`, `activity/editor.js:103–109`) |
| machine 경계 | source spec.on과 shared snapshot의 on/space 일치 검사, remote semantic LSP는 명시적으로 비활성 | engine Request에는 on/machine이 없고 local disk `file:` URI만 사용. 동일 경로의 remote/local을 합쳐서는 안 됨. Structure의 jump helper는 machine을 넘기지 않지만 현재 remote symbols는 생성하지 않아 가려져 있음 (`tools.js:292–307`, `common.js:69–72`) |
| tool-window publish | Code가 caret/symbols/problems에 path/on/space를 붙이고 현재 context를 다시 확인한 deferred publish. problemFiles는 최대100개 | publisher는 editable buffer가 아니다. editorSnapshot에도 revision이 없다. hidden Code가 disk 상태를 계속 publish하면 editable text와 다른 Problems/Structure가 보일 수 있음 (`code.js:547–568`, `tools.js:296`, `:329`) |
| 취소·재시도 | LSP RPC context timeout/cancel→$/cancelRequest. HTTP handler 최대120s. transport 오류 때 read-navigation request 재시도 | editor 입력 때 semantic 요청을 취소하는 연결 없음. HTTP request에 editor generation/cancellation token도 없음. 현재 자동 재시도는 읽기 요청 중심이며 미래 mutating operation을 같은 의미로 재사용해서는 안 됨 (`lsp.go:602–632`, `main.go:229`, `mods/codenav/lsp.js:85–97`) |

## 5. 재사용 자산과 확인이 필요한 capability

### 그대로 활용할 수 있는 현 자산

- native `EditorState` 생성·유지·release, change/value, local/remote CAS 저장, 저장 중 추가 입력과 workspace 전환 보호, close Save/Discard/Cancel.
- loopback engine transport 인증·설치 identity·server process lifecycle·언어/root별 캐시·UTF-16 negotiation·RPC cancellation·기존 navigation normalization.
- existing Problems/Structure/caret shared 데이터 소비자와 진단 severity/source/code 포맷, 결과 목록·documentation 카드·이동 spec.
- viewer의 machine/workspace identity와 요청 generation 방어, UTF-16/display 좌표 변환 규칙, history 경계.

### 현재 없거나 공개 계약이 부족한 능력

1. editable document의 원문·revision·변경 순서를 semantic 요청과 연동하는 능력. editor change→server didChange가 실제로 연결돼야 한다. 저장해서 서버를 갱신하는 우회는 미저장 LSP 지원이 아니다.
2. native caret/selection 조회·이벤트와 programmatic reveal/selection, 동일 native buffer의 범위 편집·하나의 undo 단위로 edit 적용하는 능력.
3. native editor에 diagnostics underline/gutter/overview, inline hover targets, completion popup 및 accept와 관련된 위치·표시 능력. 현재 built-in editor의 설정은 syntax colors/line numbers/folding 수준이다.
4. 서버 응답을 동일 document identity+text revision+위치에 귀속하고 늦은 diagnostics/semantic 응답을 거르는 능력.
5. completion/rename/format/code-action 지원 여부와 결과를 buffer에 안전하게 적용하는 능력. `workspace/applyEdit` 거부를 제거하는 것만으로 완료되지 않는다.
6. 다중 문서 수정의 dirty/undo/save/파일 생성·이동·삭제 및 외부 변경 충돌 처리. 현재 native buffer 보관은 workspace당 dirty/saving 문서 중심이다.
7. document open/close/save lifecycle, hidden buffer diagnostics와 active tool-window publication의 소유권. 종료·탭 닫힘·server restart 시점의 일관성이 필요하다.

설치 타입상 `EditorState`가 제공하는 것은 `value`, `set_value`, `on(change|submit|focus|blur|paste_other)`, `release`다 (`~/.config/herdr-app/gpui-kit.d.ts:21430–21459`). `set_value`는 readonly 상태에서도 전체 교체할 수 있지만 selection 보존·undo grouping·range edit semantics는 문서화돼 있지 않다. 이 API만으로 동일 editing/LSP UX가 가능하다는 결론을 내릴 수 없다.

## 6. 실행 계획 검토용 순서와 통과 근거

새 API 구현 설계에 앞서 아래 단위로 현재 계약의 유지 여부를 판정한다.

| 순서 | 확인/작업 범위 | 통과 증거 |
| --- | --- | --- |
| 1 | 단일 editable source 화면으로 옮길 기존 UX 목록 고정: selection, find, comment, history, 진단, Structure, Problems, HTTP/Spring, 외부 library, 미디어/Markdown/review 분기 | viewer 기능을 잃는 항목·native에 이미 있는 항목·런타임 능력이 없는 항목을 구분한 mapping. codebench 분기와 read-only library 정책 명시 |
| 2 | native editor 공개 능력 검증 | 실제 설치 runtime에서 caret/selection/reveal/diagnostic/edit/undo 지원 여부에 대한 타입·실행 근거. 지원하지 않으면 unified editor 완료로 판정하지 않음 |
| 3 | 미저장 text와 server snapshot 일치 검증 | fake LSP에서 UI 변경 내용이 disk save 없이 didOpen/didChange로 전달되고, 동일 revision의 hover/symbol/diagnostics가 돌아오는 로그. 연속 입력·취소·server restart·같은 경로 다른 space/machine 포함 |
| 4 | 현재 읽기 semantic 기능 먼저 보존 | hover/definition/type/implementation/references/outline/Problems를 editable caret에서 실행; UTF-16 emoji/한글/탭/CRLF 위치, definition line reveal와 history 복귀, 늦은 응답 차단 확인 |
| 5 | 편집 결과가 있는 기능의 capability 확인 | completion accept/additional edits, rename 다중파일, format을 각각 원문 revision 검증→native edit→한 번의 undo→redo→dirty 유지→명시 save로 검증. 저장 전 disk가 바뀌지 않고 실패 시 일부만 적용되지 않는지 확인 |
| 6 | 기존 보호와 수명 회귀 | 저장 CAS 거부, 저장 중 입력, workspace/파일/탭 변경, dirty close Save/Discard/Cancel, hidden buffer, 외부 파일 변경, same path local/remote 분리, parent published state 검증 |
| 7 | viewer 제거 판정 | 위 능력과 기존 기능 coverage가 확인된 이후에만 code child/전용 publisher·명령 소유권의 중복 제거 범위를 결정. 라우팅 변경만으로 제거 완료 판정하지 않음 |

현 테스트 근거는 제한적이다. `engine/core_test.go:211–294`의 `TestLSPProcessLifecycle`는 fake server로 process 재사용, didOpen 중복 방지, **디스크 파일 변경 이후** didChange, UTF-16 full-range end, 진단 캐시와 progress를 검증한다. `:573`의 token span 테스트와 Spring/related UTF-16 테스트도 존재한다. 이는 미저장 editor 동기화·native caret·edit transaction·undo·completion/rename/format의 증거가 아니다. 이번 조사에서는 테스트 실행이나 서버 설정 변경을 하지 않았다.
