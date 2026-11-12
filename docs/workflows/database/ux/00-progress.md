# Database UX 후속

2026-11-05. 전체 구현 진행. 실제 IntelliJ IDEA를 SQLite fixture로 computer use 검증하고 설치된 코드 근거와 대조한다. 그 결과를 Herdr의 idea·codebench에 반영하고 실제 UI를 재확인한다. 사용자 요청: 현재 기능 UI/UX 개선, 프로젝트 선택 목록 순서 변경, DB 비밀번호 macOS 키체인 저장(사용자 후속 승인).

| 작업 | 상태 | 담당/범위 |
| --- | --- | --- |
| U01 프로젝트 순서 | 구현·자동 검증·설치·실제 UI 확인 완료 | 이름순·최근 사용순·직접 지정, 위/아래 버튼·Alt+↑↓, [결과](results/U01-result.md) |
| U02 키체인 | 구현·호스트 검증·설치 완료, UI 대기 | [엔진](results/U02-result.md), [UI](results/U02-ui-result.md), 실제 키체인·재시작 API 통과 |
| U03 실제 UI 조사·개선 | 진행 중 | [실제 관찰](findings.md), [REA](rea-followup.md), [그리드 개선](results/U03-grid-result.md) |
| U04 통합 검증·설치 | 자동 검증·설치 완료, 실제 UI 대기 | 6종 release 0.1.0-3664aa092dc4, native 11개, JS/Go/API 통과 |

기존 사용자 DB/프로필은 조작하지 않고 새 SQLite test source만 사용한다. OS keychain은 이 제품 서비스의 테스트 항목으로만 검증한다. 현재 메인 세션 모델/effort를 변경하지 않는다. 하위 medium은 스킬의 일반 컴포넌트 구현 기준이다. 새 API 계약은 U02 명세에 고정한다. 관찰 결과와 개선은 findings.md에 연결한다.
