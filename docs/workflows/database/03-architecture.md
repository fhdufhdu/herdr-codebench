# 구조와 UX

`Database/DatabaseManager`는 전역 프로필과 lazy 탐색을, `DatabaseEditor`는 작업공간별 콘솔·DDL·그리드와 작업 진행을 소유한다. 엔진의 `databaseManager`는 프로필·pool·bounded job·dialect catalog·transaction을 소유한다. 기존 token-auth transport를 재사용하되 DB 쓰기는 응답이 끊겨도 자동 재전송하지 않는다.

새 문서는 기존 editor-stack에 한 child만 추가하고 기존 탭/패널 크기·순서·터미널을 보존한다. Source viewer와 DB SQL viewer는 같은 CodeView/Scroller/editor-surface로 형태·폰트·구문·선택을 공유한다. 명령 큐는 포함하는 DatabaseEditor 한 곳에서만 읽는다. 편집 가능한 native Editor는 읽기 전용 viewer와 같은 문서 버퍼를 사용한다.

UI 상태 흐름:

1. 오른쪽 Database → 추가/관리 → 전역 프로필 작성 → 필요 시 연결 테스트 → 저장. 비밀번호는 masked이며 디스크 응답에 포함하지 않는다.
2. 연결 펼치기 → database → schema → table/view → columns. 탐색 중 로딩/오류/빈 상태를 구분한다. Cmd/Ctrl·Shift 선택, 키보드 이동, 오른쪽 메뉴가 같은 selection snapshot을 사용한다.
3. table 열기 → 데이터 탭. 셀 double click → 값 또는 NULL 설정 → 변경 표시 → Apply transaction/충돌 rollback 또는 Revert. 페이지 전환은 진행 중이거나 미적용 변경이 있으면 막는다.
4. SQL 콘솔 → 편집/선택 모드 → 블록 실행 또는 ⌘Enter 후보 → 실행 → 경과/결과 탭 → 취소. 성공/오류 후 실행 결과는 순서대로 보존한다.
5. 혼합 객체 선택 → DDL 생성 → SQL 탭. 지원 범위 경고를 SQL과 함께 확인할 수 있다.
6. 행 선택 → 추출기 선택 → 복사. Export dialog도 같은 추출기로 preview/clip/file을 만든다. table 전체는 페이지를 끝까지 읽는다. Import는 열 이름/형식/원문 snapshot을 검토하고 변경된 파일은 다시 preview해야 한다.

공통 메뉴는 MenuController/native popup bounds를 사용한다. 가상 목록/Editor의 일반 입력 이벤트는 실제 GPUI가 소유한 plain wrapper에 등록한다. 색·버튼·입력·행·대화상자는 생성된 IDEA 공통 모듈을 사용하며 툴 제목은 registry의 shared header 한 곳이다. 새 root gap이나 자체 애니메이션 타이머는 추가하지 않는다.
