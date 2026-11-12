# T04 공통 디자인 시스템

2026-11-05. U01·U05·U06의 공통 시스템 변경을 구현했다. 설치·실제 화면 조작은 부모의 통합 검증 범위다.

## 변경 범위

- `design/idea/tokens.json`의 `herdr.ux`에 지정된 dark 역할 색·normal/compact metrics와 syntax를 추가했다. 이전 추출 데이터와 공개 export 이름은 보존했다. 새 syntax 색은 본문 배경 대비를 고려한 구현 선택이다.
- `design/idea/ui.js`의 IDEA metrics·uiColors·uiEditorSyntax가 idea에서 새 canonical 값을 사용한다. codebench는 기존 theme/fallback·plain activation 분기를 유지한다.
- 버튼·아이콘 버튼·stripe는 idea에서 gpui-base Button.new를 사용한다. native disabled·selected 상태와 accessibility_label을 전달하고 focus border의 공간을 미리 예약한다. 아이콘 glyph 크기와 별도로 최소 24px hit area를 둔다. disabled 상태에는 activation callback을 등록하지 않는다.
- primary button은 primary/onPrimary 색을 사용한다. 선택된 탭은 중립 배경과 accent 아래 선, stripe는 subtle selection과 측면 선을 사용한다. 도구 header와 dialog 제목·본문·footer 경계를 구분했다.
- 진단 underline·overview stripe·hint도 새 error/warning/accent·popup/border 역할을 사용한다. informational severity에는 overview 경고 stripe를 만들지 않는다.
- `themes/idea.json`의 편집·terminal 기본색·ANSI·solid/accent를 새 dark 역할에 대응시켰다. `settings.js`의 테마 표기는 Codebench Dark다.
- `design-preview.js`는 Codebench component gallery 이름으로 표시하며 16px action·20px navigation 아이콘 예제를 추가했다. progress는 `uiSpinner(() => uiIcon("progress"))`의 fresh factory를 사용한다. 기존 focus/disabled/selected/error/busy·100행 메뉴 예제를 유지했다.
- 생성 파일은 `python3 design/idea/sync_ui.py`로만 갱신했다. layout tree·패널 size·API·engine 구현은 수정하지 않았다.

## native API 확인

설치된 `/Users/estsoft/.config/herdr-app/gpui-kit.d.ts`의 Button 선언 20692 부근과 공통 Element 메서드를 읽었다. Button.new는 NativeElement를 반환한다. 실제 chaining은 `.disabled(boolean)`, `.selected(boolean)`, `.accessibility_label(text)`, `.focus(callback)`이다. focus callback은 detached element에 style을 선언한다. focus_style 메서드는 사용하지 않았다. tooltip과 접근성 label을 함께 제공한다.

## 검증

| 명령 | 결과 |
| --- | --- |
| `python3 design/idea/sync_ui.py --check` | 통과 |
| `node --experimental-vm-modules design/idea/check_system.mjs` | 통과 |
| `node --experimental-vm-modules design/idea/check_diagnostic_ui.mjs` | 통과 |
| `node --experimental-vm-modules design/idea/check_settings.mjs` | 통과 |
| `node --experimental-vm-modules design/idea/check_editor_context.mjs` | 통과 |
| `herdr-app check mods/codenav` | 통과 |
| `herdr-app check mods/activity` | 통과 |
| 소유 파일 `git diff --check` | 통과 |

check_system은 새 canonical metrics의 normal/compact 전 항목을 확인한다. 기존 긴 메뉴 keyboard/disabled row/scroll, stable identity, tab reveal, layout order·active·hidden·패널 size·terminal payload 보존·migration idempotence 검사를 유지했다. shell header 높이를 바꾸는 기존 migration 항목인 left2-bar/right2-bar도 header 예외 목록에 명시했다.

추가 회귀는 native button 생성·label·disabled callback 부재·focus border color와 geometry 불변, 최소 hit24, input focus border 예약, primary 색, codebench activation primitive 보존을 확인한다. 본문·보조 텍스트와 syntax는 4.5 대비, focus/control border는 3 대비를 검사한다. primary/selected label 대비도 확인한다. 이 수치는 native 제품 설계 검증 기준이며 WCAG 준수 인증은 주장하지 않는다.

## 통합 확인 사항

검사 시점의 `check_surfaces.mjs`는 부모 작업 `tools.js`의 progress factory를 mock이 반환하지 않아 undefined.spin으로 실패했다. 부모에게 전달했으며 해당 파일은 소유 범위 밖이라 변경하지 않았다. 실제 native Tab/Enter/Space activation, focus 이동, disabled 상태, 긴 메뉴, 두 밀도 화면은 부모의 일괄 설치와 CUA 확인이 남아 있다.
