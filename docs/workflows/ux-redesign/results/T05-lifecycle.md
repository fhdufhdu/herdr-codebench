# T05 DB 문서 수명 안전성

2026-11-05. 구현·자동 검사 완료, 실제 화면 검증은 부모 통합 단계에서 수행한다. effort medium 유지.

## 구현

- `database-editor.js`가 layout·instance owner별 문서 dirty/busy 메타데이터를 공유한다. SQL 원문·행 값·비밀번호를 포함하지 않는다. SQL 변경·staging·열린 셀은 dirty, loading·save·Apply·transfer·queued/running job은 busy다. 이벤트에서는 즉시 발행하고 render의 sync에서는 timer로 발행을 예약한다.
- `tabs.js`는 비활성 탭과 등록 대기 중인 현재 DB 문서까지 검사한다. close/closeOthers/closeAll 요청에 보호 문서가 포함되면 요청 전체를 보류하고 해당 DB 문서를 선택하며 이유를 알린다. 사용자가 Save/Discard 또는 Apply/Revert로 정리하거나 작업을 마친 뒤 명시적으로 다시 닫는다. 닫기는 서버 변경을 실행하지 않는다.
- SQL 초안에 `Discard SQL draft changes` 액션을 추가했다. 저장된 마지막 snapshot으로 돌아가며 저장 중 discard를 차단한다. CAS 저장 실패는 초안과 dirty 상태를 보존한다. Save 아이콘은 공통 save 역할을 사용한다.
- 문서 이동 시 열린 셀을 기존 문서 staging에 확정한다. render에서는 focus·notify·shared 쓰기를 직접 수행하지 않고 순수 staging과 예약 발행만 처리한다. Revert는 열린 셀만 있을 때에도 사용할 수 있다.
- DB dirty 표시는 기존 uiTab children의 점과 tooltip로 제공한다. codebench에도 같은 의미 표시와 close 보호를 적용하고 기존 last-tab hiding 동작을 보존했다.

## 메타데이터 수명

layout당 하나인 기존 DB editor가 초기화될 때 같은 layout의 이전 owner metadata를 정리한다. release는 자신의 owner만 제거하고 늦게 끝난 task/timer는 metadata를 다시 만들지 않는다. 다른 layout metadata는 유지한다. DB view가 존재하지 않는 orphan metadata는 close 판단에서 제외한다.

앱 재시작 후 DB view가 아직 지연 초기화되지 않았다면 복원 metadata 때문에 첫 닫기가 보류될 수 있다. 이때 DB view를 선택해 init 정리를 실행하므로 다음 닫기를 영구 차단하지 않는다. 메타데이터를 SQL/staging 복원 데이터로 사용하지 않는다. 앱 종료·강제 재시작의 staging 영속화는 이번 변경 범위에 포함하지 않았다.

## 검증

| 명령 | 결과 |
| --- | --- |
| `node --experimental-vm-modules design/idea/check_database_editor.mjs` | 통과. active cell 이동 보존, 실제 tabs closeAll 보호, metadata에 원문 없음, Apply/save busy, 저장 충돌 시 dirty 유지, discard, init·release cleanup 회귀 포함 |
| `node --experimental-vm-modules design/idea/check_tabs.mjs` | 통과. 비활성/현재/등록 전 DB close·closeAll, busy, 다른 layout/orphan metadata, codebench, 일반 파일 save 승인 경로 유지 |
| 같은 tabs 검사 내 real common | 통과. 기존 native 파일 dirty/saving 상태가 DB spec으로 이동할 때에도 native editor를 우선 표시하고 정리 후 DB로 이동 |
| `node design/idea/check_database_model.mjs` | 통과 |
| `herdr-app check mods/codenav` | 통과 |

설치·CUA·사용자 DB 접속은 수행하지 않았다. 새 i18n 키 5개는 부모에게 전달했으며 번역 파일은 수정하지 않았다. 부모가 공통 wantedChild와 i18n을 소유한다.
