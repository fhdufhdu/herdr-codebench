# T35 Database manager implementation

2026-11-06. 담당 범위 구현 완료. 실제 설치와 native 화면 관찰은 root 담당이며 아래 검사 결과와 구분한다.

`mods/codenav/database.js`의 idea 연결 관리를 승인 데모의 master/detail 구조로 정리했다. 840px 창, 250px 공통 managed list, 검색·추가·삭제·복제·편집 focus·상하 이동, 현재 연결 이름 상세 heading, Name 다음 compact driver selector와 TLS selector를 사용한다. 창 제목은 Connection Manager이며 목록 caption은 실제 전역 연결 수다. 실제 network/password/database/TLS 및 SQLite path 필드는 그대로 제공한다.

프로필 전환은 프로필별 native InputState bundle을 메모리에 보관한다. 입력한 비밀번호도 native masked input에만 남고 shared state·디스크·다른 프로필·복제본에 옮기지 않는다. driver/TLS, 이름 등 입력값, 명시적 비밀번호 제거 draft를 함께 복원한다. Save Profile은 현재 프로필 하나만 기존 db_save/Keychain API로 저장한다. Close는 미저장 draft를 버리며 이미 저장한 변경은 유지한다. 두 의미를 본문에 명시했다. 저장/교체/삭제된 draft의 native input을 해제하고, 종료 때 모든 소유 password input을 비운 뒤 해제한다. 지연 응답·저장 중 새 입력·실패·삭제 재확인 계약은 유지했다.

탐색 body에 선택 객체의 source/database/schema를 전달하는 SQL Console 행동을 추가했다. backend catalog는 그대로 lazy load하고, 불러온 table/view 객체만 Tables/Views 가상 그룹과 loaded 개수로 표현한다. Tables는 최초 기본 펼침, Views는 접힘이다. 표시 그룹을 DDL 요청에 보내지 않는다. 일반 테이블 이름 클릭은 중앙 data tab을 열고, wrapper pointer의 local x와 depth로 구분한 화살표 영역은 column 펼침만 수행한다. modifier 클릭은 다중선택을 유지하며 data를 열지 않는다. Enter/Cmd+Down·방향키·Home/End·range selection·context snapshot은 유지했다. footer에 열기/column 탐색/전역 연결 안내를 추가했다. codebench는 기존 driver/TLS 버튼 및 tree 계층·두 번 클릭 열기를 유지한다.

검증 통과:

- `node --experimental-vm-modules design/idea/check_database_ui.mjs`: 실제 local module + native/HTTP fixture. 다섯 driver, TLS 네 옵션 및 keyboard/focus, SQLite/network payload·조건 표시, masked password/Keychain 유지·제거, 프로필별 draft 복원·비밀번호 제거 격리·Save/Close·지연 응답, grouping loaded count, 공개 SQL Console 문맥, 단일 클릭 열기/화살표 펼침 분리, modifier 다중선택, lazy catalog·DDL·stale refresh, 전체 native input/focus/scroll 해제를 검사했다.
- `node --experimental-vm-modules design/idea/check_database_model.mjs`: SQL candidate/extractor/import 회귀 통과.
- `herdr-app check mods/codenav`: native eager check 통과.

생성물 및 설치본은 수정하지 않았다. canonical sync/system 검증, 실제 SQLite API 및 실제 UI·긴 메뉴 관찰은 root 통합 검증에서 확인해야 한다. fixture/native eager 통과만으로 화면의 시각 정합이나 실제 pointer 위치를 확인했다고 주장하지 않는다.
