# T71 · Spring Data 탐색·구현체·분석 풀

구현·설치·통합 검증 완료. [통합 결과](../results/T71-navigation-integration.md). 기존 문서 기반 개발 흐름을 이어간다.

R1: LyricRepository는 JpaRepository를 상속하는 무주석 인터페이스. Spring Data proxy 빈 후보를 소스 선언으로 찾고 동적 후보임을 표시한다. NoRepositoryBean·동명 일반 interface 오인 제외.
R2: Java/Kotlin interface 구현 탐색이 LSP 빈 결과/미지원일 때 import·상속 관계 기반 현재 프로젝트 소스 후보를 제공한다. 모든 이름 일치만으로 구현체라고 하지 않는다. 기존 LSP 결과 우선, revision 보호와 외부 소스 기능 유지.
R3: 한정된 LSP pool에서 사전 준비 보류를 실제 서버 오류로 표시하지 않는다. 보류 문맥이 foreground로 준비되면 status 반영. 무제한 프로세스/활성 서버 반복 종료 금지.

분담: T71a high는 engine/spring.go, spring_test.go만 수정하고 Spring Data 빈 인식 및 후속 구현 탐색에서 재사용 가능한 source class 메타데이터 검토. T71b high는 engine/lsp.go, project_analysis.go, project_analysis_test.go와 mods/ade/project-analysis.js만 수정해 pool 수명과 보류 상태 계약을 정리. 현재 상위는 implementation request fallback·통합·배포·실제 검증을 담당하며 공유 main.go는 상위만 수정. 두 high는 parser 상속/오인 방지와 동시 pool eviction 불확실성 때문에 선택.

검증: 소유 Spring Data/일반 Java/Kotlin 상속 fixture, 실제 업무 소스 read-only Spring 탐색, Go 전체/race, pool 보류→파일 준비→상태 회복, stale buffer guards, ADE mod/system 검사. 업무 프로젝트 빌드/패키지 다운로드/쿼리 실행은 하지 않는다.


## 사용자 변경 요청 반영

- 프로젝트 사전 준비·주기적 상태 요청·기존 UI 모듈/검사를 제거하고 현재 파일 분석 UI로 교체했다. 언어 서버가 정의·참조를 해석하는 프로젝트 root 자체는 유지한다. legacy engine project endpoint는 다른 클라이언트 호환성만 보존하며 ADE가 자동 호출하지 않는다.
- 선택한 파일만 분석 lease를 유지한다. 비활성 문서 원문·편집 상태는 캐시하지만7개 inactive lease/heartbeat 캐시는 제거했다.
- 후속 owner conflict를 T71c로 분리: 같은 owner의 close single-flight, known-retired cleanup idempotency, exact-owner release gate, 엔진 세대별 cleanup guard. unknown owner나 다른 현재 owner의 강제 종료는 허용하지 않는다.
