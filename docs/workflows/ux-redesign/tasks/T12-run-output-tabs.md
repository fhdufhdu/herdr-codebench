# T12 하단 실행 결과 도구 시안

2026-11-05. 하단 stripe에 실행 결과 도구를 추가하고 구성 실행마다 결과 탭을 만든다.

- 기존 실행 구성 선택·시작·중지·설정과 샘플 실행을 유지한다.
- 각 결과는 실행 시점의 이름·명령·폴더 snapshot, 실행 중·완료·중지 상태와 출력을 소유한다.
- 실행 중인 결과와 현재 보고 있는 결과를 분리한다. 이전 탭을 보더라도 완료·중지는 해당 실행 결과에 반영한다.
- 같은 구성을 반복 실행하면 별도 탭으로 남긴다. 완료·중지 결과는 닫을 수 있고 실행 중 탭은 닫기를 비활성으로 표시한다.
- 하단 결과 버튼으로 결과 도구를 접거나 다시 연다. 문제 도구와 같은 하단 영역의 각 소유 콘텐츠를 선택한다.
- 결과 탭은 방향키·Home·End로 이동하며 선택한 탭을 보이게 한다.

부모는 HTML·CSS·도구 전환·통합 검증을 소유한다. 하위 구현은 `/tmp/codebench-run-output-tabs.js`와 `results/T12-run-output-tabs.md`만 작성한다. 공개 DOM은 runTabStrip·runOutput·runEntryMeta·runEntryStatus와 기존 runStart·runStop·runEdit·runConfig·runStatus다. 하위 effort는 기본 medium이다.
