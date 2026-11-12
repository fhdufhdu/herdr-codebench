# R04 공통 아이콘 조사와 이행 경계

2026-11-05. `codex/ux-principles-redesign`의 소스 정적 조사 결과다. 사용자 요청에 따라 자체 UX 원칙을 디자인 판단 기준으로 삼는다. 기존 IntelliJ 외관 목표는 이번 설계의 기준에서 대체한다. 구현 파일 변경과 실제 앱 검증은 후속 구현 태스크가 담당한다.

## 현재 상태

- `design/idea/tokens.json`과 `ui.js`가 공통 UI의 원본이고 `sync_ui.py`는 codenav/activity의 `idea-design.js`, `idea-tokens.js`를 생성한다. 현재 아이콘 자산·매핑은 생성 대상에 포함되지 않는다. `ui.js` 자체에는 SVG 경로가 없다. graphic element 또는 factory를 호출자가 공급한다.
- `mods/codenav/icons`에 SVG 36개, `mods/activity/icons`에 50개가 있다. 각각 대부분 24×24/2px/round/currentColor지만 search는 1.5px이고 vscode는 채움형이다. 같은 역할이 여러 디렉터리에 중복된다. 현 자산을 그대로 묶으면 하나의 선 굵기를 보장하지 못한다.
- `mods/codenav/idea-icons`에는 130개 SVG가 있다. 파일 종류·심볼과 제품 조작 아이콘이 섞여 있고, 고정색을 유지하는 `image()`로 출력한다. 도구 선택은 `Selected.svg` 별도 파일이다. `toolImage()`의 기본 크기는 18이고 실사용은 12/14/15/16 등으로 분산되어 있다.
- `mods/activity/ficons/svg`에는 1,184개 SVG가 있다. 파일/폴더 종류는 Material Icon Theme 기반 매핑이다. `fileImage()`는 현재 layout이 idea이면 별도 IntelliJ 매핑으로 갈라진다. 양쪽의 동일한 파일이 다른 아이콘으로 표시될 수 있다.
- installed runtime의 `gpui-kit.d.ts` 20274행은 `svg(path)`가 주변 글자색을 상속하는 마스크라고 명시한다. `image(path)`는 원본 색을 보존한다. 경로 원점은 앱 루트다. 모드 사이 JS import는 피하고 생성된 로컬 모듈을 사용한다.

## 공개 진입점과 보존할 동작

