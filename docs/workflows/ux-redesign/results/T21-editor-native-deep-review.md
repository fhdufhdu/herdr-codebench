# T21 native 편집기 통합 심화 검토

2026-11-06. 목표는 source viewer와 editor의 UI/UX를 통일하고 **수정 중 buffer에 LSP를 연결한 뒤 기존 source viewer의 역할을 대체**하는 것이다. T20의 일반적인 가능성 비교를 넘어, 현재 기능 손실과 대체 완료 조건을 검토했다. 코드·설치·runtime은 변경하지 않았다. host/upstream 라이브러리와 LSP pipeline의 상세 조사는 다른 담당 결과와 결합해야 한다.

## 선택 판단

**기존 native Editor를 재사용하고 필요한 host 제어를 확장하는 경로가 우선이다.** native Editor에는 이미 code syntax palette·줄 번호·brace folding·readonly·wrap·font 생성 옵션이 있다. 이 입력 엔진을 유지하면 현재 EditorPane의 buffer·저장·dirty·Markdown 수명을 재사용하면서 CodeView의 언어 기능을 옮기는 데 집중할 수 있다. 그러나 position API 몇 개를 추가하는 것만으로 완료되지는 않는다. unsaved 문서의 server 동기화, revision별 응답 적용, 편집 transaction, 실제 editable 영역의 decoration/hit testing, focus와 탐색 경로까지 필요하다.

Textarea wrapper는 native 입력 엔진을 재사용하는 유효한 대안이지만 이 목표에서는 **host 확장을 피하는 지름길이 아니다.** 공개 API상 selection range 설정·focus·replace는 Editor보다 유리하다. 반면 native Editor에 이미 있는 code syntax·line numbers·folding은 없고, 현재 selection 조회·selection event·reveal 보장·viewport/decorations도 없다. 이 차이를 JS wrapper에서 메우면 editor engine 위에 또 하나의 레이아웃·선택·시각 상태를 만들 위험이 크다. Editor host가 구조적으로 확장 불가능하고 Textarea 쪽 host가 필요한 제어를 더 쉽게 제공한다는 근거가 나올 때만 통합 code editor 후보로 승격하는 것이 타당하다.

## 이번 비교의 정확한 근거

- 설치 `gpui-kit.d.ts:21430–21459`: EditorState의 공개 메서드는 value/set_value/on/release. 생성 옵션은 language/value/font_family/font_size/line_numbers/folding/readonly/soft_wrap/syntax다. folding은 brace-based라고 명시한다. caret/selection·reveal·외부 diagnostics·편집 transaction·focus 메서드는 공개되지 않는다.
- 설치 `gpui-kit.d.ts:21398–21427`: TextareaState는 content/tokens/set_selected_range/replace/value/set_value/on, rows/auto_grow/soft_wrap/focus/release를 공개한다. 현재 범위 getter·selection event·line/offset reveal·내부 scroll viewport·구문분석/줄번호/folding·diagnostic decoration은 선언에 없다.
- `gpui-kit.d.ts:20670–20684`, `:21316–21319`: InputRange는 half-open UTF-16 offsets, InputEvent에는 secondary/shift만 있다. inline token은 id/text/label을 가진 입력 token으로, arbitrary syntax spans의 대체 API가 아니다.
- `gpui-kit.d.ts:732–750`: key/pointer handler는 지원되는 wrapper와 focus 경로에 연결해야 한다. Input/Editor에 임의 generic handler를 붙여 native 내부 이벤트를 가로챌 수 있다고 가정하면 안 된다.
- `mods/activity/editor.js:99–138`, `:159–191`, `:269–300`, `:356–407`: buffer identity·workspace 보관·저장 당시 snapshot 보호·EditorState 생성·Markdown same-buffer preview가 구현돼 있다. native 엔진을 교체해도 재사용할 계약이다.
- `mods/codenav/code.js:111–173`, `:200–245`, `:314–389`, `:397–484`, `:537–571`, `:684–746`: source의 token/LSP·위치 이동·범위 선택·진단·탐색·상태 publish가 따로 구현돼 있다. 읽기 상태의 `this.sel`은 native 입력 caret가 아니다.
- `mods/codenav/common.js:84–98`: 현재 source/edit 라우팅이 다르며 dirty/saving 문서는 native EditorPane을 우선한다. `code.js:497–501`의 Edit 전환은 source 선택 행을 넘기지만 EditorPane은 공개 reveal API가 없어 실제 caret 이동을 replay하지 못한다(`editor.js:106`).

