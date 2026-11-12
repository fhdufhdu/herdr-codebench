# U02 macOS Keychain 비밀번호

사용자가 macOS 키체인 사용을 명시 승인했다. 기존 token-auth DB API와 source ID를 유지한다. 메타데이터/응답/로그에는 비밀번호를 쓰지 않는다. 저장 시 macOS keychain 전용 service와 source ID account로 저장, 명시 비밀번호 변경/비우기/프로필 삭제를 반영하고 엔진 재시작 뒤 기존 프로필에서 사용 가능해야 한다. macOS keystore 실패는 명시 오류이며 session/plaintext로 조용히 대체하지 않는다. 다른 OS는 기존 session 저장을 유지하고 그 상태를 명시한다.

제안 public source 추가: password_storage:"keychain"|"session"|"none", has_password 기존 호환. 저장된 password 존재 마커(비밀 아님)만 metadata에 보관할 수 있다. input의 상태 marker는 신뢰하지 않고 서버가 결정한다. 새 password를 생략하면 기존 credential 유지, 빈 문자열이면 제거. 목록 조회는 키체인 전체를 열거하거나 비밀을 읽지 않는다. 실제 연결 때 해당 source의 credential만 lazy read한다. 기존 session credential의 자동 이전을 위해 사용자 몰래 UI state/다른 keychain항목을 읽지 않는다. 사용자가 해당 profile을 다시 저장하면 현재 세션 password의 저장 허용 범위는 부모와 협의한다.

macOS security CLI를 택한다면 /usr/bin/security 고정, secret은 argv/env/파일 대신 stdin의 interactive command로 전달. 복잡한 Unicode/개행/따옴표는 보존하고 전체 subprocess 출력은 노출하지 않는다. CGO=0·6종 crossbuild를 보존한다. 새 외부 deps/OS 권한 변경 없이 가능하면 표준라이브러리만 사용한다. 전용 service는 dev.herdr.codebench.database. 라이브 테스트는 이 서비스에 새로 만든 테스트 account만 set/get/delete하며 다른 사용자 항목은 접근하지 않는다. 현재 UI/API tests는 fake keystore로 독립 실행할 수 있어야 한다. API contract를 임의 확대하지 말고 실패 정합성/취소·동시성은 근거와 테스트를 남긴다.

소유 파일: engine/database.go 및 새 password store Go 파일/tests만, 자기 results/U02-result.md. go.mod/sum 의존성 변경 필요 시 먼저 부모에게 알린다. release/build/install/UI/docs공통 파일은 부모 담당. 기존 Go backend 테스트를 훼손하지 않는다. 구현 후 race/vet 및 플랫폼 build 검증(배포 바이너리는 만들지 않음). medium으로 시작: 명확한 OS CLI 경계·기존 프로필 저장에 한정. 불확실한 데이터 정합성은 먼저 보고한다.
