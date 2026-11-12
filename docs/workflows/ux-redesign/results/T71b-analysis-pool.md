# T71b · bounded 분석 풀과 준비 보류

상태: 구현·자동 검증 완료, 배포 및 실제 ADE 화면 검증은 상위 통합 범위. 상속한 모델과 high effort로 수행했다. [태스크](../tasks/T71-navigation-pool.md)의 R3를 담당했다. 수정 범위는 `engine/lsp.go`, `engine/project_analysis.go`, `engine/project_analysis_test.go`와 이 기록이다. 설치·빌드·재시작·commit은 하지 않았다.

사용자가 “프로젝트 단위를 빼고, 파일 단위로 다시” 요청한 후 프로젝트 scan 우선순위 확장과 project-analysis UI 변경은 철회했다. 상위가 프로젝트 사전 준비 활성화를 제거하고 현재 파일 상태로 전환한다. 이 하위 작업은 파일 전환에도 필요한 pool 안전성과 legacy endpoint의 보류 계약만 유지한다.

## 동작

- 서버 한도는 기존과 같은 **3개**다. background 사전 준비는 가득 찬 풀을 교체하지 않고 `errServerCapacity`를 반환한다. 이 결과는 프로젝트에서 `deferred`, 빈 `error`로 저장하며 완료된 사전 준비 작업을 계속 실행 중으로 표시하지 않는다.
- foreground는 편집기 lease가 없고 초기화가 끝났으며 pending RPC가 없는 서버만 오래 사용하지 않은 순서로 교체한다. 아직 서버에 연결되지 않은 lease와 만료되지 않은 attached lease도 보호한다. 전부 보호 중이면 capacity 결과를 반환하며 활성 서버를 강제로 종료하지 않는다. lease의 만료 규칙은 기존 1분 TTL을 따른다.
- pending 등록과 retirement는 같은 `LSPServer.mu`에서 직렬화한다. 이미 시작한 RPC는 eviction 대상이 아니고, retire된 서버로 뒤늦게 들어온 RPC는 capacity 결과를 받는다. 초기화 중인 서버도 교체하지 않는다.
- admission과 retirement를 `poolMu`로 직렬화하고 이전 서버의 `Stop()`을 마친 뒤 대체 서버를 시작한다. 반복 foreground 요청이 detached 비동기 shutdown을 누적하지 않는다. `documentMu → Engine.mu → LSPServer.mu` 순서를 보존하며 shutdown 및 RPC 응답 대기는 documentMu/Engine.mu 밖에서 한다. idle reaper도 같은 lease·pending 보호를 적용한다.
- 다른 문맥에서 실제로 죽은 서버도 다음 admission에서 회수한다. 실제 실패는 `failed`에 남아 기존의 명시적 retry 계약을 유지한다. capacity와 idle eviction은 `failed`에 기록하지 않는다.
- 프로젝트 상태는 완료된 snapshot의 서버 객체를 보관하지 않고 현재 풀을 조회한다. `deferred → foreground starting → ready`, `ready → idle eviction → deferred`를 조회마다 반영한다. 실제 transport 실패는 `error`로 남긴다. 모든 문맥이 보류면 프로젝트도 `deferred`, 준비와 보류가 섞이면 `partial`이다.

## 검증

- `cd engine && go test ./...` 통과.
- `cd engine && go test -race ./...` 통과.
- `cd engine && go test ./... -run 'TestProject|TestPool|TestEngineEvictionAndIdle' -count=3` 통과.
- 위 선택의 `-race -count=1` 통과.
- 신규·수정 fixture는 full pool background 보류, foreground 준비 후 상태 회복, idle eviction 후 보류, starting→ready 회복, genuine failure 유지 및 명시적 retry를 검증한다.
- 실제 child-process fixture로 attached/pending lease 2개와 응답을 보류한 RPC 1개를 유지한 상태에서 12개 concurrent admission과 idle reaper가 이를 종료하지 않는지 확인했다. RPC 취소 후에는 그 idle 문맥만 교체하며 풀은 3개이고 failure map은 비어 있다. 이미 retire된 서버의 late RPC는 capacity 결과를 받는다. 죽은 다른 문맥을 회수할 때 live 문맥을 불필요하게 교체하지 않는 것도 검증했다.
- `herdr-app check /Users/estsoft/project/herdr-codebench/mods/ade` 통과.
- `python3 design/idea/sync_ui.py --check --mod ade` 통과. 공통 생성 원본을 바꾸지 않아 재생성은 필요하지 않았다.
- `node --experimental-vm-modules design/idea/check_system.mjs` 통과.
- 변경 대상 `git diff --check` 통과.

## 한계와 상위 확인

generic `Server()`는 반환 이후 caller의 전체 사용 기간을 소유하는 API가 아니다. lease 없는 legacy 요청에서 Server 반환과 첫 RPC 등록 사이의 짧은 간격까지 예약하지는 않는다. 그 사이 retirement가 이기면 late RPC는 capacity로 끝나며, 이미 pending인 RPC를 끊지는 않는다. 일반 ADE 편집기 요청은 accepted/pending document lease로 이 구간을 보호한다.

보호된 3개 문맥을 유지하면서 네 번째 언어/프로젝트 문맥을 동시에 준비하는 기능은 추가하지 않았다. 공간이 없으면 보류하며 background 재시도 루프도 만들지 않는다. foreground가 필요한 서버를 준비하면 다음 상태 조회에 반영한다. idle 교체의 shutdown 동안 다른 admission이 최대 기존 shutdown budget만큼 기다릴 수 있다. process bound 검증은 admitted pool 및 shutdown 직렬화에 대한 것이며 OS의 process reap 순간이나 메모리 상한을 측정한 결과는 아니다.

현재 파일 중심 UI와 실제 파일 전환·탐색 검증은 상위에서 배치 설치 후 수행해야 한다. 이번 하위 작업은 mod check를 실제 UI 확인으로 간주하지 않는다. 프로젝트 준비 UI와 scan 순서는 이번 최종 변경에 포함하지 않는다.
