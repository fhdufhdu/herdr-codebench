# T23 편집 라이브러리와 설치 런타임 경계

2026-11-06. 공개 라이브러리 소스·설치 선언·배포 binary metadata의 읽기 전용 검토다. 호스트 소스를 수정하거나 라이브러리를 설치·실행하지 않았다. 외부 최신 소스에 기능이 있다는 사실을 현재 Herdr에 동일하게 노출됐다는 증거로 사용하지 않는다.

## 고정한 근거

- 설치 `AGENTS.md:35–46`은 Herdr가 GPUI Kit/gpui-shell의 자체 복사본과 추가 기능을 사용하며 설치 타입이 현재 계약이라고 명시한다.
- 공식 upstream Git HEAD를 `git ls-remote`로 조회한 값은 `b2aaa3e5f9a387dea74981586bfca33e7e08420d`다. 이하 원문 검토는 이 commit에 고정했다. 공개 소스는 `/tmp/herdr-editor-review-b2aaa3e5/`에 다운로드했으며 실행하지 않았다.
- 설치 `gpui-kit.d.ts` SHA256: `240970545ddc115e88ed1e5ae853461371e29e8dd7f7410979334a6d71acfb7a`.
- 설치 `herdr.d.ts` SHA256: `5dd5388abe811467d94edf9e3427730614d581348087758f28afc26565affbe3`.
- 설치 `AGENTS.md` SHA256: `429d3c9d5bfe4670ac3c7ec3b1fb8a2dd4b26b82666709ce164a17733fdd66d4`.
- REA `inspect_rust_binary`로 `/Applications/Herdr.app/Contents/MacOS/Herdr`를 읽었다. arm64 Mach-O, 59,770,016 bytes, SHA256 `d2a672a8414b80cdc30dc2d6927d5ba0793e49ba79fc4b98e1cbeb5fd6be1dcf`. `.dep-v0`가 없어 정확한 GPUI Kit dependency revision/version을 얻지 못했다. dependency가 없다는 뜻도, 최신 upstream과 같다는 뜻도 아니다. [REA 원본 결과](T23-editor-artifact-evidence.json).

## 가장 중요한 추가 근거

**상위 native 편집 라이브러리에 이미 풍부한 편집 기능이 있다. 부족한 기능을 모두 처음부터 만들어야 한다는 결론은 아니다.** 다만 Rust native 기능과 JS shell binding은 별개의 표면이다.

