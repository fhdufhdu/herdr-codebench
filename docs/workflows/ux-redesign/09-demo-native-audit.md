# 승인 데모와 실제 모드의 변경점

2026-11-06. 사용자 지시인 ‘먼저 변경점을 찾기’에 따른 감사와 후속 구현 결정이다. 전체 구현 완료 보고가 아니다. 한글 조합 실험 확인 후 사용자가 이 문서에 결과를 정리하고 개발을 진행하도록 지시했다. 기준은 `design/ux-redesign-demo.html`, 설치된 codenav/activity 모드, 현재 런타임 선언, 사용자가 제공한 프로젝트 선택기·실행 화면이다. 이후 추가한 자체 편집기 타당성도 포함한다. 모든 구현 판단에 YAGNI·KISS·DRY를 적용하고 기존 컴포넌트·입력 엔진·라이브러리를 우선 재사용한다.

편집기 목표는 동일 UI/UX·미저장 LSP를 갖춘 단일 editor와 검증 후 source viewer 대체다. **Herdr 앱 본체와 SDK는 수정하지 않는다.** 이전 [심화 검토](10-unified-editor-review.md)의 native host 확장 우선안은 사용자 정정으로 대체됐다. 현재 구현 계약은 [모드 전용 자체 편집기](11-custom-editor-implementation.md)와 아래 검증 결과를 따른다.

## 확인 범위와 현재 상태

2026-11-06 후속: T35–T37에서 연결 관리/master-detail·SQL 선택 확인·하단 statement 탭·고정 header grid·변경 bar·compact 전송을 구현·설치하고 관련 회귀 및 native eager18종을 통과했다. 새 연결 관리 화면은 실제 관찰했으며 SQLite 전체 UI 왕복은 아직 대기다. T36의 종료된 terminal attach/body 누락을 복구했고, 사용자 후속 resize 버벅임은T38에서 native default 생략으로 인한 반복 layout.set을 수정·설치했다. 실제 드래그 성능 재확인도 대기다. 아래 감사 당시 차이와 후속 해결/검증 상태를 구분한다.

- 사용자 재시작 후 `herdr-app status`의 오류 목록이 비었고 Computer Use로 실제 Herdr 설정·도구 관리 화면에 접근했다. 메뉴 및 도구 모음 페이지가 남은 것도 확인했다.
- 프로젝트 선택기의 이중 외곽과 실행 위치·상태 오류는 사용자 실제 화면과 설치 소스가 함께 뒷받침한다.
- DB 세부 화면은 주로 설치 소스와 HTML 비교다. 실제 연결 관리 창을 여는 명령은 보냈으나 그 창의 최종 화면을 관찰하지 못했다. DB 전 화면의 실제 클릭 검증을 완료했다고 주장하지 않는다.
- 사용자 후속 지시 전 `settings.js`와 `database.js`에 일부 수정이 시작됐다. 감사 당시에는 문법 검사만 거친 중간 상태였으며 기존 자동 검사 25종은 이전 설치본의 기록이었다. 후속 개발 배치에서 설정 회귀와 실제 DB Select/Popup fixture를 갱신·통과했고 파일을 설치했다. 현재 적용/검증 상태는 아래 개발 재개 후 첫 배치를 따른다.
- 실행 중인 사용자의 Docker Compose·터미널과 실제 DB 데이터는 이 감사에서 중지·재실행·수정하지 않았다.

## 우선순위별 변경 목록

