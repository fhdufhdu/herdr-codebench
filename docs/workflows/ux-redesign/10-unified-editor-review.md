# 단일 편집기·LSP 통합 심화 검토

2026-11-06 후속 결정: 아래 native host 확장 우선안은 사용자 정정으로 대체됐다. 앱 본체를 수정하지 않는 [현재 계약](11-custom-editor-implementation.md)과 [09 문서의 실제 검증 결과](09-demo-native-audit.md)를 따른다.

2026-11-06. 사용자의 최종 목표는 **일반 소스 파일을 편집기 하나에서 열고, 같은 UI/UX 안에서 LSP를 사용한 뒤 별도 소스 뷰어를 제거**하는 것이다. 이전 ‘런타임 제약 때문에 우선 뷰어 유지’는 현재 구현의 임시 보존 결정이며 최종 목표가 아니다. 이번 작업은 상세 검토·범위 및 검증 계획이며 제품 코드나 설치본은 바꾸지 않았다.

## 결론

**기존 native Editor의 입력 엔진을 재사용하고, 필요한 host 제어와 미저장 문서 LSP 동기화를 연결하는 안이 가장 적합하다.** UI·폰트·색만 맞추거나 caret 조회 몇 개만 추가하는 작업으로 끝나지 않는다. 한 editable buffer가 원문·선택·undo를 소유하고 LSP와 Problems/Structure/검색/탐색이 그 buffer를 함께 사용해야 한다.

상위 GPUI Kit의 native Editor에는 선택·증분 edit 이벤트·진단·decorations·언어 provider가 실제로 존재한다. 따라서 엔진을 전부 자체 개발해야 하는 상황은 아니다. 다만 현재 Herdr의 JS binding은 그 기능을 대부분 내보내지 않으며 실제 dependency revision도 확인되지 않았다. **현 저장소의 mod 변경만으로 목표 전체를 구현 가능하다고 판정할 수는 없다.** Herdr host의 해당 능력을 사용할 수 있는지가 우선안의 첫 판정 지점이다. [native 라이브러리/배포본 근거](results/T23-editor-library-review.md).

## 목표로 삼을 사용자 경험

- 파일을 열면 바로 같은 편집기가 나온다. source→edit 버튼으로 작업 표면을 갈아타지 않는다.
- 타이핑한 미저장 내용에 진단·문서화·정의/참조 이동·Structure가 따라온다. 저장을 해야만 분석이 갱신되는 경로를 통합 완료로 보지 않는다.
- Problems·검색·정의 결과를 누르면 해당 문서의 실제 caret/선택과 화면 위치가 이동한다. 같은 파일을 다시 열어도 native buffer와 필요한 undo/위치를 유지한다.
- 읽기 전용 library source도 같은 편집 표면의 readonly 상태로 보여준다. 별도 source renderer가 필요하지 않은 방향을 목표로 한다.
- Markdown은 같은 편집 원문을 기준으로 편집/미리보기를 전환한다. preview 때문에 별도 disk snapshot이나 undo history를 만들지 않는다.
- SQL 콘솔도 같은 source 편집 표면을 재사용할 수 있어야 한다. 선택 SQL·현재 구문·전체 script 실행과 ⌘Enter의 범위 확인이 native caret/selection을 기준으로 동작한다. DB 결과 grid는 기존 하단 도구의 별도 역할이다.
- 제거 대상은 idea의 일반 텍스트 소스 뷰어 역할이다. 이미지/PDF/media, diff/review, 중앙 table grid, codebench가 사용하는 경로는 각 역할에 맞게 보존한다.

## 현재는 어디에서 갈라져 있는가

| 단계 | 현재 구현 | 통합 시 필요한 변화 |
| --- | --- | --- |
| 화면 | CodeView가 읽기 source·선택·진단·이동을 직접 그림. EditorPane은 별도 native 입력 | native editor 하나가 실제 위치·선택·입력을 소유하고 기존 viewer의 기능을 연결 |
| 원문 | source는 disk snapshot, editor는 미저장 native buffer | editable document의 내용과 revision을 언어 기능의 기준으로 사용 |
| 문서 변경 | EditorState change는 dirty/preview 갱신 | 저장과 별개로 변경 순서·문서 revision을 언어 서버에 동기화 |
| LSP 동기화 | semantic 요청 직전에 Go `Open`이 `os.ReadFile`하고 didOpen/didChange 전송 | 편집 중 문서가 열려 있으면 해당 buffer 내용을 사용. 후속 요청이 disk를 다시 읽어 최신 미저장 내용을 덮어쓰지 않게 수명 통합 |
| 진단 | 서버 push→engine cache→viewer의 유한 polling→자체 밑줄/Problems | 변경 중 buffer와 대응하는 진단을 같은 editor에 표시하고 오래된 결과를 처리 |
| 편집형 언어 기능 | completion/rename/format/quick fix 경로 없음. workspace/applyEdit 거부 | 채택한 지원 범위의 요청·결과·범위 edit·undo·dirty·충돌 처리를 새로 연결 |
| 탭/undo | active native buffer와 workspace별 dirty/saving buffer 보관 중심. 모든 파일 탭의 undo 보관은 아님 | 같은 문서/탭으로 돌아왔을 때 보장할 buffer·undo·위치 수명을 명확히 정하고 필요한 범위만 보관 |
| SQL | SQLViewer가 CodeView를 상속하며 실제 selection을 제공. native edit 모드는 선택 조회 불가라 statement 목록만 표시 | 공통 editable selection/range를 SQL 후보 분석에 전달해 읽기/편집 모드 간 차이를 제거 |

