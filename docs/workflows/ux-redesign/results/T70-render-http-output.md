# T70 · 편집기 렌더 비용·HTTP 인증서·출력

2026-11-09. 사용자 SQL 렌더 interrupted와 HTTP TLS 실패·출력 복사/고정폭 요청에 대응했다.

## 적용

- CodeInput은 매 grapheme마다 토큰 이진 탐색과 native element를 만들던 경로를 변경했다. 줄 시작만 이진 탐색하고 이후 토큰 경계를 순회한다. 알려진 고정폭 글꼴의 ASCII만 같은 색/선택 상태로 최대 32자씩 묶는다. caret·토큰·선택 경계에서 분리하며 한글/이모지·비례 글꼴·진단이 있는 줄은 기존 개별 grapheme을 보존한다. 묶음 안의 클릭·드래그·우클릭은 실제 셀 너비로 문자 위치를 환산한다. interrupted 스택만으로 원인이 확정되지는 않으므로 동일 SQL 재현이 해결됐다는 주장은 하지 않는다.
- 실행 결과의 전체 복사 버튼은 보관된 현재 출력 전체를 그대로 클립보드에 복사한다. 기존 최대 2,000줄 보관 범위는 유지한다. 출력 각 줄에 Menlo를 직접 지정하고 줄바꿈 없는 수평 스크롤을 추가했다.
- 실제 서버 TLS 인증서 발급자가 사내 ePrism SSL이었다. curl은 검증 성공/HTTP 401을 반환하지만 기존 Java HTTP Client는 PKIX 오류였다. macOS 실행 시 JVM KeychainStore를 사용하도록 공유 HTTP 실행기에 반영했다. 기존 IJHTTP_JAVA_OPTS/JAVA_TOOL_OPTIONS/_JAVA_OPTIONS의 trustStore 설정은 덮어쓰지 않는다. Linux/Windows는 기존 설정 유지. 검증 비활성화와 시스템 인증서/전역 JVM 설정 변경 없음.

## 검증·범위

- 실제 ijhttp의 소유 임시 .http 파일에서 동일 서버 origin에 인증 없는 HEAD를 보내 KeychainStore 사용 시 exit 0 및 PKIX/SSLHandshakeException 없음 확인. 업무 요청·인증키·응답 본문은 실행하지 않았다.
- 실제 localhost HTTP 회귀 통과: 선택 블록만 요청, 환경, response scripts/globals, private snapshot permissions와 cleanup. shell setup의 macOS/Linux/custom JVM 설정 보존도 테스트했다.
- CodeInput의 batching 후 원문 복원·caret boundary·token boundary·비례 글꼴 보존과 기존 Unicode/IME/selection/undo 검사 통과. 실행 결과 복사 값 일치·native text row의 고정폭 지정 검사 통과. editor/completion/DB editor/shared system 및 생성 사본·mod 검사 통과.
- 설치 후 실제 창의 기존 Kotlin 파일과 한글 주석이 정상 렌더되는 화면을 읽기 전용 shot으로 확인했다. 사용자가 작업 중이므로 화면 전환·업무 요청 재실행·실제 클립보드 변경은 하지 않았다. HTTP 결과 버튼의 실제 클릭과 해당 SQL 재현은 미검증이다.
- 최신 ADE 설치 backup 1794212375230885000.

## 실행기 선택

현재 .http 환경 파일·pre/post script·client.global 기능을 이미 사용하므로 ijhttp를 유지했다. curl 기반 실행기는 ADE의 응답 헤더/본문 표시와 macOS 신뢰 저장소 활용에 적합하지만 기존 스크립트 호환성 검토가 필요하다. 별도 문법으로 API 회귀 테스트를 관리한다면 [Hurl](https://hurl.dev/docs/manual.html)이 대안이다. 이번에는 실행기를 교체하지 않았다.
