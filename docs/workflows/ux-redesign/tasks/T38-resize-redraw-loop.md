# T38 크기 조절 중 반복 레이아웃 갱신

사용자 재시작 후 크기 조절 불가/심한 버벅임 재보고. T34의 native rail은 유지되어 있으며 root의 첫 실제 왼쪽 drag는 이동했다. 이동 가능과 원활한 동작을 구분해 조사한다. 앱 본체·사용자 실행·도구 설정·codebench는 보존한다.

읽기 전용 native 소스에서 Node serializer가 hidden:false와 max:null을 생략하는 것을 확인했다. executionTerminalLayout은 raw JSON 비교로 이를 매번 변경으로 판단하고 RunResults가 layout.set→notify→render를 반복한다. 기본값의 의미를 비교하는 최소 수정을 적용하고, host가 기본값을 생략한 뒤 active/final/SQL 상태의 재렌더가 추가 layout.set을 만들지 않는 회귀를 추가한다.

root가 실행 레이아웃·관련 검사·통합·실제 drag를 담당한다. 기존 T36 에이전트는 추가 읽기 전용 감사만 담당하며 기존 high 설정 유지(여러 native/모드 상태의 상호작용 원인 조사). elapsed polling 최적화는 별도 성능 증거가 없으면 확장하지 않는다. 실제 smoothness 검증 전 완료로 표시하지 않는다.
