# T13 승인된 목록 관리 UI 모드 적용

2026-11-05. 사용자 승인 HTML 시안의 선택 목록 + 상단 공통 툴바 + 상세 설정 패턴을 실제 모드에 적용한다. YAGNI/KISS/DRY, codebench 보존.

공통 원본 design/idea/ui.js에 필요한 목록 관리 조립 단위를 추가하고 Projects 직접 지정/전역 DB 연결 관리에 재사용한다. Projects 셀렉트 직접 지정은 별도 목록 관리로 이어진다. 선택 후 위/아래, 검색 중 이동 비활성, 경계 비활성, 선택 유지·키보드·scroll, 취소/적용을 구현한다. 기존 프로필·keychain·remote machine 경계 보존. 실데이터를 demo 값으로 대체하지 않는다.

파일 소유: design/idea/ui.js, mods/codenav/tools.js, mods/codenav/database.js. 생성물 직접 편집 금지. 부모가 일괄 sync/install 및 앱 검증한다. 하위 결과 results/T13-native-managed-lists.md. 하위 effort medium: 확정된 시안의 기존 상태 소유자에 UI 이식. 공통 계약을 부모/B 담당에 빠르게 전달한다. run.js/settings.js/main.js/tool-windows.js는 수정 금지.