| 파일과 진입점 | 현재 계약 | 이행 경계 |
| --- | --- | --- |
| `mods/codenav/common.js`의 `icon(name,size=16)` | `mods/codenav/icons/{name}.svg`를 svg로 생성 | 공통 registry의 별칭 해석을 통해 새 native element 생성 |
| 같은 파일의 `iconButton(id,name,tip,action,opts)` | idea는 uiIconButton 사용, codebench는 별도 wrapper, 클릭 전파 차단 | 기존 signature·tip·handler·codebench 동작을 보존하고 graphic만 교체 |
| `mods/activity/common.js`의 `icon`, `iconButton` | activity 로컬 assets, 같은 레이아웃 분기 | 동일 registry를 생성 배포하여 역할과 자산 통일 |
| 같은 파일의 `programIcon(p,size,color)` | tint이면 svg, 아니면 image, icon 부재 시 null | runtime Program 정체성과 tint 계약 보존 |
| `mods/codenav/ideaicons.js`와 `mods/activity/ficons/idea.js`의 `ideaIcon`, `ideaImage` | 파일·디렉터리 추측 → path/element | 호환 wrapper에서 공유 file-type resolver로 연결 |
| 같은 두 파일의 `symbolIcon`, `symbolImage` | LSP kind와 Kotlin 확장자로 고정색 심볼 선택, 미상은 unknown | 심볼 역할 registry와 같은 stroke family 사용, kind/경로 인자 유지 |
| 같은 두 파일의 `toolImage(name,size=18,selected=false)` | 이름과 Selected suffix로 image 경로 조립 | 별칭 표로 역할을 해석하고 svg로 생성, selected는 공통 wrapper 색 상태에 전달 |
| 같은 두 파일의 `ideaName` | 대문자로 시작하는 kt/java 파일의 확장자 일부 생략 | 이름 표시 정책으로 분리해 검토. 아이콘 교체 도중 경로·검색값을 변경하지 않음 |
| 같은 두 파일의 `IDEA_STATUS` | git 상태별 고정색 | 공통 의미 토큰으로 이전, git mark와 텍스트 정보 유지 |
| `mods/activity/ficons/index.js`의 `fileIcon`, `fileImage` | path/name/긴 확장자 순서, open folder, light variant, generic fallback | 파일 종류 resolver의 기존 우선순위와 light/open 계약 보존 |
| `design/idea/ui.js`의 `uiIconButton`, `uiStripeButton`, `uiTab`, `uiTreeRow`, `uiMenu`, `uiNoticeCard`, `uiSpinner` | graphic 소유·상태·메뉴 factory·native animation | 호출자와 공통 wrapper의 색 계약을 통일. 메뉴 factory 검증 유지 |
| `mods/codenav/actions.js`의 `ACTIONS`, `actionPresentation` | pure icon 문자열 metadata와 기존 command/owner/shortcut | semantic role 문자열로 순차 이행, 실행·키맵 코드는 보존 |
| `mods/codenav/tool-windows.js`의 `TOOLS` | icon/idea 이중 이름과 headerActions | 하나의 semantic icon role로 수렴, headerActions의 command/owner 유지 |
| `mods/codenav/toolbar-model.js`와 `settings.js`의 customization | 사용자 item.icon이 기본 occurrence를 override | 저장된 과거 이름은 명시 별칭으로 해석, unknown 값과 원본 설정 보존 |

`programIcon` 외에 `mods/codenav/agents.js`의 로컬 `icon(p,size,color)`와 `panehead.js`, `tools.js`, `newterminal.js`, `mods/activity/panelbar.js`가 Program graphic을 직접 그린다. runtime `herdr.d.ts`의 Program.icon/tint 규칙을 같은 방식으로 적용해야 한다.

## 경로를 직접 소유한 호출부

다음 경로는 현재 저장소 밖의 설치 자산을 참조한다. 자체 action glyph는 registry 자산으로 가져와 배포하여 이 의존을 끝낸다. 실제 Program.icon은 runtime 소유로 유지한다.

| 호출부 | 하드코딩 경로와 역할 |
| --- | --- |
| `mods/codenav/agents.js` | `mods/workspace-chrome/{s.icon,sort.icon}.svg`, check, chevron, pin/pin-off, spinner. 정렬·위치·핀·펼침·상태 |
| `mods/codenav/tools.js`, `design-preview.js` | `mods/codenav/idea-icons/progress.svg`. tools의 codebench branch에는 workspace-chrome spinner도 존재 |
| `mods/codenav/termfiles.js` | `mods/workspace-chrome/{it[1]}.svg`. 메뉴 factory로 전달 |
| `mods/codenav/newterminal.js` | `icons/shell.svg`, `mods/workspace-chrome/branch.svg`, 동적 agent.icon. Terminal/Worktree 조작과 agent 정체성 분리 |
| `mods/codenav/panehead.js` | `mods/pane/{iconName}.svg`, workspace-chrome spinner, 동적 program.icon |
| `mods/activity/footer.js` | `mods/workspace-chrome/{icon}.svg`. shell layout 제어 |
| `mods/activity/common.js`, `panelbar.js` | workspace-chrome spinner, program.icon |
| 두 common.js | `mods/{MOD}/icons/{name}.svg` 문자열 경로 |
| 두 idea icon 모듈 | `mods/codenav/idea-icons/{id}{Selected?}.svg` 문자열 경로. activity도 codenav 자산을 참조 |
| `mods/activity/ficons/index.js` | `mods/activity/ficons/svg/{id}.svg`. file identity 자산 |