위 메서드가 공개되지 않았다는 사실은 host 내부에서도 구현할 수 없다는 뜻이 아니다. 실제 native 확장 난도·확장점은 부모의 host/upstream 조사로 확인해야 한다. 반대로 public generic style 메서드가 존재한다고 Editor의 내부 caret/selection/gutter painting까지 바꿀 수 있다고 단정하지 않는다.

## 기능별 회귀와 추가 요구

아래에서 ‘유지’는 현재 source에 이미 있는 기능의 이전이고, ‘신규’는 현재 CodeView/EditorPane에서 지원 근거를 찾지 못한 기능이다. native 실제 IME/undo/키보드 동작은 선언과 현재 사용 사실을 넘어 이번 조사에서 실행 검증하지 않았다.

| 기능 | 현재 기준 | 기존 Editor 재사용+host 확장 | Textarea wrapper의 손실·추가 작업 |
| --- | --- | --- | --- |
| IME·한글·emoji 입력 | EditorPane은 native Editor 사용. JS CodeView는 입력 엔진 아님 | native 입력 경로 유지. LSP 전송/decoration이 조합 중 텍스트와 selection을 강제로 바꾸지 않는지 확인 | native Textarea 입력 경로 재사용 가능. 조합/undo 보장과 programmatic replace가 조합을 깨는지는 실제 검증 필요. 키 이벤트로 한글 조합을 재구현하지 않음. |
| undo/redo | 같은 EditorState 재선택/preview 왕복에서 buffer 유지. 공개 undo 명령·transaction API 없음 | 같은 native undo history 보존. completion/format edits를 한 사용자 작업으로 undo할 수 있는 host edit transaction 필요 | native 사용자 undo를 활용할 가능성은 있지만 set_value/replace의 undo 의미가 공개되지 않음. 매 change 전체 set_value나 외부 overlay 재생성은 피해야 함. |
| focusing | source는 focus_handle, find 입력은 InputState.focus. EditorState.focus는 미공개 | editor 본문·find·completion·hover/context·preview 전환의 focus 왕복을 native owner 기준으로 검증/보강 | TextareaState.focus가 공개된 점은 장점. 하지만 popup가 입력 focus/selection을 빼앗거나 composition을 끝내는 문제는 별도 관리. |
| search·Go to Line·위치 기록 | CodeView.findNext `:484`와 reveal `:200`, history `:210–231`, 검색/Problems 경로가 line/col 전달 | editable text 검색과 실제 range 선택/reveal, 뒤/앞 위치 복원 이전. native 공개 find/reveal API는 현재 없음 | UTF-16 offset range 설정은 가능하지만 그 행이 화면으로 scroll되는 보장 없음. find highlights/현재 hit·viewport 연결은 새 작업. |
| folding | native Editor에 brace folding 생성 옵션. CodeView에는 동등 editable folding 구현 없음 | 기존 folding 유지. folded 대상에 jump/진단 이동 시 unfold/reveal 정책 확인 | Textarea에 folding API 없음. 실제 줄 숨김·논리행/화면행 대응·selection과 scroll 재매핑까지 필요하므로 wrapper만으로의 동등 대체는 어려움. |
| syntax·tokenization | native는 language+syntax palette. CodeView는 engine tokens로 span 색 렌더링 | native syntax 재사용. server semantic tokens를 추가 요구한다면 외부 span 주입과 buffer revision 연계 별도 필요 | language/syntax 옵션 없음. inline token chips를 source syntax span으로 쓰는 우회는 동등하지 않음. 자유 span rendering 또는 host text decoration 확장이 필요. |
| gutter·행 번호·markers | native 줄번호. source는 자체 geometry, git change·comments·HTTP/Spring/navigation markers (`code.js:246–309`, `:572–581`, `:664–681`) | native 줄번호/folding 유지하며 gutter marker 확장·line hit mapping을 제공할 수 있는지 확인. source의 marker data/동작 재사용 | 기본 줄번호도 외부 조립 필요. 내부 scroll/wrap/shaping 위치가 공개되지 않아 정확한 동기화가 blocker. 동일 text를 두 겹 그리는 접근은 IME/selection/accessibility 위험. |
| diagnostics·Problems·F2 | source 밑줄/hover와 Problems publish/nextProblem 존재. native에는 외부 진단 API 없음 | unsaved revision별 진단을 editable range에 그리고 Problems/F2가 실제 위치로 이동. stale 진단 제거·실패/미지원 상태도 이전 | Problems 패널 자체는 재사용 가능하나 text 안의 밑줄·hover bounds·range mapping은 해결되지 않음. 옆의 별도 읽기 복사본에만 밑줄을 그리면 목표 미달. |
| selection·copy·status | source span/line drag/copy와 caret publish; native 사용자 선택/복사 | 현재 범위 조회·change event·설정/reveal과 status/명령을 한 native 상태로 연결 | setter와 replace는 장점. getter/event 부재 때문에 클릭/드래그/키 이동 후 실제 범위를 JS가 알 수 없음. 별도 shadow selection은 불일치 위험. |
| completion | 현재 source UI/공개 route에서 구현 근거 없음 | **신규**. server capability·요청/취소·popup·range edit/additional edits·commit/IME·undo가 필요. caret 조회만으로 완성 아님 | 같은 신규 범위에 syntax/selection/viewport 제약이 더해짐. native replace만으로 completion 전체를 대체할 수 없음. |
| hover·definition·references·implementation | `code.js:397–464`는 local LSP/설치 상태 확인, generation/identity/선택 변경 guard 사용. idea documentation은 명시적 실행 | 수정 중 buffer의 해당 revision/position으로 요청하고 stale 응답을 버림. editable caret/selection anchor와 실제 target reveal로 연결 | 현재 범위 getter 부족으로 caret기반 위치 결정 불가. 알려진 range 지정과 실제 사용자 caret 읽기를 구분해야 함. |
| format·rename | 현재 source UI/공개 route에서 구현 근거 없음 | **신규**. workspace edits·버전 충돌·다중 파일·dirty 문서·undo·preview/확인 정책 필요. 단순 full-text set_value로 완료 아님 | 같은 신규 범위에 native edit transaction 제약 추가. 엔진을 바꾸어도 LSP editing 기능은 생기지 않음. |
| remote | 두 view 모두 on/path identity로 read. source의 `lspReady():398`은 !shown.on 조건이며 remote 로드 `:143`에서 local LSP 절차 종료 | 원격 파일 편집·저장/실패·identity 유지. 기존 local-only LSP 경계를 명시적으로 보존하거나 별도 구현. 원격을 local 파일 경로로 잘못 전송하면 안 됨 | 같은 IO 계약을 재사용 가능. Textarea 선택은 remote LSP 통합을 해결하지 않음. |
| large file·긴 줄 | readTextFile은1MiB, EditorPane400k 초과 readonly/truncated(`editor.js:20/172–177`). source에는 MAX_LINE/width 계산 제한 | 현재 안전한 제한·경고 유지. incremental edits/token/진단·긴 줄·wrap·scroll 성능 시험 후에만 정책 확대 | Textarea 문자 수 제한 미기재는 성능 보장이 아님. multiline 전체 value 비교·검색·외부 gutter 재계산은 큰 파일 부담 추가. |
| Markdown | T02/T06의 same-buffer Edit/Preview, codebench split. source에는 별도 Source/Preview | editable buffer 하나로 원문/preview·dirty/undo 유지. 수정 중 preview와 LSP 문서 수명이 어긋나지 않게 이전 | 단순 multiline+TextView preview는 가능한 장점. 코드 syntax/folding·LSP 요구까지 충족하는 것과 구분. |
| save·close·workspace | snapshot write·dirty/saving·pending navigation·close token·workspaceBuffers 계약 | existing EditorPane 수명 재사용. 저장 중 수정/이동/close·외부 변경·실패 회귀 필수 | 수명 자체는 재사용 가능하나 Textarea native state로 교체되는 시점·undo 보존·release를 재검증해야 함. |

