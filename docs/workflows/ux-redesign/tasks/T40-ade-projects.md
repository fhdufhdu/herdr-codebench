# T40 실제 프로젝트·탐색·문서

사용자가 전체 완료까지 중단 없이 진행을 요청했다. T39 뒤 기본 기능 흐름을 구현한다.
- 새 파일 `mods/ade/workspace.js`: currentProject(), projectKey(context), documentState(context), openDocument(path,context), selectDocument(path,context), closeDocument(path,context). currentProject()는 활성 spaces()의 folder/machine/name/branch/id를 읽고 적절한 panes cwd 보완; UI에서 선택한 root override는 scope별 보관.
- 문서 상태 key `ade.documents`는 projectKey(context)별 `{tabs:[absolutePath],active:absolutePath}`. 원문은 shared에 저장하지 않는다. context는 `{id,root,machine,name,branch}`. key는 machine/root/id를 충돌 없이 직렬화한다.
- ProjectTree 클래스 init(props,cx), render(cx), release(). props.onOpen(path,context,eventCx) 콜백. lazy 디렉터리 실제 읽기, 오류/재시도/빈 상태, MenuController 키보드, 세대별 stale응답 차단. 메서드 refresh(cx)와 focus 핸들 공개.
- ProjectPicker 클래스 init(props,cx), render(cx), release(). overlay view projects에 사용. 프로젝트 선택/이름·최근·직접 정렬, 직접순서는 공통 관리목록. 폴더 열기 시스템 picker + scope root override. 개인 기존 공간/터미널 삭제 금지.
- canonical 새 ade primitives를 사용, 기존 UI controller 복사/상속하지 않는다. 필요시 공통 primitives 변경은 root에게 요청. 소유 범위 workspace.js 및 자신의 tests/results. main.js는 root만 수정.
- API는 설치 runtime 선언. no DOM/Node. 파일 경로는 argv로 전달, shell interpolation 금지. 앱 설치/CUA/사용자 입력은 root만 수행.
- effort medium, 단순 상태/로딩 경계. 기본 모델 유지.