근거: [현재 native 기능·회귀 범위](results/T21-editor-native-deep-review.md), [LSP 실제 흐름](results/T22-editor-lsp-pipeline.md), `database-editor.js:42–71/205–226`. `Request.Text`가 있다는 이유로 미저장 LSP가 지원된다고 볼 수 없다. 현재 Text는 lexical tokens와 일부 Spring 분석에 쓰이며 semantic `Open`에 전달되지 않는다.

## 제안한 방식의 재평가

| 경로 | 재사용하는 것 | 추가 비용과 위험 | 판정 |
| --- | --- | --- | --- |
| A. 현재 native Editor+host 최소 확장+기존 Go LSP | native 입력/IME/undo·줄번호·문법 색·folding, EditorPane 저장/닫기, Go 서버 수명·탐색, 공통 디자인 | host의 실제 엔진/binding 확인과 문서 version/진단/범위 edit 연결 필요. 현재 JS만으로는 부족 | **우선안**. 이미 있는 기능을 노출·연결하는 범위를 먼저 검증 |
| B. Textarea를 감싼 자체 편집기 | native 다중행 입력·focus·범위 setter/replace·저장 shell | caret 조회·viewport·reveal·진단 문제는 남고 syntax·줄번호·folding까지 다시 확보해야 함 | 이번 통합 목표에는 **비추천**. 이전 T20의 단순 편집용 조건부 후보와 구분 |
| C. CodeView에 JS 편집 엔진 추가 | 현재 source의 시각 요소·진단·gutter·일부 선택 모델 | IME·glyph hit testing·scroll·접근성·undo 입력 계약이 크게 늘어남. parser/text model library가 이 문제를 해결하지는 않음 | 현 요구에 비해 범위가 큼 |
| D. Monaco/CodeMirror 임베드 | 검증된 browser 편집 엔진·확장 생태계 | 현재 host에 없는 browser 실행·focus/worker·테마·IO/LSP 연동 계층 필요. 일반 mod에 추가 import로 해결되지 않음 | host 확장 선택 시 가능한 대안. 현재는 A보다 선행 작업이 큼 |

위 A가 가장 작다는 판단은 **host가 필요한 native capability를 재사용할 수 있다는 조건**에 따른 것이다. 실제 host가 해당 엔진과 호환되지 않으면 순위를 다시 평가해야 한다. upstream 업데이트만으로 Herdr의 custom binding이 자동 확장되지는 않는다.

## native 경계에서 확인할 최소 능력

새 함수 형식이나 API 배포 계획은 아직 설계하지 않는다. 다음 능력이 실제로 노출될 수 있는지 확인한다.

| 능력 | 필요한 이유 | 현재 설치 mod 계약 |
| --- | --- | --- |
| caret/anchor/head·범위 조회와 변화, 방향 보존 | status·선택 실행·hover/정의·완성 요청을 실제 입력 위치에 연결 | 미공개. Input/Textarea의 범위 setter를 Editor에도 있다고 가정할 수 없음 |
| 목적 range 설정·focus·reveal/unfold | Problems/검색/정의 이동과 popup 왕복 | Editor에는 해당 공개 제어 없음 |
| 변경 순서·revision·프로그램 edit 구분 | LSP 동기화, stale 요청 폐기, undo/format/재시작 일관성 | value/change는 있으나 edit/revision payload 없음 |
| 범위 edits·한 사용자 작업의 undo 단위 | completion·format·quick fix를 전체 set_value 없이 반영 | 공개 range/transaction API 없음 |
| 진단·gutter/range 장식과 실제 위치 bounds | 편집 text와 일치하는 밑줄·hover·git/comment 표시 | palette 외 외부 decoration/geometry 미공개 |
| 의미 색·font·selection/focus·popup 테마 | viewer와 editor의 UI/UX를 공통 시스템으로 통일 | font/syntax는 가능. 내부 장식·언어 popup 전체 제어는 별도 확인 필요 |