| 우선순위 | 영역 | 확인한 차이 | 변경 방향 |
| --- | --- | --- | --- |
| P0 | 실행 구성의 출력 위치 | 설정 실행이 `tab.new`/`tab.select`로 일반 터미널을 먼저 선택한다. 하단 결과는 그 터미널을 읽은 텍스트 사본이다. | 실행별 상태·실시간 출력·중지·재실행을 하단 실행 결과 탭에서 다룬다. 중앙 문서의 위치를 유지하고 일반 터미널을 실행 화면으로 자동 선택하지 않는다. native terminal의 layout 삽입 지원을 활용하는 경계를 검토한다. |
| P0 | 실행 중인데 상태 확인 불가 | 새 결과의 owner 등록 전에 결과를 공개하고 도구를 연다. 복구가 실행을 `untracked`로 바꾸면 원래 로그 수집자도 종료할 수 있다. 사용자 화면의 0ms·명령만 남는 현상과 부합한다. | 현재 실행과 재시작 후 복구를 구분한다. 공유 소유권·공개 순서를 확인하고 정상 long-running 작업을 footer 부재만으로 추적 불가 처리하지 않는다. 실제 VM 분리는 아직 가설이다. |
| P0 | 프로젝트 선택기 외곽 | 제목을 감싼 `popupSurface` 안의 `uiMenu`가 다시 `popupSurface`를 만든다. 밝은 외곽이 두 겹이다. | 외곽을 한 컴포넌트가 소유한다. 단독 메뉴와 dialog 안에 들어가는 목록 본문을 구분해 재사용한다. |
| P1 | 공통 디자인 역할 | 색상 hex는 이미 데모와 같지만 popup/dialog 배경·윤곽 역할이 다르다. 기본 버튼도 대부분 채움+테두리라 화면이 무겁다. | 팔레트 전면 변경 대신 surface·line·border의 용도, primary·outline·quiet 버튼과 입력 focus의 공통 규칙을 맞춘다. 갤러리와 caller를 함께 이행한다. |
| P1 | 설정 잔재·키맵 | 메뉴 및 도구 모음 설정, 펼침형 키맵 트리, 고정 키맵 이름 표시가 남아 있다. | 사용자가 제외한 페이지의 전용 코드만 제거한다. 키맵은 검색 가능한 액션 목록+선택 항목 상세로 바꾸고 할당·녹화·충돌·적용·취소를 유지한다. |
| P1 | DB 연결 관리 | 데모는 compact select와 master/detail이다. 설치본은 DB 종류·TLS 옵션을 버튼으로 나열하고 여백·제목 위계도 다르다. | 이름→DB 종류→조건별 필드 순서, 공통 관리 목록과 compact select를 사용한다. 다섯 driver·TLS·Keychain을 유지한다. |
| P1 | 연결 편집의 저장 경계 | 데모는 목록 전체 draft를 확인 시 저장한다. 실제는 profile별 Save이며 선택 전환이 현재 입력을 덮어쓴다. | 선택을 바꿔도 미저장 입력을 잃지 않는 흐름과 실제 저장·취소의 의미를 정한다. 단순히 Save를 확인으로 바꾸지 않는다. |
| P1 | SQL 실행 흐름 | 주요 실행 행동이 오른쪽에 섞여 있고 블록별 즉시 실행행이 별도로 있다. 후보 popup은 클릭 즉시 실행한다. | 연결 문맥과 주요 행동을 나누고 ‘실행 범위 선택→원문·행 범위 확인→실행’ 경로로 모은다. 현재/선택/블록/전체/중첩 후보를 보존한다. |
| P1 | 하단 SQL 결과 | 한 job 안의 결과를 버튼행으로 선택한다. 데모는 결과를 탭으로 구분하며 실행 SQL·결과 요약·내보내기·선택 footer의 위계도 다르다. | 하단 실행 결과 안에서 작업과 statement 결과를 명확히 선택한다. 엔진 job·transaction·중지 단위는 유지하고 표현 때문에 SQL을 재실행하지 않는다. |
| P1 | 공통 DB 표 | 열이 모두 180px이고 헤더도 데이터와 함께 세로로 스크롤된다. 행 밀도와 NULL·수정·focus 표시가 다르다. | 하나의 공통 grid에서 고정 헤더·열폭·밀도·상태 표현을 개선한다. 가상화·키보드·정확한 원본 값·행 선택은 유지한다. |
| P1 | 표 수정과 추출 | 수정 반영/되돌리기가 상시 icon toolbar에 섞인다. 추출 형식·범위도 여러 버튼으로 나열된다. | 변경이 생겼을 때 반영할 행과 행동을 전용 bar로 보여준다. 추출은 형식/범위 selector→preview→복사/파일 순서로 정리하고 기존 공용 extractor를 재사용한다. |
| P2 | DB 탐색·DDL·가져오기 | 콘솔 진입은 context menu에 숨어 있고 table/view 종류·개수 구분이 없다. DDL은 데모 dialog와 달리 중앙 문서다. 가져오기는 데모에 없는 실제 기능이다. | 콘솔 진입과 객체 계층을 정리한다. 중앙 DDL 문서·다중 객체 추출·실제 import를 유지할지 표시 계약을 명확히 하고 공통 dialog·header 규칙을 적용한다. |
| P2 | 관리 목록·제목·탭 밀도 | picker/관리 목록/표의 역할별 치수와 제목·보조 텍스트 위계가 다르다. 도구 목록은 위치별 group 대신 각 row에 위치를 쓴다. | 관리 화면 공통 shell과 역할별 밀도를 먼저 맞춘다. 전역 rowHeight를 바꿔 파일 트리까지 덩달아 변경하지 않는다. normal/compact·큰 글꼴·긴 경로를 함께 확인한다. |
| P1 · 실험 통과, 통합 진행 | 자체 편집기 | native Editor SDK의 커서·선택·이동·진단 제어 부족으로 viewer/editor를 통합하지 못한다. | 앱 본체 변경 없이 모드가 문서·선택·undo·렌더링·LSP를 소유한다. DOM 없는 CodeMirror state와 Unicode grapheme library를 재사용하고 native Textarea는 OS/IME 입력 전달에만 쓴다. 기존 CodeView의 공통 표면을 편집기에 재사용한다. |

