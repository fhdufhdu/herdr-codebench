# T26 buffer-aware LSP 결과와 프런트 연결 계약

2026-11-06. standalone Go engine만 변경했다. 앱 본체·프런트·설치 engine·사용자 LSP 설정은 수정하지 않았다. 미저장 원문은 engine 메모리에만 두며 disk/shared.json에 쓰지 않는다.

## 정확한 JSON 계약

기존 authenticated POST와 envelope를 유지한다. 성공은 `{"ok":true,"result":...}`, 실패는 `{"ok":false,"error":"..."}`다. 기존처럼 도메인 충돌은 HTTP200의 실패 envelope, malformed JSON/type은 HTTP400이다. 기존 `owner:{line,col}`는 super-navigation 위치이므로 보존하고 새 문자열은 **document_owner**로 구분했다.

### Sync

`POST /document_sync`:

```json
{"path":"/workspace/app/main.go","document_owner":"unique-buffer-session","revision":0,"text":"package main\n","retry":false}
```

성공 result:

```json
{"path":"/workspace/app/main.go","document_owner":"unique-buffer-session","revision":0,"version":1}
```

- path는 engine 머신의 absolute local path이며 lexical clean한다. remote routing과 symlink/inode alias 통합은 없다. UI가 remote spec을 차단해야 한다.
- document_owner는 nonblank session id, revision은 필수 nonnegative integer, text는 필수 string이다. revision0/빈 문자열은 유효하다.
- 동일 owner/revision/text 재시도는 idempotent하다. 낮은 revision, 동일 revision의 다른 text, 다른 owner의 점유는 명시적으로 거부한다.
- 메모리 lease를 먼저 확보한다. server startup/transport 실패에도 수락한 원문·revision은 유지하므로 동일 sync를 재시도하거나 그 revision을 close한다. 실패 응답이 lease 미획득을 뜻하지 않는다.
- incremental server에는 이전 **buffer 원문** 전체의 UTF-16 range를 새 원문으로 교체하는 단일 didChange를 보낸다. 디스크 원문으로 range를 계산하지 않는다.
- 서버 openClose 미지원이면 원문 전달 성공으로 응답하지 않고 거부한다. change 미지원 서버의 후속 변경도 기존 오류 방어를 유지한다.

### Semantic requests

지원: hover, definition(kind typeDefinition/implementation 포함), references, symbols, workspace_symbols, diagnostics.

```json
{"path":"/workspace/app/main.go","document_owner":"unique-buffer-session","revision":0,"line":0,"col":8}
```

성공 result:

```json
{"value":{"markdown":"..."},"path":"/workspace/app/main.go","document_owner":"unique-buffer-session","revision":0,"version":1}
```

value는 해당 route의 기존 result다. owner/revision이 현재 lease와 정확히 일치해야 한다. text는 불필요하며 전달한다면 현재 원문과 정확히 같아야 한다.

revision은 UI buffer 번호, version은 LSP process 번호다. 서버 재시작 시 version은1부터 시작할 수 있다. 현재 lease로 semantic 요청하거나 동일 sync를 재시도하면 서버를 메모리 원문으로 복구한다. failed server는 기존 retry 플래그로 재시작할 수 있다. engine 자체 재시작은 메모리를 잃으므로 UI가 다시 sync해야 한다.

**응답 수명:** lease 검증·동기화 이후 mutex를 풀고 semantic RPC를 기다린다. typing sync/close는 pending hover에 막히지 않는다. 그 사이 server 내용이 바뀔 수 있으므로 wrapper는 immutable 분석 snapshot의 증명이 아니라 요청을 시작한 snapshot 식별이다. UI는 document_owner/revision이 현재 buffer와 다르거나 이미 닫혔으면 결과를 버려야 한다.

### Diagnostics

buffered diagnostics의 value:

```json
{"items":[],"busy":[],"diagnostic_version":null,"version_confidence":"pending"}
```