completion/format/rename을 ‘현 viewer 제거 시 반드시 복구할 기존 기능’으로 계산하면 현재 상태를 과대평가한다. 반대로 ‘LSP 통합’이라는 큰 표현에 포함해 약속한다면 신규 구현과 검증 없이 완료로 보고해서는 안 된다. 제품의 명시적 지원 목록에 포함했는지를 acceptance에서 구분해야 한다.

## 공수 범주와 위험 집중점

시간 추정은 host 확장점·테스트 가능성·동일 플랫폼 지원 범위가 확인되지 않아 확정하지 않는다. 아래 범주는 작업 묶음의 상대적 크기다. S=기존 조립/정리, M=단일 경계 확장과 회귀, L=여러 상태 소유자·비동기 계약 변경, XL=새 text/layout engine 수준의 책임 추가다.

| 작업 | 기존 Editor 경로 | Textarea 경로 |
| --- | --- | --- |
| 통합 title/toolbar/tabs·Markdown shell | S–M: 기존 두 shell 공통 역할 정리 | S–M: 같은 문서 수명/shell 재사용 |
| position/selection/focus/reveal host 연결 | M–L: 현재 native editor 상태를 노출할 실제 확장점에 좌우 | M–L: range setter/focus는 있지만 getter/event/reveal 부족은 남음 |
| syntax/line numbers/folding | 기존 native 지원 재사용. UI 일치 조정은 M, 외부 semantic spans는 별도 L 가능 | L–XL: host 없이 JS만으로 동등성 확보 어렵고 layout 동기화 책임 확대 |
| gutter/diagnostic decorations·bounds | M–L: native line layout와 붙일 수 있는 host 확장 필요 | L–XL: 기본 gutter부터 내부 viewport와의 연결이 필요 |
| 수정 중 LSP와 stale/version/identity 계약 | L: 별도 pipeline 담당 범위와 통합 필요 | L: 같은 언어 pipeline 필요. Textarea로 바꿔도 감소하지 않음 |
| completion·format·rename 신규 기능 | L: transactional edits와 server/UI/undo 검증 | L–XL: 같은 기능에 Textarea의 layout/selection 제약 추가 |
| 기존 viewer 대체·모든 진입점·회귀 | L: 문서 owner와 명령 경계 이전 | L 이상: 추가로 잃는 native code 기능을 대체해야 함 |

