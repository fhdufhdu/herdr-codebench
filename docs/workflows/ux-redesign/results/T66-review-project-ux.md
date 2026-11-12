# T66 프로젝트·리뷰 후속

## 반영

- 리뷰 오른쪽 비교는 `현재 프로젝트` 정적 텍스트. 과거 저장 head 선택은 로드 시 null로 정규화하고 기준 선택만 유지한다. swap/head picker를 제거했다. 커밋만/작업 트리 포함 선택은 현재 checkout의 비교 범위다.
- 자체 Git 팔레트7색을 canonical tokens에 추가했다. 수정 파랑, 추가 초록, untracked 보라, rename 청록, 삭제 분홍, 충돌 주황, ignored 중성 회색. 파일에는 상태 텍스트를 병기한다. 단일 Git snapshot을5초마다 조회하고 변화가 없으면 notify하지 않는다. 원격 프로젝트는 기존 exec on 경계를 따른다. porcelain -z로 개행·인용부호 경로와 rename의 두 레코드를 처리하며 부모 폴더에 상태를 모은다. macOS /var와 /private 경로 표기는 실제 프로젝트 트리와 맞춘다.
- 디렉터리에 하위 디렉터리만 하나 있으면 자동으로 연속 확장한다. 파일·복수 항목·오류·사용자 접힘에서 중지하며 깊이64 제한, symlink directory 미추적을 유지한다. 캐시된 경로도 재확장한다.
- 리뷰 새 소스에 LSP 색상/행별 진단, 우클릭 요소 선택 후 정보·정의·참조, Cmd클릭 정의 이동을 연결했다. 결과는 리뷰 내부 정보 영역과 위치 버튼으로 제공하고 실제 정의 이동은 중앙 편집기로 연결한다. 리뷰 원문과 현재 snapshot의 줄이 정확히 일치해야 언어 요청을 허용한다. 삭제된 이전 줄과 커밋만 historical snapshot은 순수 tokenizer만 사용하며 현재 LSP 의미 결과를 잘못 붙이지 않는다. 원격·미지원 파일은 언어 분석을 시도하지 않는다.
- source editor와 review는 exact path의 close promise를 기다려 분석 소유권을 넘긴다. 프로젝트별 리뷰 상태는 기존 canonical Git root를 유지해 코멘트 키가 바뀌지 않게 하고, sourceRoot는 표시/편집기 경로 alias를 보존한다.
- 기존 코멘트 목록 hover 삭제 외에 선택 상세와 수정 폼에도 명시적 삭제 버튼. canonical state에서 삭제를 저장하고 legacy backing은 건드리지 않는다.
- 같은 프로젝트 파일 전환 시 분석을 매번 버리지 않고 현재+최근7개 문서 세션을 유지한다. 오래된 세션은 LRU 퇴거, 프로젝트/DB/리뷰 전환과 tab close에서 정리한다. 열린 적 없는 모든 파일을 서버에 강제로 보내지는 않는다.

## 검증

check_review(실제 Git merge-base·diff·모드·코멘트 CRUD), check_review_analysis(UTF16·과거/현재 row 일치·lease handoff·정보/정의/참조 routing·cleanup), check_file_status(실제 staged/unstaged/delete/rename unusual NUL paths·untracked·ignored·non-Git), workspace chain/cached expansion/stale response, editor/host/leases/cache8 회귀가 통과했다. canonical sync/shared system/native ADE 검사도 통과했다.

실제 ADE 검증 space에서 파일 상태 문구와 자체 색, zz-folders→one→two→leaf.ts 한 번 확장, 고정 `현재 프로젝트`와 선택 불가를 확인했다. aaa-library-navigation.ts 리뷰에서 syntax 색, reviewCount의 TypeScript 진단1개, map의 타입 정보 `(method) Array<number>.map<string>...`를 확인하고 정의 버튼으로 lib.es5.d.ts:1468 이동을 검증했다. 실제 입력은 검증용 space/files에서만 수행했다. 기존 저장 코멘트1개가 canonical root 키에서 복원되는 것을 확인했다. 삭제는 canonical/legacy 보존 회귀로 검증했으며 사용자 코멘트를 실제로 삭제하지 않았다.

최신 설치 backup `1794190898336646000`. 캡처 `/tmp/ade-chain-open.png`, `/tmp/ade-review-typescript.png`, `/tmp/ade-review-hover.png`, `/tmp/ade-review-definition.png`.

## 프로젝트 인덱싱 질문에 대한 현재 경계

엔진은 이미 language+findRoot로 서버를 재사용하고 rootUri/workspaceFolders를 전달한다. TS는 tsconfig/jsconfig/package, Kotlin/Java는 서버의 build import를 따른다. 이번 변경은 문서 세션 캐시이며 **전체 프로젝트 사전 인덱싱 시작/진행 UI를 구현한 것은 아니다**. 별도 프로젝트 준비 기능은 프로젝트 설정 탐색→언어별 서버 초기화/자체 인덱스 warmup→서버가 제공하는 workDoneProgress 표시로 설계해야 한다. 보편적인 LSP force-index 표준 요청은 없으므로 모든 파일 didOpen이나 별도 AST 인덱스 DB를 추가하지 않는다. 입력 didChange·현재 revision 진단은 전체 인덱싱과 별도로 계속 필요하다.

공식 근거: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/ , https://www.typescriptlang.org/tsconfig/ .
