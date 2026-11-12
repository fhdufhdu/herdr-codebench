# 실제 IntelliJ IDEA / SQLite 관찰

2026-11-05. 대상은 Herdr의 idea 레이아웃과 구분되는 실제
`/Applications/IntelliJ IDEA.app` (`com.jetbrains.intellij`), 열린 프로젝트
`datagrip`이다. Computer Use로 직접 연결·수정·실행·내보내기를 수행했다.
사용자의 기존 원격 데이터 소스에는 쓰기 작업을 하지 않았다.

`design/database/make_ux_fixture.py`가 만든 전용
`/private/tmp/codebench-db-ux-tntkuejb/ux-lab.sqlite`와
`Codebench UX Lab (SQLite)` 연결을 사용했다. customers 240행 외에 복합 PK,
PK 없는 테이블, BLOB, generated column, view, update trigger가 포함된다.

| 흐름 | 실제로 확인한 결과 | Herdr 반영 |
| --- | --- | --- |
| 연결 관리 | SQLite 파일 경로, 자동 URL, Test Connection 성공 팝업, 저장 후 source/console | 전역 profile과 테스트/저장 분리 유지 |
| 데이터 열기 | source → main → Tables → customers, ⌘↓로 데이터 탭 열림 | 더블클릭 유지, ⌘↓ 추가. 더블클릭도 같은 뷰를 연다는 사용자 확인 반영 |
| 셀 편집 | F2로 name 편집, Return 후 다음 행으로 이동하며 변경 셀 표시 | 방향키·Home/End·Enter/F2·Escape, focused cell 테두리, 변경 셀 표시 |
| 제출 | DML 미리보기에서 `UPDATE customers SET name = ... WHERE id = 1`, Submit 후 실제 DB 반영 | 값 staging과 DB Apply 분리 유지. DML 미리보기 추가는 이번 범위에 포함하지 않음 |
| 표시 | PK 열 아이콘, 숫자 오른쪽, NULL은 dim, 빈 문자열은 빈칸, 줄바꿈 ↵ | PK 표시·숫자 정렬·줄바꿈 ↵. 편집/복사 원문 유지 |
| 실행 후보 | 두 statement가 있는 SQL에서 ⌘Enter 팝업, 후보 선택 후 첫 쿼리만 실행 | 원문 범위 기반 후보 유지; native editor caret 미노출 제약 명시 |
| 선택 실행 | `SELECT COUNT(*) AS total FROM customers;` 범위 선택 후 ⌘Enter, 결과 240 | Source viewer의 정확한 범위 실행 유지 |
| 결과/진행 | 실행된 범위 녹색 외곽선, 경과 시간, 독립 결과 그리드/출력 로그 | 실제 job 상태/경과 시간·취소 유지 |
| DDL | 테이블 툴바 DDL로 customers (DDL) SQL 탭 | 테이블 우클릭에도 DDL 진입 추가 |
| 추출기 | CSV 메뉴에 Insert/Update/Where, 계산/생성 열 옵션, TSV/JSON/Markdown/XML 등 | 기존 공용 추출기 유지, 그리드 우클릭에 선택·복사·내보내기 연결 |
| 내보내기 | 첫 10행 preview, NULL/빈 문자열 CSV 구분, multiline quoting, 파일/clipboard 목적지 | 공용 미리보기·형식 선택 유지 |
| 페이지 | 240행은 일반 행 수, 큰 결과는 현재 범위와 다음 페이지 | 테이블 페이지를 query truncation 경고로 표시하던 부분 수정 |

실제 제출 후 SQLite 값과 audit trigger를 별도 조회해 확인했다. IDEA가 작성한
`idea-customers.csv`는 240행이며 Unicode와 multiline이 보존됨을 CSV parser로 확인했다.
이는 실제 UI 동작의 결과 검증이며 모의 화면의 출력이 아니다.

정적 구현 근거와 원본 해시는 [REA 후속](rea-followup.md)에 따로 기록했다.
공유 extractor API나 기본 keymap 선언을 실제 실행 증거로 대신하지 않는다.

미확인 범위: IDEA에서 여러 DB/schema/table을 함께 선택한 DDL 생성,
실제 import 완료, 장시간 쿼리 취소는 이 조사에서 끝까지 실행하지 않았다.
드래그 시도 한 번은 의도하지 않은 SQL 일부가 선택되어 SQLite 문법 오류를
반환했고, 이후 접근성으로 정확한 범위를 선택해 240 집계 성공을 확인했다.
그 결과를 드래그 성공으로 기록하지 않는다. IDEA에는 사용자 IdeaVim 설정이 활성화돼 있다.

추출기 메뉴 조작 중 접근성 조회가 timeout 되었고 사용자가 IDEA를 강제 종료한 뒤
재연결했다. 이후 DDL/CSV는 성공했으며 후속 셀 메뉴 조회는
`noWindowsAvailable`을 반환했다. 원인은 확인하지 않았으며 앱을 임의로 재시작하지 않았다.

Herdr CUA의 stale app binding을 다시 가져온 뒤 프로젝트 팝업 클릭을 재개했다.
실제 진입점이 하단 이동 도구 모음 높이를 예약하지 않아 잘리던 문제를 수정하고,
이름순·최근 사용순·직접 지정 전환, 단축키/버튼 이동과 재열기를 확인했다.
프로젝트의 실제 확인 근거는 [U01 결과](results/U01-result.md)에 기록했다.
데이터베이스 수정본의 실제 Herdr 상호작용 검증은 이어서 확인한다.
