# T36 실행 결과 로그 복구

2026-11-06. 실행 process/layout 소유 부분의 구현과 독립 검증 완료. 실제 RunResults 렌더·설치·UI 관찰은 부모 작업에서 통합한다. 앱 source 수정·빌드·재시작, 기존 사용자 실행·터미널·설정 변경은 하지 않았다.

## 실제 원인

읽기 전용 공개 host source와 현재 설치 layout을 함께 확인했다.

- `src/terminal.rs`의 `TerminalView::attached`는 이미 종료한 core terminal의 attach를 `finished` 오류로 거부하고 `TerminalEvent::Ended`를 보낸다. 실행이 빠르게 끝나면 처음 attach부터 이 경로에 들어간다. 살아 있는 terminal도 종료하면 Ended를 보낸다.
- `src/window.rs`의 `terminal_ended`는 composition chrome terminal block을 `self.chrome.remove(block)`으로 제거한다. native terminal block은 완료 transcript를 계속 보여주는 보관소가 아니다.
- 기존 `runTerminalContent`는 완료 기록에도 native content를 반환했다. 따라서 RunResults는 이미 `hc read`로 확보한 최종 output을 숨기고 상단 제어줄만 렌더했다.
- 실제 설치 `layouts/idea.json`에는 `bottom-run-results` column 아래 **84px min/max인 execution-controls만 남고 execution-terminal은 삭제**되어 있었다. 기존 layout 함수는 body가 없으면 즉시 반환하므로 이후 실행도 native body를 복구하지 못했다. 현재 bottom-stack은 직접 자식의 identity를 보호하므로 이 관찰에서 result id가 사라진 것은 아니다.
- `layout.rs`의 remove/collapse는 stack의 자식 identity를 보존한다. row/column 아래에서는 한 자식 container가 collapse될 수 있으므로 오래된 구조가 이미 execution-controls로 축소된 경우도 별도로 복구한다.

근거는 공개 저장소 `herdrdev/herdr-app`의 읽기 전용 source다. 로컬 조사본 `src/window.rs` 2286 이후, `src/layout.rs` 566 및 681 이후, terminal blob `0362271f084788c87ced01cbe66d549a9f9fb06c`의 attached 362 이후를 확인했다. 앱 내부 구현을 고치거나 다시 빌드하지 않았다.

## 변경

`run-process.js`의 `runTerminalContent(entry)`는 주소를 가진 owned queued/running 기록에서만 native terminal을 요청한다. authoritative `nativeState: finished`이면 shared state가 아직 running이어도 최종 transcript로 돌아간다. 완료·실패·취소·legacy/codebench 기록에는 null을 반환한다. 기존 label 검사, native exit code, stop/recovery, 최종 2,000 history line 출력 수집과 소유 자원 정리는 유지한다. 실행 중 transcript를 shared JSON에 주기적으로 복사하지 않는다.

`execution-layout.js`는 native body를 `execution-output` stack 안에 둔다. host가 native block을 삭제해도 빈 stack이 남아 결과 column·controls·외곽 크기·최소/최대·위치가 보존된다. 삭제된 body는 다음 sync에서 복구하며, 완료 때는 native slot을 숨기고 controls가 전체 결과 영역에서 transcript를 그릴 수 있게 만든다. 기존 direct terminal 구조, 이미 body가 사라진 현재 설치 구조, 옛 execution-controls collapse 구조를 같은 함수에서 이행한다. collapse 뒤 원래 외곽 bound가 이미 소실된 경우 복구 가능한 slot size를 유지하고 유출된 header min/max를 제거한다. 사용자 terminal이나 다른 도구 노드는 재구성하지 않는다.

## 검증

- `node --experimental-vm-modules design/idea/check_run_process.mjs` 통과. host remove/collapse를 재현하여 terminal 종료 후 결과 id·panel size/min/max·active 및 unrelated terminal 보존, body 복구, 다음 실행 native 재연결, 현재 설치 header-only 구조 복구, 기존 구조 이행, 반복 sync 무변경을 확인했다.
- 같은 검사에서 실제 core synthetic process 5개만 만들었다. 살아 있는 stdout·cwd·고유 label 복구, 상태만 읽을 때 running transcript 재수집 없음, 최종 출력, label 불일치 시 타 terminal 출력 접근 차단, stderr/exit7, 장기 실행 정확한 중지, 첫 상태 확인 전에 끝난 stdout+stderr/exit4, 출력 없는 exit0을 확인했다. finished·cancelled 및 nativeState finished는 native content를 반환하지 않는다.
- 테스트의 interrupt/kill/rm은 검사 소유 address Set만 허용한다. 생성 process와 임시 folder는 finally에서 정리했다. 사용자 terminal 탭 생성·선택·send는 하지 않았다.
- `check_run_sessions.mjs`, 두 변경 모듈 syntax 검사, `herdr-app check mods/codenav` 통과.

이 검증은 실제 lower RunResults의 live paint/완료 transcript/빠른 실행/선택 전환/재실행을 육안으로 확인한 증거와 구분한다. 부모의 renderer·설치·실제 UI 확인 결과를 아래에 합친다.
