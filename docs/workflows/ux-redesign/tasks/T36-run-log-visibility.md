# T36-run-log-visibility

2026-11-06. 사용자 DB 데모 정합 재요청 및 실행 로그 누락 보고. 이어 진행/구현 허가됨.

실행 결과 로그 안 보임 P0. 파일: mods/codenav/run-process.js, mods/codenav/execution-layout.js, design/idea/check_run_process.mjs, 관련 실행 회귀(다른 작업 database-editor fixture 제외), 자기 결과. database-editor.js는 읽기 전용, root가 수정. 실제 원인 source/public host/own synthetic core process로 확인, 모든 출력은 하단 결과에 live 및 종료 후 보존. native terminal unavailable/finished일 때 빈 화면 금지. 실행중 transcript JSON 매초누적은 피하고 필요시 bounded fallback. terminal ownership/label/취소/재실행/복구/state 보존 및 codebench 격리. API 변경 root와 먼저협의. 기존 사용자의 터미널/실행/설정 건드리지 않음, 소유 fixture만 정리. effort high: 원인 미확정 host·process·layout lifecycle 상호작용. 설치/CUA는 root.

완료: 현재 기능 보존 회귀·canonical sync/system·native eager 검사, root 실제 SQLite/자체 실행 UI 관찰. 구현 성공과 실제 확인 구분. 결과 results/T36-run-log-visibility.md. YAGNI·KISS·DRY.
