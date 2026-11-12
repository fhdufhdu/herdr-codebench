# T71 · 파일 분석·Spring 탐색·소유권 통합

2026-11-09. 전체 진행 완료. YAGNI/KISS/DRY, Herdr 앱 Rust 수정 없음. 변경 전 existing dirty tree를 유지하고 별도 commit/push는 하지 않았다.

## 최종 동작

- 사용자 요청에 따라 프로젝트 사전 준비를 제거했다. 새 file-analysis 모듈은 엔진 polling/timer 없이 현재 선택 파일의 기존 LSP 상태를 읽고, 다시 연결은 그 파일의 편집기로 전달한다. 기존 project-analysis UI 모듈과 검사를 제거했다. 파일을 열 때 서버 연결을 시작하며 inactive 문서의 lease는 해제한다. 원문/미저장 상태는 그대로 캐시한다. 서버 프로세스의 프로젝트 root는 정의·참조 해석에 필요하므로 유지한다.
- Spring Data JpaRepository 등 정확한 framework 상속 계열을 빈 후보로 인식하고 실제 인터페이스 선언으로 이동한다. NoRepositoryBean·동명 일반 타입은 구분하고 proxy source candidate로 표시한다. 동적 Repository의 gutter는 존재하지 않는 구현 클래스 대신 주입 사용 위치를 연다. [T71a](T71a-spring-data.md).
- 일반 Java/Kotlin 구현 탐색은 LSP 응답 우선. 빈 응답 또는 미지원일 때 기존 bounded source index의 import·상속 관계로 프로젝트 후보를 제공한다. 클래스/타입 선언과 유일한 이름의 선언 멤버를 지원하며 오버로드 추측은 하지 않는다. 후보 표시는 runtime 확정과 구별한다. 미저장 현재 원문과 snapshot/revision envelope를 보존한다.
- 풀 한도3은 유지하고 lease·pending RPC·초기화 서버를 교체하지 않는다. idle 프로세스는 종료를 기다린 후 대체한다. legacy project endpoint의 capacity는 deferred로 구분하되 ADE에서 이 사전 준비 경로를 활성화하지 않는다. [T71b](T71b-analysis-pool.md).

## 반복 owner conflict 원인과 수정

일반 LSP sync 실패와 달리 screenshot의 raw owner conflict는 새 세션 생성 전 이전 close gate에서 발생할 수 있었다. 중복 close A 중 첫 요청 성공→새 B 소유→두 번째 close A가 B와 비교되어 실패하는 순서를 재현했다. 이미 retired인 A의 close는 즉시 성공시키며 B의 본문·revision·소유권은 건드리지 않는다. never-seen 다른 owner close는 계속 거절한다.

클라이언트 close는 같은 pending Promise를 공유한다. 이전 owner 정리가 실패하면 리뷰가 새 owner를 만들지 않으며 같은 정확한 이전 세션만 재시도한다. review 비활성화는 file activation보다 먼저 실행한다. 이전 엔진의 cleanup은 검증된 새 엔진에 전송하지 않는다. [T71c](T71c-owner-handoff.md).

## 검증

- Go 전체 및 전체 race 통과. source implementations의 qualified Java/Kotlin 상속·동명 충돌·멤버·overload 거절·미저장 원문·취소와 실제 stdio fallback snapshot 보존 검사 통과. Spring Data 및 pool 동시성/lease/pending 보호는 하위 기록 참조.
- JS current-file status(no project requests), gutter/review, LSP recovery, exact-owner cleanup/single-flight, editor leases/host, 메뉴, shared design system 및 generated 사본 일치 검사 통과. 기존 recovery 검사의 최초 파일 debounce250ms 가정을 현재0ms 계약에 맞춰 갱신했다. mod check ADE/codenav/activity 통과.
- 기존 설치 엔진에서 PlaylistDocs→PlaylistController는 이미 정상 LSP 결과였다. 변경 후에도 실제 API 결과 PlaylistController.kt:23 확인. LyricCommandService의 lyricRepository는 이전0개→새 LyricRepository.kt:11 하나로 확인했다. 실제 업무 소스는 read-only 요청했고 업무 파일 저장·빌드·쿼리 실행은 하지 않았다.
- 최종 설치 엔진의 소유 임시 fixture에서 A 해제→B 소유→A 재해제 성공, B touch/revision 유지, 알 수 없는 C 해제 거절, 늦은 A sync 거절을 실제 HTTP API로 확인했다. 소유 fixture/lease 정리 완료.
- 실제 창의 동일 LyricCommandService 분석 팝업이 owner conflict에서 LSP 준비됨으로 회복된 화면을 shot으로 확인했다. 사용자 작업을 옮기거나 소스 입력을 하지 않았다. 실제 gutter 클릭 이동의 마지막 native 검증은 별도로 주장하지 않는다.
- 최종 engine 0.1.0-6136907d549b, owned runner t5p 유지. ADE backup1794214411668691000.6개 플랫폼 build/install verify 통과. 창/터미널 core 재시작 없음.

## 한계

Spring source index는 runtime Spring context가 아니며 profile/conditional 판정, wildcard import, 일반 메타 annotation 확장에는 제한이 있다. 소스 구현 후보 fallback은 현재 Java/Kotlin 프로젝트의 선언 기준이며, 복잡한 generic overload·임의 receiver method call·외부 binary 구현은 LSP에 의존한다. 다른 파일의 미저장 상속 수정까지 전체 overlay index로 결합하지 않는다. 실제 다른 창/편집기가 소유하는 활성 lease는 강제로 탈취하지 않는다.