- changed text sync 시 이전 cache를 즉시 비운다. disk-open 문서를 같은 text로 claim할 때도 새 server version의 change를 보내 분석 경계를 만든다.
- versioned publish는 현재 buffered LSP version과 일치할 때만 저장한다. 늦은 과거 version이 최신 cache를 덮어쓰지 못한다.
- matched: publish가 일치하는 LSP version을 명시했다.
- pending: 새 sync 이후 eligible publish가 아직 없다. items는 빈 배열이다.
- unversioned: cache 초기화 후 새 publish를 받았지만 서버가 version을 생략했다. items를 반환하되 **현재 revision 분석이 증명된 것은 아니다.** 이전 분석의 늦은 versionless publish를 완벽히 구분하지 못한다. 프런트가 확인 수준을 구분해 표시해야 한다.
- legacy diagnostics의 items/busy 모양은 유지한다. metadata는 buffered result에만 추가된다.

### Close

`POST /document_close`:

```json
{"path":"/workspace/app/main.go","document_owner":"unique-buffer-session","revision":0}
```

성공 result:

```json
{"closed":true,"path":"/workspace/app/main.go","document_owner":"unique-buffer-session","revision":0}
```

현재 owner/revision이 정확히 일치해야 한다. 동기화된 server가 있으면 didClose/cache 해제 후 lease를 제거한다. close를 위해 서버를 새로 시작하지 않는다. 다른 owner, stale revision, 이미 닫힌 lease는 오류다.

닫힌(path,document_owner)는 engine 수명 동안 retired identity로 보관한다. 닫힘 뒤 늦은 sync가 lease를 부활시키지 못한다. **reopen에는 새 document_owner가 필요하다.** retired identity에는 원문이 없다. 같은 server의 close/reopen도 이전 LSP version을 재사용하지 않아 늦은 진단과 충돌하지 않는다.

## 기존 경로와 경합 보호

active lease가 없으면 ownerless saved-file 요청의 모양과 disk 동작을 유지한다. active lease가 있으면 ownerless semantic 요청을 거부한다. 상대 경로로 absolute lease를 우회하지 못한다.

related/super는 multi-file Open/read를 쓰므로 buffered 요청은 명시적으로 거부한다. saved related는 유지하고 secondary Open/read에도 lease guard를 연결했다. server 재시작 중 아직 복구되지 않은 pending lease도 보호한다. Spring 기존 explicit-text 계약은 유지하며, owner/revision을 붙인 buffered Spring 요청은 거부한다. tokens는 기존 text 기반 lexical 분석이다.

server startup 대기·semantic Call 대기 중에는 document mutex를 잡지 않는다. lease 검증과 sync/close의 ordered 전송에만 사용한다. startup 이후 오래된 continuation은 owner/revision/lease 생존을 다시 확인한다.

completion·rename·format·multi-file edit·workspace/applyEdit는 추가하지 않았다. 다섯 DB driver/connection/transaction 경로도 변경하지 않았다.

## 구현과 검증

소스: engine/editor_document.go, lsp.go, main.go, related.go. 문서: engine/README.md. 시험: engine/editor_document_test.go 및 core_test.go의 기존 child fixture 확장.

별도 child process의 실제 stdio 프레임과 authenticated HTTP handler로 검증했다.

| 시험 | 확인한 동작 |
| --- | --- |
| TestBufferedDocumentHTTPAndStdio | 미저장 원문 관측/disk 불변, sync 재시도 중복 notify 방지, buffered wrapper/legacy shape, owner/text/revision 충돌, UTF-16 range, cache 초기화·version mismatch·matched/unversioned, late-old 진단 거부, didClose, 재열기 version 증가, server restart 복구 |
| TestBufferedSemanticDoesNotBlockSyncOrClose | fake hover 응답을 실제 보류한 동안 새 sync와 close 완료. 보류 응답은 이전 revision/version으로 반환되어 UI가 폐기 가능 |
| TestBufferedValidationAndOutOfOrder | 누락·음수·빈 owner/path/text 검증, 같은 text의 disk→buffer claim 새 version, out-of-order sync/close, retired session, 기존 owner-position JSON 보존 |
| TestBufferedCloseDuringStartup | initialize 지연 중 close 후 오래된 sync가 lease를 부활시키지 못함. pending lease의 legacy secondary Open/read 거부 |
| TestBufferedUnsupportedSyncRetainsLease | openClose 미지원 서버에 성공 ack를 주지 않음. accepted memory lease는 유지해 disk 덮어쓰기를 막고 명시 close 가능 |