native layer에는 입력·shaping·선택·undo·화면 좌표를 두고, 제품 모드에는 문서 shell·명령·공통 디자인·기존 IO·언어 결과 표시 정책을 둔다. 두 영역이 각각 caret나 원문을 따로 소유하게 만들지 않는다. native 입력을 투명하게 숨기고 source 텍스트를 덧그리는 방식은 scroll/IME/선택/접근성 정합 문제가 있어 우선안에서 제외한다.

## LSP를 연결할 때 반드시 함께 다룰 부분

1. **저장 전 원문:** 변경된 buffer가 didOpen/didChange의 원문이어야 한다. 저장은 disk write이며 언어 분석 동기화와 별개다. syntax highlighting과 LSP 분석도 다른 기능이다.
2. **하나의 client:** 기존 Go 서버 수명·서버별 설정·취소·URI/Location normalization을 재사용한다. native library의 completion/hover provider는 연결 경계로 활용하고 동일 파일용 LSP client를 둘로 만들지 않는 방향을 우선한다.
3. **문서 identity와 순서:** workspace/machine/URI·문서 revision·요청 위치를 함께 관리한다. 동일 파일의 복수 표시가 각자 다른 원문을 같은 server URI에 덮어쓰는 상황을 방지해야 한다.
4. **오래된 결과:** 파일뿐 아니라 같은 파일의 새 revision·caret 이동·서버 재시작을 기준으로 결과를 검증한다. 현재 진단 cache는 publish version을 수집하지 않으며 변경 뒤 이전 진단을 즉시 무효화하지 않는다.
5. **진단 version의 한계:** LSP publishDiagnostics의 version은 선택 항목이다. client의 증가 counter만 붙였다고 server 진단이 그 revision에 대한 것임을 증명할 수 없다. version 제공 여부·진단 방식에 따른 stale/pending 표시와 갱신 정책을 검증해야 한다. [공식 진단 계약](https://github.com/microsoft/language-server-protocol/blob/gh-pages/_specifications/lsp/3.17/language/publishDiagnostics.md).
6. **범위 단위:** 기존 engine은 UTF-16 LSP 위치를 사용한다. 검토한 upstream native range는 UTF-8 byte다. JS offset·UTF-8·LSP 위치·화면 glyph 좌표를 혼용하지 않고 한글·emoji·결합문자·CRLF·탭으로 확인한다.
7. **편집 적용:** completion의 추가 edit, rename의 여러 파일, format의 여러 range는 순서/충돌/readonly/dirty를 확인한 뒤 반영해야 한다. ‘응답을 받음’과 ‘한 번의 undo로 안전하게 적용됨’을 구분한다.
8. **닫기와 복구:** didClose/didSave·hidden buffer·언어 서버 재시작을 문서 수명에 연결한다. 입력 중 오류가 나도 편집 buffer가 살아 있고 저장되지 않은 내용을 disk로 대체하지 않아야 한다.

공식 LSP도 언어 기능을 동기화된 문서 상태에서 계산하도록 설명한다. [문서 동기화 계약](https://github.com/microsoft/language-server-protocol/blob/gh-pages/_specifications/lsp/3.17/specification.md#text-document-synchronization). 현 engine의 saved-file navigation을 유지하는 것과 editable client로 확장하는 것은 별도 단계다.

## 이번 목표의 기능 범위 제안

| 범위 | 기능 | 현재와의 관계 |
| --- | --- | --- |
| 뷰어 대체의 필수 범위 | 진단/Problems·Structure·문서화·정의/구현/타입·참조·검색·줄 이동·위치 기록·기존 gutter 명령·copy/AI·읽기 전용 source·Markdown | 기존 기능을 editable buffer 기준으로 이전. 이미 native에서 동등 지원된다고 가정하지 않음 |
| 통합 코드 편집기의 다음 기본 범위 | 미저장 내용 기반 completion·선택/수락·추가 edit·한 번의 undo | 현 코드에는 없는 신규 기능. 통합 편집기 목표에서 명시적으로 작업량에 포함하는 것을 권장 |
| 별도 확장 범위 | rename·format·quick fix·다중파일 workspace edit | 기존 viewer 제거의 선행 기능으로 과대계산하지 않는다. 채택 시 각 기능의 적용·충돌·undo/저장 검증을 별도로 정의 |

원격 파일은 편집·IO 경계를 유지하지만 현재 LSP는 local-only다. 이 작업을 이유로 remote LSP·협업 편집·자체 parser·일반 플러그인 플랫폼·새 문서 daemon까지 함께 만들지 않는다. 현재 파일 크기 제한도 성능 근거 없이 확대하지 않는다. 이것이 YAGNI의 범위 기준이다.

## 가장 작은 검증 순서와 뷰어 제거 조건

| 단계 | 확인할 실제 동작 | 통과 근거 |
| --- | --- | --- |
| E0 host 가능성 | 실제 native 엔진의 선택·reveal·장식·edit transaction을 current host에 연결할 수 있는가 | 앱 source/build 경계와 필요한 능력 확인. 공개 upstream 기능만으로 통과 처리하지 않음 |
| E1 native 입력 시제품 | 한글 조합·drag/keyboard selection·진단 range 표시·목적 위치 이동·undo·focus/popup 왕복 | 같은 native editable 영역의 실제 조작. 조회 값과 실제 caret/scroll 일치. syntax overlay 사본으로 대체하지 않음 |
| E2 미저장 LSP | disk는 옛 코드로 두고 buffer에만 오류/새 symbol을 만든 뒤 진단·hover·정의 확인 | 저장 없이 새 원문으로 분석. 빠른 입력/undo·늦은 응답·서버 재시작에서도 최신 문서와 일치 |
| E3 단일 source UX | tree/검색/탭/Problems/Structure/정의/뒤앞/Markdown/SQL 선택 실행을 같은 owner에 연결 | source→edit 전환 없이 동작. 같은 파일 재선택/탭 왕복 시 문서·undo·선택 계약 확인 |
| E4 언어 편집 | 선택한 completion 기능의 수락·추가 edits·취소·undo/redo·dirty 유지 | 같은 buffer에 정확한 변경, 저장 전 disk 미변경. stale 결과를 새 원문에 적용하지 않음 |
| E5 회귀와 제거 | 저장/닫기/외부 변경/remote/큰 파일/긴 줄·codebench·남은 viewer 사용처 확인 | 기존 기능 mapping과 실제 통과 근거가 모였을 때 idea의 source 전용 ownership/명령만 제거 |

E0–E3가 통과하지 않았는데 기존 viewer를 숨기면 기능이 조용히 빠진다. E4를 이번 통합 릴리스의 완료 범위로 채택하면 completion까지 통과 후 제거한다. 물리적으로 code.js를 지우는 것이 목표가 아니라 일반 소스의 이중 UI·buffer·LSP 소유를 없애는 것이 목표다. SQLViewer의 상속과 codebench 사용처를 이행한 뒤 불필요해진 코드만 제거한다.

## YAGNI·KISS·DRY 적용

- native 입력과 existing Go LSP를 우선 사용한다. 별도 editor engine/두 번째 LSP client/동일 source renderer를 추가하지 않는다.
- 기존 EditorPane의 파일 identity·저장 충돌·dirty/saving·close 보호와 Markdown preview를 재사용한다.
- 기존 Problems·Structure·진단 내용·SQL splitter/queryCandidates·공통 semantic tokens를 재사용한다. UI adapter와 상태 소유만 필요한 만큼 바꾼다.
- 기능 지원을 숨기지 않는다. 읽기 전용·미지원 서버·진단 pending·실패 상태를 정확히 표시하고, 없는 capability를 가능한 버튼으로 노출하지 않는다.
- 검증된 라이브러리의 native 기능을 이용할 수 있는 host 지점을 먼저 찾는다. import를 늘리는 것 자체나 새 프레임워크 도입을 개선으로 보지 않는다.

## 현재 완료 범위와 미확정

완료한 것은 source·SDK·공식 upstream의 세부 검토와 변경/검증 범위다. 현재 설치 binding의 부족, saved-disk LSP 경로, upstream native의 재사용 지점은 확인했다. REA는 배포 binary metadata만 읽었고 dependency revision은 얻지 못했다.

아직 실제 host 확장·native IME/selection/reveal/장식 시제품·미저장 LSP 실행·통합 편집 UI를 구현하거나 검증하지 않았다. host source와 현재 dependency를 확인하기 전에는 구체적인 구현량이나 기간을 확정하지 않는다. 현재 제품 viewer는 보존한다.

세부 자료: [T21 native 비교/회귀표](results/T21-editor-native-deep-review.md), [T22 현재 LSP pipeline](results/T22-editor-lsp-pipeline.md), [T23 upstream/배포본](results/T23-editor-library-review.md). 이전 [T20](results/T20-editor-feasibility.md)은 일반 가능성 조사이며 이번 단일 편집기 목표의 권장안은 이 문서를 따른다.
