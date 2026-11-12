# T67 외부 라이브러리 원 서버 의미 탐색

구현: `engine/library_source.go`, `engine/library_source_test.go`, `engine/lsp.go`, `engine/editor_document.go`.

- jar/jdt 및 외부 file URI materialize 결과에 원 URI, 원 server language/root, 정확한 캐시 path와 원문 SHA256을 private `source-metadata` sidecar로 보관한다. 텍스트는 readonly `sources`에만 두며 공유 engine state에 넣지 않는다. cache key에는 URI와 server language/root를 함께 사용하여 같은 URI의 다른 프로젝트 연결이 섞이지 않는다. file 원문은 content digest별 하위 디렉터리에 저장하여 원본 갱신 후 재탐색하면 새로운 캐시 경로를 만든다.
- `libraryRequest(ctx, route, req) (any, bool, error)`를 일반 dispatch 시작 시 호출한다. 캐시 경로의 info/hover/definition/references/symbols/diagnostics를 처리하고 tokens는 기존 pure 경로를 사용한다. 원 URI에 hover/definition/typeDefinition/implementation/references/documentSymbol 요청을 보내고 기존 Location materialize, preview, symbol flattening을 재사용한다. 캐시 파일을 didOpen/didChange 하지 않는다. file URI 원본은 typescript-language-server 의미 조회에 필요한 original-URI didOpen을 전송하고 이후 immutable disk text/version을 재사용한다. JAR/JDT URI는 그대로 조회한다.
- `libraryInfo(path) (any, bool)`는 `{lang,library:true,semantic:true,readonly:true,root,state,busy,installed}`를 반환한다. 매핑이 없거나 원문이 바뀌면 `{lang:null,library:true,semantic:false,readonly:true,reason}`이다. root/main.go가 이 helper를 직접 info에도 연결한다.
- 캐시 문서의 buffer owner/revision/text와 document sync/touch/close, completion/resolve/formatting 등은 거절한다. 직접 syncDocument 호출도 lease 저장 전에 거절한다. 원 server root 밖이나 node_modules 경로의 file URI 대상도 immutable 캐시에 복사하여 원 server에 연결한다. 프로젝트 내부 일반 파일과 originating server 없는 file URI는 기존 경로를 유지한다.
- 진단은 `{items:[],busy:[],supported:false,version_confidence:'unversioned',scope:'external_source',reason}`로 명시적으로 미지원임을 표시한다. 진단을 위해 서버를 시작하거나 캐시 문서를 열지 않는다.
- restart 시 설정된 language만 허용하고 absolute server root, 캐시 path, URI/server별 디렉터리, content digest를 검증한다. file URI는 fromURI로 검증한 absolute local path만 허용하며 의미 요청/info 전에 원본 파일 digest도 확인한다. 원본이 변경되면 원문과 다른 위치를 잘못 조회하지 않도록 reopen 메시지와 함께 거절한다. os.Root 기반 source/metadata 접근이 symlink 경합으로 cache 범위 밖을 읽거나 쓰는 것을 차단한다. 원문과 sidecar는 임시 파일과 rename으로 원자적으로 저장한다. 이미 유효한 매핑은 덮어쓰지 않는다. 구 버전 캐시에 매핑이 없으면 unsupported이며 서버가 다시 materialize하면 연결된다.
- 공통 pool의 `serverFor(ctx,lang,root,retry)`를 추출했다. project preparation context에서 pool이 가득 차면 foreground server를 evict하지 않는다. Engine project 필드 및 Close의 closeProjects hook도 프로젝트 분석 구현과 맞췄다.

검증: `cd engine && go test ./...`, `go test -race ./...` 통과 (file 기반 라이브러리 확장 후 전체 14.240s). fake stdio server가 원 URI와 원 root를 그대로 받는지, didOpen 0회인지, definition/reference 대상과 preview, symbols shape, jar association의 language/root 분리, restart 복원, 변경 작업 거절과 lease 미생성, concurrent materialize/read, digest/path 매핑 불일치, missing metadata, symlink escape 거절을 검증한다. file 기반 node_modules/프로젝트 외부 경로의 원 URI/root 라우팅, no didOpen, 단일 server pool 유지, 원본 변경 후 이전 캐시 요청 거절·새 경로 생성, project local 및 nil-server 동작 유지, oversized/relative/remote URI 거절도 검증한다. 전체 engine 기존 테스트도 통과했다.

제한: metadata 없는 임의 캐시 파일은 의미 탐색할 수 없다. 원 server가 외부 URI 의미 요청을 지원하지 않으면 해당 LSP 오류를 그대로 반환한다. 외부 소스 진단은 의도적으로 미지원이다. file 원본에 editor lease가 있거나 RPC 도중 owner/version이 바뀌면 cached-view 의미 결과를 거절하여 unsaved 원문을 덮어쓰거나 다른 revision 결과를 반환하지 않는다. UI 연결·설치·native 검증은 root 담당이다.


## file 원본 opening 회귀 수정

실제 typescript-language-server에서는 default library 선언 파일이 프로젝트에 포함되어 있어도 명시적으로 열기 전에는 해당 file URI의 hover/references가 비어 있었다. 기존 구현의 cache URI 우회는 맞았으나 original file URI didOpen이 빠져 있었다. `syncText`의 기존 version/notification 처리에서 URI를 명시할 수 있는 `syncURIText`를 추출하여 원본 URI와 digest 검증한 디스크 텍스트만 전송한다. saved-file server document lifecycle을 재사용하고 editor lease를 새로 만들지 않는다. original file의 기존 buffer lease/owner를 확인하고 semantic RPC 후 version도 다시 확인한다. 원본 편집기가 닫히면 다음 library 조회에서 원본을 재개방한다.

회귀 fake server는 열지 않은 file URI의 hover와 references를 실제 TS server처럼 빈 응답으로 반환한다. 원본 한 번 개방/재사용, 원본 갱신, cache URI 미개방, editor buffer 덮어쓰기 거절, RPC 중 owner/version 변경 거절, editor 종료 후 원본 재개방을 검증했다. `go test -race -run 'TestLibrary' ./...` 통과 (3.395s).

설치/재시작 없이 임시 Go test process에서 실제 typescript-language-server를 직접 실행한 추가 증거: live fixture의 Array.map 선언 `lib.es5.d.ts` zero-based 1467:5에 대해 original didOpen 전 hover는 `{"contents":[]}`, 수정 경로의 hover는 nonempty, references는 2개이며 그중 원 프로젝트 `.ts` 사용처가 포함되었다. 해당 단독 probe는 0.98s에 통과했다. 임시 probe test 파일은 제거했으며 배포 파일은 변경하지 않았다.
