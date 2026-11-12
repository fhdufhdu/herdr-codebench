# T62 자동완성·서식·줄 주석

2026-11-09. fresh ADE text editor와 buffered Go LSP 경계에 completion/resolve/formatting을 추가했다. 기존 codenav controller를 가져오지 않았다.

엔진 요청은 현재 path/owner/revision을 확인한다. completion은 UTF16 위치, 최대 100개/4MiB 후보, 서버 capability와 itemDefaults를 처리한다. 선택한 항목만 서버가 지원하는 resolve를 요청한다. plain text/textEdit와 같은 문서 additionalTextEdits를 지원하며 snippets, commands, InsertReplace, cross-file, 잘못된/겹치는 범위는 비활성 또는 오류다. initialize는 snippetSupport:false다. formatting도 snapshot 범위를 검증한다. executeCommand/workspace edit를 적용하지 않는다.

편집기는 CtrlSpace와 서버에서 확인한 trigger characters(180ms debounce)로 요청한다. 후보와 raw completion item은 로컬 메모리에만 보관한다. public SDK에 정확한 keyboard caret rect가 없어, 확정된 editor bounds 안의 오른쪽 위 panel을 사용한다. native input focus를 유지한 채 위/아래/Page로 선택하고 Enter/Tab으로 적용하며 Escape로 닫는다. source/preview는 같은 문서다.

선택한 primary/additional import edits는 CodeInput.applyEdits로 한 revision/undo에 적용한다. 요청 후 문서·세션·revision·caret가 바뀌면 응답/resolve를 버린다. 서식은 CmdAltL(mac)/CtrlAltL(그 외), indent 4 spaces로 현재 버퍼만 변경한다. 저장은 별도다. 줄 주석은 Cmd/ 또는 Ctrl/이며 알려진 확장자에만 //,#,-- prefix를 제공한다. IME pending/readonly/stale revision은 CodeInput atomic 경계가 거절한다.

추가로 실제 T60 오류 내용을 볼 수 있도록 LSP 정보 영역 header36/content최대144의 definite height를 지정했다. 실제 definition 실패 원인은 root가 다음 batch에서 오류 본문을 확인한다.

검증:

- engine `go test -race ./...` 통과. fixture buffered completion/resolve/import/formatting, stale/owner 거절, snippet/command/범위/한도 검증.
- check_ade_completion: UTF16/CRLF, overlap/crossfile, import+primary 원자 적용, native focus 유지, arrow 무변경, stale resolve·문서 전환 formatting 거절.
- check_ade_lsp: completion owner/revision envelope, formatting options, 동일 revision caret 이동 응답 거절.
- check_ade_editor / check_ade_editor_leases / check_ade_lsp_recovery / check_ade_editor_menu 및 native ADE check 통과.

엔진 build/install/restart 및 actual UI 검증은 root 담당이다. 이 결과는 실제 completion 서버/UI 성공을 대신하지 않는다.

후속 bounds 검증: completion panel은 CodeInput이 측정한 viewport에서 양쪽 여백24와 top42를 빼고 최대460×320으로 제한한다. 미측정/높이0이면 그리지 않고, 매우 낮은 viewport에서는 header도 남은 높이로 줄여 clip한다. 200×120 fixture는176×78, top42로 viewport 안에 유지되며 높이50 fixture는8px로 제한된다. Root의 격리된 새 엔진 실제 TS probe는 completion100/customerName, resolve, formatting2edits, definition1 및 disk 무변경을 확인했다. 실제 native completion panel 검증은 root 대기 중이다.
