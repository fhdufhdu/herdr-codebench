# T64 LSP 표시 안정성

사용자가 명확히 지정한 범위는 입력할 때 코드 색상·밑줄 등 LSP 표시가 깜빡이는 문제다. 자동완성 후속 작업은 중단했으며 해당 코드는 변경하지 않았다.

LspSession의 새 revision pending 상태는 진단/토큰 배열을 비우지 않고 이전 결과의 diagnosticsRevision/tokensRevision을 유지한다. confidence는 pending으로 전환해 이전 진단을 현재 revision에서 확인된 결과로 표시하지 않는다. CodeInput이 local ChangeSet으로 보정한 절대 offset decoration은 TextEditor가 pending callback으로 덮어쓰지 않는다. 각 field revision이 현재 CodeInput revision과 일치하는 실제 응답만 해당 decoration을 교체한다. 같은 배열을 status callback마다 재적용하지 않는다.

토큰과 진단 응답은 독립적으로 게시한다. 느린 진단 서버 때문에 이미 도착한 현재 revision 토큰이 지연되지 않는다. 현재 revision의 빈 결과는 authoritative하므로 해결된 진단/토큰을 정상 제거한다. 오래된 revision/project/session guard는 유지한다.

진단 패널은 새 응답을 기다리는 동안 이전 메시지와 행 높이를 유지하고 `이전 분석 · 새 진단 대기`로 표시한다. 이전 위치를 사용하는 row action은 diagnosticsRevision이 현재 문서와 일치할 때까지 비활성이다. CodeInput의 실제 span mapping/수정 구간 밑줄 제거는 별도 owner 작업과 통합한다.

검증: check_ade_editor는 pending의 mapped spans 보존, 현재 토큰만 교체/진단 유지, 현재 빈 진단으로 제거를 확인했다. check_ade_lsp는 pending revision tags 유지 및 느린 진단 중 토큰 독립 도착을 확인했다. recovery/lease tests 및 native ADE check 통과. 실제 입력 시 표시 안정성과 참조 owner 경계 검증은 root가 수행한다. Go/설치/CUA 변경 없음.

엔진 diagnostics의 version_confidence=pending은 현재 서버 revision을 아직 확인하지 못했다는 뜻이며 items가 빈 배열이다. 이 빈 배열을 확정된 진단 없음으로 해석하면 밑줄이 다시 깜빡인다. 첫 응답과 poll 모두 pending에서는 이전 배열/diagnosticsRevision을 유지하고 confidence만 바꾼다. matched/unversioned 결과에서만 decoration을 교체한다. fixture가 pending 빈 응답 보존 뒤 matched poll의 revision 전환을 검증한다.

## CodeInput 변경 범위 매핑

CodeDocument는 각 transaction과 undo/redo의 실제 CodeMirror ChangeSet, 편집 전 Text, 이전/현재 revision을 `lastChange`로 제공한다. history는 역 ChangeSet을 보관하므로 undo/redo도 추정 diff 없이 같은 경로로 보정한다. CodeInput은 바로 이전 revision에서 온 decoration만 매핑한다. 완전한 문서 교체와 revision 간격이 있으면 기존 표시를 제거한다.

영향 없는 token/diagnostic은 UTF16 offset을 ChangeSet.mapPos로 옮기며 `provisional: true`를 붙인다. 진단 내부 편집, identifier가 진단 경계에 붙는 입력, point diagnostic 편집은 해당 진단만 제거한다. identifier token 내부 일부 편집과 경계 identifier 입력은 기존 색상 분류를 잠정 유지한다. token 전체 교체, 비identifier 삽입 등 분류를 유지하기 어려운 직접 편집은 해당 token을 제거한다. 새 서버 배열을 적용하면 provisional 상태는 새 응답으로 대체된다. 잠정 진단 HoverCard에는 변경 후 진단 확인 중 문구를 표시한다.

`node --experimental-vm-modules design/idea/check_ade_code_input.mjs` 통과: emoji와 CRLF 앞 삽입, 정확한 offset 이동, undo/redo 역매핑, identifier 입력 중 색상 유지와 영향 진단만 제거, 경계 공백의 범위 포함 규칙, 새 응답 교체, 전체 교체 초기화, 여러 TextEdit의 일괄 매핑 및 point 진단 제거를 검증했다. `herdr-app check mods/ade` 통과. 이번 변경은 설치/CUA를 수행하지 않았으며 실제 타이핑 표시 검증은 root가 수행한다.

## 통합 설치와 실제 입력 검증 · 2026-11-09

ADE 설치 backup `1794186611632829000`. CodeInput/editor/host/LSP/recovery/lease 회귀, canonical sync 검사, 공통 시스템 검사, `herdr-app check mods/ade`가 통과했다. 앱 status errors는 비어 있다. 검증 전용 space의 navigation.ts에서 syntax 색과 TypeScript 대입 오류 밑줄/진단1개가 표시된 상태로 두 번째 줄 끝에 공백을 입력했다. 변경 표시와 재분석 후 색상·기존 진단 유지, undo 후 원문 복원을 실제 화면에서 확인했다. 프레임 캡처만으로 250ms 대기 구간 전체의 무깜빡임을 입증하지는 않으며, 해당 구간의 배열 비우기 방지·정확한 offset 매핑·늦은 응답 거절은 위 회귀 테스트로 확인했다. 캡처: `/tmp/ade-t64-ready.png`, `/tmp/ade-t64-typed.png`.

이 배치에 포함된 retained queue 수정도 실제 우클릭→참조 요청으로 검증했다. native 메뉴가 닫힌 뒤 navigation.ts:1:14 결과 popup이 열렸고 scoped analysis는 `kind: references`, `phase: reply`, query4, status ready였다. 앞선 sleep 재개 방식은 native에서 동작하지 않아 제거했다. TextEditor와 EditorHost는 init에서 생성한 25ms timer가 대기 job만 처리하고 idle에서는 notify하지 않으며 release에서 취소한다. popup이 다른 view에서 Promise를 깨우는 경계를 통하지 않고 편집기 자신의 실행 turn에서 하위 task를 만든다.
