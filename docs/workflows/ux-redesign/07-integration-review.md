# 통합 검증

2026-11-05. 브랜치 `codex/ux-principles-redesign`. 기존 DB 엔진·프로젝트 정렬 변경 위에 UI 변경을 통합했다.

## 자동 검사

| 검사 | 결과 |
| --- | --- |
| `python3 design/idea/sync_ui.py --check` | 통과 |
| `node --experimental-vm-modules design/idea/check*.mjs` 각각 실행 | 25종 전체 통과 |
| repo `herdr-app check mods/codenav`·`mods/activity` | 통과 |
| 설치된 codenav·activity `herdr-app check` | 통과 |
| `git diff --check` | 통과 |

기존 codebench 분기·키맵 Ctrl/Meta 경계, 패널 크기·순서·active·hidden·terminal payload와 migration idempotence를 검사했다. DB Apply·수동 편집·transfer 경계와 비활성 DB 문서 닫기 보호, 저장 충돌·늦은 callback도 포함한다. 사용자가 선택한 기존 소스 뷰어와 LSP 이동 경로를 유지한다.

## 실제 화면

| 대상 | 관찰 |
| --- | --- |
| Herdr Markdown source | 새 원문·미리보기 선택기와 rich render 클릭 확인 |
| Herdr native Markdown editor | 새 편집·미리보기 선택기와 rich render 클릭 확인 |
| Herdr 기본 셸·아이콘 | 새 도구 아이콘·선택 상태와 중앙·좌우 도구 영역 관찰 |
| 소유 SQLite customers | 기존 200행·NULL·타입·여러 줄 값이 새 표에서 렌더됨을 확인 |
| HTML 데모 | SQL·표·Markdown·추출·연결·작은 정렬 셀렉트, 수동 순서 보존·좌우 슬롯 접기·열기·6개 경계 키보드 조절, 실행 구성 편집·샘플 시작·중지·완료 확인 |
| 최신 HTML 후속 | 목적 위치 메뉴의 직접 순서 이동, 설정 초안·취소·적용·확인과 도구 표시, 디자인 시스템 상태·색·아이콘 컬렉션 확인 |
| gallery·100행 메뉴 | Find Action 빈 목록과 이어진 native memory 오류로 후속 검증 대기 |
| native DB 닫기·정렬 셀렉트 focus·두 밀도 | 자동 검사 통과, 실제 조작 후속 확인 필요 |

반복 HMR 이후 `out of memory`가 관찰됐다. 원인 관계를 확정하지 못해 Find Action의 임시 진단 수정을 모두 복원했다. 앱 재시작은 사용자가 직접 진행하기로 했다. 이후 Herdr screenshot에서는 다른 작업 공간의 사용자 입력이 진행 중이었고 클릭은 사용자 조작 감지로 중단됐다. 반복 클릭은 중단하고 HTML 검증을 진행했다.

## 산출물과 남은 경계

데모는 `/Users/estsoft/project/herdr-codebench/design/ux-redesign-demo.html`이며 IAB에 열린 상태로 유지했다. 미리보기는 Codex visualization 폴더의 `codebench-ux-demo.jpg`와 `codebench-project-sort.jpg`다. 리뷰의 열린 문서 목록 제거·작은 정렬 셀렉트·좌우 위·아래 슬롯·상단 실행 구성·통합 내보내기를 포함한다. 6개 경계의 키보드 조절을 확인했으며 실제 포인터 드래그는 미확인이다.

Lucide stroke2·16/20px, dark palette·normal/compact metric, Markdown 텍스트 모드는 UX 원칙을 바탕으로 선택한 제품 설계 값이다. HTML의 샘플 실행·셀 반영·연결 표시는 native 기능의 성공 증거와 구분한다.

DB query history·필터·열 너비·긴 값 편집·import mapping·DDL 범위 요약·SQL 변경 사전 검토는 조사에서 정리한 후속 제안이다. 여러 Run transaction과 전체 export snapshot은 별도 엔진 연결 수명 설계가 필요하다. 앱 강제 종료 시 DB staging 영속화는 이번 UI 변경에서 제공하지 않는다.
