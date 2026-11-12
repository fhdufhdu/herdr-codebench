# T06 Markdown 모드 선택 결과

2026-11-05. source viewer 유지 결정에 맞춰 Markdown의 text mode 선택을 구현했다.

## 최종 UI 명세

| 위치 | 영문 label | 한글 label | 기본 선택 |
| --- | --- | --- | --- |
| Markdown source viewer 상단 | Source · Preview | 원문 · 미리보기 | 원문 |
| Markdown native editor 상단 | Edit · Preview | 편집 · 미리보기 | 편집 |

두 목적지를 항상 함께 표시한다. 선택한 항목은 selection 배경·accent 1px outline·selectionForeground 텍스트와 native Button.selected(true)로 표시한다. 나머지는 secondary 텍스트와 투명 배경을 사용한다. 선택기 바깥은 editor 배경·separator 경계·padding1·gap2다. 버튼의 최소 높이·폭은 24px이고 label 좌우 padding은 8px다. normal/compact input metric과 uiSize를 따라 높이를 늘린다. focus는 미리 예약한 border의 색만 바꿔 치수 변화가 없다.

기본 native Button activation·접근성 label을 사용한다. 현재 선택을 누르면 onChange가 호출되지 않는다. 두 선택은 Tab으로 focus하고 Enter·Space로 실행하는 native 버튼이다. 별도 tablist/ARIA tab role이나 Arrow 키 handler는 추가하지 않았다.

source viewer에서는 이 선택기를 기존 연필 Edit action 바로 왼쪽에 둔다. Source/Preview 선택은 기존 richView 상태만 바꾸며 반복 Preview activation도 같은 결과를 유지한다. native editor는 같은 EditorState를 계속 사용하면서 mdMode만 바꾼다. preview는 기존 code.value()를 읽어 저장 전 내용을 표시한다. 기존 source rich-view command와 native preview command 및 shortcut routing을 보존했다. codebench는 기존 눈 버튼과 native edit→split→preview 순환을 유지한다.

## 구현

- canonical `design/idea/ui.js`에 `uiModeSwitch(id, items, current, onChange)`를 추가하고 두 mod의 생성 모듈로 배포했다.
- `mods/codenav/code.js`, `mods/activity/editor.js`는 idea Markdown에서 공통 선택기를 사용한다. 일반 파일에는 모드 선택기를 표시하지 않는다.
- 두 mod에 Source·Edit·Preview의 필요한 한글 번역을 추가했다.
- `mods/codenav/design-preview.js`에 source viewer와 native editor 모드 그룹 예제를 추가했다.
- `check_system.mjs`는 native Button 생성·selected·접근성 label·최소 hit·focus geometry·선택 outline/fill·현재 선택 no-op·event 전달·허위 tab role 부재·실제 한글 번역을 확인한다.
- `check_editor_context.mjs`는 두 owning view의 label·현재 선택·전환·source preview command와 별도 연필 위치·codebench icon/3상태를 확인한다. 기존 native buffer·undo 보존 계약·dirty·save/close/space 회귀는 유지했다.

## 검증

| 명령 | 결과 |
| --- | --- |
| `python3 design/idea/sync_ui.py --check` | 통과 |
| `node --experimental-vm-modules design/idea/check_system.mjs` | 통과 |
| `node --experimental-vm-modules design/idea/check_editor_context.mjs` | 통과 |
| `node --experimental-vm-modules design/idea/check_keymap.mjs` | 통과 |
| `node --experimental-vm-modules design/idea/check_shortcuts.mjs` | 통과 |
| `node --experimental-vm-modules design/idea/check_surfaces.mjs` | 통과 |
| `herdr-app check mods/codenav` | 통과 |
| `herdr-app check mods/activity` | 통과 |
| 변경 소유 파일 `git diff --check` | 통과 |

설치와 실제 native focus·Tab·Enter·Space·두 밀도 레이아웃의 화면 확인은 부모의 통합 검증이 남아 있다. 이 결과의 keyboard 근거는 native Button 공개 API와 계약 검사이며 실제 UI 조작 결과는 아니다.

## 판단 근거

항상 보이는 목적지 label로 아이콘 해석과 hover 탐색의 부담을 줄이는 방향을 적용했다. 이 선택은 NN/g의 icon label 지침을 native 문서 모드 선택에 적용한 설계 판단이다. [Icon Usability](https://www.nngroup.com/articles/icon-usability/)

짧고 평행한 두 label과 현재 선택 표시를 사용한다. Fluent 2의 label·선택 지침을 참고했으며 native Button 그룹의 구체적인 outline·간격·크기는 이 제품의 구현 선택이다. [Fluent 2 Tablist usage](https://fluent2.microsoft.design/components/web/react/core/tablist/usage)