`cd engine && go test -race ./... -count=1` 전체 통과. 기존 transport/HTTP/LSP/Spring/related 및 DB 회귀를 함께 검증했다. 외부 HTTP dependency가 없는 stdio 계약이므로 Postman simulation은 사용하지 않았다. 실제 사용자 server 기동·설치 engine 교체·prebuilt artifact 생성은 하지 않았다. 프런트 snapshot discard/confidence 표시와 실제 편집·IME·저장 UX는 이 engine 태스크의 검증 범위 밖이다.

## 별도 실제 TypeScript server 검증

2026-11-06. 부모가 현재 source로 빌드한 `/tmp/codebench-editor-lsp-engine`을 사용했다. 설치본과 사용자 engine은 건드리지 않았다. 실제 `/Users/estsoft/.nvm/versions/node/v22.22.3/bin/typescript-language-server --stdio`를 해당 디렉터리의 Node로 실행했으며 version은 **6.0.3**이다. 별도 engine은 `--port 0`, 임시 state/config/cache와 strict/noEmit tsconfig·package.json이 있는 소형 임시 workspace를 사용했다. npm install이나 실제 프로젝트 설정 변경은 없었다.

실행 fixture/report: `/var/folders/pd/b2x6km0n1595w41vbl3_8jgh0000gn/T/codebench-t26-real-ts-8v5z1et0/report.json`. 검증 script: `/tmp/t26-verify-typescript.py`. 실제 HTTP port55298, own engine PID78285였다. 보고서에는 인증 token을 포함하지 않았다.

| 단계 | 관측 결과 |
| --- | --- |
| Disk baseline | `answer: number = 7`, `result: number = answer`를 가진71byte 파일 |
| Sync rev0 | 미저장 `answer: number = "broken"`를 전송. ack revision0/version1 |
| 오류 진단 | disk에는 없는 TypeScript2322 `Type 'string' is not assignable to type 'number'.` 수신. 범위 line0/col13–19, severity1/source typescript |
| Hover/definition | 사용처 hover가 `const answer: number`. definition이 동일 sample.ts의 line0/col13–19로 이동할 위치 반환 |
| Sync rev1 | disk를 저장하지 않고 `answer: string = "ready"`, `result: string = answer` 전송. ack revision1/version2 |
| 진단 갱신·hover | 새 publish 후 items=[]; hover가 `const answer: string`으로 바뀜 |
| Close | 현재 owner/revision1 close ack closed=true |
| Legacy 복귀 | ownerless hover가 다시 disk의 `const answer: number`를 반환. 기존 legacy result 모양 유지 |
| Disk 보존 | sync 전후와 close 이후 모두 원본71byte와 문자열 동일 |
| Cleanup | own engine SIGTERM/exit0, 해당 process group이 사라짐을 확인. own TypeScript child도 같은 group으로 종료됨 |

이 실제 서버는 오류 publish와 수정 후 empty publish 모두 **version을 생략**했다. 관측 metadata는 diagnostic_version:null, version_confidence:unversioned이며 wrapper revision/version은 각각0/1과1/2였다. 테스트는 type error와 hover 변화의 실제 관측을 입증하지만, versionless 진단을 서버의 명시적 revision 확인으로 승격하지 않는다.

추가로 기존 결과 preview의 한계를 확인했다. definition 좌표는 LSP 응답이지만 `Location.text`는 `withPreviews`가 disk를 읽어 `export const answer: number = 7;`로 남았다. 미저장 target text의 preview 일치까지 보장하는 계약은 이번 구현에 포함되지 않는다. 프런트는 이 text를 현재 buffer 원문의 증명으로 사용하면 안 된다. 후속 source 변경 없이 관측 사실만 기록했다.

