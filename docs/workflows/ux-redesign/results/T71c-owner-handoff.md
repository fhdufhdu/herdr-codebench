# T71c · 파일 분석 owner handoff

상태: frontend 구현·전용 자동 검증 완료. 상속한 high effort로 수행했다. 사용자 요청에 맞춰 선택 파일만 분석 lease를 유지한다. 엔진 tombstone-idempotency, backend engine-generation guard와 EditorHost 활성화 순서는 상위 소유이며 이 기록의 frontend 변경과 함께 통합해야 한다. 설치·빌드·재시작·commit은 하지 않았다.

## 원인 근거

`text-editor.startLsp`는 이전 `leaseClosings[path]`의 cleanup이 실패하면 새 `LspSession`을 만들기 전에 같은 old owner의 close를 다시 요청한다. backend가 owner conflict를 반환하면 이 barrier에서 raw error가 표시되며 새 세션의 bounded recovery까지 도달하지 않는다. 따라서 원래 화면의 raw owner-conflict는 일반 semantic request 실패와 구별된다.

엔진의 기존 close 순서는 `sync A → close A 성공/owner tombstone → sync B → close A 재전송`에서 B와 old A를 비교해 owner conflict를 반환한다. old A는 이미 정리됐지만 반복 close가 실패한다. client `close()`는 pending promise를 공유하지 않아 retire와 HMR release가 겹치면 동일 owner cleanup을 중복 전송할 수 있다. 상위는 **이미 tombstone된 정확한 owner**의 close만 먼저 idempotent하게 승인하며, 처음 보는 foreign owner의 close 거부는 유지한다.

또한 `ReviewAnalysis.load`는 source 파일 cleanup promise가 `false`로 끝나도 결과를 확인하지 않고 새 review owner를 만들었다. 파일→리뷰 handoff가 실패한 상태에서 경쟁하는 owner를 시도할 수 있는 경로였다. 숨긴 파일 7개의 lease·heartbeat 유지도 파일 단위 요청에 불필요하므로 제거했다.

## 변경

- `LspSession.close()`는 일반 Promise 반환 함수로 바꿔 같은 in-flight promise를 그대로 반환한다. `alive=false` 이후의 중복 close도 요청을 추가하지 않는다. 실패하면 pending 참조를 해제해 **같은 owner** cleanup을 나중에 재시도할 수 있고, 성공하면 추가 close 요청이 없다.
- attempted/acknowledged 두 cleanup 모두 `{ engine: this.engineIdentity }`를 backend로 전달한다. 상위 generation guard가 이전 엔진 owner의 cleanup을 새 엔진에 적용하지 않도록 한다. stale-revision fallback도 같은 owner를 유지하며 unknown foreign-owner 오류는 무시하지 않는다.
- `EditorSurface.awaitClosing(path,cx)`를 source startup과 review beforeOpen의 공통 barrier로 제공한다. 실패한 정확한 session만 재시도하며 지속 실패는 `false`다. 성공 시 record와 retiring session 참조를 정리하고, 대기 중 최신 closing record가 생기면 그것도 확인한다. 새 owner를 강제로 claim하거나 미확인 owner를 닫지 않는다.
- source startup은 owner conflict barrier를 사용자에게 한국어로 설명한다. 오류를 성공으로 바꾸거나 서버를 재시작하지 않는다.
- review는 beforeOpen이 `false`면 새 세션 생성을 멈추고 이전 분석 정리 실패와 재선택 방법을 표시한다. 이후 barrier가 성공하면 다시 load할 수 있다.
- `retireInactive`는 선택한 파일만 유지한다. 다른 파일의 CodeInput과 미저장 문서는 그대로 캐시하며 LSP lease·heartbeat만 해제한다. project-root 단위 서버 프로세스 재사용은 엔진 계약대로 유지한다.

## 검증

- `node --experimental-vm-modules design/idea/check_ade_lsp.mjs` 통과: concurrent close의 promise identity·cleanup 1회, cleanup 실패 후 같은 owner 재시도, 성공 후 no-op, engine identity 전달, 기존 pending write/HMR/stale revision/foreign-owner 거부 검증.
- `node --experimental-vm-modules design/idea/check_ade_editor_leases.mjs` 통과: 선택 파일만 lease 유지, inactive 문서 원문 유지, same-path cleanup barrier, 실패 중 새 owner 생성 금지, 한국어 오류, 실패한 exact owner cleanup 재시도와 record 회수, 최종 해제.
- `node --experimental-vm-modules design/ade/check_review_analysis.mjs` 통과: false handoff에서 새 review session 미생성, 상태 오류 표시, 이후 successful handoff에서 load 회복, 기존 historical/current source 분리·탐색.
- `node --experimental-vm-modules design/idea/check_ade_lsp_recovery.mjs` 및 `check_ade_editor_host.mjs` 통과.
- `herdr-app check /Users/estsoft/project/herdr-codebench/mods/ade` 통과.

## 한계와 통합 확인

`ReviewAnalysis.close`의 기존 `Promise.allSettled` cleanup 결과 수집 구조는 이번 좁은 변경 범위에서 유지했다. 진짜 transport cleanup 실패를 완전히 추적하는 review lifecycle 확장은 별도다. unknown foreign-owner conflict는 정리 성공으로 취급하지 않으므로 실제 다른 owner가 살아 있으면 barrier가 계속 막는다.

상위 EditorHost는 review 비활성화를 source activate보다 먼저 실행하고 review beforeAnalysis를 `files.awaitClosing(path,eventCx)`로 연결한다. 실제 LyricCommandService 화면에서 old owner 반복 cleanup이 더는 source startup을 영구 차단하지 않는지, source↔review↔source와 다른 파일 전환을 검증해야 한다. 자동 mod check는 실제 화면 검증을 대신하지 않는다.
