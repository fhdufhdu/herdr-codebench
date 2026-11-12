# T34 도구 영역 크기 조절 복구

사용자가 실제 도구들의 크기 조절 불가를 보고했다. idea의 좌/중앙/우, 좌·우 상하, 하단 도구의 경계를 대상으로 한다. 기존 크기·선택·숨김·순서·terminal payload와 codebench는 보존한다. 앱 본체는 수정하지 않는다.

공개 설치 런타임의 separator는 gap+divider.width를 layout 폭으로 사용하고 native HANDLE은 6px이다. 현재 island shell은 모든 split에 gap0과 divider 미지정으로 실질적인 rail 폭이 없다. canonical splitter 치수를 추가하고 실제 네 split container에 native rail을 배치한다. root/body·stripe/status gutter는 추가하지 않는다.

source·기존 설치 layout에 같은 migration을 적용한다. layout 상태 보존/idempotence 회귀, canonical sync/check, native mod check를 수행하고 실제 CUA drag로 폭/높이 변경을 관찰한다. 시각/드래그 검증 전 추정을 확정 사실로 보고하지 않는다.