`mods/activity/viewer.js`의 `image(this.src)`, `image(d.src)`는 사용자가 연 콘텐츠다. `mods/activity/io.js`의 이미지 입출력도 콘텐츠 처리다. 이들은 UI 아이콘 이행 범위에서 분리한다. `mods/open-vscode/vscode.svg`와 두 icons/vscode.svg는 실제 외부 제품 실행의 식별 표식으로 출처를 확인해 보존할 수 있다.

## 최소 canonical registry 제안

1. `design/idea/icons.json`에 실제 사용하는 semantic role → Lucide asset 이름을 두고 `design/idea/icons/*.svg`에 필요한 subset만 저장한다. 전체 라이브러리·프레임워크 패키지를 런타임에 넣지 않는다. upstream 버전/commit과 LICENSE를 함께 고정한다.
2. `design/idea/ui.js`에 `uiIcon(role,size=16)`를 추가한다. registry에 등록된 로컬 경로만 `svg()`에 전달하고 매 호출마다 native element를 새로 생성한다. `sync_ui.py`가 registry 데이터와 동일 subset 자산을 codenav/activity 로컬로 생성·검사한다. 생성 사본 직접 편집 금지를 기존 두 파일과 동일하게 적용한다.
3. `icon()`과 `toolImage()`는 이행 기간 공개 signature를 유지한 얇은 adapter로 둔다. 오래된 키를 한 별칭 표에서 해석한다. 사용자가 저장한 item.icon과 기존 기본 item.icon을 함께 처리한다. 저장된 설정을 자동 재작성할 필요는 없다.
4. 역할의 이름과 사용자 노출 이름은 구분한다. 역할은 `search`, `close`, `newFile`, `previousDifference`, `database`처럼 의미를 나타낸다. 실제 tooltip/label은 기존 `ACTIONS`·`TOOLS.headerActions`의 번역 가능한 label을 소유자가 공급한다. 역할 registry에 모든 문구를 중복 저장하지 않는다.

### 시각·상태 계약

