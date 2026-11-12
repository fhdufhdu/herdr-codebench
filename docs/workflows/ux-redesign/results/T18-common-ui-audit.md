# T18 공통 UI와 프로젝트 선택기: 승인 데모 대비 설치본 감사

2026-11-06. 구현 전 읽기 전용 조사다. 기준은 `design/ux-redesign-demo.html`과 현재 설치된 `/Users/estsoft/.config/herdr-app/mods/codenav/`다. 이 문서 외 파일은 수정하지 않았다. 실제 앱 조작과 화면 검증은 부모가 수행한다. 아래의 시각 차이는 코드로 확인 가능한 구성·값 차이이며, 미관의 전체 일치나 픽셀 측정 완료를 뜻하지 않는다.

## 결론과 원인

프로젝트 선택기의 이중 테두리는 색상 토큰 배포 실패가 아니라 **외곽을 소유하는 컴포넌트를 중첩한 구조**에서 발생한다. 설치 `tools.js:559`가 `uiMenu`를 만들고 `:561`의 `popupSurface` 안에 넣는다. 설치 `idea-design.js:374`의 `uiMenu`도 `popupSurface`를 호출한다. 각 surface는 `:143–147`에서 밝은 border 1px, popup 배경, radius, clipping을 함께 소유한다. 결과적으로 제목을 포함한 외곽과 목록만 감싼 내부 프레임이 모두 생긴다. 데모 `:2452` 프로젝트 dialog는 단일 surface/line 외곽과 별도 제목 구분선만 있다.

색상 기본값은 이미 맞는다. canonical `tokens.json:2793`의 herdr.ux.colors와 설치 idea-tokens.js는 같으며 데모 `:8–24`와 대응한다. surface `#20252E`, popup `#272E39`, border `#6B7C95`, separator/line `#394352`, selection `#29466B`다. 문제는 **어느 역할에 어느 색을 적용하는가**다. 현재 picker는 popup 배경과 밝은 border를 두 번 쓰지만 데모 dialog는 surface 배경과 어두운 line을 쓴다. 전체 팔레트를 어둡게 바꾸면 이미 일치한 다른 영역도 바뀐다.

현재 설정은 설치 shared.json의 `layout:idea`, UI13, `.AppleSystemUIFont`, `compact:false`다. 이 기준에서 native 일반 목록 행은30px, toolbar44px다. 데모 프로젝트 picker 행36px, 관리 목록 행34px·toolbar 최소38px와 다르다. compact 값만 비교하여 현재 screenshot의 원인으로 삼으면 잘못된 판단이다.

## 배포본과 원본의 관계

- 설치 `idea-design.js`는 canonical `design/idea/ui.js`와 생성 헤더 1줄만 다르다. 아래 canonical UI 행 번호는 설치본보다1 작다. 생성물 누락이 주원인은 아니다.
- 설치 idea-tokens.js와 저장소 생성 tokens는 동일하다. 설치 tools.js와 저장소 tools.js도 조사 시점에 동일하다.
- 설치 settings.js/database.js와 저장소 source는 다르다. 진행 중인 저장소 수정은 실제 설치 화면에 반영된 것으로 가정하지 않았다. 그 두 화면에 대한 이하 적용 여부는 설치본 기준이다.

## 화면별 차이와 수정 대상

