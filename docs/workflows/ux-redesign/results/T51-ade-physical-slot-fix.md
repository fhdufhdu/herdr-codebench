# T51 후속 · 다섯 도구 위치의 실제 native 순서

root가 실제 사용자 UI에서 “터미널 위/데이터베이스 아래” 역전을 보고했다. 구형 설치 흐름에서 database node가 terminal 뒤에 추가된 뒤, show/toggle은 hidden과 논리 slot만 바꾸고 native children 순서를 정리하지 않은 것이 원인이었다.

frame-layout의 ensureDatabaseRegion(tree,metadata)는 누락 node 추가뿐 아니라 이미 잘못 추가된 database 순서도 정리한다. 새 node는 명시한 유효 위치의 실제 parent에 추가하며, 미지정 기본은 right-top이다. toggleRegion과 selectTerminal도 slot 활성화 뒤 실제 native children를 top→bottom으로 정렬한다. 같은 slot의 직접 순서는 유효 metadata.order 또는 현재 순서를 사용한다. 중심 영역은 editor 다음 bottom 도구를 유지한다. custom node 속성이나 index로 top/bottom을 추정하지 않는다.

regionSettings는 실제 parent와 명시 metadata/REGIONS.section으로 위치를 결정한다. 정상적인 기존 parent를 show 동작이 다른 side로 옮기지 않는다. 기존 known node를 정렬할 때 unknown child의 위치는 그대로 두고 known child 자리만 교체한다. native tab/pane content, terminal 데이터, 사용자 panel/column 크기, 다른 side와 중앙 문서는 재생성하지 않는다.

양성 회귀 검증:

- legacy right children가 `[agents,unknown,terminal,database]`일 때 DB를 열면 실제 표시 순서가 `[database,terminal]`이다.
- agents를 다시 열면 `[agents,terminal]`이며 terminal node는 전후 deep-equal이다.
- unknown child는 같은 index와 데이터, 수동 column/terminal 크기를 유지한다.
- 명시 위치를 지정한 여섯 도구를 배치한 뒤 left-top/left-bottom/right-top/right-bottom/bottom의 실제 parent·표시 순서를 각각 확인했다.
- 명시 target이 있는 missing database migration과 이미 존재하는 appended database 수정, 반복 migration도 확인했다.

`node design/ade/check_frame_layout.mjs`, `node --experimental-vm-modules design/ade/check_terminal.mjs`, `node --experimental-vm-modules design/ade/check_settings.mjs`, `node design/ade/build_layout.mjs --check`, `herdr-app check mods/ade`가 통과했다. 이 작업자는 설치·main 변경·CUA를 수행하지 않았다. 실제 수정 UI의 재관찰과 installer 추가 위치 수정은 root 작업이다.
