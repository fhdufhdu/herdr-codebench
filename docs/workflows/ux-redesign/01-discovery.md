# UX 원칙과 적용 판단

2026-11-05. 조사 범위는 UX 원칙, native runtime 공개 API, 현재 프로젝트와 DB 클라이언트 공식 문서다. 새 목표는 자체 디자인 체계다. 중앙 편집기와 좌·우·아래 도구 영역, 사용자가 정한 크기·순서·터미널은 보존한다.

## 원칙에서 제품 규칙으로

진행 상태를 알리고 사용자가 취소·복구할 수 있게 한다. 비슷한 행동은 같은 용어와 제어를 쓴다. 실패 예방과 명확한 복구 경로를 우선한다. 기능 이름과 현재 대상을 화면에서 인지하게 한다. 이를 아래 제품 규칙으로 구체화했다. [NN/g 사용성 원칙](https://www.nngroup.com/articles/ten-usability-heuristics/)

| 제품 규칙 | 현재 문제 | 적용 |
| --- | --- | --- |
| 한 영역에는 한 제목과 명확한 주요 행동 | 중복 제목·상태와 액션의 혼재 | 도구 header 재사용, 본문은 해당 작업 내용, dialog footer에 실행·취소 |
| 실행 전 대상·범위를 읽을 수 있음 | SQL 번호와 결과 번호만으로 원문 파악 어려움 | 연결·DB·schema, SQL 줄 범위, 실행 원문과 결과 행 수 |
| 로컬 변경과 서버 반영이 구분됨 | 셀 수정 중 Apply·Revert와 닫기 경계 모호 | pending 수정·삭제 수, 적용 중 변경 금지, 실패 시 staging 유지 |
| 상태는 색과 텍스트로 함께 표시 | 파란 선택·경고·dirty 의미의 혼재 | 중립 활성 배경·accent 선, 의미별 상태색·텍스트 |
| 편집 문서는 한 buffer를 유지 | 보기·편집 모드의 별도 진입과 저장 중 교체 | Markdown 텍스트 모드 전환, 저장 중 workspace buffer 수명 보존 |

빈도가 높은 행동은 직접 보이고 고급 설정은 명확한 이름의 메뉴로 접근하게 한다. DB 툴바에서는 Run·Cancel·Apply·Revert를 작업 상태에 맞춰 제공하고, 추출 형식·DDL 대상 선택은 기존 메뉴를 재사용한다. [NN/g 단계적 공개](https://www.nngroup.com/articles/progressive-disclosure/)

아이콘은 같은 계열·선 굵기·의미 역할로 묶는다. 낯선 기능에는 이름과 설명을 함께 제공한다. Lucide subset의 기본 16px·탐색 20px와 최소 24px hit 영역은 이번 제품의 설계 선택이다. 파일 종류·사용자 프로그램 identity는 해당 콘텐츠의 구분을 유지한다. [NN/g 아이콘 사용성](https://www.nngroup.com/articles/icon-usability/)

표의 이동과 값 입력을 분리하고 방향키·Home/End·Enter·Escape 흐름을 일관되게 제공한다. 버튼은 native activation·focus·disabled·접근성 이름을 사용한다. 웹 APG의 상호작용 지침을 native API 범위에서 참고하며 DOM API를 가정하지 않는다. [W3C Grid 패턴](https://www.w3.org/WAI/ARIA/apg/patterns/grid/), [Toolbar 패턴](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/), [Dialog 패턴](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

공통 팔레트에 주요 본문 대비 4.5와 핵심 제어·포커스 대비 3 검사를 둔다. 화면 전체의 접근성 판정은 별도 실제 검증이 필요하며 이 수치 검사를 인증으로 해석하지 않는다. [W3C 비텍스트 대비](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [최소 대상 크기](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

## 데이터베이스 개선 방향

공식 문서 비교의 상세 범위와 코드 근거는 [R03 조사](results/R03-database-research.md)에 있다. DBeaver의 실행 범위·여러 결과, TablePlus의 변경 검토·반영, Beekeeper Studio의 실행 문맥·연결 수명, pgAdmin의 작업 상태·행 수에서 공통 흐름을 수집했다. 이 문서 조사를 실제 앱 실행 검증으로 기록하지 않는다. [DBeaver](https://dbeaver.com/docs/dbeaver/SQL-Execution/), [TablePlus](https://tableplus.com/docs/gui-tools/the-interface/toolbar), [Beekeeper Studio](https://docs.beekeeperstudio.io/user_guide/sql_editor/editor/), [pgAdmin](https://www.pgadmin.org/docs/pgadmin4/latest/query_tool_toolbar.html)

| 순서 | 개선 | 범위 |
| --- | --- | --- |
| 1 | 연결 대상·실행 범위·결과 출처와 작업 진행의 명료화 | 이번 UI 구현 |
| 2 | pending 수정·삭제·읽기 전용 설명, 적용 중 보호와 실패 복구, 탭 닫기 보존 | 이번 UI 구현 |
| 3 | 선택 행·로드된 행·전체 테이블 범위, sample 미리보기와 완료 결과 | 이번 UI 구현. 기존 공통 extractor 유지 |
| 4 | 단일 SQL 편집기에서 커서 구문·드래그 선택 실행 | runtime caret·selection API 확인 후 통합 |
| 5 | 테이블 필터·정렬·페이지 이동, 열 너비·긴 값 편집, query history와 결과 탭 | 제안. 현재 요구사항과 함께 후속 구체화 |
| 6 | 가져오기 열 매핑·타입 검토, 혼합 DDL의 선택·확장 요약, 변경 SQL 사전 검토 | 제안. 실제 metadata와 지원 dialect 경계 확인 필요 |
| 7 | 여러 Run에 걸친 transaction과 일관된 전체 export snapshot | 엔진 연결 수명·동시성 설계가 필요한 후속 기능 |

현재 한 Run은 하나의 연결을 사용하고 종료 시 폐기한다. Apply는 별도의 단일 transaction이다. 각 실행 사이에 BEGIN/COMMIT이 유지된다고 표시하면 사용자가 예상한 DB 상태와 어긋나므로 UI에서 이 수명을 설명한다. 이 판단은 `engine/database.go`·`database_apply.go`의 구현에 근거한다.

## 편집기 결정

현재 설치된 `EditorState`는 값·변경 이벤트를 공개하지만 caret·selection 조회와 reveal 이동을 공개하지 않는다. 기존 CodeView가 LSP 탐색·진단 이동과 SQL 정확한 선택을 소유한다. 사용자는 이 제약을 확인한 뒤 기존 뷰어 유지로 결정했다. 기존 분석 기능과 소스 탐색을 유지하고 Markdown 미리보기·저장 수명을 개선한다. 후속 눈 아이콘 대안은 원문/미리보기 또는 편집/미리보기의 텍스트 전환으로 비교·구현한다. [Fluent 2 Tablist의 label·선택 설명](https://fluent2.microsoft.design/components/web/react/core/tablist/usage)

## 검증 출처

SQLite 실제 UI 검증은 기존 소유 fixture `Codebench UX Lab (SQLite)`만 사용한다. 사용자 DB 프로필은 변경하지 않는다. 자동 회귀·native load 검사는 실제 화면 검증과 구분하고 [검증 계획](06-validation-plan.md)에 따라 결과를 남긴다.
