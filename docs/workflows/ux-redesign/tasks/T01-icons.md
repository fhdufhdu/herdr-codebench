# T01 공통 아이콘 구현

- 요구사항 U05·U06. 선행 R04 조사와 03-architecture 아이콘 계약 확정.
- 담당 하위 구현, effort medium. 기존 공개 호출을 adapter로 연결하는 일반 컴포넌트 작업이다.
- 원본 registry와 Lucide subset·라이선스·upstream pin을 추가하고 sync 생성·검사를 확장한다.
- 수정 범위는 design/idea/icons.json, icons/, sync_ui.py, 생성 ui-icons.js·ui-icons/와 codenav/ideaicons.js, activity/ficons/idea.js다. codenav/agents.js, termfiles.js, newterminal.js, panehead.js, activity/footer.js, panelbar.js의 하드코딩 action glyph를 공통 uiIcon으로 교체할 수 있다.
- common.js 두 파일, canonical ui.js·tokens, tools.js·design-preview.js·actions.js·tool-windows.js는 부모가 변경한다. 필요한 adapter import는 부모에게 전달한다.
- 파일 종류 resolver는 현재 파일 자산을 보존하며 symbol/tool glyph를 공통 계열로 연결한다. Program.icon/tint·외부 제품 identity·콘텐츠 이미지는 유지한다.
- 등록된 ACTIONS/TOOLS/headerActions와 legacy generic icon 이름 전체를 매핑한다. unknown 이름은 안전한 실제 fallback을 사용한다. native element 재사용 금지.
- 최소 회귀 검사는 alias/unknown/missing asset/generated check. 결과 results/T01-icons.md에 실제 명령과 남은 native 검증을 기록한다.
