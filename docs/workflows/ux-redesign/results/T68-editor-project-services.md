# ADE 편집기·에이전트·프로젝트 서비스

2026-11-09. YAGNI·KISS·DRY에 따라 기존 엔진 분석과 HTTP 실행 코어를 재사용하고 ADE 공통 UI로 연결했다. Herdr 앱 소스는 변경하지 않았다.

## 편집기와 리뷰

- 텍스트 드래그 도중 native input에 반복해서 포커스를 주지 않는다. 조합 중이 아닐 때 native caret를 투명하게 하고 같은 위치에 정적인 caret를 그린다. 마우스를 놓거나 편집 영역을 벗어나면 원래 caret로 돌아간다. 한글 조합 중에는 native 입력 표시를 유지한다.
- 일반 편집기와 리뷰의 줄 번호 끝에 공통 separator 색상·1px 구분선을 둔다. 편집기는 구분선 뒤 코드에 8px 여백을 둔다.
- 우클릭 메뉴에 상위 선언·인터페이스, 구현, 타입 정의를 추가한다. Cmd+U는 상위 선언, Cmd+Option+B는 구현, Cmd+Option+클릭도 구현 이동이다. 리뷰에서도 상위·구현 탐색을 제공한다. 기존 lease·revision·프로젝트·커서 stale 응답 검사를 유지한다.

## 전역 에이전트와 터미널

- 에이전트 도구는 모든 프로젝트·머신의 에이전트를 나열하고 소속 프로젝트와 상태를 표시한다. 다른 프로젝트 에이전트 열기는 해당 공간·pane으로 이동한다. 파일 첨부는 소스 프로젝트 문서를 유지하면서 사용자가 선택한 에이전트를 대상으로 한다. 자동 전송은 하지 않는다.
- ADE 터미널 탭 닫기와 마지막 pane 닫기에서 프로젝트의 마지막 탭이면 먼저 실행 프로세스가 없는 ADE 작업 공간 mod 탭을 만든다. 원래 터미널 탭을 닫아도 공간이 유지되어 공간 제거 확인창이 뜨지 않는다. mod 탭은 ADE 터미널 목록에서 제외한다. 실패 시 원래 터미널을 닫지 않는다.
- 이는 ADE 소유 닫기 버튼 경로다. Herdr 앱 자체의 전역 tab.close 명령 구현은 변경하지 않았다.

## Spring

- Java·Kotlin 줄 번호 오른쪽 Spring 아이콘에서 빈·주입 관련 대상으로 이동한다. 프로젝트 검색 구현은 유지하지만 편집기 상단의 중복 Spring 버튼은 제거했다.
- 기존 `spring_markers`, `spring_project`, `related` 엔진을 사용한다. 미저장 소스는 명시적 text로 제공하고 다른 편집기의 LSP 문서를 덮어쓰지 않는다. 주입 지점에서 관련 빈으로, 빈에서 사용 위치로 이동한다.
- 조건부 빈과 프로필의 실제 활성 여부는 추정하지 않는다. 원격 분석은 기존 로컬 엔진 범위 밖이므로 비활성이다.

## HTTP

- `.http`·`.rest` 요청 시작 줄의 실행 아이콘에서 해당 블록이 선택된 확인 창을 연다. 블록 또는 전체 요청, 환경과 원문을 확인한 뒤 명시적으로 실행한다. 요청 선택만으로 보내지 않는다. 실행 전에 파일·revision·환경이 바뀌면 중단한다.
- `design/idea/http-client.js`를 canonical 실행 코어로 추출하고 생성기로 ADE·codenav에 배포한다. 기존 IDEA-UX 호출은 어댑터로 동일 실행 코어를 사용한다. 환경 파일 탐색, ijhttp 스크립트, 메모리 내 client.global, private snapshot과 정리를 공유한다.
- ADE 실행 기록·로그·중지 경로를 사용하고 하단 실행 결과 탭에 파일명·블록 줄 번호를 표시한다. `.http`는 지원하지 않는 언어 서버 세션을 만들지 않는다. 현재 원격 실행은 제공하지 않는다.

## 검증

- 자동: ADE editor/leases/completion/menu/LSP/code-input, project services, terminal, review, 공통 시스템, 생성 drift 검사, ADE·codenav native check 통과. 엔진 `go test ./... -run 'Spring|Super'` 통과.
- 실제 ijhttp localhost 테스트: 환경 변수, 선택 블록만 실행, 응답 assertion·global 스크립트, 0600 스냅샷, 임시 파일·리포트 제거 통과.
- 실제 Herdr: 소유 테스트 공간에서 Spring 빈·주입 3개 표시와 대상 이동, `.http` 실행 결과 완료·종료 코드 0·로그 표시, 편집기·리뷰 구분선, 전역 에이전트 목록, 텍스트 드래그 조작을 확인했다. 드래그의 중간 프레임 깜빡임은 CUA 단일 drag 호출로 직접 계측하지 않았으며 native focus 재호출 방지와 정적 caret 분기로 검증했다.
- 마지막 소유 터미널을 닫은 후 공간과 mod-only 탭이 유지되고 overlay·runtime 오류가 없는 것을 확인했다. 테스트 공간·서버·파일을 정리하고 원래 작업 공간으로 복귀했다. 기존 업무 터미널은 종료하지 않았다.

## 줄 번호 옆 동작과 상태 표시 정리

- 상단 작업 버튼은 저장·다시 읽기만 남긴다. 방문 위치 뒤로·앞으로와 Markdown 원문·미리보기는 유지한다. 정보·정의·참조·Spring·HTTP 중복 버튼과 상시 LSP footer를 제거한다. 분석 상태는 브랜치 옆 버튼 한 곳에서 확인하며 요청한 빠른 정보 결과만 닫을 수 있는 패널로 표시한다.
- canonical `adeGutterAction`은 24px 고정 폭과 행 높이, 지연 아이콘 factory, 툴팁·클릭 전파 차단을 공유한다. 편집기와 현재 소스에 대응하는 리뷰 줄에 상위/인터페이스·구현·Spring 아이콘을 표시한다. 과거/삭제 리뷰 줄과 리뷰 HTTP에는 실행 아이콘을 표시하지 않는다.
- override marker는 기존 canonical editor-model에서 생성하고 Spring은 미저장 소스를 debounce 분석한다. 입력·닫기 이후 늦게 도착하는 marker와 대상 응답은 폐기한다. HTTP 아이콘은 요청 확인 창을 해당 블록으로 선택하며 자동 전송하지 않는다.
- 자동 검증: gutter revision/lifecycle 테스트, editor/leases/completion/code-input/review/review-analysis/project-services, 공통 시스템·생성 검사, ade/codenav/activity native check 통과.
- 실제 Herdr 소유 fixture에서 저장·다시 읽기 상단, LSP footer 제거, 인터페이스·상위 선언·Spring 줄 아이콘과 구분선을 확인했다. HTTP 줄 버튼도 AX에 표시됨을 확인했다. 사용자 작업 공간 전환을 감지한 뒤 추가 클릭을 멈췄고 소유 테스트 공간·파일만 정리했다. 이번 검증은 아이콘 배치와 상태 표시 범위이며 HTTP 전송은 앞선 localhost 검증을 재사용한다.
