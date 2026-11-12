# T31 설정 잔재와 키맵 목록 구현 결과

2026-11-06. 이전 중간 작업본을 검토한 뒤 settings.js와 설정 전용 회귀 검사를 정리했다. 공통 UI·tools·engine·editor·database·run source, 생성물, 설치 파일은 변경하지 않았다.

## 구현

- 메뉴 및 도구 모음 전용 페이지·편집 메서드가 제거된 작업본을 유지하고 남은 unused toolbar/button import를 제거했다. 삭제된 페이지 API를 호출하던 검사는 해당 UI의 복원을 요구하지 않도록 현재 windows/common-list 계약으로 이행했다. 기존 action registry·keymap·runtime customization 소비와 저장된 `codenav.customization` 값은 삭제하지 않았다.
- 키맵은 공통 uiManagedList의 검색·단일 액션 선택과 상단 추가/변경/제거를 사용하며 오른쪽에서 개별 할당 chord 선택·기록·문자 입력을 처리한다. 미등록 icon 이름 keyboard를 실제 등록된 key 역할로 교정했다.
- 녹화·추가/변경·제거에 saving guard를 추가했다. 숨겨진/취소된 capture가 submit으로 다시 stage되지 않게 capturing 상태도 확인한다. 현재 액션에 속한 선택 chord만 제거할 수 있다. 여러 할당 중 하나를 제거하면 남은 실제 chord를 선택한다.
- capture 취소/Escape·다른 chord 선택·성공 가능한 Apply 진입에서 이전 입력 오류를 정리한다. 유효한 staged 변경에 대한 오래된 입력 오류가 저장 후에도 남지 않는다.
- keymap-model의 staged edit·expected-action·terminal bridge·CAS를 그대로 재사용한다. 저장 후 bindingBase를 구성할 때 keyfile의 미래 metadata를 실제 binding으로 오인하지 않도록 object 섹션의 string action만 추출한다. metadata 자체는 저장 문서에 보존한다.

## 회귀 검사

`check_settings.mjs`는 실제 설정 class와 실제 keymap/tool-order/customization 모델을 사용한다. 공통 목록/입력/native UI 경계는 fixture이며 실제 UI keyboard 전달과 pixel layout의 증거를 대신하지 않는다.

- 제거된 메뉴/툴바 전용 UI가 source에 없고 오래된 page 요청은 안전한 기본 페이지로 처리됨. 저장된 customization 값은 Apply/Cancel 이후에도 동일함.
- 공통 관리 목록과 오른쪽 실제 callback으로 액션/개별 chord 선택, Add/Replace/Remove, 키 기록, InputState 문자 입력/submit, 충돌·잘못된 chord·empty/unassigned·saving disabled를 검증.
- Ctrl와 Meta가 같은 action에 동시에 있어도 서로 다른 chord로 보존됨. 기록한 ctrl-shift-b를 Cmd로 바꾸지 않음. 기존 macOS shortcut/상속 규칙은 별도 keymap/shortcuts 검사도 통과.
- Apply까지 staged 상태 유지, 실제 Cancel에서 keyfile 무변경, 실패·parse/domain 오류·세 번 CAS retry 실패에서 pending edit 보존, 동시 unrelated keyfile/settings 필드 유지.
- 기존 notification draft/default restore, windows 단일 목록·5위치 selector·within-position 순서·검색중 이동 disabled, visibility-only 무재배치, 변경한 tool만 Apply, future/concurrent order·hidden·side 보존과 실제 DB 설정 진입 검사 유지.

통과한 명령:

```sh
node --experimental-vm-modules design/idea/check_settings.mjs
node --experimental-vm-modules design/idea/check_keymap.mjs
node design/idea/check_shortcuts.mjs
node --check mods/codenav/settings.js
git diff --check -- mods/codenav/settings.js design/idea/check_settings.mjs
```

또한 현재 mod source를 임시 디렉터리에 복사하고 main wrapper가 IdeaSettings의 keymap/windows 페이지를 직접 init/render하도록 만든 실제 `herdr-app check`가 두 페이지 모두 통과했다. 성공 후 fixture를 삭제했다. 설치·CUA·사용자 설정 쓰기는 수행하지 않았다.

## 부모 통합 경계

소유 범위 밖 두 잔재를 부모에게 전달했다. `mods/codenav/tools.js:242`의 toolbar 우클릭이 제거된 toolbars 페이지를 요청하므로 전용 진입 제거 여부를 부모가 정리해야 한다. `Assigned Shortcuts`의 한국어 번역도 i18n.js에 필요하다. 두 파일은 직접 수정하지 않았다. 이후 부모의 일괄 설치와 실제 검색·단축키 기록·Tab/focus·긴 목록·Apply/Cancel 화면 확인이 남는다.