검증 script는 exit0으로 완료됐다. 이 후속 검증에서는 source·frontend·설치 artifact·사용자 server/config를 수정하지 않았고, 결과 문서만 추가했다.

## 후속 수정: buffered navigation preview도 원문 기준

상위 검토 후 위 실서버 실험에서 발견한 preview 불일치를 수정했다. 이제 **buffered definition/references**는 target path에 active lease가 있으면 그 target의 현재 메모리 text로 미리보기를 만든다. active target이 없으면 기존 disk fallback을 사용한다. legacy 응답은 기존 disk preview를 유지한다. 공통 trim/240-rune 제한은 withPreviewsFrom을 통해 그대로 재사용한다. source wrapper의 document_owner/revision/version 계약은 바뀌지 않았다.

다른 owner의 target buffer도 현재 text snapshot을 사용한다. target의 revision을 LSP가 분석했다고 증명하거나 target 좌표가 그 snapshot에 속한다고 보장하는 것은 아니다. source request wrapper만 기존 snapshot 식별을 제공하므로, UI는 source stale 응답을 여전히 버려야 하고 cross-document target preview를 revision-confirmed라고 표시하면 안 된다. target snapshot을 복사한 뒤에는 lease mutex를 풀며 RPC 응답을 기다리는 동안 잠그지 않는다.

검증:

- TestBufferedNavigationPreviews 추가: 실제 child stdio/HTTP의 definition/references가 미저장 원문 preview를 반환하고 source wrapper를 보존함. 다른 owner target의 memory preview, legacy disk preview, close 이후 disk fallback, disk 불변도 확인.
- `cd engine && go test -race ./... -count=1` 최신 전체 통과(7.967s).
- 최신 source를 별도 `/tmp/codebench-editor-lsp-preview-engine`으로 빌드해 실제 TypeScript server6.0.3 재검증. 원래 `/tmp/codebench-editor-lsp-engine`과 설치본을 교체하지 않았다. definition text가 disk의 `number = 7` 대신 **`export const answer: number = "broken";`**로 반환됨을 명시 assertion으로 확인했다. 미저장2322진단→hover/정의→수정 후 empty진단/string hover→close→legacy number hover→disk71byte 불변의 전체 흐름도 다시 통과했다.
- 후속 실제 fixture/report: `/var/folders/pd/b2x6km0n1595w41vbl3_8jgh0000gn/T/codebench-t26-real-ts-u0qlmy_r/report.json`, script `/tmp/t26-verify-typescript-preview.py`. 별도 engine PID91567/port55725. engine exit0과 own process group 전체 소멸을 확인했다. 진단 metadata는 이번에도 unversioned/null이었다.

이 후속으로 앞 절에서 기록한 buffered definition/reference의 disk preview 불일치는 해결됐다. 다른 문서 target의 분석 revision 증명과 versionless 진단의 한계는 여전히 명시적으로 남는다.

## 후속 통합: 미저장 super/related 보존

`related`의 **kind:super**를 buffered semantic 계약에 연결했다. 앞 절의 buffered related 미지원은 일반 Spring related에 대해서만 유지되며, super는 아래 계약으로 지원한다. 기존 `owner:{line,col}`는 class 위치이며 document_owner와 구분한다.

```json
{"path":"/workspace/app/Child.ts","document_owner":"source-session","revision":0,"kind":"super","name":"answer","owner":{"line":1,"col":6},"line":1,"col":28}
```

응답은 다른 buffered semantic과 같은 `{value:[Location...],path,document_owner,revision,version}` wrapper다. 다른 owner/stale source revision은 openRequest에서 거부한다. source text는 해당 openRequest의 원문 snapshot으로 고정하여 header fallback이 disk나 새 revision을 섞어 읽지 않는다.

