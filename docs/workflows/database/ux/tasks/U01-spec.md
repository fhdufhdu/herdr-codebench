# U01 프로젝트 목록 순서

원본 AGENTS.md, design/idea/PARITY_PLAN.md·COMPONENTS.md, installed Herdr guide/types를 읽는다. tools.js Projects의 selector에서 순서를 조정하고 재열어도 유지돼야 한다. 실제 공간 순서는 core의 space.move {id,index}를 사용해 중복 저장하지 않는다. 같은 machine 안에서만 이동하며 키보드와 클릭 선택/열기/Esc 및 Open Folder 동작을 보존한다. 가장 단순한 명확한 UI로 drag 또는 선택 항목 이동 조작을 제공한다. 가능하면 drag + 접근 가능한 위/아래 버튼/shortcut. 계약 변경/공통 component 확장이 필요하면 부모에 알린다.

소유 파일: mods/codenav/tools.js의 Projects 부분과 필요한 import만, 전용 순수 model 파일(필요할 때), design/idea/check_project_order.mjs, 자기 results/U01-result.md. 다른 파일·생성물·앱 설치는 수정하지 않는다. 특히 Database/Status/engine 및 i18n은 부모 소유. 필요한 번역 문자열은 부모에 전달한다.

medium: 일반 UI 컴포넌트 및 순서 명령 검증. native UI 자동화/설치는 부모가 단독으로 담당한다. 테스트: 미지·누락·machine 경계·첫/마지막/동일 위치·최신 목록 재조회·선택/이동 분리, MenuController keyboard/handle cleanup. 기존 소스·하위 컴포넌트 재사용, YAGNI/KISS/DRY. 실제 구현과 테스트 결과를 별도 기록한다.
