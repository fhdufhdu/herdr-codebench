# T32 Database Select/Popup 현재 기능 검증

2026-11-06. 현재 DatabaseManager의 T17 Select/Popup 구현을 기준으로 UI fixture를 갱신했다. 데모 정합 기능이나 새 draft/Apply 계약을 추가하지 않았다. database-editor.js 및 엔진·설치 파일은 변경하지 않았다.

## 발견 원인과 최소 수정

기존 check_database_ui는 gpui-base의 Select/Popup export와 Popup.content subtree를 모델링하지 않아 최신 database.js를 link하지 못했다. 그 다음에는 IDEA에도 과거 db-driver-postgres/db-tls-verify-full 버튼이 있다고 가정하고 있었다. IDEA는 현재 db-driver-select/db-tls-select와 공통 uiMenu를 사용하고 codebench만 버튼 행을 유지한다.

fixture에 native Select/Popup의 생성·content 연결·open state/focus handle을 추가했다. 단순 존재 검사로 끝내지 않고 실제 manager가 넘긴 open-change와 공통 menu의 stable-key activation/keyboard/Escape 콜백을 실행한다. driver 옵션은 mysql/mariadb/postgres/sqlserver/sqlite, TLS는 빈 default/disable/require/verify-full이다. 원본 로컬 모듈은 그대로 로드하며 host와 engine HTTP 응답만 fixture다.

명확한 source bug도 재현했다. Delete를 한 번 눌러 확인 상태를 만든 뒤 driver 또는 TLS를 바꾸면 deleteArmed가 남아 다음 Delete가 바로 실행됐다. 일반 필드 입력은 이미 확인 상태를 해제한다. 회귀 assertion으로 실패를 확인한 뒤 chooseDriver와 IDEA/legacy TLS 변경에서도 deleteArmed를 해제하도록 맞췄다. legacy TLS 변경은 다른 입력처럼 오래된 error도 해제한다. profile 삭제 자체는 기존 두 번 확인 계약을 유지한다.

## 검사한 현재 동작

| 영역 | 검증 근거 |
| --- | --- |
| Select/Popup | 현재 값으로 option index 설정, 전용 trigger/content focus handle 연결과 open/close focus 전달, stable-key 선택, TLS Home/Down/Enter 및 Escape, busy 중 driver popup 열기 차단 |
| Driver/API | 실제 selector activation으로5개 driver 변경, 기본 port3306/3306/5432/1433, db_test source payload의 driver/port/TLS 확인 |
| SQLite/network | SQLite는 path만 보내고 host/port/user/password/database/TLS를 보내지 않음. native form도 path만 보여주고 network/TLS를 감춤. network는 path를 보내지 않고 host/password 필드를 보여줌 |
| 검증 오류 | SQLite path 누락, port0, 빈 host는 HTTP 요청 전에 거부 |
| Credential | password native masking, publicSource의 예상치 못한 secret 제거, shared state에 secret 미공개, 저장 후 빈 입력은 기존 secret 보존, 입력 후 지워도 암묵 삭제 안 함 |
| 명시적 삭제 | Clear Saved Password는 Save에만 password:"" 전달. Test에는 deletion field를 보내지 않고 staged clear를 유지. clear 후 저장 결과와 설명 갱신 |
| 플랫폼 설명 | macOS Keychain/session 설명, Linux session-only 설명, window가 없는 headless render 유지 |
| Profile 수명 | loading 후 응답이 사용자 입력을 덮어쓰지 않음. Duplicate는 metadata만 복사하고 id/secret를 가져오지 않음. 현재 profile 선택은 local field를 교체하지만 암묵 저장하지 않음 |
| In-flight | busy source row는 profile 전환 불가. Save 중 새로 입력한 이름은 과거 Save 응답이 덮어쓰지 않음. invalid save response 오류. close 이후 late response 무시, password state 비운 뒤 handle release |
| Delete | 기본 두 번 확인과 driver/TLS 변경 시 재확인, codebench의 기존 driver/TLS 버튼 동작도 검증 |
| 기존 회귀 | lazy catalog, 다중 선택·키보드 탐색, table 열기, DDL selection snapshot, refresh/close stale replies, deferred renderer handle 미생성 및 모든 input/focus/scroll 해제 |

프로필 전환의 dirty draft 확인창을 새로 만들지 않았다. 현재 선택은 기존처럼 즉시 해당 profile 필드로 바뀌며, 이 동작을 테스트와 문서에 명시했다. 이 검증은 현재 계약 보존이며 새로운 Save/Discard/Cancel 수명의 완료 증거가 아니다.

## 실행 결과와 한계

통과:

- `node --experimental-vm-modules design/idea/check_database_ui.mjs`
- `node --check mods/codenav/database.js`
- `herdr-app check mods/codenav`
- 소유 파일 `git diff --check`

mod check는 초기 native description의 유효성을 확인하며 열려 있는 실제 DB manager popup·deferred 상태·OS 포커스·레이아웃을 직접 조작한 검증이 아니다. fixture의 focus 검사는 callback이 올바른 소유 handle을 사용하는지 확인한 것이다. 이번 작업에서는 설치·HMR·CUA를 수행하지 않았다.

5개 실제 DB 연결, 실제 OS Keychain 저장/삭제, TLS handshake는 실행하지 않았다. payload와 UI state를 synthetic 응답으로 검증했으므로 이를 실제 네트워크·credential backend 성공으로 해석하면 안 된다. 기존 별도 native 관찰/driver 통합 증거와 이 UI fixture 증거는 구분한다.

변경 파일: mods/codenav/database.js(확인 상태 해제3곳), design/idea/check_database_ui.mjs, 이 결과 문서. 다른 source·generated module·사용자 설정은 변경하지 않았다.
