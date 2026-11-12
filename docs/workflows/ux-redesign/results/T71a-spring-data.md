# T71a · Spring Data source 후보

상태: 구현·전용 자동 검증 완료, 상위 통합 검토 대기. 상위에서 상속한 모델과 high effort로 수행했으며 별도 모델 변경은 없다. parser의 generic 경계와 간접 상속 오인을 확인하는 데 high를 사용했다. [태스크](../tasks/T71-navigation-pool.md)의 R1과 R2용 메타데이터 부분을 담당했다.

## 변경

- `engine/spring.go`: 인터페이스가 정확한 qualified Spring Data 기본 타입으로 이어지면 소스 선언을 bean 후보로 제공한다. JPA의 `JpaRepository`와 Commons의 Repository/CRUD/list/paging/reactive/coroutine 기본 인터페이스를 지원한다. 명시적 import, Kotlin import alias와 fully qualified 이름을 사용하며 이름의 접미사나 단순 이름 일치로 추정하지 않는다.
- 현재 프로젝트의 중간 인터페이스를 재귀 탐색하고 순환을 차단한다. generic 선언의 `extends`/`:`가 실제 상위 타입으로 잘못 파싱되지 않도록 angle 경계를 구분했다.
- 정확한 Spring Data `@RepositoryDefinition`도 지원한다. `@NoRepositoryBean`은 해당 인터페이스의 등록을 제외하고 자식 인터페이스의 상속 판단은 유지한다. 일반 클래스 구현은 자동 repository 후보로 만들지 않는다.
- detail과 직접 저장소 marker title에 `dynamic proxy source candidate`를 표시한다. 명시적 stereotype의 이름, qualifier, primary와 conditional 메타데이터를 보존하고 기존 `spCandidates` 선택 경로를 재사용한다. 동일 후보가 중복 등록되지 않는다.
- 후보는 index 조립 단계에 추가하며 공유된 cached `spFile.beans`를 변경하지 않는다. bean → injection 역방향 탐색도 조립된 index 후보를 사용한다.
- R2에서 재사용할 `spClass.interfaceType bool`, `file *spFile`, `methods []spMethod`를 추가했다. methods는 선언 위치·기존 parameter token을 보존하고 Java/Kotlin 생성자를 제외한다. 구현 fallback과 main/lsp 변경은 상위 소유다.
- `engine/spring_test.go`: Java/Kotlin 직접·간접 상속, alias/FQN, RepositoryDefinition, 제외된 중간 기반, 동명 일반 interface, 순환, 비주석 클래스, qualifier/primary/collection, 역방향 탐색, 미저장 index 격리와 클래스/메서드 메타데이터를 검증한다.

## 실행한 검증

- `cd engine && go test ./... -run '^TestSpring' -count=1` 통과.
- `cd engine && go test -race ./... -run '^TestSpring' -count=1` 통과.
- 실제 `/Users/estsoft/project/altools/altools-api-alsong`에서 `LyricService.kt`의 `lyricRepository` 주입으로 `springRelated`를 호출하는 임시 테스트 통과. 결과는 `LyricRepository.kt:11` 한 개였고 detail은 `Spring Data repository · dynamic proxy source candidate`였다. 실제 파일은 읽기만 했으며 절대 경로를 담은 임시 테스트는 제거했다. 업무 프로젝트 build, 의존성 다운로드, 실행/쿼리는 하지 않았다.
- `git diff --check -- engine/spring.go engine/spring_test.go` 통과. 전체 Go/race·UI·설치 검증은 상위 통합 범위다. 이번 작업은 mod를 변경하지 않는다.

## 근거와 한계

[Spring Data 공식 문서](https://docs.spring.io/spring-data/jpa/reference/data-commons/repositories/definition.html)는 Repository 상속과 RepositoryDefinition을 정의 방식으로 설명하고, 공통 기반 인터페이스의 NoRepositoryBean 및 자식 저장소를 구분한다. 이를 bounded source 후보 판단에 적용했다.

실제 repository scanning scope, 다중 store의 결합, profile/조건 평가나 실행 중 proxy의 생성 여부는 증명하지 않는다. wildcard import와 classpath 전용 사용자 기반 interface는 기존 bounded parser 범위 밖이다. marker는 단일 파일을 파싱하므로 다른 파일을 거치는 간접 저장소의 자체 marker는 추가하지 않지만, 프로젝트 bean 목록과 주입 대상 탐색은 전체 index에서 이를 인식한다. 기존 generic injection의 erased/multiple 선택 규칙과 중첩 generic wrapper 해석 한계는 변경하지 않았다.

## 상위 확인 사항

상위 구현 fallback은 새 클래스 메타데이터를 사용해 실제 상속 관계를 검증해야 한다. Spring Data 후보는 동적 proxy의 소스 정의이며 Java/Kotlin 구현 클래스가 존재한다는 뜻은 아니다. 상위는 전체 통합 검사와 실제 ADE 탐색 화면 확인 후 T71 완료 여부를 판단한다.
