# T07 Find Action 실제 앱 재검증 대기

2026-11-05. 실제 설치 CUA에서 빈 검색과 design-system·Component Gallery·갤러리 검색이 모두 0개인 현상이 보고됐다. actions 모드, idea layout, 실제 input 변경을 부모가 확인했다. 이어진 설치 검증에서는 `Null"null"`과 `out of memory`가 표시됐다.

빈 actions 검색은 `score('',...)`가 양수를 반환하고 등록된 자체 액션을 포함해야 한다. gallery는 필수 capability가 없고, 검색 대상은 번역 label·원래 label·command다. `actionContext()`의 capability 부족은 disabled 표시로 남긴다. commands 중복 제거는 자체 액션을 제거하지 않는다. 데이터 계산에서 빈 결과를 설명하는 근거는 찾지 못했다.

당초 local actions를 동기 게시하여 task continuation 의존을 없애는 수정을 시도했으나, 실제 앱 실패의 원인을 확정하지 못했다. 후속 설치에서는 메모리 부족이 관찰되어 처음의 비동기 빈 결과와 이후 Null 예외가 환경 메모리 압박에 관련되었을 가능성이 있다. 구체적인 원인 관계는 아직 검증되지 않았다. 부모 지시에 따라 동기 게시 변경과 단계별 진단 wrapper, 해당 변경만을 요구한 회귀 검사를 모두 제거했다. `everywhere.js`는 원래 비동기 계산·rseq 게시 경로로 복원했다. 부모의 기존 action icon registry 검사 변경은 보존했다.

`node --experimental-vm-modules design/idea/check_actions.mjs`는 복원 후 통과했다. 현재 검사는 registry·키맵·presentation, 실제 picker compute/pick과 stale-context 실행 방어를 검증한다.

추가로 설치 자산을 건드리지 않는 `/tmp/herdr-action-probe.UREziR`에 codenav 전체 복사본을 만들었다. 임시 fixture에서 actions props를 넣고 실제 `Everywhere.init()`과 `render()`를 실행하는 `herdr-app check`가 통과했다. keys→commands→actionContext→actionRows→showResults를 단계별 실행한 임시 동기 진단 경로도 통과했다. 실제 keys.json에서 만든 143개 binding과 CLI에서 읽은 71개 command를 fixture로 제공한 경우도 통과했다. 이 검사는 정적 mock보다 넓은 경로를 실행하지만 실제 앱의 메모리 상태를 재현하지 못한다.

실행 중인 Herdr 프로세스의 stdout/stderr는 `/dev/null`이었다. macOS unified log에서 codenav/exception/JavaScript를 확인했으나 구체적인 JS 예외 원인을 찾지 못했고, status에는 Null 예외 반복이 남아 있었다.

현재 상태는 메모리 부족으로 실제 앱 재검증 대기다. 부모가 앱 재시작 필요 여부를 사용자와 조율하고, 환경 회복 후 빈 검색·gallery 검색·실행을 다시 확인한다. 이 조사에서는 설치·HMR·CUA를 수행하지 않았다. 원인과 해결을 확정하는 코드 변경은 남기지 않았다.
