# T34 도구 영역 크기 조절 복구

2026-11-06. 실제 도구 경계에서 크기 조절이 되지 않는 사용자 보고를 처리했다.

## 원인과 변경

native 런타임 separator의 layout 폭은 gap+divider.width다. 기존 island shell은 gap0·divider 미지정이어서 native 6px handle이 옆 tree/editor/terminal 입력 표면과 겹쳤다. 실제 split인 `idea-upper`(좌·중앙·우), `idea-content`(상단·하단), `sidebar`와 `tool-right`(각 상하)에 canonical `splitterWidth:6`을 예약하고 resizable을 활성화했다. 별도 JS drag 처리나 앱 소스 수정은 추가하지 않았다.

토큰은 `tokens.json`과 `ui.js`, 조립은 `islands.js`가 소유한다. 두 모드의 공통 생성 파일은 sync로 배포했다. 사용자 custom divider의 더 넓은 폭·색·추가 필드는 보존한다. root/body·stripe/status에는 gutter를 추가하지 않는다. 기존 min/max·크기·순서·active/hidden·terminal payload와 codebench는 유지한다.

## 검증과 설치

- `check_system.mjs`: 네 split rail·resizable, 사용자 divider 보존, 상태 보존·idempotence 회귀 통과.
- `check_workspace.mjs`: 상하·하단 이동, 빈 slot 접기/다시 열기, 크기·active·terminal identity와 codebench 격리 통과.
- canonical sync `--check`, codenav/activity native check, `git diff --check` 통과.
- 저장소/기존 설치 layout에 같은 migration을 적용했고 배치 install 후 `herdr-app status` errors는 비어 있었다. 앱/터미널 재시작은 하지 않았다.
- 실제 Herdr에서 CUA로 왼쪽 너비 확대, 왼쪽 상하 경계 이동, 오른쪽 너비 확대, 하단 실행 결과 경계 이동을 수행했다. 각 screenshot에서 인접 표면의 폭/높이가 즉시 변하는 것을 관찰했다.
- 실제 native click state에서도 sidebar399px와 변경된 상하/하단 weights를 읽어 저장을 확인했다. 테스트 뒤 official `layout.resize`/`layout.hide` 명령으로 기존335px·812px·상하 비율과 숨김 상태를 복원하고 실제 화면을 확인했다. `.state`는 직접 편집하지 않았다.
- 현재 오른쪽 아래 slot은 비어 있고 자동으로 접히므로 그 경계의 실제 drag는 별도 확인하지 않았다. 같은 native column 계약의 구조/회귀 검사는 통과했다.

사용자의 작업 파일·터미널 입력·실제 DB 데이터는 변경하지 않았다. 개인 화면 내용은 저장소 증거 이미지로 복사하지 않았다.