## 실행 결과의 기준 동작

실행 구성을 시작하면 하단 실행 결과가 열리고 해당 실행 탭이 선택된다. 그 탭에서 실행 중 상태, 경과 시간, 실시간 출력, 종료 결과를 확인하고 중지·재실행한다. 다른 결과 탭으로 이동해도 실행은 계속된다. SQL 결과 표도 이 도구에 들어가고 중앙에는 SQL 원문 또는 테이블 편집 문서가 남는다.

일반 터미널의 탭 선택을 잠깐 실행한 뒤 중앙으로 되돌리는 임시 처리는 이 기준을 만족하는 최종 해결로 보지 않는다. 설치 런타임은 layout-level `{terminal: id}` 삽입을 지원하지만 mod 내부에 넣는 Terminal factory는 확인되지 않았다. 기존 하단 island의 header·tabs와 native live terminal을 조합하는 경계를 먼저 확인해야 한다. 상세 source 사실·가설·검증 사례는 [T19](results/T19-run-routing-audit.md)에 기록했다.

## 기능을 보존하며 정리할 경계

프로젝트 경로·remote machine 정보·동명 구분, 다섯 DB driver·전역 연결·Keychain, staged 행 수정·PK/충돌 검사, 공용 추출기·import·다중 객체 DDL은 유지한다. 데모 샘플에 없다는 이유만으로 실기능을 제거하지 않는다. 편집기·터미널·LSP·알림 설정도 사용자가 제거한 메뉴 설정과 별개다.

SQL의 한 job에서 여러 결과를 받는 구조, 연결 profile별 저장 경계, DDL 문서/간단 확인 dialog의 역할은 겉모양만 바꾸면 동작이 달라지는 항목이다. 화면 표현과 기존 저장·실행 계약을 함께 정한 뒤 구현해야 한다. 현재 codebench의 별도 동작과 panel 크기·순서·active/hidden 상태·터미널 데이터를 보존한다.

## 자체 편집기 결정과 검증 결과

앱 Rust 소스는 공개 계약·입력 동작을 확인하는 읽기 자료로만 사용했다. 앱 소스 수정·재빌드나 browser host 추가는 하지 않는다. 모드가 제어할 수 없는 native Editor를 감싸는 방식 대신 모드가 문서·caret·selection을 직접 소유한다.

