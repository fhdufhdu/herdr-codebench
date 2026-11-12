# T42 새 통합 편집기 첫 단위

새 모드 전용 EditorSurface 클래스와 문서 상태/렌더를 처음부터 구현한다. 기존 EditableCode나 controller를 복사·상속하지 않는다. 검증된 라이브러리/OS IME boundary 원리는 재사용 가능.
- 파일 `mods/ade/text-editor.js`와 필요시 자신의 작은 순수 모델. export default EditorSurface 클래스 init(props,cx), render(cx), release(). 실제파일 open/선택은 workspace.js documentState(currentProject())의 `{tabs:[absolutePath],active:path}`와 context {id,root,machine,name,branch}. root와 계약변경 조율.
- 우선 native TextareaState/Textarea의 공개 selection/IME/코드 renderer 능력을 gpui-kit.d.ts에서 확인. 네이티브 전체 텍스트 textarea가 선택/커서/멀티라인/IME/undo를 제공하면 이를 먼저 활용해서 KISS. 공개API로 불가능한 부분 구체적으로 보고, 가짜성공금지.
- init에서 입력상태/포커스, changedirty/읽기실패/불러오기/닫기경고/Save CAS/undo-redo/한글조합표시/Markdown source-preview. Ctrl/Meta 구분. OS IME텍스트를 키 이벤트로 재조립금지.
- LSP 연결은 다음 본단위에서도 가능하나 위치/선택 API 조사결과와 구조상 연결경계를 명시. 키입력 선행시험이 먼저. root가 통합/실제 CUA검증.
- native tabs+context row는 EditorSurface가 소유. UI는 canonical ade primitives. 원문 shared저장금지. remote write unsupported는 명확히 readonly처리. 늦은read/save응답 다른프로젝트 문서 덮어쓰기금지.
- 파일범위 text-editor.js, 관련새모델/테스트/자신result. main.js/workspace.js 수정은root에요청. 앱설치/CUA금지.
- effort medium, 공개 native입력 사용 가능성부터 짧게 검증. 모델변경없음.
