# T15 모드 통합 및 검증

2026-11-05 구현·검사·설치 당시 기록이다. **2026-11-06 후속 상태:** 사용자가 앱 재시작·잠금 해제를 완료했고 status 오류가 없는 실제 UI에 접근했다. 설정과 사용자 제공 화면에서 승인 데모와의 불일치 및 실행 위치/추적 문제가 확인됐다. 아래 자동 검사 기록은 이 실제 동작의 정합 완료를 의미하지 않는다. 현재 판단과 미검증 부분 변경은 [통합 감사](../09-demo-native-audit.md)를 따른다.

부모는 main.js RunResults 등록, 실행 구성 위젯의 idea 하단 결과 연결, actions 갤러리 버튼, 설정의 도구 관리/DB관리 페이지, 위치 셀렉터, 공통 목록 갤러리와 번역을 통합했다. source/편집기·중앙 테이블 직접 편집을 유지하고 SQL 결과만 실행 도구로 보낸다. 공통 uiButton 복합 콘텐츠의 문자열 접근성 label과 TextView plain 이벤트 wrapper를 실제 native 검사로 교정했다.

검증: 저장소 check*.mjs 25종 모두 통과, sync_ui.py --check 통과, repo codenav/activity 및 설치본 두 모드 herdr-app check 통과. 설정 도구/DB, 직접 지정 프로젝트, 연결 network/SQLite, 실행 구성, 갤러리, 빈 실행 결과/SQL 표/shell 출력 11개 실제 native eager fixture 통과. 재현 명령은 `python3 design/idea/check_native_surfaces.py`이며 실행 당시 source를 복사한 fixture는 /var/folders/pd/b2x6km0n1595w41vbl3_8jgh0000gn/T/codebench-native-redesign-_h2wy357. 이 검사는 실제 화면 배치/후속 클릭까지 입증하지 않는다.

설치: codenav/activity를 rsync로 배치 복사했다. machine-local gpui-kit.d.ts/jsconfig.json/hosts.json/cache는 제외하고 레이아웃 파일은 재설정하지 않았다. 백업 /Users/estsoft/.config/herdr-app/data/native-ide-backups/ux-redesign-20261105-161108. 설치 파일 검사 통과 후 실제 앱 status가 codenav reload out of memory를 반환했다. Computer Use는 Mac 잠금으로 접근하지 못했다. 사용자에게 잠금 해제와 Herdr 창 앱의 직접 재시작을 요청했으며 임의 재시작/코어 종료는 하지 않았다. 마지막 렌더 파일은 evidence일 뿐 이전 화면일 수 있으므로 새 UI 성공으로 주장하지 않는다.

남은 확인: 재시작 후 실제 관리창과 다섯 위치 배치/열 접기, 로컬 SQLite 실행·결과 선택/추출, 실제 짧은 shell 구성의 종료/중지와 하단 탭을 확인한다. 재시작과 잠금 해제는 외부 상태 변경을 기다린다.

기본 위치 label은 Left Upper/Left Lower/Right Upper/Right Lower/Bottom으로 5개 모두 명시한다. 기존 슬롯 id와 사용자 배치는 바꾸지 않는다. SQL source 접기는 결과 표의 높이를 확보하며 선택/결과/추출 상태를 보존한다.

후속 복구: 런타임 재로딩 시 원래 실행을 다시 보내지 않고 SQL job 상태/terminal footer를 조회한다. 확인 불가 shell은 상태 확인 불가를 표시하고 로그를 보존하며 terminal 재실행 확인을 유지한다. shared만 유지해 새 VM 그래프를 만드는 회귀 검사와 실제 RunResults 상태 검사까지 DB34개/전체25검사 모두 통과했다. Stop의 선택 결과별 비활성/실제 명령 연결도 검사했다. SQL 원문은 접어서 결과 표 공간을 확보한다.

마지막 소스 추가 배치 설치 후 설치본 두 모드 검사는 통과했다. `herdr-app status`에는 누적 HMR 오류22개가 있고 마지막은 Null 메시지다. OOM으로 실패한 실행 컨텍스트의 활성화가 확인되지 않았으므로 실제 모드 클릭/실제 DB·shell 검증은 재시작 후로 남긴다. 실제 화면의 마지막 capture는 기존 화면임을 확인했으며 새 결과로 제시하지 않는다.