- **문서:** DOM 없는 `@codemirror/state` 6.7.6의 Text/ChangeSet/EditorSelection과 `unicode-segmenter` 0.17.3을 버전 고정 번들로 재사용한다. 원문·UTF-16 좌표·grapheme 이동/삭제·undo/redo는 `editor-buffer.js`가 소유한다. Node/DOM은 런타임 의존성이 아니다. license와 재생성 경로는 `design/editor/`에 보존했다.
- **표시:** `CodeView`의 줄·gutter·선택·syntax·진단·scroll 표면을 재사용하고 caret 위치에 입력부를 끼운다. viewer와 editor의 서로 다른 renderer를 추가하지 않는다. Markdown 원문/미리보기도 같은 buffer를 사용한다.
- **입력:** native Textarea는 OS 입력/한글 조합을 담당하고 완성된 문자열만 모델에 전달한다. 조합 중 값은 document revision·undo·LSP에 넣지 않으며 IME 동작을 ASCII key 조립으로 재구현하지 않는다.
- **미저장 LSP:** engine의 메모리 `document_owner/revision/text` 계약으로 sync/close한다. stale owner/revision 응답은 버리고 저장 파일 요청이 열린 buffer를 덮어쓰지 못한다. 미저장 원문을 shared.json이나 임시 저장 파일에 보관하지 않는다. 실제 서버가 진단 version을 생략하면 `unversioned`임을 표시한다.
- **저장·수명:** original 원문 기반 CAS 저장, 저장 중 추가 입력의 dirty 유지, 외부 변경 충돌, workspace 전환, 저장/버리기/취소, clean 문서의 lease 종료·disk 재열기를 검사한다. 같은 URI는 workspace가 달라도 하나의 모드 buffer/owner를 재사용한다.

### 한글 조합·글꼴 문제와 해결

| 실제 관찰 | 원인과 반영 |
| --- | --- |
| `ㅇ → 아 → 안`이 보이지 않다가 다음 글자를 입력할 때 완성본만 나타남 | `line_height(22)`의 숫자는 px가 아니라 글꼴 배율이었다. native 입력부 줄 높이를 명시적인 `22px`처럼 설정했다. |
| 조합 글자 끝이 잘림 | native 입력기는 caret 오른쪽에10px를 확보한다. native viewport의12px 여유를 문서상의 advance와 분리해 확보했다. |
| 맨 처음 잘린 뒤 다음 프레임에서 크기가 바뀜 | 빈 caret2px를 native viewport에도 적용해서 첫 native IME paint가 좁은 상태로 시작했다. native viewport는 **첫 입력 전부터** 편집 영역 폭(최소 글꼴 크기×16)을 확보하고, 문서상의 advance만 별도로 계산한다. |
| 글꼴/크기를 바꿔도 유지해야 함 | codeFont의 family/size/row를 공유하고 같은 font/size/px line-height로 native offscreen text를 실측한다. text/font/size/height가 달라지면 측정을 갱신한다. native viewport를 측정 완료 후 뒤늦게 늘리는 경로에 의존하지 않는다. |

사용자가 최종 수정본을 직접 입력해 **‘아 잘된다’**고 확인했다. 부모도 실제 Herdr 실험 창에서 Helvetica21px로 물리 키 `d → k → s`를 입력해 밑줄이 있는 `ㅇ → 아 → 안`이 보이는 것을 관찰했다. 기본 JetBrains Mono14px와 큰 글꼴의 별도 실험 UI를 사용했고 사용자의 전역 글꼴 설정은 바꾸지 않았다. 이는 모든 임의 글꼴·OS·IME의 검증을 의미하지 않는다. 현재 코드 hit test는 기존 monospace measured-cell geometry를 재사용하므로 임의 비례 글꼴의 모든 문자 좌표까지 정확하다고 주장하지 않는다.

### 검사 범위와 아직 남은 일

- [T24 모델](results/T24-editor-buffer.md), [T25 입력](results/T25-editor-input.md), [T26 LSP](results/T26-editor-lsp.md), [T27 통합 검사](results/T27-checks.md)를 구분한다. native eager check는 실제 UI/IME의 증거로 대신 쓰지 않는다.
- 실제 TypeScript language server6.0.3과 별도 engine/임시 port에서 미저장 타입 오류→hover/definition→원문 수정→진단 갱신→close/legacy 복귀를 확인했다. 디스크 원문은 불변, 시험용 child process는 모두 종료했다. definition/references preview도 active buffer 원문을 사용하도록 교정했다.
- 실험 후 기본 파일 routing·SQL 편집기·설치 engine을 갱신했다. 실제 일반 파일 Cmd+S 저장과 같은 미저장 Markdown buffer의 미리보기를 확인했다. Preview에 포커스가 있을 때 Save가 누락되는 문제를 찾아 문서 전체 shortcut scope로 수정·설치했다(T33). 이 수정 후의 native Preview 저장 재검증과 SQLite 왕복은 남아 있으며 전체 완료로 묶지 않는다. completion·rename·format·multi-file edit는 현재 엔진이 제공하지 않는 기능이며 이번 기본 통합의 성공 항목으로 표시하지 않는다.