| 우선순위 | 영역 | 데모와 다른 현재 설치 구성 | 원인·수정 대상 | 위험과 보존 조건 |
| --- | --- | --- | --- | --- |
| P0 | 프로젝트 picker 외곽 | 외곽 popupSurface 안에 프레임 포함 uiMenu. 둘 모두480px 폭이고 outer border의 content 폭을 제외하지 않아 내부 경계 clipping 가능성도 있다. | `mods/codenav/tools.js:559–569`, canonical `ui.js:142`, `:365`. surface 소유를 한 곳으로 모으고 목록 본문을 재사용할 수 있게 공통 조립 경계를 정한다. | uiMenu의 모든 호출에서 프레임을 일괄 제거하면 독립 context menu가 깨진다. 선택·focus·disabled·virtual scroll은 MenuController 그대로 보존. |
| P0 | picker 배경·윤곽 톤 | native popup `#272E39`/border `#6B7C95`, 데모 surface `#20252E`/line `#394352`. | canonical `ui.js:142–146`, demo `:626–644`, `:2452`. dialog/menu/embedded body 역할의 surface 규칙을 결정한다. | 토큰 hex 자체가 일치하므로 전역 색상 변경 대신 역할 매핑을 확인해야 한다. codebench는 기존 분기 보존. |
| P1 | picker 제목과 정렬 trigger | native toolbar44px, 제목13px, 닫기 버튼 없음. 데모 제목15px/semibold,14×20px padding·하단 line, 정렬26px/12px secondary·닫기 icon. native trigger는24px/기본 UI13/foreground. | `tools.js:459–479`, `:568`; canonical `uiToolbar` `ui.js:251`; demo `:640`, `:721–754`, `:2453`. 공통 dialog/header와 compact select 역할을 맞춘다. | Select의 native focus/open state 및 Escape 복귀를 유지. 기능 없는 장식 select로 바꾸지 않는다. |
| P1 | picker 행 위계·밀도 | native30px 행,18px 다색 이니셜 avatar, 오른쪽11px 폴더/remote machine 경로, 선택 배경 있음. 데모36px의 이름 중심 행으로 avatar/경로를 넣지 않는다. | `tools.js:135–140`, `:555–557`; canonical `ui.js:195`, `:379–383`; demo `:1108`, `:3750–3766`. 이름·보조정보의 간격/톤/폭과 아이콘 역할을 먼저 맞춘다. | 경로와 machine은 동명 프로젝트 구분에 필요한 실데이터다. 데모에 없다는 이유로 삭제하지 않는다. 이니셜 badge도 식별 역할 검토 후 공통 row 위계에 맞추며, 검증 없이 전 화면에서 없애지 않는다. |
| P1 | 프로젝트 순서 관리 | native popupSurface 모양, caption 제목·닫기 없음,480×440. 데모 dialog 제목/닫기·footer 구분선,460px 폭,editor 배경의 목록. native 행 avatar, 데모 folder icon. | `tools.js:527–544`; demo `:1283–1289`, `:2487–2508`, `:3773–3784`. 관리 dialog shell과 목록 surface를 일관되게 조립한다. | draft·machine 경계·검색중 이동 비활성·선택 유지·Cancel/Apply를 보존. 크기를 줄여 목록/하단 버튼 clipping을 만들지 않는다. |
| P1 | 공통 관리 목록 | native toolbar44px, gap4, border-bottom 없음. 검색은 outer6px/4px,caption8px/4px, 목록 본문 inset 없음. 데모 toolbar38px·gap2·line, 검색 margin8px10px,caption10px14px, 목록 padding4px6px8px. native 행30px/detail11px max150, 데모 행34px/detail10px max92. | canonical `ui.js:396–453`, `:251`, `:205`; demo `:1168–1262`. 단일 관리 목록 예제에서 표준 간격·행·보조정보 역할을 정하고 재사용한다. | 전역 rowHeight를34/36으로 바꾸면 file tree/context menu까지 바뀐다. 관리 목록과 picker의 역할별 치수를 검토한다. 긴 명령/경로 detail의 폭은 실제 콘텐츠로 검증. |
| P1 | 연결/실행/설정 dialog 공통 틀 | native uiSettingsShell 제목28px secondary,content padding16×12,footer46px. 데모 큰 title15px semibold·14×20px,body20px,footer12×20px. 연결 native900×680/sidebar210, 데모840px/master250·editor 배경. | canonical `ui.js:462–471`; 설치 `database.js:432`, `settings.js:682`; demo `:629–668`, `:1125–1140`, `:1289`. 제목·본문·master/detail 경계의 공통 shell 계약을 정한다. | 상세 field와 profile/credential·저장/취소 수명은 화면 소유자 영역. demo 고정 높이를 그대로 복제하면 실제 긴 form을 자를 수 있다. |
| P1 | 공통 기본 버튼 | native 기본 버튼 모두 surface 채움+밝은 border1px, normal32px/좌우12px. 데모 기본은 transparent background/border, 최소28px/좌우8px이고 outline class만 line 테두리. primary 색은 일치. | canonical `ui.js:148–155`; demo `:42–98`. 기본/outline/primary 역할을 구분하고 실제 caller를 해당 역할에 연결한다. | 기본값 하나를 바꾸면 모든 dialog footer와 선택 trigger가 동시에 변한다. codebench와 disabled/keyboard activation/접근성 이름 보존. |
| P1 | 공통 입력 | native 바깥 uiInputBox가 항상2px border+surface 배경. 데모 일반 field1px border+editor 배경, 검색은line. native search callers는 focused 옵션을 공급하지 않아 wrapper 강조도 일반 field와 다름. | canonical `ui.js:188–194`; 설치 `database.js:392/408`, `run.js:258/271`; demo `:680–688`, `:1200–1207`. 필드/검색의 배경·윤곽과 focus 표시 소유를 정리한다. | native InputState 상태와 입력 focus·caret·비밀번호 masking은 유지. browser input API를 native element에 옮기지 않는다. |
| P2 | 탭 | native normal outer40/fill36px·좌우8px·모서리4px, inactive도foreground. 데모 strip40px/fill34px·좌우12px·위쪽만radius, inactive secondary·active text. native active underline는accent라 색은 일치. | canonical `ui.js:258–271`; 설치 `tabs.js:282–291`; demo `:327–350`. 탭 텍스트 톤·fill·padding을 공통화한 뒤 비교한다. | dirty/pin/review count는 실제 기능정보이므로 삭제하지 않는다. close/middle/context와 TabViewport scroll 유지. |
| P2 | tool header | native normal36px은 데모36px과 맞지만 padding8px·13px foreground; 데모 padding10px·12px/semibold/secondary. compact native32px은 별도 상태. | canonical `ui.js:252–257`; demo `:246–258`. 제목과 action의 위계·padding을 공통 header에서 맞춘다. | 툴 제목/액션을 body에 다시 추가하면 이중 header가 된다. TOOLS.headerActions의 실제 owning-view dispatch 유지. |

