# T29 실행 위치·소유권 P0 구현

2026-11-06. 상태: source/독립 검증 완료, 부모의 하단 live terminal 통합·실제 화면 검증 대기. 기존 부모 context의 모델/effort를 유지했다. 사용자 실행·Docker·DB·기존 terminal·설치본을 변경하지 않았다.

## 변경과 통합 계약

- `run.js`: idea는 구성마다 전용 core process를 시작한다. 일반 terminal tab을 만들거나 선택하지 않고 기존 shell에 명령을 전송하지 않는다. codebench의 기존 tab 생성/재사용/send/confirm 경로는 유지한다.
- `run-process.js`: 기존 hc CLI로 실행별 process 생성·라벨 검증·상태/출력 조회·중지·완료 자원 해제를 담당한다. 새 engine/API를 추가하지 않는다.
- `execution-results.js`: beginExecution의 선택적 `{claim:true}`로 shared 공개/tool 열기 전에 claim을 확보한다. processOwned 실행은 기존 interactive-shell footer 추정 대신 실제 native process 상태를 읽는다.
- 검사: 기존 `check_run_sessions.mjs`에 codebench 회귀를 보존하며 새 idea 실행 경로/공개 순서/cold-copy 회귀를 추가했다. `check_run_process.mjs`는 실제 독립 synthetic core process만 실행한다.

부모 소유인 database-editor.js·main.js·공통 UI/설정·layout은 수정하지 않았다. 다음 통합이 필요하다.

1. `run-process.js`의 `runTerminalContent(entry)`는 선택된 `processOwned` shell 기록에 terminal이 있으면 `{terminal: entry.terminal}`, 없으면 null을 반환한다. **이 content를 하단 도구의 layout-level native terminal block에 연결해야 실제 live TTY가 표시된다.** readonly Editor 문자열 mirror를 유지하는 것만으로 P0 완료가 아니다.
2. 부모 RunResults는 새 processOwned entry를 native live body로 표시하고 SQL 결과는 기존 소유 표로 유지한다. 공통 tool header·execution strip을 중복하지 않는다. 실제 중앙 editor, 하단 panel 크기·active/hidden 상태와 기존 terminal 데이터는 보존한다.
3. processOwned recovery는 `inspectExecutionTerminal(entry)`의 queued/running/final state가 authoritative다. live terminal에는 종료 footer가 없어도 running을 반환한다. 이 경로에 untracked 추정이나 continuityLost 경고를 추가하지 않는다. 초기 queued/launching 중 기존 `stopRequested`를 지우지 않는다.

새 shell snapshot은 kind='shell', processOwned=true, launching, terminal, configuration, name/command/folder/machine, startedAt, state, elapsed_ms, nativeState 및 종료 후 exitCode를 가진다. 환경 값은 결과에 중복 저장하지 않는다. output은 완료/실패 fallback 기록용 최대 2,000 history line snapshot이며 실제 live 화면의 대체물이 아니다.

## 실행·복구·중지

기존 `hc run --bg --no-parent --no-notify --json`에 실행별 고유 name과 `codebench.execution=<executionId>` label을 붙인다. 일반 앱 tab adoption label을 붙이지 않는다. cwd와 remote machine 옵션을 전달한다. 알려진 core 주소가 없으면 label로 필터한 `hc ls`에서 고유 name 후보를 찾고 `hc get`의 정확한 실행 label을 다시 검증한다. label이 맞지 않으면 출력 읽기나 중지를 하지 않는다.

실제 CLI 관찰상 단일 command text는 `sh -c <text>`로 실행되었다. 이는 core의 command 실행 방식이며 예전 interactive shell의 alias/function/session 환경을 재사용하는 것과 다르다. 구성의 명시 환경은 기존 withEnv 변환으로 전달한다. codebench interactive shell semantics는 변경하지 않았다. remote 옵션 전달은 구현했지만 실제 remote 머신 실행 검증은 하지 않았다.

