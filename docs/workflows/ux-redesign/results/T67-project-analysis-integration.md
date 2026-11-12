# T67 프로젝트 준비 · 외부 소스 LSP 통합

요구: 파일을 열 때마다 처음부터 분석하지 않도록 프로젝트 언어 서버를 미리 준비하고, 외부 라이브러리에서도 정보·정의·참조를 이어간다. 기존 LSP pool, 원본 위치 변환, readonly 편집기, scoped 상태를 재사용한다.

## 적용

- `engine/project_analysis.go`: bounded 비동기 `project_prepare` / `project_status`. 대표 소스 한 개와 지원 workspace query로 lazy project loading을 미리 시작한다. foreground buffer/서버를 background 준비가 덮거나 퇴출하지 않는다. 완료 기록은 최근 12개만 유지한다.
- `mods/ade/project-analysis.js`, `main.js`: 프로젝트 전환 시 자동 준비, 상단 실제 상태와 상세 팝업·재시도. stale project 응답 무시, idle notify 없음, 원격 프로젝트에 local 분석 요청 없음.
- `engine/library_source.go`, `lsp.go`, `editor_document.go`: private 원 URI·언어·프로젝트 root·digest로 cache와 원 server 연결. JAR/JDT와 project 밖/node_modules 파일 대상 지원. 변경된 원본은 재탐색 요구. cached source를 수정 가능한 buffer로 등록하지 않는다.
- `mods/ade/lsp-session.js`, `text-editor.js`: immutable library에서도 같은 정보·정의·참조 흐름 사용. owner/revision은 client stale callback 보호에만 붙이고 engine library 요청에 쓰지 않는다. sourceOnly 저장 보호 유지.
- 외부 진단은 서버 지원이 확인되지 않아 `진단 미지원`으로 명시한다. syntax와 의미 탐색 지원을 오류 없음과 혼동하지 않는다.

## 확인된 근거

- 프로젝트 controller / 편집기 / LSP / 복구 회귀, canonical sync(codenav/activity/ade), shared system 통과.
- native fixture 24개 구조 검사 통과. 변경 모드 runtime check 확인.
- 실제 앱에서 상단 `프로젝트 분석 중` → `프로젝트 준비됨 · 상세 상태`, Spring readonly source의 색상·LSP 준비·진단 미지원 표시 확인.
- native 관찰에서 `.claude/worktrees` 중복 source가 준비되는 것을 발견해 agent worktree/cache 디렉터리를 scan 제외했다. 설치 엔진 API 재검증: 현재 프로젝트 130 files / 100 sources, Kotlin·TypeScript 준비됨.
- 설치 엔진의 owned TypeScript fixture: 프로젝트 준비 완료 후 처음 여는 consumer의 definition이 dependency로 이동. 관측 준비 534 ms / 첫 definition 9 ms (해당 환경 한 번의 측정이며 성능 보장 수치 아님).
- 설치 엔진의 Spring external source hover는 실제 runApplication 문서를 반환(76 ms), 내부 ConfigurableApplicationContext 정의가 다음 readonly Java 소스로 이어짐.
- file-based lib.es5.d.ts에서 TypeScript 서버가 원본 URI didOpen 전 hover/references를 비우는 문제를 재현했다. 검증된 원본 URI를 공통 saved-document sync로 등록하도록 수정하고, 실제 TypeScript 서버 별도 probe에서 hover 문서와 프로젝트 사용 위치를 포함한 참조 2개를 확인했다. 원본 editor lease 충돌 및 RPC 중 버전 변경은 결과를 거부한다. cached URI는 열지 않는다.
- 최종 Go 전체 race test 통과: `go test -race ./...` (15.011s).

최종 설치: engine `0.1.0-9b4987d11d6c` (6개 배포 binary 검증), owned runner `t58`. 앱/터미널 코어는 유지하고 이전 owned engine만 graceful 재시작했다. 최종 설치본 live proof: lib.es5.d.ts hover 문서 있음, 참조 2개에 owned 프로젝트 사용 파일 포함, original root 유지. 최신 ADE 파일 설치 backup `1794193492118068000`.

## 마지막 native 검증 완료

잠금 해제 후 실제 Herdr에서 프로젝트 상세 상태와 다시 준비를 확인했다. background status 조회의 일시적인 `busy`를 버튼 disabled에 사용해 상태가 그대로인 응답 뒤 재시도가 비활성으로 남는 문제를 발견했다. 준비 진행 상태에만 disabled를 연결하고 기존 request coalescing은 유지했다. 수정 모드 runtime check 통과 및 설치 backup `1794197286888433000`. 실제 다시 준비 클릭 → 프로젝트 검색 중 → Kotlin·TypeScript 모두 준비됨을 확인했다.

외부 SpringApplicationExtensions.kt readonly 탭에서 runApplication을 선택하고 정보 버튼을 눌러 실제 함수 설명과 시그니처 표시를 확인했다. 참조 버튼은 해당 서버가 반환한 외부 선언 위치 1개를 표시했다(프로젝트 사용 위치까지 반환했다고 주장하지 않는다). ConfigurableApplicationContext를 선택해 정의 버튼 클릭 후 ConfigurableApplicationContext.java 탭으로 이동한 것을 확인했다. 실제 TypeScript의 프로젝트 사용 참조는 앞선 live API proof의 별도 근거다. 사용자 파일 수정·저장 없음. 앱 status errors 없음.

`ready`는 서버 초기화와 지원 warmup 완료이며, 서버가 알리지 않는 전체 인덱스 완성을 뜻하지 않는다. 이전 metadata 없는 library cache는 project source에서 정의 이동 한 번이 필요하다.

## 투명 창·첫 열기 대기 후속

Legacy uiDialog의 popupSurface는 idea layout에서만 배경을 칠하므로 ADE에서 투명했다. 공통 adeDialog를 adePanel 기반으로 추가하고 분석 창을 전환했다. 디자인 시스템 collection에 예시 추가. 실제 Herdr 분석 창에서 불투명 배경·테두리·header/footer 및 뒤 코드가 비치지 않음을 확인했다.

프로젝트 준비는 전체 파일 분석 완료가 아님을 사용자에게 명확히 정정했다. 상단 ready 문구를 언어 서버 준비됨으로 구체화했다. 새 문서 최초 sync는 기존 입력 debounce 250ms를 기다리지 않고 바로 예약한다. 후속 편집은 기존 coalescing 유지. 이 변경으로 전체 1~2초가 사라졌다고 주장하지 않으며 서버별 초기 문서 분석은 남는다. LSP 최초 타이머/편집 coalescing 회귀, project controller, shared system, generated sync, mod runtime check 통과. 설치 backup 1794198542623881000.
