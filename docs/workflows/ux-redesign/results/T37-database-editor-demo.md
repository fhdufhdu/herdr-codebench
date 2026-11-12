# T37-database-editor-demo

2026-11-06. root 구현·검사·설치 완료, 실제 SQLite 화면 왕복은 대기 중이다. 자동 fixture와 실제 UI 관찰을 구분한다.

## 구현

- idea SQL 문서는 연결 문맥→왼쪽 primary 실행 범위 선택/중지/저장→모드 소유 편집기 순서로 정리했다. 별도 블록 즉시 실행행은 제거하고 현재/선택/블록/전체/중첩 SQL의 기존 후보 모델을 재사용한다.
- 실행 범위 dialog는 공통 관리 목록과 정확한 SQL 원문 미리보기, 취소/선택 SQL 실행으로 구성했다. 선택·방향키는 실행하지 않으며 Enter/primary가 명시 실행한다. 중복 submit을 차단한다.
- 공통 grid는 idea에서 고정 header와 header/body 수평 offset을 공유한다. header와 앞60개 값의 표시폭으로88–320px 열폭을 정하며 큰 글꼴 행 높이를 반영한다. NULL·개행·typed 원본·행 선택·PK/충돌·키보드와 가상화는 유지한다.
- 중앙 table 문서는 제목/새로고침/DDL/삭제/가져오기/내보내기와 조건부 변경 반영 bar를 사용한다. 행 변경 중 page 이동과 busy 동작을 막고 로딩 중 이전 행은 유지한다. DDL은 같은 readonly 표시의 중앙 문서로 유지한다.
- 하단 SQL 결과는 job/statement별 공통 탭과 독립 결과 selection을 사용한다. 실행 SQL 토글·요약·한 내보내기 진입·선택 footer로 행동을 정리했다. Cmd+C/context의 형식 선택은 같은 extractor를 사용한다.
- 전송 dialog는 왼쪽250px 옵션/오른쪽 preview, 공통 native Select/Popup format·scope, 파일 입력과 footer 행동으로 정리했다. 파일 입력 변경은 reviewed import를 즉시 무효화하고 오래된 path/format 적용도 거부한다. 전체 table fetch·16MiB 한도·원본 파일 CAS·transaction은 유지한다.
- canonical `uiManagedList`는 action0개일 때 빈 toolbar를 만들지 않는다. 선택/키보드/스크롤은 기존 공통 controller를 사용한다. 생성 모듈을 sync로 갱신했다.
- codebench의 기존 native SQL editor·후보 popup·copy/format 버튼·전송 형식/범위·180px 열폭·행 높이 분기는 보존했다.

## 검사·설치

- `check_database_editor.mjs` 전체 통과. SQLBuffer input/선택 실행·저장 CAS·discard·typed 수정/NULL/충돌·pending Apply·선택 추출·전체 export·import preview/CAS·지연 응답·하단 독립 owner·다중 결과·복구·codebench를 포함한다.
- `check_database_ui.mjs`, `check_database_model.mjs`, `check_workspace.mjs`, `check_settings.mjs`, canonical `check_system.mjs`, sync `--check` 통과.
- `check_native_surfaces.py`18종 통과: 연결 관리(network/SQLite), tree, 실행 선택 dialog, extractor, export/import, grid/console, 실제 source/설정/갤러리 조립. native eager 검사는 실제 클릭 동작의 증거가 아니다.
- `herdr-app check mods/codenav`, `git diff --check` 통과. 파일을 batch 설치했다. HMR OOM으로 사용자가 창 앱을 재시작한 뒤 errors[]와 새 연결 관리 master/detail 실제 화면을 확인했다. DB 종류/파일 label의 불필요한 영어 줄바꿈도 줄였다.
- 실제 사용자 Docker 실행 출력이 하단 native 영역에서 보이는 것은 관찰했다. 사용자 process에는 입력·중지·재실행하지 않았다. 실행 수명 수정은T36, 반복 layout 갱신 성능 수정은T38에 분리했다.

## 잠금 해제 후 실제 검증

검증용 `Codebench UI check` 작업공간과 기존 disposable sample.sqlite를 사용했다. 실제 제품 DB의 기존 펼침 상태는 관찰만 했고 연결·SQL·수정 요청의 대상은 새로 만든 시험 SQLite profile로 한정했다.

- 연결 관리에서 추가→이름 입력→드라이버 selector의 End/Enter로 SQLite 선택→파일 경로 입력→연결 테스트 성공→프로필 저장을 실제 CUA로 수행했다. API로 새 id/driver/path 저장 결과를 확인했다. profile 이름은 `Codebench verification SQLite`다. 비밀번호는 입력하지 않았다.
- 중앙 SQLBuffer에 customers 조회와 COUNT 두 문장을 입력했다. 버튼 Save로 저장하고 실행 범위 dialog에서 전체 스크립트를 선택한 뒤 명시 실행했다. 하단 job의 결과1(3행)/결과2(1행)가 생성되고 원문 문서는 중앙에 남는 것을 확인했다.
- 중앙 customers table에서 Alice 셀을 double click해 `Verified Ada`를 입력하고 Enter로 stage했다. 변경1·반영/되돌리기 bar와 dirty tab을 관찰했다. 변경사항 적용을 클릭한 뒤 SQLite의 해당 row를 별도 read-only 조회하여 실제 persist를 확인했다. 원본은 시험 데이터다.
- 실제 native Input에서는 Cmd+S/⌘Enter가 얕은 문서 key context보다 native Input/global action에 먼저 잡히는 문제를 발견했다. T33에 Input depth alias를 추가했고 SQL도 같은 깊이 alias를 적용했다. 실제 query/transfer의 preview column은 h_flex 기본 items_center 때문에 세로 중앙으로 줄어들어 items_stretch/h_full로 수정했다.
- 두 수정과 누락된 Saved/Revert 번역을 한 배치로 설치했으나 Herdr HMR이 OOM/Null 오류로 실패했다. 사용자의 창 앱 재시작을 요청했다. 추가 수정 후의 실제 단축키·미리보기 배치, DDL/전송 UI 왕복, 자체 빠른 실행 최종 transcript 검증은 남아 있다. latest native eager18종은 통과했다.

새 SQLite profile/SQL draft는 후속 실제 검증을 위해 유지한다. 원래 제품 DB·Keychain credential·사용자 실행 process는 변경하지 않았다.
