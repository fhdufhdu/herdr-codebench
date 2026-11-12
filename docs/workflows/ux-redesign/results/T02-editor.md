# T02 편집기 독립 개선

2026-11-05. U03·U04의 독립 구현을 완료했다. 대상은 `mods/activity/editor.js`, `mods/activity/i18n.js`, `design/idea/check_editor_context.mjs`다.

## 변경

- idea Markdown은 새 문서를 로드할 때 edit 기본값으로 시작한다. 눈 버튼과 preview 명령은 동일한 `toggleMarkdown()`을 통해 edit↔preview를 전환한다. 같은 native EditorState·undo·dirty·저장 전 내용을 유지한다. codebench는 기존 split→preview→edit 순환을 유지한다.
- idea 눈 버튼은 현재 동작에 맞게 마크다운 미리보기·편집을 안내한다. 영문·한글 문구를 추가했다. 부모가 최종 keymap routing을 확정하기 전이므로 이 버튼의 idea tooltip은 shortcut을 추정 표시하지 않는다.
- 저장 중 undo로 dirty가 false가 되더라도 native buffer가 파일 이동으로 release되지 않게 saving도 전환 보호 조건에 넣었다.
- space 이동 시 기존 workspaceBuffers에 saving·note를 함께 보관한다. 별도 buffer 저장소는 추가하지 않았다. 성공·실패 callback은 저장 당시 EditorState를 가진 현재 또는 보관 buffer에 original·dirty·saving·note를 적용한다. 다른 space의 저장 상태나 pending navigation을 바꾸지 않는다.
- 저장이 끝나 dirty가 사라진 뒤 pending target으로 전환한다. 복원된 buffer의 요청 key가 이미 같아도 clean pending 전환을 다시 처리한다. 복원 시 해당 문서의 file watcher를 재개한다.
- 기존 close token 승인·취소, optimistic write와 추가 입력의 dirty 유지 계약을 보존했다.

## 검증

| 명령 | 결과 |
| --- | --- |
| `node --experimental-vm-modules design/idea/check_editor_context.mjs` | 통과 |
| `python3 design/idea/sync_ui.py --check` | 통과 |
| `node --experimental-vm-modules design/idea/check_system.mjs` | 통과 |
| `herdr-app check mods/activity` | 통과 |
| `git diff --check -- mods/activity/editor.js mods/activity/i18n.js design/idea/check_editor_context.mjs` | 통과 |

회귀 검사는 실제 EditorPane 메서드를 mock host에서 실행한다. idea 두 상태·codebench 세 상태, preview 전환의 buffer 정체성·dirty 보존, 새 Markdown edit, 느린 저장 중 추가 입력·undo·파일 이동 취소, 저장 중 space 이동, A 저장 완료가 B saving을 지우지 않는 경우, 원격 실패에 해당하는 write rejection의 workspace 격리, 보관 buffer 복원, 복원 중 pending 전환 재개, close 취소 token의 완료 후 비승인을 검증했다.

## 남은 통합 범위

지정 범위에 따라 기본 file routing·CodeView source 기능·legacy edit 종료 경로는 변경하지 않았다. 공개 caret·selection·reveal API도 추가하거나 추정 호출하지 않았다. 앱 설치와 실제 화면 조작은 수행하지 않았으며 부모의 일괄 설치·통합 UI 검증이 남아 있다. dirty buffer의 프로세스 종료·HMR 복구 persistence는 기존과 동일하게 메모리 범위다.
