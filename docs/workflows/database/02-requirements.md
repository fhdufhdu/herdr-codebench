# 요구사항과 구현 기준

초기 지원은 사용자 확인에 따라 MySQL·MariaDB·PostgreSQL·SQL Server·SQLite 모두다.

| 요청 | 구현/수용 기준 |
| --- | --- |
| 1 DB 연결 | driver별 Go native driver, TLS, 저장 전 연결 테스트, 실제 실패 메시지 |
| 2 전역 DB 관리 | source id 기반 전역 프로필, workspace 변경에도 공유, CRUD. macOS 비밀번호는 키체인 저장, 다른 OS는 세션 보관; 실제 저장 상태 표시 |
| 3 테이블 보기/수정 | lazy catalog, 페이지 조회, 셀 편집/NULL/삭제를 로컬 버퍼에 보관하고 Apply/Revert |
| 4 쿼리 진행 | queued/running/completed/error/cancelled, 실제 블록 번호·경과 시간·취소. 임의 퍼센트 없음 |
| 5 블록 실행 | dialect를 고려한 SQL 범위 분리, 블록별 실행 버튼, 클라이언트 DELIMITER/GO 처리 |
| 6 선택 실행 | 기존 Source viewer의 실제 드래그 범위를 그대로 후보로 사용 |
| 7 ⌘Enter 실행 후보 | 현재 구문/안전하게 추출 가능한 중첩 SELECT/전체 스크립트 후보. 원문 범위를 표시하고 확인 후 실행 |
| 8 데이터 viewer 탭 | workspace별 DB 전용 문서 탭, 기존 source/review 탭과 이웃/닫기 동작 공유, PK 기반 optimistic transaction |
| 9 테이블 DDL | DB catalog/원본 SHOW CREATE 기반 DDL 문서와 복사. 지원하지 않는 고급 속성은 경고 |
| 10 혼합 계층 DDL | source 내 DB/schema/table 복수 선택, 부모 우선 재귀, 자손 중복 제거, MySQL database 생성부터 출력 |
| 11 행 추출 | CSV/TSV/JSON/SQL INSERT/UPDATE/WHERE/Markdown/HTML/XML 공통 추출기; NULL·다중 줄·큰 정수·binary 보존 |
| 12 가져오기/내보내기 | 11번 추출기로 미리보기·클립보드·파일 출력. CSV/TSV/JSON 열 이름 미리보기 후 transaction으로 import |

## 명시적인 범위

- 현재 native EditorState는 selection/caret getter가 없다. SQL 콘솔은 기존 Source viewer의 `선택 및 실행` 모드와 native `SQL 편집` 모드를 사용한다. 편집 모드의 ⌘Enter는 실제 구문 목록을 보여주며, viewer 모드는 정확한 드래그/현재 위치를 사용한다. 없는 host API를 호출하거나 위치를 추측하지 않는다.
- 기본 200행, 페이지 최대1,000행. query 결과 제한과 truncation을 표시한다. import는 transaction당1,000행. table 전체 export는 페이지를 순회하며16 MiB를 넘으면 명시적으로 실패하고 일부 파일을 성공으로 쓰지 않는다. 대용량 스트리밍/바이너리 XLSX/사용자 코드 추출기는 범위 밖이다.
- PK 없는 테이블은 조회·export·새 행 import 가능, update/delete는 차단한다. 생성 열 할당이나 타입별 비교가 불가능하면 DB 오류와 rollback을 보여준다.
- DDL은 database clone/권한·소유자·고급 vendor 객체 전체 복원을 보장하지 않는다. 누락과 재접속 필요를 warnings로 표시한다.
- SQL Server schema 선택은 login default schema를 변경하지 않는다. SQL의 schema 수식이 필요하다.
- 사용자 스크린샷의 연결/DB/계정은 조사·테스트 대상으로 사용하지 않는다. 새 UI는 실제 사용자 DB 변경을 자동 실행하지 않는다.
