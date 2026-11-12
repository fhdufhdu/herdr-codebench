# T67 프로젝트 준비 엔진 구현 결과

상태: 상위 검토 대기. 명시된 medium effort 하위 구현으로 실행했다. 경계는 `engine/project_analysis.go`, `engine/project_analysis_test.go`, 이 결과 문서다. `main.go`, `lsp.go`는 수정하지 않았으며 공유 필드·풀 보호·종료 hook은 담당 에이전트와 협의했다.

## 구현

- `project_prepare`에 대응하는 `prepareProject(Request)`와 `project_status`의 `projectStatus(Request)`를 제공한다. 동일한 정리된 절대 경로의 진행 중/완료 job을 재사용하며, 완료 뒤 명시적인 retry만 새 job을 만든다.
- HTTP 요청과 독립적인 3분 background job, context별 90초 timeout, 엔진 전체 최대 2개 동시 준비, 종료 시 cancel/wait를 적용했다.
- 최대 50,000 파일, 100,001 방문 entry, 16개 language/findRoot context로 제한한다. 일반 dependency/build/VCS/cache 디렉터리와 엔진 cache를 건너뛴다. 디렉터리 symlink를 따라가지 않는다.
- Native 검증에서 발견한 `.claude/worktrees/<branch>` 중복 checkout을 제외하도록 `.claude`, `.codex`, `.agents`, `.worktrees` 디렉터리도 건너뛴다. 임의의 `.git` 파일을 가진 폴더 전체 제외는 submodule 등 정상 프로젝트 범위를 변경할 수 있어 추가하지 않았다. 일반 multi-module 검색은 유지한다.
- 기존 server pool을 재사용한다. 준비 context 표식을 전달하고 `serverFor` 소유 에이전트가 기존 3개 pool 한도에서 foreground server를 eviction하지 않는 guard를 추가했다. 한도 초과는 error/partial에 그대로 노출한다.
- context마다 최대 2MiB 대표 source 하나만 didOpen한다. Engine의 pending editor lease와 서버의 이미 열린 document를 모두 확인하여 디스크 text로 교체하지 않는다. 서버가 workspaceSymbolProvider를 알린 경우만 빈 query의 workspace/symbol을 기다린다.
- 상위 검토 후 파일 읽기를 document mutex 밖으로 이동했다. Engine/document 서버 mutex는 TryLock으로만 잡아 foreground 작업이 있으면 warmup을 건너뛴다. 원자적인 lease/document 재확인은 유지한다. Notify 동안 잡는 두 mutex의 대기 budget은 최대 1초이며 부모 취소가 먼저 오면 즉시 해제한다. 전송 확인 timeout은 didOpen 실제 전송 여부가 불명확하므로 기존 syncText처럼 server를 fail하여 추측한 document ledger를 남기지 않는다. 이는 실제 오류 경로에서의 일관성 보호이며 zero blocking을 보장한다는 의미는 아니다.
- 서버 초기화 직후 context의 server 포인터를 게시하여 workspace query가 진행 중인 preparing 상태에서도 live busy를 노출한다. scan 안에서는 language+directory별 findRoot 결과를 메모이즈하여 같은 디렉터리 source마다 ancestor stat/glob을 반복하지 않는다.
- 최종 메모리 검토 후 완료 job은 모든 server 포인터를 해제하고 완료 metadata도 최근 12개 root까지만 보관한다. 진행 중 job은 제거하지 않는다. 완료된 ready context의 status는 매번 현재 pool의 language/root 키를 조회하므로 evicted 서버의 document text를 metadata가 붙잡지 않는다. 현재 server가 없거나 stopped/not-ready이면 error/partial을 정직하게 반환한다. 새 pool server의 progress도 즉시 반영한다.
- ready는 초기화와 지원되는 준비 query 완료다. 전체 indexing 완료 의미가 아니다. `busy`는 매 status 요청에서 서버 progress를 읽고, 멈춘 server도 error로 반영한다.

반환 snapshot: `root,state,error,file_count,source_count,truncated,contexts,started_at,updated_at`. Context 필드: `lang,root,state,error,busy`. 진행 단계는 scanning/preparing/ready/partial/error다. 아직 시작되지 않은 프로젝트 status는 state:error와 원인을 반환한다.

경로는 기존 Server/findRoot와 editor lease와 맞추어 `filepath.Clean`만 한다. 이 경로에서만 symlink를 resolve하면 macOS `/var` 등에서 별도 server와 별도 lease 키가 생기는 것을 검증 중 발견하여 제거했다.

## 검증

`cd engine && go test -race -run '^TestProject' -count=1 .` 통과 (완료 metadata 메모리 제한 보완 후 최종 4.368s).

실제 stdio child LSP fixture를 통해 동시 요청 병합, 대표 source 하나만 open, 완료 재사용/명시 retry, 지원 workspace query, live busy, active/pending buffer 보존, 제한과 제외 디렉터리, scan 취소, 엔진 전체 동시 준비 2개, 종료 cancel/wait, pool이 가득 찼을 때 foreground 보존을 검증했다. 입력 경로 오류, 빈 프로젝트, 종료한 엔진도 포함한다.

추가 검토 테스트는 foreground가 두 mutex 중 하나를 잡고 있어도 background가 기다리지 않는 것, 1초 Notify budget 및 더 짧은 부모 deadline, timeout 후 mutex 해제와 stopped server/비어 있는 ledger, 응답을 보류한 workspace query 도중 preparing+busy 표시를 검증했다.

Native 피드백 후 추가한 실제 준비 테스트는 네 agent metadata 디렉터리 각각에 `worktrees/branch/{go.mod,duplicate.go}`를 만들고 main source/context/server가 각각 하나로 유지됨을 확인한다. 기존 일반 multi-module scan 테스트도 통과한다.

메모리 보완 테스트는 완료 metadata 12개 제한과 oldest eviction, 진행 중 job 보존, 완료 server 포인터 해제, pool 제거 후 error, 교체 server의 busy 조회 및 metadata에 server 포인터를 다시 붙이지 않음을 검증한다.

native UI 검사, mod check, 배포/설치/재시작은 root 담당이며 이 하위 작업에서 실행하지 않았다. 새 dependency, dist, commit/push 없음.
