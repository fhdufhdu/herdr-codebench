# Database tools

2026-11-05. 사용자 지정 12개 기능을 구현하고 앱에 설치했다. 초기 지원은 사용자 확인대로 **MySQL·MariaDB·PostgreSQL·SQL Server·SQLite 모두**다. YAGNI/KISS/DRY를 적용하여 기존 엔진·탭·Source viewer·공통 IDEA 컴포넌트와 추출기를 재사용한다.

| 태스크 | 상태 | 결과 |
| --- | --- | --- |
| D01 shipped artifact 조사 | 완료 | [REA와 정적 근거](01-artifact-research.md), 전역 관리·실행 후보·계층 DDL·공통 추출기 흐름 |
| D02 Go 데이터 서비스 | 완료 | [구현 결과](D02-result.md), 5종 driver, global metadata, catalog, query jobs/cancel, transaction, DDL |
| D03 연결 관리·Database 트리 | 완료 | [구현 결과](D03-result.md), 공통 UI·전역 관리·lazy tree·혼합 선택 메뉴 |
| D04 SQL/데이터 viewer·추출기 | 완료 | [요구사항](02-requirements.md), [구조](03-architecture.md), [순수 모델](D04-model-result.md) |
| D05 통합/검증 | 완료 | [통합 검증과 사용법](05-verification.md), JS 24개 suite·Go race/vet·Postman·6종 release·native 11개·실제 앱 |

실제 사용자 DB와 스크린샷의 서버를 재사용하지 않았다. 소유한 임시 SQLite로 검증했다. 원격 MySQL/MariaDB/PostgreSQL/SQL Server는 driver 빌드와 모델 검증을 통과했지만 실제 서버 연결은 미검증이다. native 포인터 자동화는 사용하지 않았다. 세부 제약은 요구사항과 검증 문서에 구분한다.

현재 변경은 작업 트리에 있으며 이 DB 작업의 커밋/푸시는 수행하지 않았다.

2026-11-05 후속: 실제 IntelliJ CUA·키체인·프로젝트 순서·셀 편집 UX의 [후속 기록](ux/00-progress.md). 초기 검증과 구분한다. 후속 실제 UI 검증은 아직 진행 중이다.