- 한 action family는 Lucide의 24×24 viewBox, source stroke-width 2, round cap/join, fill none, currentColor로 통일한다. 렌더 크기는 16px를 기본으로 하고 20px는 강조된 탐색 glyph에만 사용한다. 24 좌표를 비례 축소하면 선은 각각 약 1.33/1.67 논리 px다. 크기별 수동 stroke 수정과 selected 복제 파일은 제거한다. 이는 제안값이며 1×/2× 실제 화면에서 밀도·선명도를 확인한 뒤 확정한다. Lucide 규격도 동일한 canvas와 stroke 원칙을 명시한다. [Lucide specification](https://lucide.dev/contribute/icons/specification)
- 같은 glyph가 header/menu/toolbar에서 같은 역할을 가진다. 16/20 glyph와 클릭 영역 크기는 별도다. 밀도별 현재 버튼·stripe 영역과 사용자 UI 확대를 공통 wrapper가 소유한다.
- 기본 foreground, 보조 secondary, 비활성 disabled, 선택 selectionForeground/accentForeground, 오류 error 등 기존 `uiColors()` 의미색을 사용한다. 기본 glyph 내부에 text_color를 박으면 부모 상태색이 전파되지 않으므로 graphic은 상속하고 wrapper가 상태색을 결정한다. 현재 uiStripeButton은 부모 선택색을, uiIconButton은 disabled색을 이미 제공한다.
- disabled는 공통 button handler 차단과 함께 적용한다. active는 선택 배경/표시를 함께 사용한다. 의미 있는 오류/경고/성공은 shape와 설명을 함께 제공한다. loading은 실제 busy일 때 동일 loader glyph에 native spin을 적용한다. JS 재렌더 타이머를 추가하지 않는다.
- icon-only control은 실제 action label과 shortcut을 tooltip으로 제공하고 기존 키보드 command에 연결한다. 화면에 label이 있는 메뉴/행은 그 label을 사용한다. native 접근성 이름 노출은 설치 runtime API의 지원 범위를 별도 검증한다. DOM용 aria 속성을 추정해 적용하지 않는다. Lucide 문서 역시 기능적 glyph에 문구와 키보드 접근을 요구한다. [Lucide accessibility](https://lucide.dev/how-to/accessibility)

### 현재 역할의 매핑 예

| semantic role | Lucide glyph 후보 | 기존 키 또는 현재 혼동 |
| --- | --- | --- |
| search, settings, close, add, refresh | search, settings, x, plus, refresh-cw | search/find, config/settings, close/x, add/plus, refresh |
| previousTab, nextTab | chevron-left, chevron-right | 현재 tab-prev와 tab-next가 모두 chevronRight |
| previousDifference, nextDifference | arrow-up, arrow-down | 현재 review-prev-diff는 chevronRight |
| back, forward, goTo | arrow-left, arrow-right, crosshair | 현재 서로 다른 동작이 locate로 합쳐짐 |
| newFile, newFolder, copy, delete | file-plus, folder-plus, copy, trash-2 | 기존 hyphen 이름과 IDEA 명칭 |
| preview, edit, save | eye, pencil, save | Markdown preview/markdown, Save/anyType 등의 표시 역할 분리 |
| run, rerun, stop | play, rotate-cw, square | run/runAction/rerunAction/stopAction |
| explorer, structure, terminal, agents | files, list-tree, terminal, bot | project/layers/module/services/terminal 혼용 |
| problems, notifications, database | triangle-alert, bell, database | problems/alert, notifications/message, database |
| expand, collapse, overflow, openExternal | chevron-right/down, list-collapse, ellipsis-vertical, external-link | case와 alias 정규화, 확장 상태는 호출자가 소유 |

후보의 upstream 실제 파일명은 subset 취합 시 존재 검사를 통과해야 한다. glyph 후보와 기존 legacy key의 전체 매핑은 저장된 customization과 모든 ACTIONS/TOOLS/headerActions 값을 포함해야 한다. `TOOLS.database.icon`은 database지만 현재 `mods/codenav/icons/database.svg`가 없어 문자열 조합을 검증하는 정적 검사가 특히 필요하다.

## 파일·심볼·제품 identity 경계

파일 종류는 확장자/언어 정보를 보조하는 의미가 있으므로 별도 `fileIcon/fileImage` resolver로 유지할 가치가 있다. 기존 Material 기반 자산은 라이선스 파일을 동반하며 light/open/name/longest-extension 매칭을 재사용할 수 있다. 두 레이아웃에서 동일한 파일 종류 resolver를 쓰면 동일 파일의 인식을 유지할 수 있다. 폴더의 수많은 이름별 컬러 장식은 실제 기능 구별에 필요한지 후속 구현에서 좁힌다.

Kotlin/Java 파일명이 대문자라는 이유로 class라고 추정하는 현재 코드는 파일 종류와 실제 심볼을 혼합한다. 새 resolver는 확장자 기반 file identity와 LSP kind 기반 symbol role을 분리한다. 심볼은 같은 stroke family의 kind별 glyph로 정리하고 unknown kind에는 일반 symbol을 사용한다. 이 변경은 클래스 검색 필터나 실파일 이름/경로를 바꾸지 않아야 한다.

Program.icon과 외부 제품 로고는 runtime 제공 정체성으로 보존한다. tint 플래그와 사용자의 programs.json override를 따른다. Lucide 공식 정책도 브랜드 로고를 일반 아이콘 모음에서 제외한다. [Lucide brand policy](https://lucide.dev/brand-logo-statement)

## fallback과 오류 처리

- known legacy name은 한 별칭 표로 해석한다. unknown custom icon은 generic action glyph로 표시하고 원본 문자열/label/command를 보존한다. unknown key를 임의 파일 경로로 연결하지 않는다.
- unknown file extension은 generic file, unknown directory는 folder, unknown LSP kind는 generic symbol을 쓴다. 파일명 label과 실제 경로는 계속 표시한다.
- 아이콘 부재 때문에 action·menu row·tab 자체가 사라지지 않게 한다. Program.icon 부재 시 해당 문맥의 기존 terminal/agent fallback 또는 명시적인 공간 생략 동작을 유지한다. native image 로더의 실패 이벤트 API는 조사 범위에서 확인되지 않았으므로 임의 런타임 catch에 의존하지 않는다.
- 생성 시 모든 등록 경로·alias target·자산을 검사하고 누락은 빌드 검사 실패로 처리한다. shipping fallback glyph도 반드시 실제 자산이어야 한다. 사용자 정의 외부 Program.icon은 runtime 계약을 따른다.

## 구현 적용 목록과 검증

공통 아이콘 호출이 있는 codenav 파일은 `common.js`, `ideaicons.js`, `tools.js`, `diagnostics.js`, `notice.js`, `review.js`, `agents.js`, `code.js`, `run.js`, `tabs.js`, `termfiles.js`, `everywhere.js`, `newterminal.js`, `design-preview.js`, `comments.js`, `database-editor.js`, `panehead.js`, `recent.js`, `settings.js`, `http.js`다. metadata-only인 `actions.js`, `tool-windows.js`, customization을 다루는 `toolbar-model.js`도 검사한다. activity는 `common.js`, `ficons/{idea,index}.js`, `titlebar.js`, `agents.js`, `fileops.js`, `spaces.js`, `git.js`, `files.js`, `editor.js`, `panelbar.js`, `search.js`, `bar.js`, `footer.js`, 콘텐츠 glyph를 가진 `viewer.js`다.

1. 원본 registry/ui/tokens와 sync를 함께 수정하고 기본 두 모드의 로컬 생성 파일·자산을 한 번에 배포한다. 파일 resolver와 레거시 adapter를 먼저 연결하면 caller의 단번 이행 부담을 줄일 수 있다.
2. 모든 action/header/menu에 이름·실행 command·disabled·active 상태가 유지되는지 확인한다. 선택 glyph는 부모색을 상속하고 factory가 fresh element를 생성해야 한다. `MenuController`와 overlay bounds는 유지한다.
3. 갤러리에 16/20, light/dark, normal/hover/active/disabled/error/loading, unknown alias/file/kind, long label 상태를 추가한다. 100행 메뉴 End/Home/PageUp/PageDown·Enter/Escape와 disabled skip을 점검한다.
4. `python3 design/idea/sync_ui.py --check`, `node --experimental-vm-modules design/idea/check_system.mjs`, 변경 모드의 `herdr-app check`를 실행한다. 설치 후 idea/codebench 실제 화면에서 toolbar, stripe, Project, tabs, search, review, DB, terminal/agent 상태를 확인한다.

이 결과는 정적 감사와 공식 문서 확인이다. runtime 렌더·키보드·색 대비·Retina 선명도 검증 결과는 포함하지 않는다. Lucide subset 채택과 16/20 크기는 조사자의 설계 제안이다. 라이선스는 Lucide ISC와 Feather 유래 glyph의 MIT 고지 모두를 subset 배포에 동반하는 방식으로 처리한다. 기존 JetBrains Apache-2.0와 Material MIT/Herdr file icons Apache-2.0 고지는 남아 있는 해당 자산과 함께 보존한다. [Lucide license](https://lucide.dev/license), [upstream LICENSE](https://raw.githubusercontent.com/lucide-icons/lucide/main/LICENSE)
