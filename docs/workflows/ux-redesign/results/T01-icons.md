# T01 공통 아이콘 구현 결과

2026-11-05. canonical registry와 모드별 로컬 생성 모듈을 연결했다.

## 변경

- `design/idea/icons.json`에 77개 canonical glyph와 legacy alias를 정의했다. 24×24, stroke2, round cap/join, currentColor인 unmodified Lucide subset을 `design/idea/icons/`에 저장했다. upstream commit은 `91a1359b5ea235f620ba3a9682015ab8d6ada3af`다. upstream 전체 LICENSE를 동반하여 ISC와 Feather 유래 MIT 고지를 보존했다.
- `sync_ui.py`가 `mods/{codenav,activity}/ui-icons.js`, `ui-icons/*.svg`, LICENSE, UPSTREAM.md를 생성한다. `--check`는 기존 UI/tokens drift에 더해 icon asset/alias target/경로 안전성/stroke 속성/불필요해진 generated SVG를 검사한다. 원본 자산이 누락되거나 alias가 존재하지 않는 role을 가리키면 실패한다.
- `uiIcon(role,size=16)`은 매 호출마다 `svg(path).size(size).flex_none()`을 생성한다. `uiIconPath(role)`도 제공한다. 알 수 없는 이름·prototype property·비문자열은 실제 `action` fallback 자산으로 연결한다. `constructor`는 LSP symbol의 유효한 legacy alias다. 새 API 메서드를 가정하지 않는다. 20px를 명시할 수 있고 기존 호출자의 크기 인자는 호환 유지한다.
- 두 `ideaicons.js`/`ficons/idea.js`의 symbol/tool 진입점을 shared stroke registry로 연결했다. `toolImage(name,size,selected)`의 선택색은 owning wrapper가 제공한다. 기존 파일 종류 자산과 resolver는 보존한다.
- 허용된 `codenav/{agents,termfiles,newterminal,panehead}.js`, `activity/{footer,panelbar}.js`의 workspace-chrome/pane 고정 action 경로를 uiIcon으로 바꿨다. terminal split-right/split-down과 zoom glyph의 방향/의미도 구분했다. Program.icon/tint와 외부 제품 identity는 기존 처리대로 연결한다.

## 부모 통합

1. 두 common.js에서 `import { uiIcon } from "./ui-icons.js"`를 추가하고 `icon(name,size=16)`을 uiIcon adapter로 연결한다. `name === "vscode"`는 기존 모드 로컬 `icons/vscode.svg`와 svg()를 유지해야 외부 제품 identity가 보존된다. generic legacy stem은 이 brand 하나를 제외하고 모두 매핑했다.
2. tools.js/design-preview.js의 spinner factory를 `() => uiIcon("progress")`로 바꾼다. canonical ui.js는 ui-icons.js를 import할 필요가 없다. 부모가 uiIcon을 공개 re-export할 경우 mock linker에 모듈/`gpui-kit.svg` 지원이 필요하다.
3. actions.js의 양방향 동작은 `previousTab`/`nextTab`, `previousDifference`/`nextDifference`, `back`/`forward` 역할을 쓸 수 있다. Save에는 `save`, Markdown preview에는 `preview`, 새 파일에는 `newFile`, 새 폴더에는 `newFolder`를 제공한다. TOOLS는 기존 aliases를 유지해도 해석되며 `explorer`/`agents`도 지원한다.
4. 공통 wrapper에서 foreground/secondary/disabled/selected 상태색을 제공한다. uiIcon은 내부 색을 고정하지 않는다. tooltip/label과 실제 handler·키맵 소유권은 기존 ACTIONS/TOOLS/호출부에 둔다. 메뉴의 `icon: () => uiIcon(...)` factory 계약을 유지한다.
5. `sync_ui.py`가 생성하는 기존 idea-design.js와 idea-tokens.js는 부모의 canonical ui/tokens 변경 이후 다시 생성해야 한다.

## 검증

| 명령 또는 검사 | 결과 |
| --- | --- |
| `python3 -m py_compile design/idea/sync_ui.py` | 통과 |
| `python3 design/idea/sync_ui.py` | 두 모드의 module/assets 생성 |
| `python3 design/idea/sync_ui.py --check` | 통과 |
| `node --experimental-vm-modules design/idea/check_system.mjs` | 통과 |
| `herdr-app check mods/codenav` | 통과 |
| `herdr-app check mods/activity` | 통과 |
| 임시 Node VM 회귀 검사 | 양쪽 모듈의 185 role/alias 자산 존재, known alias, unknown/prototype/비문자열 fallback, fresh native element, 16/20 크기 통과 |
| 같은 VM에서 현재 ACTIONS와 TOOLS/headerActions의 모든 icon 이름 검사 | 통과 |
| 임시 원본 복사본에 broken alias와 missing SVG를 각각 주입 | 생성기의 오류 거부 확인 |

VM 회귀 검사는 `/tmp/herdr-ux-check-icons.mjs`에서 실행했다. 생성기는 누락 자산을 검증하므로 추정한 native image 실패 콜백에 의존하지 않는다. 실제 설치·HMR·CUA는 수행하지 않았다. 부모 통합 후 실제 앱에서 16/20 glyph의 선명도, 선택/비활성 currentColor 전파, 메뉴 factory, tool stripe, 확대 글자, idea/codebench와 Program identity를 검증해야 한다.

Lucide subset 채택, unknown role의 circle-question-mark fallback과 역할별 glyph 선택은 확정된 아키텍처를 바탕으로 구현자가 고른 세부값이다. upstream 현재 명칭이 `triangle-exclamation-point`, `circle-question-mark`, `trash`인 자산은 registry에서 기존 `triangle-alert`, `circle-help`, `trash-2` 역할로 호환한다.