| upstream에서 확인한 것 | 고정 source | 통합안에 주는 의미와 한계 |
| --- | --- | --- |
| Editor의 native 엔진은 선택·IME·clipboard·shaping·layout·caret painting을 공통 입력 기반에서 사용 | [ARCHITECTURE.md](https://github.com/longbridge/gpui-kit/blob/b2aaa3e5f9a387dea74981586bfca33e7e08420d/docs/ARCHITECTURE.md#L293), 특히 313–340 | 입력·표시 엔진을 재구현할 이유를 줄인다. 현재 설치 엔진의 정확한 revision은 미확정이다. |
| selection range와 방향 보존, incremental edit events | [editor.md](https://github.com/longbridge/gpui-kit/blob/b2aaa3e5f9a387dea74981586bfca33e7e08420d/website/component/editor.md#L445), 445–453 | `InputEditsEvent`는 edit 순서와 각 edit 뒤 문서를 제공하고 `set_value`는 해당 이벤트를 내지 않는다고 설명한다. native 선택은 UTF-8 byte range이므로 JS/LSP UTF-16과 명시적 변환이 필요하다. |
| text/range/gutter/overview decorations | [decorations.rs](https://github.com/longbridge/gpui-kit/blob/b2aaa3e5f9a387dea74981586bfca33e7e08420d/crates/base/src/input/editor/decorations.rs#L200), 200–267, 884–1007 | 현재 viewer의 진단·git/comment marker 시각 역할을 native layout에 붙일 확장점 후보다. decoration의 edit 추종과 undo 의미는 문서별 검증이 필요하다. |
| diagnostics data model·range 조회 | [diagnostics.rs](https://github.com/longbridge/gpui-kit/blob/b2aaa3e5f9a387dea74981586bfca33e7e08420d/crates/base/src/input/editor/diagnostics.rs#L18), 18–75, 186–260 | source의 진단을 native Editor에 표시하는 재사용 후보. server 진단의 문서 버전을 해결해 주는 기능은 아니다. |
| completion/hover/definition/code action/semantic token provider와 show-document hook | [lsp/mod.rs](https://github.com/longbridge/gpui-kit/blob/b2aaa3e5f9a387dea74981586bfca33e7e08420d/crates/base/src/input/editor/lsp/mod.rs#L39), 39–76 | 팝업/편집 동작을 library에 맡기는 경계가 있다. provider는 서버 프로세스를 자동으로 기동·연결하는 전체 LSP client와 같지 않다. 기존 Go client를 다시 만드는 대신 연결할 방안을 검토한다. |
| LSP edit 적용 함수 | [lsp/mod.rs](https://github.com/longbridge/gpui-kit/blob/b2aaa3e5f9a387dea74981586bfca33e7e08420d/crates/base/src/input/editor/lsp/mod.rs#L141), 141–158 | 범위 변환·native text edit의 출발점이다. 이 함수가 있다는 것만으로 다중파일 WorkspaceEdit·stale version·여러 edit 순서·한 번의 undo가 모두 보장되지는 않는다. |
| 최신 upstream shell binding도 native 전체 능력을 그대로 내보내지 않음 | [shell/media/editor.rs](https://github.com/longbridge/gpui-kit/blob/b2aaa3e5f9a387dea74981586bfca33e7e08420d/crates/shell/src/components/shell/media/editor.rs#L51), 51–117 | 이 registry는 초기 text와 rust/json language, 표시 appearance/border/readonly 등을 등록한다. 설치된 HERDR 확장 `EditorState.new(options)`와 형식도 다르다. upstream 업데이트만으로 현재 앱이 필요한 JS 기능을 얻는다고 판단하면 안 된다. |

따라서 제안은 ‘최신 GPUI Kit를 가져오면 바로 끝난다’가 아니다. **Herdr가 사용하는 native Editor의 실제 버전과 확장점을 확인해 필요한 기능만 bridge에 노출할 수 있는지 판정한다**는 것이다. 호환성이 맞으면 이미 있는 native 선택·레이아웃·장식·언어 provider를 재사용해 범위를 줄일 수 있다. 실제 Herdr host source와 빌드 경로를 확보하지 못한 현재는 구현 난도와 변경량을 확정하지 않는다.

## 대안별 판정

| 대안 | 현재 목표에 대한 판정 |
| --- | --- |
| 기존 native Editor + 필요한 binding + 기존 Go LSP 재사용 | **우선안.** 입력/undo/줄번호/folding과 제품의 저장·진단 모델을 재사용할 가능성이 가장 높다. native capability와 bridge 검증이 선행돼야 한다. |
| Textarea + JS gutter/syntax overlay | 통합 코드 편집기에는 비권장. native 선택 getter·viewport·진단 장식이 부족한 것은 같고 현재 Editor의 code 기능까지 다시 붙여야 한다. 작고 단순한 text form에는 유효하지만 이번 목표의 shortcut은 아니다. |
| CodeView + JS text model/parser library | DOM 없는 text model/parser는 일부 재사용할 수 있어도 IME·glyph hit testing·native selection/접근성·undo 소유 문제는 해결하지 않는다. 현재 renderer에 편집 기능을 덧붙이는 범위가 커진다. |
| Monaco/CodeMirror | browser host가 생긴다면 검증된 엔진을 재사용하는 후보다. 현재 Herdr mod에는 DOM/WebView가 없으므로 직접 탑재할 수 없다. host 임베딩·입력 focus·테마·프로세스/worker·기존 IO/LSP bridge가 별도 작업이다. |

[CodeMirror 공식 reference](https://codemirror.net/docs/ref/)는 EditorView를 DOM component로 정의한다. [Monaco 공식 ESM 통합](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md)은 DOM container와 worker bundling을 사용하는 예제다. [Monaco FAQ](https://github.com/microsoft/monaco-editor#faq)는 browser/worker·VS Code extension 호환 범위를 설명한다. 설치 Herdr의 WebView 부재와 upstream GPUI Kit 자체의 최신 WebView 지원 여부는 다른 사실이다. upstream 기능을 설치 host에 있다고 가정하지 않는다.

## 기존 실험의 재사용 가능 범위

로컬 별도 저장소 `/Users/estsoft/project/herdr-idea-rebuild/mods/ide-editor-lab/README.md`에는 native Editor / Textarea overlay / 짧은 Input sink의 A/B/C 실험이 있다. README 자체가 selection·marked text·scroll·geometry 미조회와 gate unverified를 명시한다. 따라서 새로운 실험 설계의 참고는 되지만 성공 증거가 아니다. 그 저장소의 설계 선택·지시는 이번 저장소의 사용자 요구를 대체하지 않는다. 실험을 설치·실행하거나 별도 저장소를 수정하지 않았다.

## 조사 한계

이번 REA는 target-free metadata read이며 live process attach나 GUI 재시작·수정은 없었다. native 바이너리 함수 수준의 capability·특정 upstream commit 사용 여부를 복원하지 않았다. 실제 Editor의 한글 조합·selection/reveal·undo·테마/장식 결과도 아직 실험하지 않았다. 현재 문서의 우선안은 source-backed feasibility 판단이며 동작 검증 완료가 아니다.
