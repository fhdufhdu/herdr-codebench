# T69a · 일반 파일 분석 범위 확장

상태: 구현 완료, 상위 통합·native 확인 대기. 실제 effort는 medium, 모델은 상위에서 상속한 기본 모델이다. 기존 dirty 변경을 보존했다.

## 변경

- `mods/codenav/bridge/servers.json`을 기존 7개에서 16개 서버 family, 45개 확장자로 확대했다. JSON/JSONC, YAML/YML, HTML/HTM, CSS/SCSS/Less, sh/bash, C/C++/headers, Markdown, TOML, XML/XSD/XSL/XSLT/SVG를 추가했다. 기존 Go/Rust/Swift/TS·JS/Python/Java/Kotlin 설정은 유지한다.
- `languageID`는 family와 문서 dialect를 구분한다. JSX/TSX/JS 기존 동작을 유지하고 JSONC/SCSS/Less/C 문서 ID를 보완했다. `.h`는 C 기본값이며 clangd가 compilation flags로 실제 언어를 판단한다. 대문자 `.C`/`.H`는 C++ ID를 유지한다. 임의 확장자, zsh/fish, SQL에는 이 일반 LSP 설정을 억지로 연결하지 않는다.
- 실제 서버 검사에서 VS Code JSON/HTML/CSS 서버가 `snippetSupport:false`이면 completionProvider를 제공하지 않는 것을 확인했다. 상위의 명시적 scope 확대 승인으로 `editor_completion.go`와 테스트를 수정했다. 숫자 tabstop, placeholder 기본값·중첩, 첫 choice, escaped literal을 bounded plain text로 변환하고 snippetSupport를 켰다. interactive tabstop session은 만들지 않는다. 변수·transform·잘못된 문법·16단계 초과 중첩·256KiB 초과 입력/결과는 disabled_reason으로 거절하고 적용용 문자열을 비운다. 추가 edits는 LSP 계약대로 plain text로 유지한다. commands, 잘못된 UTF16/edit 범위, cross-file 및 overlap 보호를 유지한다.
- 실제 CSS 서버가 `workspace/configuration`의 null CSS 설정에서 diagnostics를 내보내지 않는 것을 확인하여 css/scss/less 각각 `validate:true`를 제공한다. JSON/HTML/CSS에는 기존 formatting 경로를 위한 provideFormatter를 켰다.
- engine README에 설치 명령, 지원 범위/누락/서버별 차이, schema와 SDK 의존성, 기본 snippet 변환 계약, 개인 설정 저장 위치를 기록했다.

## 호스트 설치와 실제 가용성

작업 중 현재 사용자의 전역 npm prefix에 registry 배포본을 설치했다. workspace의 package.json, lockfile, node_modules는 수정하지 않았다.

- vscode-langservers-extracted **4.10.0**: JSON/HTML/CSS 서버
- yaml-language-server **2.0.0**: Node22.13+ 필요, 호스트 Node22.22.3 사용
- bash-language-server **5.8.1**
- pyright **1.1.414**: 기존 Python 설정의 pyright-langserver 후보 사용

기존 PATH에서 gopls, rust-analyzer, sourcekit-lsp, typescript-language-server, jdtls, kotlin-lsp, clangd도 발견했다. 이 목록의 발견은 각 프로젝트의 완전한 초기화나 indexing 성공을 의미하지 않는다.

후속 상위 요청에 따라 공식 Homebrew core formula로 **Marksman2026-02-08, Taplo0.10.0, ShellCheck0.11.0, shfmt3.14.1**도 설치했다. Marksman 의존성으로 dotnet@9 9.0.123이 설치되었다. 기존 openssl@3 3.6.4와 ca-certificates2026-10-20은 그대로다. 관련 없는 untrusted tap의 trust 설정은 바꾸지 않았다. `marksman --version`, `taplo --version`, `taplo lsp --help`, `shellcheck --version`, `shfmt --version`으로 실제 실행과 Taplo의 LSP subcommand를 확인했다. workspace 패키지 변경은 없다.

현재 **lemminx만 미설치**다. XML은 설정됨과 실행 가능을 구분하여 보고해야 한다. Taplo npm 배포본에는 LSP가 없으므로 LSP-enabled native build가 필요하다. LemMinX는 native stdio executable을 `lemminx`로 PATH에 두거나 개인 cache override에 설치된 Java/JAR 명령을 지정한다. Bash의 추가 lint는 ShellCheck, formatting은 shfmt가 필요하다. 별도 linter protocol, 임의 프로젝트 패키지 설치·build 실행, universal file support, inlay-hint renderer는 추가하지 않았다.

`install.sh`는 mod-local bridge JSON을 shipped base로 교체하지만 `~/.cache/herdr-codenav/servers.json`은 건드리지 않는다. 현재 개인 override의 java/typescript 항목은 읽기 전용으로 확인했고 수정하지 않았다. 기존 NewEngine field merge가 유지된다. 공유 engine 프로세스를 재시작하지 않았으며 dist 생성·배포와 실제 UI 통합은 상위 담당이다.

## 검증

- `cd engine && go test ./...` 통과.
- `cd engine && go test -race ./...` 통과.
- `cd engine && HERDR_TEST_COMMON_LSP=1 go test -run '^TestInstalledCommonLanguage' -v` 통과. 소유한 임시 root와 stdio child만 사용했다. JSON/JSONC/YAML/HTML/CSS/SCSS/Less/sh/Python/Markdown/TOML/C/C++ **13개** 문서의 실제 initialize, buffered didOpen, completionProvider 및 completion RPC 성공을 확인했다. JSON/YAML/TOML/CSS/C 구문 오류와 sh의 ShellCheck lint를 포함한 **6개** buffer의 실제 publishDiagnostics도 확인했다. Bash formatting RPC가 설치한 shfmt로 성공하는 것도 검증했다. 종료 시 소유 child를 정리한다.
- 모든 설정 확장자의 language family/ID, 대소문자/unsupported/custom fallback, 실제 fixture didOpen languageId, setup_status가 서버를 시작하지 않는 계약, 기본 snippet 변환과 거절·추가 edit 보존·itemDefaults를 테스트했다.
- `herdr-app check mods/codenav` 통과. 변경 범위는 엔진·설정·문서이며 native popup/키보드/자동 trigger 검증은 상위 통합에서 수행한다.

## 공식 근거

- [VS Code servers extraction](https://github.com/hrsh7th/vscode-langservers-extracted): 서버 실행 파일과 전역 npm 설치.
- [YAML language server](https://github.com/redhat-developer/yaml-language-server): npm 배포본과 `--stdio` 계약.
- [Bash language server](https://github.com/bash-lsp/bash-language-server): `start`, ShellCheck/shfmt 의존성.
- [clangd](https://clangd.llvm.org/installation): 실행 파일과 compilation database 필요성.
- [Marksman](https://github.com/artempyanykh/marksman): `server`와 Markdown link 중심 기능.
- [Taplo LSP](https://taplo.tamasfe.dev/cli/usage/language-server.html): `lsp stdio`, npm build의 LSP 미포함.
- [LemMinX](https://github.com/eclipse-lemminx/lemminx), [stdio launcher source](https://github.com/eclipse-lemminx/lemminx/blob/main/org.eclipse.lemminx/src/main/java/org/eclipse/lemminx/XMLServerLauncher.java): XML LSP, native/JAR 배포 및 stdin/stdout 계약.
