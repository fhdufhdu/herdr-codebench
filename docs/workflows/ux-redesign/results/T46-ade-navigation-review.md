# T46 ADE 프로젝트 검색·변경 리뷰

`mods/ade/navigation.js`를 ADE 공통 관리 목록·입력·버튼·패널에서 새로 구현했다. 기존 검색·Git UI controller는 가져오거나 복사하지 않았다. root frame의 검색/변경 진입과 라우팅은 root 작업 범위다.

SearchDialog는 retained InputState, native 200ms debounce timer, 파일/내용 모드, 실제 rg 결과, MenuController/가상 목록을 사용한다. 파일 경로는 `rg --files --hidden --null -g !.git -- .`로 읽고 20,000개까지만 보관한다. 내용 검색은 `rg --json --line-number --hidden --max-filesize 1M --max-count 100 -g !.git -e query -- .`이며 최대 500개 match를 표시한다. 파일 이름의 공백·개행과 옵션처럼 생긴 검색어는 argv/NUL/JSON 경계로 보존한다. rg가 없거나 정규식/접속이 실패하면 오류와 재시도를 표시한다. 설치 runtime의 exec는 30초/출력 8MiB 한도로 제한된다. 거대한 응답이 runtime에서 실패하면 성공이나 완전한 결과로 표시하지 않는다.

검색어 변경 즉시 이전 결과를 비워 debounce 중 이전 항목을 열 수 없게 한다. generation·alive·현재 프로젝트 검사로 늦은 응답을 차단한다. Enter 또는 실제 행 클릭으로 openDocument를 호출하고 overlay를 닫는다. 입력에서 ↓는 결과 목록으로 포커스를 이동한다. 문서를 열 때 `ade.navigation[projectKey(context)] = {path,line,column:1,at}` target을 기록하며 실제 editor caret 이동 연결은 root/editor의 후속 작업이다.

ChangesView는 `git status --porcelain=v1 -z --untracked-files=all`을 파싱하여 NUL 경로·rename 원본을 보존한다. 선택된 파일의 작업 트리 diff와 cached diff를 각각 읽고 외부 diff/textconv 실행을 끈다. untracked는 설치 runtime의 1MiB 제한 readTextFile로 읽는다. 큰 diff는 표시를 제한한다. 상세 원문은 HTML escape 후 selectable native TextView로 표시한다. 목록/상세 작업은 서로 다른 generation으로 stale 응답을 차단한다. 삭제 파일 열기는 비활성이다. Git stage/discard/commit 등 변경 명령은 없다.

검증:

- `node --experimental-vm-modules design/ade/check_navigation.mjs` 통과: NUL·rename·개행 경로, 결과 상한, argv 경계, debounce/stale query·project, navigation line target, cached/unstaged diff, HTML escape.
- SearchDialog/ChangesView 각각 임시 복사 fixture의 `herdr-app check` 통과. 이 검증은 실제 native 렌더를 수행하지만 사용자 UI에서 입력/스크롤/화면 배치를 관찰한 결과는 아니다.
- `herdr-app check mods/ade`와 `python3 design/idea/sync_ui.py --check --mod ade` 통과.

이 작업자는 설치·CUA·Git mutation·기존 live terminal 입력을 수행하지 않았다. 실제 검색/리뷰 흐름과 root frame 연결 관찰은 root 검증에서 별도로 기록한다.