YAGNI는 현재 필요한 입력·선택·위치 이동·진단·저장·SQL 실행 범위를 구현하는 기준이다. KISS는 현재 GPUI/OS 입력을 재사용하고 앱 본체·DOM host를 추가하지 않는 기준이다. DRY는 라이브러리의 문서 구조와 기존 renderer·LSP·CAS·추출기·공통 UI를 공유하는 기준으로 적용한다.

## 구현 순서와 검증 기준

1. 자체 편집기의 기본 파일/Markdown·SQL 통합을 진행한다. 위에서 통과한 모델·입력·LSP를 연결하고 dirty/close·저장·선택 실행·원문/미리보기를 실제 모드에서 확인한다. 검증 전 codebench/미디어/원격 편집 경로는 제거하지 않는다.
2. 실행 소유권·실시간 출력의 P0를 수정하고 서로 다른 native copy·처음 여는 하단 결과·종료하지 않는 작업을 실제 앱에서 검증한다. 자동 검사 통과만으로 실제 출력 위치를 보장하지 않는다.
3. canonical 공통 surface·dialog·버튼·입력·관리 목록 역할을 정리한다. 프로젝트 선택기를 첫 caller로 사용해 이중 프레임과 위계를 교정한다.
4. 설정 페이지 제거·키맵과 연결/실행/프로젝트 관리 화면을 같은 시스템으로 맞춘다. 저장 경계·선택·검색·키보드·Cancel/Apply를 함께 확인한다.
5. SQL 실행 범위·하단 결과·표·추출/가져오기/DDL을 정리하고 로컬 SQLite로 편집·취소·실행·추출을 확인한다. 네트워크 DB별 기존 driver 검사는 별도로 유지한다.


설치 전 canonical 생성 검사와 관련 회귀·native eager 검사를 수행하고, 배치 설치 후 실제 UI를 관찰한다. 이 문서의 다른 감사 항목은 편집기 실험 통과만으로 해결됐다고 처리하지 않는다. 각 실제 모드 통합과 검증 결과를 별도로 갱신한다.

## 세부 근거

### 개발 재개 후 첫 배치

사용자의 ‘09 문서 정리 후 개발’ 지시로 자체 편집기·SQLBuffer 기본 routing, 미저장 LSP와 CAS 저장, 실제 owner로 Save/Preview 전달을 구현했다. 실행은 전용 core process와 하단 native terminal로 연결하고 프로젝트 선택기 단일 외곽·설정 잔재/키맵 목록도 정리했다. [T28 통합 결과](results/T28-owned-editor-integration.md)에 변경·검사·설치 범위를 기록했다.

모드와 engine 파일은 설치했고 자동/native eager 검사는 통과했다. HMR 메모리 부족과 잠금 이후 사용자가 창 앱을 재시작해 실제 검증을 재개했다. 일반 파일 저장·미저장 Markdown 미리보기와 하단 native 실행 출력을 관찰했다. 후속 사용자 보고로 도구 경계에 실제 6px native 조절 영역을 확보했고 좌우·왼쪽 상하·하단 드래그를 확인했다([T34](results/T34-tool-resize.md)). 앞선 IME 실험이나 일부 실제 확인을 전체 SQLite·DB 디자인 감사 완료로 간주하지 않는다. T33 native 재검증과 DB 디자인 나머지 항목은 남아 있다.

- [설정 잔재·키맵·목록 관리](results/T16-settings-cleanup.md)
- [DB 화면별 차이 26개](results/T17-database-design-alignment.md)
- [공통 시스템·프로젝트 선택기](results/T18-common-ui-audit.md)
- [실행 위치·실시간 출력·복구 오류](results/T19-run-routing-audit.md)
- [자체 편집기 구현 타당성](results/T20-editor-feasibility.md)
