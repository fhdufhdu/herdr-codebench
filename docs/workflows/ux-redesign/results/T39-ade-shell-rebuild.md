# T39 ADE 프레임 — 첫 화면 구현·핵심 조작 검증

2026-11-06. 승인 HTML을 원본으로 새 `mods/ade`와 `layouts/ade.json`을 구성했다. 기존 idea/codebench의 UI controller나 DB/편집기 내부 로직을 가져오지 않았다. 색과 Lucide 자산 원본·생성 경로는 공유한다.

## 구현

- canonical ADE 치수와 quiet/outline/primary 버튼, 행, stripe, 탭, 단일 도구 제목, 안내 컴포넌트.
- 상단48/탭40/도구 제목36/행28/stripe44/하단26. 좌우·상하 native split 경계6. HTML 경계2보다 hit 영역이 넓은 의도적인 차이다.
- 다섯 도구 슬롯과 접기/펼치기. 같은 쪽 도구가 모두 닫히면 열 전체를 접는다. native 크기/상태만 읽고 이벤트에서 변경하며 render mutation이나 주기적 타이머가 없다.
- 프리뷰 문서 선택·탭닫기·다시 열기, 좌우 키 탭선택, Esc 도구접기/갤러리닫기, pane.go focus 소유.
- 제품 기능을 대신하는 거짓 성공/프로세스/DB 데이터 없이 미연결 제어는 disabled, 문서는 UI 미리보기로 표시한다.

## 자동 검사

- `sync_ui.py --check --mod codenav --mod activity --mod ade`: 통과.
- `check_system.mjs`: 통과.
- `build_layout.mjs --check`, `check_frame_layout.mjs`: 통과. 500회 토글, 사용자 크기·unknown 필드·터미널 payload 보존, hidden:false 생략 host roundtrip, 잘못된 tree 거부 포함.
- `check_native_frame.py`: appbar/editor/status/collection/좌우 stripe/도구5개 총11면 eager 검사 통과. check 환경의 window() null을 발견해 optional guard로 수정했다.
- `herdr-app check mods/codenav`, `mods/activity`, `mods/ade`: 통과.

## 실제 화면 근거와 제한

새 ADE 모드/레이아웃만 설치하고 전환했다. 최초 mod 폴더 탐지 지연 오류 뒤 실제 로드가 완료됐고 status errors[]를 확인했다. 전체 프레임의 상단/탭/프로젝트/다섯 슬롯과 공통 색·아이콘 native screenshot을 관찰했다(`/tmp/ade-frame-first.png`, 이후 CUA 화면). CUA 프로젝트 접기 후 제목 액션이 사라지는 것까지 관찰했다.

사용자 작업 화면에 레이아웃 전환·입력이 방해된다는 피드백으로 **CUA를 중단했다**. 실제 모든 열 collapse/reopen·splitter 연속 드래그 성능·큰 글꼴/작은 창·갤러리/키보드 조작은 미검증이다. 전체 T39 완료로 표시하지 않는다.

## 검증 환경 정책 · 사용자 후속 우선

사용 중인 Herdr에는 자동 설치/HMR·layout 전환·클릭·키 입력·재시작을 하지 않는다. OOM 재시작 허용은 이후 요청한 ‘작업 방해 금지’보다 우선하지 않는다. 우선 소스 및 소유 임시 fixture의 eager/모델 검사를 사용한다. Mac의 별도 창도 마우스/키보드를 공유하므로 완전한 격리가 아니다. 실제 pointer 검증은 별도 OS/display 환경을 마련하거나 사용자가 시간을 정해 허용한 경우에만 한다. Linux 앱 소스에는 scripts/sandbox의 독립 home/core/display 경로가 안내돼 있으나 이 Mac에서 구축·실행한 상태는 아니다.

다음: 작업 화면을 건드리지 않는 검증 환경 확인 후 남은 실제 조작 검사. 그 전 DB/편집기 본 구현으로 넘어가지 않는다.

## 사용자 재개 지시 후 실제 검증 · 2026-11-06

사용자가 ‘아휴 아니다 그냥 해줘라’로 재개를 지시했다. 아래 결과가 앞의 중단 시점 기록을 갱신한다. 기존 작업/터미널에는 입력하지 않고 ADE 프리뷰만 조작했다. 이번 재개에서는 OOM/재시작이 발생하지 않았다.

- 프로젝트·구조·에이전트·터미널·실행 결과를 모두 닫은 실제 화면에서 좌우 빈 열과 하단 도구 영역이 사라지는 것을 확인했다(`/tmp/ade-collapsed.png`).
- 좌측 폭, 우측 폭, 왼쪽 상하, 오른쪽 상하, 편집기/실행 결과 경계를 CUA로 드래그했다. 이전/이후 screenshot에서 각 경계의 실제 이동을 관찰했다(`/tmp/ade-five.png`, `/tmp/ade-splits.png`). 정량 프레임 시간 측정은 하지 않았다.
- 다섯 도구를 전부 접은 뒤 다시 열었다. 조절한 경계 위치로 복원되는 것을 screenshot으로 확인했다(`/tmp/ade-reopened.png`). 순수 모델 검사와 별도의 실제 근거다.
- 디자인 시스템 갤러리의 버튼/행/탭/빈·진행·오류 예시/색상 palette가 표시됐고 주요 버튼 클릭·Escape로 닫기를 수행했다(`/tmp/ade-gallery.png`).
- 두 문서를 순서대로 닫아 빈 문서 상태, 프로젝트 샘플에서 다시 열기, 두 탭 상태에서 Left 키로 app→README 활성 이동을 확인했다. 읽기 전용 프리뷰 데이터인 `ade.preview.documents`의 active도 readme였다.
- 빈 탭 줄40px이 남는 문제를 발견해 문서가 있을 때만 그리도록 수정했다. native11면·모델·생성 검사 재통과, 수정본 HMR 후 두 탭을 닫아 빈 줄 제거를 실제 관찰했다(`/tmp/ade-empty-fixed.png`). 최종 화면은 README 샘플을 다시 열어 두었다.
- 마지막 `herdr-app status`는 errors[]였다.

첫 프레임은 사용자에게 보여줄 수 있는 상태다. 작은 창/확대 글꼴의 겹침, 정량 drag 성능, 모든 키보드 focus 경로 검증은 남아 있어 전체 T39를 완전 완료로 표시하지 않는다. DB·실제 편집기·에이전트 연결·실행 엔진 연결을 이번 검증으로 주장하지 않는다.
