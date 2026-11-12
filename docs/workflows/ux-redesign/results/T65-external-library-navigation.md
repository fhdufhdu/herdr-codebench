# T65 외부 라이브러리 이동

외부 위치를 disabled 처리하던 탐색 메뉴·진단 위치 목록과 TextEditor.navigate의 external 차단을 제거했다. 엔진의 기존 file/JAR/JDT materialize 기능을 사용하며 새 추출기나 Go 경로는 추가하지 않았다. 중앙 편집기에 같은 탭/줄 이동/소스 표면으로 연다.

프로젝트 밖 파일과 node_modules는 읽기 전용으로 표시하며 CodeInput 수정·저장·자동완성·서식·줄 주석을 차단한다. 파일 기반 외부 소스는 기존 LSP 분석/추가 탐색을 사용할 수 있다. materialized 외부 소스는 scoped provenance를 열린 탭 범위로 보관해 복원 후에도 readonly/sourceOnly를 유지한다. 해당 소스는 엔진이 새 언어 서버를 지원하지 않으므로 새 분석 세션을 열지 않으며 소스 확인/검색/복사를 제공한다. 외부 URI를 지원하지 않거나 소스를 가져올 수 없으면 기존 엔진 오류를 표시한다.

자동 검증: editor/menu/host/leases/completion 검사 통과. 외부 메뉴 활성화 descriptor 전달, file·node_modules·Windows 경로 구분, archive provenance 복원, readOnly 입력과 UI 우회 저장 거절, 외부 line/column 이동을 검증한다. native ADE check 통과.

설치 backup `1794187380296954000`. 검증 전용 aaa-library-navigation.ts의 Array.map을 실제 ⌘클릭해 `/Users/estsoft/.nvm/versions/node/v22.22.3/lib/node_modules/typescript/lib/lib.es5.d.ts` 1468행으로 이동하고 소스/주석, 외부 라이브러리 읽기 전용 안내를 확인했다. 캡처 `/tmp/ade-lib-opened.png`. JAR/JDT는 이번 실제 UI 시연 대상이 아니며 materialized 경로 회귀 테스트로만 확인했다.

코드 리뷰는 프로젝트 도구 창 상단 git-branch 액션에 유지된다. 기존 모호한 `변경 검토` 접근성/tooltip label을 `코드 리뷰`로 통일했고 실제 앱 AX에서 해당 버튼을 확인했다. 중앙 리뷰 탭은 유지한다.
