# T14 실제 실행·SQL 하단 결과 도구

2026-11-05. 상태: 검토 대기. 지정 effort medium 유지. 부모의 HTML 시안 승인 후 native 적용 위임 범위만 구현했다.

## 변경 파일과 공개 계약

- `mods/codenav/execution-results.js`: workspace별 실행 snapshot·선택·닫기·보관 정책·확인된 terminal interrupt.
- `mods/codenav/run.js`: 기존 구성 소유 terminal 실행을 보존하며 idea에서 실행별 로그·상태·종료 코드를 결과 기록에 반영한다. 실행 구성 편집에 공통 `uiManagedList`를 적용한다.
- `mods/codenav/database-editor.js`: SQL 실행 job snapshot을 결과 기록에 반영하고 `RunResults`를 export한다. 기존 grid·행 선택·복사·추출기·전송 구현을 상속해 재사용한다.
- 부모가 추가 허용한 `design/idea/check_run_sessions.mjs`: 기존 shell/codebench 회귀 검증을 유지하고 실제 history store·terminal monitor 의미 검증을 추가했다.
- 이 결과 문서. generated 파일·설치·main.js·tool 등록은 부모 담당이다.

부모 등록 계약은 `RunResults` / `view: "run-results"` / tool `run-results` / child `bottom-run-results`다. 공유 헤더의 `codenav.run-results-stop`은 이 view의 `run-results-stop` command로 전달한다. 기존 추출기 overlay는 `database-grid:`와 `database-transfer:` command를 그대로 사용하고 결과 경로를 `run-result:...`로 지정한다. 원본 DatabaseEditor와 RunResults가 각자 소유 경로만 처리하므로 nextCommand broadcast에서 중복 처리하지 않는다.

## 구현 결과

실행마다 이름·명령·작업 폴더 또는 SQL 연결/DB/schema와 실제 job 결과를 snapshot으로 보존한다. 실행 중인 job과 선택한 결과는 독립이다. 이전 결과를 보고 있어도 실제 실행의 완료·중지·오류만 해당 기록에 반영한다. 동일 구성을 반복해도 새 기록이 생긴다. 구성 환경 변수는 원래 구성 저장소에만 두며 결과에 중복 저장하지 않는다.

하단 도구는 공통 `uiTab`, `uiTabStrip`, `TabViewport`를 사용한다. 좌우·Home·End로 선택하고 선택 탭을 노출한다. 실행 중 닫기는 비활성화하고 완료 결과를 닫으면 인접 결과를 선택한다. 결과 view는 grid와 tab의 focus handle 및 읽기 전용 transcript EditorState만 소유·해제한다. SQL source viewer/editor handle은 새로 만들지 않는다.

idea에서 SQL 원문 문서는 중앙에 유지하고 실행 결과만 하단에 표시한다. table 직접 편집은 중앙에 유지한다. 기존 cancel·job 진행률·다중 statement 결과 선택·행 선택·복사·추출 형식·내보내기·NULL/숫자/멀티라인 표현을 기존 DatabaseEditor 메서드로 재사용한다. 결과용 문서는 별도 selected Set·changes Map·format·resultIndex를 소유해 원본 콘솔 상태를 덮어쓰지 않는다. 원본 SQL 문서의 실행 중 닫기 보호를 유지한다. codebench에서는 기존 중앙 SQL 결과와 terminal 실행 동작을 유지한다.

공통 실행 구성 목록은 검색·추가·삭제·복제·편집·이동을 제공한다. 검색 중 순서 이동을 비활성화하고 키보드 선택과 목록 scroll은 MenuController가 소유한다. 기존 ID migration·terminal attachment·취소 전 미저장 draft·확장 필드 보존을 유지한다. 새 소유 input/focus/menu handle은 release한다.

## 실제 shell 종료와 중지 근거

기존 구성 소유 terminal과 shell을 재사용한다. idea 실행에는 원래 명령 뒤 **별도 줄**에 실행마다 고유한 `printf` 종료 footer를 추가한다. `hc get --json`의 shell argv가 sh/bash/dash/ksh/zsh이면 `$?`, fish이면 `$status`를 사용한다. 단독 줄 `^실행별marker:-?숫자$`만 종료로 인정하고 종료 코드를 보관한다. 0은 완료, 비0은 오류다. 명령 echo나 일반 출력의 marker 유사 문자열은 종료 근거가 아니다. 대기 시간 또는 shell 프로그램 표시만으로 완료 처리하지 않으므로 shell builtin과 while loop를 조기 완료로 오인하지 않는다. shell 자체가 종료되면 native terminal의 `state=finished`와 `exit_code`를 사용한다.

중지는 `hc interrupt TERMINAL --json`의 **stopped/exited** 응답을 확인한 뒤 cancelled로 완료한다. still_working/unknown은 실행 상태를 유지하고 재시도할 수 있게 한다. 재시작은 이전 기록의 monitor가 종료될 때까지 기다려 terminal 출력이 다음 실행에 섞이지 않게 한다. 새 shell 검사/출력 읽기 이후에도 workspace를 재확인하고 원래 workspace를 벗어났으면 명령을 전송하지 않는다.

지원되지 않는 shell에는 footer를 주입하지 않고 자동 완료 확인 불가를 도구에 표시한다. 이 경우 native terminal 자체 종료 또는 확인된 Stop이 필요하다. terminal 로그는 `hc read --lines 2000`으로 기존 terminal baseline 이후 출력을 보관하며 보관 한도를 표시한다. SQL 행을 임의로 잘라 저장하지 않는다.

