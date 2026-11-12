# 통합 검증과 사용법

2026-11-05. 구현·6종 release·호스트 설치 완료. 엔진 버전 `0.1.0-a6a5556d9b5b`. 다섯 DB driver가 포함된 CGO 없는 실행 파일이며 호스트 arm64 실행 파일은 약17 MiB다. 별도 JVM/DB CLI/SQLite runtime 파일은 배포하지 않는다.

## 검증 결과

| 범위 | 실행과 결과 | 증명하는 범위 |
| --- | --- | --- |
| JS/UI 모델 | `design/idea/check_*.mjs` 전체24개 PASS | 기존 레이아웃·탭·키맵·진단 회귀와 새 SQL/model/UI 동작 |
| 편집기 | `check_database_editor.mjs` 19개 동작 사례 PASS | 정확한 선택/후보 원문, 단일 명령 소비, routine 원자 실행, 작업 폴링/취소, typed 원본/NULL/충돌, Cmd/Ctrl+C와 전체 선택, 공통 copy/export, 전체 페이지 순회, import snapshot, async 종료/역순 응답, null 파일·CAS 저장 |
| 디자인 | `sync_ui.py --check`, `check_system.mjs`, `git diff --check` PASS | canonical 생성물 일치와 공통 컴포넌트 계약 |
| Go | 실제5종 driver 포함 전체 `go test -race -count=1 -timeout=60s ./...` PASS(5.577s), `go vet ./...` PASS | 실제 SQLite lifecycle/transaction/rollback/catalog/DDL/정밀도 및 기존 Go 회귀. 원격 DB는 live 검증 아님 |
| 취소 회귀 | SQLite 취소 테스트10회 반복 PASS | VM 초기화와 겹친200회 취소 + 첫 행 이후 CPU 계산 중10회 취소. 이 근거로 SQLite driver를 ncruces로 선정 |
| Release | `engine/build.py`, `engine/check_release.py`, `engine/install.py --verify-only` PASS | macOS/Linux/Windows × amd64/arm64 6종 checksum·source identity. 호스트 실행·인증·기존 Spring 및 종료 동작 |
| 실제 HTTP | `python3 design/database/check_api.py --binary engine/dist/darwin-arm64/herdr-engine` PASS | Postman으로 실제 localhost 엔진에12개 요청. 메타데이터·비밀번호 비저장·401 인증·실제 SQLite 연결/쿼리/job/행 조회/수정/계층 DDL/삭제 |
| Native 렌더 | `herdr-app check` 총11개 PASS, 모두 stderr 없음 | codenav/activity와 독립 복사한9개 DB 상태의 eager native materialization. deferred 포인터/키 동작을 증명하지 않음 |
| 설치된 앱 | 실제 manager/stripe/data/console/후보/result/DDL 화면 확인, UI export 파일을 CSV로 재파싱해 PASS | 실제 SQLite 한글/NULL/다중 줄2행, 두 SQL 완료와2개 결과, 전체 database DDL, 파일 export 원문 보존 |

Native 최종 로그는 `/tmp/db-native-owned-vs7yp0xy/results.jsonl`이다. 화면은 `/tmp/herdr-db-manager-loaded.png`, `/tmp/herdr-db-layout-added.png`, `/tmp/herdr-db-grid-current.png`, `/tmp/herdr-db-query-picker-live.png`, `/tmp/herdr-db-query-result-live.png`, `/tmp/herdr-db-ddl-live.png`로 검사했다. 사용자 터미널이 포함되므로 저장소에 화면 바이트를 복사하지 않았다.

앱 검증으로 host 객체 인자의 중첩16단계 제한을 발견했다. 새 도구/편집기 삽입은 실제 `layout()` snapshot을 JSON 문자열로 공식 `herdr-app do layout.set`에 전달하여 해결했다. 새 콘솔 파일은 `readTextFile`의 null 반환을 처리하고, 저장/내보내기는 필수 expected snapshot을 전달한다. 테스트도 실제 native 계약을 반영했다. 일반 가상 목록/Editor 입력 이벤트는 plain wrapper에서 처리한다. 이런 문제는 eager check나 기존 HTTP mock만으로는 드러나지 않았다.

설치는 기존 모드를 백업한 뒤 파일을 묶어서 교체했다. 마지막 변경 백업은 `~/.config/herdr-app/data/native-ide-backups/database-grid-keys-20261105-105409`다. 앱/core를 재시작하거나 사용자 터미널을 종료하지 않았다. 검증용 SQLite 연결·draft·export 파일은 제거했다. 사용자 DB에는 연결하지 않았다.

Postman CLI의 `request`와 pm.test는 실제 실행했다. 설치된 CLI는 skill의 `postman status` 명령을 제공하지 않아 unknown command를 반환했다. 이 부가 명령을 성공했다고 기록하지 않으며, 계정 연결/외부 workspace publish는 수행하지 않았다.

## 사용

1. 오른쪽 **데이터베이스** → **+** 또는 관리 버튼에서 연결을 추가한다. 연결은 모든 작업공간에 공유된다. 비밀번호는 현재 엔진 세션에만 남는다.
2. 트리에서 테이블을 열어 셀 double click → 값/NULL → **변경사항 적용**. 미적용 변경은 Revert로 버린다. 충돌은 전체 transaction을 rollback한다.
3. 트리 메뉴의 **새 쿼리 콘솔**에서 SQL을 편집한다. **선택 및 실행** 모드에서 드래그한 원문이나 현재 구문을 대상으로 ⌘Enter 후보를 확인한다. **SQL 편집** 모드의 ⌘Enter는 구문 목록을 표시한다. 아래 블록 버튼으로 각각 실행할 수도 있다.
4. Cmd/Ctrl·Shift로 DB/schema/table을 함께 선택 → **DDL 생성**. 자손은 중복 제거하며 지원되지 않는 고급 정의는 경고로 표시한다.
5. 데이터 행 선택 → 추출기 선택 → **행 복사** 또는 ⌘C/Ctrl+C. 내보내기 창도 같은 추출기를 쓰며 선택/현재 페이지와 전체 테이블을 구분한다. CSV/TSV/JSON 가져오기는 미리보기 후 transaction으로 삽입한다.

## 남아 있는 검증 경계

MySQL/MariaDB/PostgreSQL/SQL Server의 실제 서버 연결·권한·버전별 DDL은 미검증이다. 빌드 성공을 실제 서버 호환성 검증으로 부르지 않는다. 네이티브 포인터/키 자동화와 실제 데이터 셀 수정/import 버튼 클릭은 수행하지 않았다. 해당 경로는 native materialization + JS 동작 테스트 + 실제 backend transaction으로 나누어 검증했다. 정확한 IntelliJ PSI 수준의 SQL 분석, 고급 DDL 전체 복제, XLSX/사용자 코드 추출기와 대용량 스트리밍은 범위에 포함하지 않는다. [현재 제약](02-requirements.md)을 함께 참조한다.
