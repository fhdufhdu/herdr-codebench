# T16 설정 잔재 제거·키맵 공통 목록

현재 상태: **변경점 감사 완료 / 구현 보류**. 후속 사용자 지시 ‘먼저 변경점 찾기’가 아래의 초기 구현 지시보다 우선한다. 중지 전 `settings.js`에 부분 변경이 있으며 문법 검사만 통과했다. 설치·회귀 검증 완료 상태가 아니다. [감사 결과](../results/T16-settings-cleanup.md).

2026-11-06 사용자 지시: 메뉴 및 도구 모음 설정 불필요. 해당 페이지와 이 페이지에만 쓰는 상태·입력·메서드·저장 동작을 제거한다. runtime toolbar-model 소비자는 부모가 별도 검토하므로 이 태스크에서 사용자 저장값 삭제하지 않는다. 키맵은 공통 uiManagedList의 검색 가능한 action 목록 + 오른쪽 상세/할당 chord 관리로 변경한다. 액션 선택→추가/변경/삭제의 툴바, 입력/녹화, conflict/CAS/터미널 bridge/Apply·Cancel 보존. 불필요한 펼침트리 UI/old collapsedstate 제거.

소유: mods/codenav/settings.js, design/idea/check_settings.mjs, results/T16-settings-cleanup.md. 다른 소스/생성물/설치 파일 수정 금지. 기존 tool windows 공통목록과5위치·DB진입 유지. 상위는 tools/actions/i18n, 실제CUA, 설치와통합을 소유한다. 하위 effort medium, 확정 UX를 기존 staged binding model에 적용하는 일반 구현. canonical uiManagedList 재사용, speculation금지. 실제nativefixture에 keymap page 추가검증 요구 상위에전달.