‘caret getter 추가’만 M 크기로 보고 전체를 작은 UI 변경으로 견적 내면 안 된다. host가 이미 position/range/decoration/transaction을 가진 재사용 라이브러리라면 JS binding 추가는 줄어들 수 있다. 반대로 그 capability 자체가 없다면 Textarea를 골라도 문제를 새 wrapper로 옮길 뿐이다. 기존 library를 직접 활용할 수 있는 host 지점을 먼저 찾는 것이 사용자 요구인 YAGNI/KISS/DRY와 라이브러리 적극 사용에 맞는다.

## viewer 대체 완료 검증 기준

각 gate는 **통합 editable 영역에서 실제 입력하며** 확인해야 한다. JS mock 검사는 순서/identity/버전 계약에 유효하지만 IME·native 범위·viewport·paint·undo 동작의 증거를 대신하지 못한다.

| Gate | 통과 조건 | 통과로 볼 수 없는 상태 |
| --- | --- | --- |
| G1 단일 문서/owner | idea의 tree/search/tabs/recent/Problems/Structure/뒤앞으로가 동일 editable buffer와 path+machine+workspace identity를 사용. 별도 Edit 전환이 필요 없고 UI/UX가 일관됨 | viewer는 숨기고 그 뒤의 disk snapshot이 여전히 caret/진단/명령을 소유하거나 두 view가 같은 명령을 처리함 |
| G2 native 입력/선택/undo | 한글 조합·emoji·붙여넣기·drag/keyboard selection·복사·undo/redo가 정상. preview/탭 재선택/검색/focus popup 왕복 후 같은 buffer 유지 | key event로 ASCII만 입력되는 시연, 외부 shadow caret만 움직이거나 set_value로 매번 전체 buffer 교체 |
| G3 정확한 navigation | Go to Line, search next/previous, Problems/F2, definition targets, history가 실제 editable caret/range와 가시 viewport로 이동. folded/긴 줄·범위·빈 파일도 처리 | 파일만 열림, header line 숫자만 변경, range 지정이 화면 scroll/reveal까지 됐다고 추정 |
| G4 수정 중 language snapshot | 저장하지 않은 text로 LSP 진단/hover/탐색이 실행되고 문서 version/identity와 일치. 타이핑·undo·파일/workspace 전환·서버 지연·재시작에서 오래된 응답 폐기 | 저장해야만 갱신, caret 조회와 밑줄만 구현, 오래된 응답을 최신 문서에 표시 |
| G5 실제 diagnostics/UI 통합 | 동일 buffer에서 밑줄·hover·Problems·Structure·status·scope를 연결. 범위가 수정에 따라 일치하고 지원되지 않는 server/remote 상태는 명확함 | 별도 읽기 복사본에만 decoration, Problems와 editor가 다른 revision/path/machine을 가리킴 |
| G6 언어 편집 기능의 명시적 범위 | 이번 릴리스에 약속한 completion/format/rename이 있다면 capability fallback·적용 범위·변경 충돌·undo/다중파일까지 검증. 미포함이면 지원 목록에서 명시적으로 구분 | 모든 기능을 구현하지 않은 채 ‘완전한 LSP 편집기’라고 보고하거나 server 기능이 있다는 이유로 편집 적용까지 구현됐다고 간주 |
| G7 저장/닫기/데이터 보호 | Save/Discard/Cancel, 느린 저장 중 추가입력/undo/문서전환, 외부변경 conflict, workspace별 dirty, close-token 재검증과 local/remote 실패 유지 | 정상 저장 한 번만 확인하거나 engine 교체 시 dirty buffer/undo를 잃음 |
| G8 source의 남은 역할 이전 | 현재 사용 중인 comment/git/HTTP/Spring/navigation gutter, context/키맵·copy/AI·기록·선택 기능이 이전되거나 명시적 제품 범위 결정으로 정리됨 | ‘UI가 비슷해졌다’는 이유로 source 전용 명령/markers를 잃고 viewer를 삭제 |
| G9 성능과 독립 레이아웃 | 현재 제한 내 큰 파일/긴 줄/빠른 입력·지연 LSP에서 입력이 멈추지 않음. codebench 기존 동작, terminal data·panel geometry, diff/review/database/nontext viewer 보존 | 모든 파일 제한을 없앤 것을 개선으로 간주하거나 codebench/비텍스트 viewer까지 함께 제거 |