새 실행은 terminal 주소를 받기 전 shared queued/launching 상태로 보인다. owner claim은 shared/tool 공개 전에 확보한다. 별도 VM/copy가 현재 실행을 조회하더라도 전용 native process의 live 상태가 running을 확정하므로 module-local Set이 공유되지 않는다는 이유로 untracked가 되지 않는다. 주소가 아직 공개되지 않은 첫 10초는 queued를 유지하고, 이후에도 원래 process를 찾지 못하면 재실행 없이 오류로 알린다.

중지는 정확한 실행 label을 검증한 owned process에 interrupt를 전달하고 native 종료를 확인한다. 계속 살아 있으면 그 owned process만 kill한 뒤 종료 상태를 확인한다. queued 중지 요청은 주소가 생긴 뒤 처리한다. 재실행은 기존 confirm을 유지하고 이전 실행이 멈춘 뒤 새 process를 만든다. process가 실제 finished임을 확인한 nativeState는 host live snapshot의 일시적 지연보다 우선한다. 완료 결과 닫기/보관 한도 제거 때는 label이 일치하는 **finished** core 자원만 비동기로 정리하며 live process나 unrelated terminal을 삭제하지 않는다.

## 검증

```sh
node --check mods/codenav/run.js
node --check mods/codenav/run-process.js
node --check mods/codenav/execution-results.js
node --experimental-vm-modules design/idea/check_run_sessions.mjs
node --experimental-vm-modules design/idea/check_run_process.mjs
node --experimental-vm-modules design/idea/check_database_editor.mjs
herdr-app check mods/codenav
```

모두 통과했다. 기존 codebench configuration ID migration·rename/copy·native terminal 보존·same-name isolation·workspace confirm을 유지했다. idea에서는 tab.new/select 호출 0회, 기존 shell send 0회, 공개 전 claim 존재, 실행별 독립 기록, 이전 결과 선택 중 현재 실행 중지, close neighbor, SQL snapshot·bounded history를 확인했다. 별도 V8 VM에서 long-running process를 cold-read하여 footer가 없어도 running이며 출력이 수집됨을 검증했다.

실제 CLI 검사는 이 검사에서 만든 synthetic process 세 개만 대상으로 했다: 첫 출력→잠깐 대기→마지막 출력, stderr 후 exit 7, 장기 sleep 후 중지다. 실제 stdout/stderr·cwd·native exit code·고유 label 주소 복구·label 불일치 출력 읽기 차단·queued grace·정확한 중지를 확인했다. 모든 생성 주소를 검사 소유 Set에 넣고 cleanup 전 검증하여 이 Set 밖의 terminal에는 interrupt/kill/rm을 허용하지 않았다. 검사 후 생성 process와 임시 폴더를 정리했다. 초기 CLI 조사용 printf/list synthetic도 생성 주소만 정리했다.

현재 DB 회귀 검사 36개도 통과했다. source와 fixture의 성공은 실제 하단 native terminal이 사용자의 화면에서 live 갱신되고 중앙 문서를 유지한다는 시각 증거가 아니다. 부모가 live body 통합 후 synthetic 장기 출력·선택 전환·resize·중지·재실행을 실제 앱에서 확인해야 한다. 설치와 CUA는 수행하지 않았다.

## 부모 통합

T28에서 RunResults와 execution-layout.js를 연결했다. 기존 result block의 id/slot/size/min/hidden을 보존하며 단일 controller와 native terminal body로 재구성한다. SQL 선택 때는 terminal을 숨기고 controller가 기존 공용 grid를 표시한다. legacy snapshot의 readonly transcript도 유지한다. fresh processOwned 복구는 status를 그대로 사용하고 pending stopRequested를 보존한다.

check_database_editor의 실제 import graph 회귀에서 이동된 도구와 사용자 terminal 불변, native shell body, SQL 전환, legacy fallback, 중앙 source 불변을 확인했다. 첫 batch를 설치했다. CUA는 Mac 잠금으로 중단됐으므로 실제 하단 live paint/중지/resize 검증은 아직 완료가 아니다.
