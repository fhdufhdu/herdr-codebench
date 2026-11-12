# T04 공통 디자인 시스템

- U01·U05·U06. effort medium. 기존 canonical public export와 호출부를 보존하며 스타일·native button 의미를 교체한다.
- 소유 파일 design/idea/ui.js·tokens.json·check_system.mjs, themes/idea.json, mods/codenav/design-preview.js·settings.js. 생성 파일은 sync만 사용한다. 다른 구현 파일은 부모 소유다.
- `herdr.ux`에 새 dark 의미색·metrics·syntax를 두고 uiColors와 IDEA metrics는 idea 레이아웃에서 이를 사용한다. codebench는 기존 theme/fallback을 유지한다. 거대한 기존 추출 데이터 삭제·이름 일괄 변경은 하지 않는다.
- 색은 canvas #14171D, editor #181C23, surface #20252E, popup #272E39, foreground #EEF2F7, secondary #B4BFCE, disabled #7D899C, border #6B7C95, separator #394352, hover #303A49, selection #29466B, selectionInactive #343F50, selectionForeground #F2F6FC, tabSelected #283340, focus/accent #88B9FF, accentForeground #14171D, primary #386FB8, onPrimary #FFFFFF, error #FF8F9B, warning #EAC476, success #8ED6AA. primary button은 primary/onPrimary, accent는 링크·선택 표시용이다. 기존 theme의 solid/accent도 대응한다.
- normal/compact metrics는 row30/26, input32/28, tab40/36, tabFill36/32, toolHeader36/32, toolbar44/36, toolbarButton32/28, stripeWidth44/40, stripeButtonWidth40/36, stripeButtonHeight40/36, status24, breadcrumb32/28, editorTextInset12/8이다. radius는 panel4, gap2, popup8, dialog10, control5, selection4. 아이콘은 16 기본·20 탐색.
- 액션 버튼·아이콘 버튼·stripe는 가능하면 gpui-base Button.new의 native activation/focus/disabled와 accessibility_label을 사용한다. 단축키·클릭 전파·중간클릭 동작을 보존한다. focus border 공간을 상시 예약해 focus 때 크기 변화가 없게 한다. 최소 hit size24를 glyph와 분리한다.
- 활성 탭은 중립 배경과 accent 선, stripe는 subtle selection과 active line을 사용한다. 강한 파란 타일을 줄인다. 도구 제목은 한 개의 경계 있는 header로 통일하고 dialog는 제목/본문/footer를 분리한다. codebench 동작과 실제 layout tree의 panel sizes는 변경하지 않는다.
- 갤러리를 Codebench 이름으로 바꾸고 공통 icon16/20 및 focus/disabled/selected/error/busy 상태를 보여준다. settings의 Islands Dark 표기는 Codebench Dark로 교체한다. root가 caller icon adapter를 별도로 통합한다.
- check_system의 이전 IDEA 특정 숫자 기대는 새 canonical token 기준으로 갱신하되 keyboard/scroll/layout 보존 검사는 약화하지 않는다. text4.5, focus/control3 대비 회귀를 추가한다. 적용 가능한 web 지침을 native 제품 설계 기준으로 참고한 것이며 WCAG 준수 인증을 주장하지 않는다.
- 결과 results/T04-system.md. 설치와 CUA는 부모 단독 수행한다.