## 보관과 메모리

workspace마다 완료 기록은 최근 20개와 약 32 MiB 문자열 예산 안에서 **오래된 실행 전체**를 제거한다. 현재 선택과 queued/running 기록은 이 예산보다 우선 보존한다. 정책을 도구 caption으로 알린다. 큰 결과를 보호하는 동안 예산을 초과할 수 있으며 보호가 풀리면 결과 전체를 제거한다. 행 일부를 조용히 잘라 보관하지 않는다. 각 기록의 직렬화 크기를 snapshot 변경 때 계산해 저장하고 매 progress update마다 모든 기록을 다시 JSON stringify하지 않는다. 선택된/실행 중인 큰 결과와 여러 workspace의 보호 기록은 여전히 메모리를 사용한다.

## 재현 가능한 검증

저장소 root에서 다음을 실행했다.

```sh
node --check mods/codenav/run.js
node --check mods/codenav/database-editor.js
node --check mods/codenav/execution-results.js
node --experimental-vm-modules design/idea/check_run_sessions.mjs
node --experimental-vm-modules design/idea/check_database_editor.mjs
herdr-app check mods/codenav
```

모두 통과했다. check_run_sessions는 저장된 실제 source module을 실행하고 native host I/O만 대역으로 바꾼다. 기존 구성 ID·rename/copy·same-name isolation·codebench 전송·workspace guard를 유지한다. 추가 검증은 결과 view를 생성하지 않은 상태의 terminal monitor 완료/중지, 정확한 footer와 비0 exit, shell builtin의 조기 완료 방지, marker 유사 출력 무시, interrupt 미확인 후 재시도, 이전 viewed 결과 선택 보존, 실행 중 닫기 거절·인접 탭 선택, SQL 명령/연결 deep snapshot, workspace 분리, 실행 중·선택 기록 보호, 최근 20개 및 32 MiB 초과 시 전체 기록 제거다.

기존 check_database_editor의 28개 검증은 SQL 승인 원문·DELIMITER·실제 job transport/poll/cancel·직접 편집·행/셀 선택·typed NULL·copy/extractor/export·close protection·stale async lifecycle 등을 확인한다. 이 하위 작업에서 실제 앱 화면을 보거나 설치하지 않았다. 부모의 native UI 확인과 실제 짧은 shell 실행·SQL 실행 검증을 통합 완료 기준으로 남긴다.

## 런타임 재로딩 복구와 추가 검증

부모의 후속 승인에 따라 같은 source 3개에 VM 내부 claim/release Set을 추가했다. 원본 SQL 제출/조회와 shell monitor는 실행을 소유하고 finally에서 해제한다. RunResults는 초기화와 소유한 1초 timer에서 현재 workspace의 소유자 없는 busy 기록만 회수하며 release 때 timer를 취소한다. 원래 poll이 살아 있으면 추가 조회하지 않는다. Set은 VM 재로딩 시 초기화되므로 영속 heartbeat나 새 API 없이 저장된 기록을 회수한다.

SQL은 저장된 job ID의 `db_job`만 재조회한다. SQL ID 유실·unknown job은 복구 불가를 명시해 닫을 수 있게 한다. `db_query`를 재전송하거나 자동 cancel하지 않는다. shell은 저장된 terminal·고유 footer와 native 종료 코드만 확인한다. VM 밖에 있던 기존 terminal baseline을 재구성할 수 없으므로 기존 로그를 유지하고 연속성 유실을 표시한다. live terminal만 있고 실행 동일성을 확인할 수 없으면 `untracked`(상태 확인 불가)로 표시한다. 이는 작업 종료나 오류의 확정이 아니며 결과 도구에서 중지하지 않고 닫기를 허용한다. 구성 소유 session의 untracked 표시는 결과를 닫아도 남아 재실행 확인을 유지하고 native interrupt가 stopped/exited를 확인한 뒤에만 해제한다.

`design/idea/check_database_editor.mjs`를 부모가 추가 허용하여 실제 RunResults subclass 검증과 재로딩 복구 검증을 저장했다. 기존 28개를 유지한 총 **34개** 검증을 통과했다. 실제 grid row handler·복사·NULL·추출기 overlay/command path·연결 snapshot·다중 결과 index·전송 중 닫기 보호·SQL stop 대상·source/result selection 격리와 source 탭 전환을 확인한다. 복구 검증은 전체 실제 import graph를 새 V8 context에 다시 로드하고 host shared만 보존한다. 원래 VM claim이 복구를 막지 않음, db_query 재전송 0회, 완료·ID 유실·unknown job, exact footer·native exit 7·live untracked, 로그 유지, 타 workspace 불변, 소유권 해제와 source 제출 도중 release 후 회수를 확인한다. 동일 VM 원본 poll이 진행 중인 동안 복구를 반복 호출해도 추가 db_job 요청은 0회다.

동일한 재현 명령 `node --experimental-vm-modules design/idea/check_database_editor.mjs`, `node --experimental-vm-modules design/idea/check_run_sessions.mjs`, `herdr-app check mods/codenav`를 실행해 모두 통과했다. run session 검증에는 untracked 결과를 닫아도 재실행 확인이 유지되고 확인된 interrupt 후 해제되는 사례를 추가했다. 실제 설치·앱 재시작·잠금 해제 후 화면 검증은 부모 담당이다.
