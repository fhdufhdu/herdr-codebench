# T11 공통 목록 렌더러 하위 결과

2026-11-05. 부모 통합용 구현은 `/tmp/codebench-managed-list-component.js`의 `renderManagedList(container, options)`다. HTML과 native mod, canonical UI는 수정하지 않았다.

- 단일 상단 툴바, 선택 검색 입력, caption, 그룹 이름, 단일 선택 목록, 빈 목록과 검색 결과 없음 상태를 제공한다.
- `items`의 이름과 보조 설명을 `query`로 검색한다. 검색 입력은 `onQuery`를 제공하면 표시한다. 선택과 query의 실제 상태, 추가·삭제·복제·이동·편집은 호출자가 소유한다.
- 방향키와 Home/End로 보이는 항목을 선택한다. Alt+위/아래는 활성 `move-up`/`move-down` 액션을 호출한다. Enter와 더블클릭은 제공된 `onActivate(id)`를 호출한다. 이동 경계와 검색 중 이동 비활성은 호출자의 `actions[].disabled`를 따른다.
- listbox/option, 안정적인 option ID, `aria-selected`, `aria-activedescendant`, 툴바 버튼 label과 shortcut을 제공한다. 항목 텍스트는 textContent로 삽입하고 아이콘만 전역 ICONS의 SVG 또는 신뢰된 SVG 문자열로 새로 생성한다.
- 같은 container를 재사용하면 검색 입력과 listbox DOM을 유지하므로 입력 포커스·caret와 목록 포커스가 유지된다. 툴바 버튼 포커스는 같은 action으로 복구하며 해당 버튼이 비활성화되면 목록으로 보낸다. 목록 scrollTop을 보존하고 선택 변경·키보드 선택·순서 이동에만 선택 항목을 보이게 한다. 바깥 dialog를 스크롤하지 않는다.

부모 통합 시 container 노드를 통째로 교체하지 않고 유지해야 한다. 스타일 대상은 지정한 managed-* 클래스와 `.managed-row.selected`이며, 보조 클래스로 `managed-caption`, `managed-icon`, `managed-separator`를 사용한다. `managed-rows`에 한정된 높이와 overflow를 제공하고 `[hidden]` 표시를 유지한다. `separator: true`는 해당 액션 앞 구분선이며 id 없는 separator 항목도 허용한다.

검증: `node --check /tmp/codebench-managed-list-component.js` 통과. 실제 브라우저·진입점·draft 저장/취소 검증과 스크린샷은 부모의 HTML 통합 단계에서 수행한다.
