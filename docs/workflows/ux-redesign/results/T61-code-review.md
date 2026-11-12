# T61 ADE 코드 리뷰

이전 idea-ux의 codenav/review.js·review-model.js·comments.js를 기능 근거로 확인한 뒤 ADE 화면과 상태/이벤트를 새로 구현했다. 기존 UI controller/표면을 복사하거나 import하지 않았다. review-model.js는 bounded diff/파일 목록·범위·메시지의 순수 모델이고 review.js의 ReviewService는 공개 Git argv/파일 읽기 경계다. 별도 Git backend를 중복 구현하지 않았다.

기존 기능과 이번 범위:

| 기존 기능 | ADE 구현 |
| --- | --- |
| 기준/비교 브랜치, merge-base, 양쪽 교환 | compact 검색 목록과 swap, 실제 merge-base 비교 |
| 커밋만 또는 작업 트리 포함 | committed / committed+staged+unstaged+untracked 구분, 다른 비교 branch는 committed scope |
| 파일 상태·추가/삭제 수 | NUL-safe 목록·통계, 삭제/바이너리/추적 안 된 파일 상태 |
| diff/전체 문맥, 이전·다음 변경 | 통합 old/new 줄 번호, 20,000줄 한도·최대 80행 window, hunk 이동/키보드/휠·가로 스크롤 |
| 소스 열기 | 실제 checkout 파일을 기존 ADE 편집기로 열고 새쪽 줄로 이동, 삭제 파일 차단 |
| 줄/Shift/드래그 코멘트 CRUD | old/new 범위와 인용 원문, 저장/수정/삭제, 코멘트 목록과 이전 범위 표시 |
| repo별 코멘트 보존 | machine/root JSON key의 persisted ade.reviews, 기존 codenav.reviews 읽기 호환·원본 미수정 |
| 리뷰 복사/AI 전달 | 리뷰 원문 복사, 현재 공간 에이전트 선택 및 기존 AgentAttachment의 편집 가능한 text draft |
| 원격 갱신 | 명시 git fetch --all --prune 버튼 |
| 파일 감시/주기 갱신 | 이번 bounded 범위는 명시 새로고침. 자동 local watch/remote polling은 추가하지 않음 |
| diff 위 LSP hover/정의/참조·구문색 | 이번 diff는 읽기용 semantic 추가/삭제 표시. LSP와 구문 편집은 소스 열기로 기존 ADE 편집기에 위임 |
| 직접 전송(Enter)·전송 후 자동 삭제 | 자동/직접 전송을 추가하지 않음. 첨부 draft 확인 후 에이전트에서 사용자가 전송 |

파일 경로와 refs는 shell에 보간하지 않고 argv로 전달한다. Git은 literal-pathspecs와 no-ext-diff/no-textconv, no-optional-locks를 사용한다. 바이너리를 가짜 텍스트로 표시하지 않고, 공통 이력이 없으면 실제 오류와 비교 대상 안내를 표시한다. untracked는 runtime의 bounded UTF-8 readTextFile을 사용한다. 표시 한도를 UI에 기록한다.

기존 코멘트와 unknown store 값은 읽기 호환 후 ADE namespace에 보존하고 legacy namespace를 덮어쓰지 않는다. 코멘트는 비교 범위 metadata와 최대 30줄 인용을 포함한다. 다른 repo로 이동한 뒤 원래 초안을 새 repo에 저장하지 못하게 막으며, file/ref/source 이동만으로 초안을 지우지 않는다. requestClose(after,cx)는 dirty 초안일 때 저장/버리기/취소를 표시한다. 확인 버튼은 보관한 이전 Context가 아닌 자신의 fresh eventCx로 after(eventCx)를 호출한다. 유효하지 않은 초안의 저장 후 닫기는 차단된다.

통합 계약:

- `openReview(context)`는 ade.review-open[projectKey]=true 다음 ade.editor-mode=review를 설정한다.
- `ReviewView.init({context,service?},cx)`, `refresh(cx,context?)`, `render(cx)`, `release()`, `focus`, `dirty()`, `requestClose(after,cx)`를 제공한다.
- host는 중앙 synthetic review tab/mode를 소유한다. 새 리뷰 화면은 sidebar+diff 전체 surface이며 중복 tool header를 만들지 않는다.
- 소스 열기는 openDocument와 ade.navigation을 사용해 file mode로 돌아간다. AI 첨부는 기존 attachment overlay의 optional text 경로를 사용하며 paste/focus 전송 구현을 복제하지 않았다.
- 프로젝트 변경은 render에서 descriptor만 enqueue하고 init-owned AsyncContext worker가 처리한다. release에서 queue/task/입력/focus/scroll handles를 해제한다.

사용하지 않게 된 navigation.js의 ChangesView와 porcelain-only parser/표시·테스트는 제거했다. 파일 검색 기능과 회귀 검증은 유지한다.

검증:

- `node --experimental-vm-modules design/ade/check_review.mjs` 통과. 임시 Git 저장소에서 실제 branch/merge-base와 커밋/staged/unstaged/untracked·삭제·바이너리·공백/탭/셸 문자 경로·full-context·공통 이력 없음 검증을 수행했다.
- 같은 검사에서 hunk/source 줄, old/new 범위, legacy 보존·CRUD·view 재생성 persistence, stale diff/project 차단, 잘못된 repo로 draft 저장 차단, explicit fetch, 미전송 AI text draft를 검증했다.
- dirty close의 저장/버리기/취소·invalid save와 fresh 확인 Context 전달을 검증했다.
- inert native fixture 네 개 통과: 실제 파싱된 diff 행, branch picker, dirty-close 확인+초안, 코멘트 상세. 실제 backend/개인 저장소 변경을 호출하지 않았다.
- search 회귀 및 `herdr-app check mods/ade` 통과.

실제 사용자 앱 설치·CUA·개인 Git fetch/terminal 입력은 root가 수행한다. 이 작업자는 임시 Git fixture 외의 저장소나 process에 변경을 가하지 않았다. 위 표의 위임/제외 항목을 포함하므로 이전 review의 모든 부가기능이 동일한 표면으로 완전히 이식되었다고 주장하지 않는다.
