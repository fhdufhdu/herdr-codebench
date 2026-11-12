# 설계·공통 계약

2026-11-06 최신 방향은 [ADE 재구성 제안](12-ade-rebuild-plan.md)이다. 아래 ‘기존 API/화면 로직 재사용·점진 수리’ 중심 설계는 이전 기록으로 남긴다. 새 화면은 승인 데모에서 조립과 상태·이벤트·탐색 흐름을 새로 설계한다. 제품 우선순위는 ADE 틀과 핵심 작업 흐름이며 DB는 후순위다. runtime/검증된 라이브러리와 사용자 저장 데이터는 기존 화면 내부 로직 보존과 구분한다.

## 이전 설계 기록

기존 `design/idea/tokens.json`·`ui.js`와 생성 경로를 재사용해 점진적으로 교체한다. 새 설계는 이 브랜치에서 이전 IntelliJ 외관 정합 목표보다 우선한다. 경로와 `IDEA` export 이름은 기존 호출부 호환을 위해 유지한다.

## 공통 시각 체계

중성 배경 3단계와 단일 파랑 accent를 사용한다. 중앙 문서 배경은 가장 낮은 단계, 도구 영역은 한 단계 위, 팝업은 가장 높은 단계다. 각 패널을 구분하는 얇은 경계와 작은 모서리를 사용하고 기존 도킹 구조·사용자 크기는 보존한다. 활성 탭과 도구는 배경에 더해 선으로 표시한다.

`tokens.json`의 `herdr.ux`가 새 의미 색·밀도의 원본이다. 기본 UI는 13px, 보통/compact 목록 30/26px, 입력 32/28px, 도구 제목 36/32px, toolbar 44/36px, 아이콘 16px와 탐색 20px다. 수치는 제품 설계 선택이며 UX 표준의 의무치로 주장하지 않는다. 클릭 영역은 glyph와 분리하며 공통 컴포넌트에서 최소 24px를 보장한다.

색 역할은 foreground·secondary·disabled·border·separator·hover·selection·focus·accent·error·success·warning을 쓴다. 중요한 텍스트·상태·포커스는 대비 검사로 확인한다. busy·empty·error·dirty를 실제 상태에서 표현한다. primary는 문맥의 한 주요 행동에만 사용한다.

## 아이콘 계약

`design/idea/icons.json`과 `icons/`의 필요한 Lucide subset이 원본이다. 24×24 viewBox, stroke2, round, currentColor로 통일한다. sync가 모드별 `ui-icons.js`와 로컬 자산을 생성하고 `--check`가 동기화·경로·alias를 검증한다. `uiIcon(role,size=16)`은 매번 fresh native SVG element를 반환하고 unknown role은 실제 general action glyph로 fallback한다. 기존 icon·toolImage 이름은 alias로 호환한다. action label은 기존 소유자가 번역·tooltip·접근성 이름에 재사용한다. 사용자 Program.icon/tint와 콘텐츠 이미지는 별도 identity 계약을 유지한다.

## 문서·편집

현재 일반 파일의 소스·LSP 탐색과 편집 진입은 보존한다. 사용자는 2026-11-06 최종 목표를 단일 편집 UI·미저장 LSP로 구체화했다. 권장 방향은 기존 native Editor 입력 엔진과 EditorPane 수명, 기존 Go LSP client를 재사용하고 필요한 host 능력과 문서 동기화를 연결하는 것이다. 현재 설치 binding과 disk 기반 semantic sync는 이 목표를 충족하지 않으므로 구현 완료로 간주하지 않는다. [심화 검토](10-unified-editor-review.md)의 native/언어/제거 gate를 통과한 뒤 idea의 source 전용 ownership을 제거한다. codebench·SQLViewer 사용처·비텍스트/diff/review 경계는 별도 보존한다.

Markdown은 같은 native buffer·undo·dirty를 기준으로 편집/미리보기 전환을 제공한다. 현재 소스 화면의 원문/미리보기도 통합 전에는 유지한다. 눈 아이콘 대안은 명시적 모드 label로 현재 상태와 가능한 행동을 읽을 수 있게 한다.

## DB

기존 API·driver·extractor·PK optimistic transaction을 재사용한다. 이번 구현은 Apply 중 mutation 금지와 상태 설명, 현재 연결·실행 원문·결과·추출 범위를 드러내는 UI에 한정한다. 여러 Run에 걸친 manual transaction, DML SQL preview와 export snapshot 보장은 별도 엔진 설계가 필요한 개선안으로 구분한다.

## 승인 시안의 실제 모드 통합

`uiManagedList`는 상단 툴바·선택 목록·선택 스크롤·키보드를 공유하고, draft/CRUD/저장·취소는 원래 소유자에 둔다. native 아이콘은 factory다. Projects 직접 지정은 별도 대화상자의 코어 순서 초안이며 Apply 전에 space.move를 보내지 않는다. DB 연결 삭제/개별 Save는 기존 확정 동작을 유지하며 목록 순서는 metadata만 별도 저장한다. 설정의 도구 위치는 5개 슬롯이고 같은 슬롯 내의 순서와 다른 위치로의 이동은 별개다.

`execution-results.js`의 workspace별 snapshot이 현재 선택된 소스 문서와 독립적으로 실행 결과를 보관한다. `RunResults`는 DatabaseEditor의 기존 grid/extractor/transfer 동작을 재사용하되 selected/format/resultIndex를 별도로 소유한다. 공통 tool header가 제목/중지/숨김을 소유한다. SQL 실행 원문은 필요할 때 펼친다. app 재로딩·중단 후 실행 기록의 수명은 검증 기록에서 별도 관리한다.
