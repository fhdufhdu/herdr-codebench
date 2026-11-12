# T31 설정 잔재·키맵 관리 목록

09/T16 기준으로 불필요한 메뉴 및 도구 모음 페이지의 전용 UI를 제거하고, 키맵을 승인된 검색·선택 목록 + 상단 추가/제거/편집 + 오른쪽 상세 UX로 완성한다. settings.js와 check_settings.mjs 및 필요한 설정 전용 검사/결과 문서만 소유한다. 공통 ui.js/tools/editor/DB/실행/main은 다른 소유다.

현재 settings.js는 이전 부분 작업본이며 부모가 capturing chain의 닫는 괄호 오류 한 개를 교정했다. 다른 부분을 완료로 가정하지 말고 검토한다. keymap-model.js의 staged/CAS·상속·macOS Ctrl/Meta 경계를 재사용한다. 실제 action/keymap 자체를 지우거나 초깃값으로 덮지 않는다. Apply/Cancel·녹화/문자 chord·충돌·검색·액션/할당 선택·disabled/empty를 검사한다. canonical 생성 파일을 직접 수정하지 않고 모르는 아이콘 역할을 쓰지 않는다. 설치/CUA는 부모만 한다.