G1–G5·G7–G9가 통과하기 전에는 기존 source viewer를 제거하지 않는다. G6은 이번 릴리스에서 약속한 언어 편집 범위에 따라 추가 gate가 된다. ‘viewer 제거’는 idea 일반 source ownership 제거를 의미하며 codebench·diff/review·비텍스트 보기까지 쓰는 파일/공통 renderer의 물리 삭제와 동일하지 않다. 사용처를 확인해 불필요해진 경로만 제거해야 한다.

## 다음 단계의 결정 항목

1. 부모의 host/upstream 조사에서 기존 Editor의 native selection·layout·decoration·edit transaction을 공개할 확장점과 테마 제어 범위를 확인한다. 이 결과가 우선안의 가능/불가능을 가른다.
2. language pipeline 담당 결과로 수정 중 text/version 동기화, 요청·응답 guard, 지원 server capability 범위를 확정한다. UI API 표와 서버 지원 표를 합쳐 위 G4–G6을 release 계약으로 만든다.
3. Editor host 확장이 불리한 구체적 근거가 있으면 Textarea의 실제 IME/undo/range/reveal/scroll 실험으로 fallback을 판정한다. native 입력을 재사용한다는 이유만으로 code editor의 layout/LSP 기능까지 재사용된다고 간주하지 않는다.
4. 선택 경로를 확정한 뒤 통합 viewer 제거의 구현/마이그레이션/검증 작업을 분리한다. 이번 조사는 API 설계·host 구현·설치가 완료됐다는 근거가 아니다.