secondary parent가 active buffer이면 **같은 language/root server 안에서** 현재 메모리 원문을 srv.syncText로 전달하고, symbol fallback도 그 원문을 읽는다. 다른 owner의 parent도 가능하다. 읽은 target owner/revision을 캡처하고 navigation 종료 전에 다시 확인하므로 target 변경/close가 끼면 stale-target 오류를 반환한다. target preview는 검증과 같은 경계에서 캡처한 text로 만든다. RPC 응답 대기 중에는 document mutex를 잡지 않는다.

이 범위는 target을 다른 server로 옮기는 기능이 아니다. 다른 language/root에 속한 active parent는 명시적 오류다. 지원하지 않는 경로를 saved disk로 몰래 대체하지 않는다. source wrapper는 계속 source snapshot 식별이며, target text snapshot을 서버가 분석했다는 별도의 revision 증명은 제공하지 않는다. 서버가 비동기적으로 분석하는 한 source 결과는 caller가 owner/revision으로 여전히 폐기해야 한다.

legacy super와 일반 Spring related는 기존 계약을 유지한다. buffered non-super related와 Spring route는 기존 unsupported 오류를 유지한다. completion/rename/format 등 새 기능은 추가하지 않았다.

검증 추가:

- TestBufferedSuperNavigation: 실제 fake-child stdio/HTTP로 disk와 다른 UTF-16 source header를 읽고 다른 owner의 미저장 parent method를 찾음. primary header 변경 이후 상속이 사라지는 결과, source owner/stale 거부, source wrapper 보존, 부모 원문 server sync, disk 불변, close 이후 legacy unwrapped 계약 검증.
- TestBufferedSuperRejectsChangedTargetWithoutBlockingSync: parent documentSymbol 응답을 child에서 보류한 동안 새 target revision sync가 완료됨. 응답 재개 후 서로 다른 target revision을 섞은 결과 대신 stale-target 오류.
- TestBufferedSuperRejectsCrossRootTarget: 별도 root의 active parent를 명시적으로 거부.
- `cd engine && go test -race ./... -count=1` 최신 전체 통과(8.654s). 기존 super overload/header fallback/UTF-16/lexical/related 회귀 포함.

실제 TypeScript server6.0.3으로도 별도 `/tmp/codebench-editor-lsp-super-engine`을 빌드해 검증했다. disk는 number-returning Parent/Child였고, 미저장 buffer는 string-returning Parent/Child였다. buffered related(super, answer)가 **미저장 `parent-buffer` 문자열을 포함한 Parent.answer** 위치(line0/col15–21)와 preview를 반환했다. 이어 미저장 Child header의 extends를 제거하자 revision1/version2에서 value=[]가 반환됐고 revision0 요청은 stale 오류였다. disk144byte는 처음부터 끝까지 동일했다.

실제 fixture/report: `/var/folders/pd/b2x6km0n1595w41vbl3_8jgh0000gn/T/codebench-t26-real-super-tsf2ehas/report.json`, script `/tmp/t26-verify-typescript-super.py`. own engine PID4956/port58338, close ack 후 SIGTERM/exit0, 전체 own process group 소멸 확인. 설치본·기존 temp binary·사용자 engine/config는 교체하지 않았다.

## T28 통합 후 Spring·배포 갱신

Spring non-super related의 기존 explicit-text 요청은 active buffer lease가 있어도 허용한다. 이 순수 분석은 LSP document를 disk로 열지 않으므로 owner lease를 덮어쓰지 않는다. text 없는 ownerless 요청은 계속 거부한다. TestSpringRelatedExplicitTextPreservesBufferLease가 명시 원문 결과·lease 불변·disk 불변·implicit 요청 거부를 확인했고 전체 `go test -race ./... -count=1`이 통과했다.

부모가 source 변경 후 여섯 target을 다시 빌드하고 checksum 검증·host engine 설치를 수행했다. 현재 배포 version은 0.1.0-bfa2e1289dac이다. 실제 사용자 앱/코어를 재시작하지 않았다. 이전 절의 ‘배포 생성/설치하지 않음’은 T26 담당자의 당시 범위이며 이후 부모 통합에서 갱신됐다.
