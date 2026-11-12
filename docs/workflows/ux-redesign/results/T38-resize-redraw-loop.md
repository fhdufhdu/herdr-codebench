# T38 크기 조절 중 반복 레이아웃 갱신

2026-11-06. 사용자 재보고로 T34 후속 조사.

## 확인과 수정

T34 splitter rail은 재시작 후에도 네 native split에 유지되어 있었다. 실제 왼쪽 경계 drag로 폭이 변했지만 사용자가 심한 버벅임을 보고했다. 기능 동작과 성능 검증은 분리한다.

`execution-layout.js`는 native `layout()`에서 빠지는 `hidden:false`·`max:null`을 명시 값과 raw JSON으로 비교했다. active native 결과는 hidden, 완료 transcript는 max에서 반복 변경 판정이 발생했다. `RunResults.syncTerminal`의 `layout.set → notify → render` 피드백 루프가 성립한다. native 소스는 읽기 자료로만 사용했다.

hidden의 생략은 false, max의 생략은 제한 없음으로 비교한다. 다른 속성·사용자 크기·위치·active·terminal payload와 결과 수명 복구는 유지한다. resizable처럼 생략 시 true인 속성에 false 규칙을 일반화하지 않는다.

## 검증과 현재 상태

- `check_run_process.mjs`: native 기본값 생략을 모사한 active/final roundtrip의 무변경 반환, 기존 native Ended 복구·실제 synthetic process5개 검사 통과.
- `check_database_editor.mjs`: 실제 RunResults renderer에서 live/SQL/완료 transcript 각각 host roundtrip 후3회 렌더해 추가 layout.set0회임을 검사, 전체 회귀 통과.
- `herdr-app check mods/codenav` 통과. 수정 파일과 DB compact label을 한 배치로 설치했고 `herdr-app status` errors는 비어 있었다.
- 현재 공유 상태 전체 약183KB, execution history약615B·active output0자. 대량 로그 문자열이 현재 주원인이라는 근거는 없다. 무제한 layout 루프를 먼저 제거하고 주기적 elapsed polling은 유지한다.
- 잠긴 Mac에서 받은4초 native sample은 대부분 idle이므로 실제 drag 전후 성능 증거로 사용하지 않는다. 잠금 해제 후 실제 drag 검증 대기.

잠금 해제 후 native CUA로 왼쪽 경계764→900 이동과 인접 pane 폭 변화를 확인했다. 연속 성능 측정은 동시 사용자 조작 감지로 일부 action이 거부되어 정확한 FPS/전후 체감 비교 근거로 사용하지 않는다. 당시 사용자 Docker의 하단 live 출력은 확인했다. T37 실제 검증에서 발견한 단축키/preview 정렬 수정의 batch HMR이 다시 OOM으로 실패하여 창 재시작을 요청했고, 최종 continuous drag 재확인은 그 뒤에 수행한다.
