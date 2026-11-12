# T21–T23 단일 편집기 상세 검토

2026-11-06. 실행 범위는 검토·계획이며 제품 코드 구현은 아니다. 사용자의 목표는 편집기·뷰어와 일관된 UI/UX 및 수정 중 LSP를 하나의 editor에 통합하고, 검증 후 source viewer 역할을 제거하는 것이다. YAGNI·KISS·DRY와 라이브러리 재사용을 기준으로 이전 native 확장안도 재평가한다.

분담은 native/회귀 범위(T21), LSP source pipeline(T22), 상위 공식 라이브러리·배포본 및 통합 보고(T23/부모)다. 하위 검토는 기존 medium 설정을 유지한다. 현재/필요 기능을 소스로 구분하는 조사이며 제품 범위를 임의로 구현하지 않는다. 하위는 지정 결과 문서만 소유하고 부모가 요구사항·진행·결정을 통합한다.

완료 기준:

1. caret/selection/reveal·진단·IME/undo·저장·탭/Markdown·SQL 선택 실행·기존 source 기능과 runtime 한계를 연결한다.
2. disk 기반 LSP와 미저장 buffer 동기화, 새 언어 편집 기능·revision/identity·stale 진단·edit/undo 부족을 분리한다.
3. native 확장/Textarea/직접 구현/웹 라이브러리의 조건과 비용을 근거로 비교한다. upstream 기능과 설치 binding을 혼동하지 않는다.
4. 실제 host/dependency가 미확정인 부분을 명시하고 viewer 제거 전 native·언어·저장 회귀의 통과 기준을 정의한다.
5. 소스·설치·실제 사용자 데이터/서버/실행은 변경하지 않는다. source review를 실제 IME/LSP 실행 검증으로 보고하지 않는다.

결과: [통합 검토](../10-unified-editor-review.md), [T21](../results/T21-editor-native-deep-review.md), [T22](../results/T22-editor-lsp-pipeline.md), [T23](../results/T23-editor-library-review.md).
