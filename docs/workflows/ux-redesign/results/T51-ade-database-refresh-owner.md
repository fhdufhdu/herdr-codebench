# T51 후속 · 연결 저장 후 자동 갱신의 task owner

root 실제 UI에서 연결 관리 저장 이후 tree가 loading 상태와 이전 세 연결을 유지했고, 수동 header refresh는 새 네 번째 연결을 표시했다. 기존 tree는 revision 차이를 render에서 감지해 render Context의 spawn으로 작업을 시작했다. 이 경계를 init에서 시작한 retained worker의 AsyncContext로 옮겼다. 이 변경은 transport의 cached connection promise가 원인이었다고 주장하지 않는다.

render는 이제 최신 shared revision의 `{revision}` descriptor를 queue에 넣고 기존 worker를 깨우기만 한다. render Context의 spawn/notify나 backend 요청을 호출하지 않는다. 연속 revision은 worker가 처리하기 전에 최신 descriptor 하나로 합친다. worker는 자신의 AsyncContext로 refresh를 dispatch한다. 동일 revision 재렌더는 작업을 추가하지 않는다.

수동 refresh는 현재 revision을 확인하고 대기 중인 중복 descriptor를 제거한다. 기존 generation 검사는 그대로 유지하여 늦은 자동 응답이 최신 수동 결과를 덮어쓰지 못하게 한다. source 요청 실패는 실제 오류를 표시하고 loading을 해제한다. release는 queue를 비우고 worker를 깨우며 소유한 task handle을 취소하고 focus/scroll handles를 해제한다. event/render Context를 저장하지 않는다.

`node --experimental-vm-modules design/ade/check_database_ui.mjs`가 다음을 검증한다.

- spawn/notify 호출 시 실패하는 render Context에서도 revision 렌더는 descriptor만 만든다.
- 여러 렌더/revision을 하나로 합치고 init-owned worker Context에서 갱신한다.
- 자동 응답이 갱신된 네 profile과 loading:false를 표시한다.
- 같은 revision은 render-refresh loop를 만들지 않는다.
- 수동/자동 응답 경합에서 최신 수동 결과를 유지하고, 수동 갱신은 중복 queue를 제거한다.
- 실패 후 loading 해제, release 전 대기 작업 폐기/worker cleanup을 수행한다.

retained worker를 사용하는 inert service native fixture와 `herdr-app check mods/ade`도 통과했다. 이 작업자는 설치·실제 사용자 profile 생성/변경·CUA를 수행하지 않았다. 사용자 UI에서 자동 갱신을 다시 관찰하는 검증은 root가 수행한다.