## 아이콘 계열 판정

모든 아이콘이 이전 IntelliJ 그림으로 남아 있는 것은 아니다. 설치 `common.js:15–17`의 일반 icon은 uiIcon으로 연결되고 `ideaicons.js:55–58`의 toolImage/symbolImage도 canonical stroke registry를 쓴다. demo inline SVG 역시 같은 Lucide 계열이므로 기능 아이콘을 전면 교체할 근거가 없다.

프로젝트 행의 다색 이니셜은 별도 `avatar()` 구현이다(`tools.js:135–140`). picker와 순서 관리자에서 이를 직접 호출해 데모의 단순 이름/folder row와 눈에 띄게 다르다. appbar 프로젝트 표식은 같은 avatar helper를 공유할 수 있으므로 helper 삭제는 appbar까지 바꾼다. 수정 단위는 caller의 row 표현이다.

파일 종류 아이콘은 `ideaicons.js:29–53`의 실제 확장자별 파일 식별 그림을 유지한다. 데모가 단순 파일 몇 개만 보여준다고 그 차이를 일괄 제거하면 코드 탐색 기능이 약해진다. 액션 glyph16px, 보조 glyph14/15px, 현재 프로젝트 avatar18px처럼 역할 크기가 섞인 지점을 먼저 목록화하고 이름/보조정보 위계와 함께 맞춘다. 설치 갤러리도 `design-preview.js:80/140–158`처럼 stroke와 파일/샘플 graphics를 함께 사용하므로 한 화면만 바꾸고 공통 상태가 일치했다고 판정하지 않는다.

## 권장 변경 순서와 확인 기준

1. 프로젝트 picker의 single surface 소유·색 역할·제목·목록 geometry를 먼저 확정한다. 이중 프레임은 별도 문제이므로 색/아이콘 변경으로 가리지 않는다.
2. 공통 popup/menu와 dialog/body 조립 경계를 확정한다. 독립 context menu(설치 newterminal.js:71, run.js:195, tabs.js:337, database.js:195 등)는 외곽을 계속 소유해야 한다. Select dropdown과 embedded list도 분리하여 검사한다.
3. uiButton/uiInputBox/uiManagedList/uiSettingsShell의 역할·간격을 갤러리와 함께 조정한 뒤 Projects/DB/Run/Settings caller를 이행한다. 공유 값과 구현은 canonical 원본에만 둔다.
4. tabs/header 위계를 맞추고 같은 UI13/normal에서 데모와 실제 화면을 비교한다. compact·확대 글꼴·긴 경로·동명/remote 프로젝트·긴 메뉴 End/Home/Page 이동·전체 disabled·빈 목록도 별도 확인한다.
5. codebench의 기존 크기/색/동작 분기와 panel 순서·크기·active state·terminal data를 보존한다. 수정 뒤 canonical sync/check, relevant repository checks, herdr-app check, 실제 UI 확인을 수행해야 한다.

이번 감사에서 추가 구현이나 설치, 원격 호출, 데이터 변경, CUA 조작은 수행하지 않았다. native와 HTML의 shadow/backdrop 및 OS font rasterization 차이는 surface 소스만으로 실제 최종 표현을 단정할 수 없어 부모의 화면 확인 대상으로 남긴다.
