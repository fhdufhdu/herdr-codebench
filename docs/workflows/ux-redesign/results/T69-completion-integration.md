# T69 · 파일 분석·커서 자동완성 통합 결과

2026-11-09. Herdr 앱 소스 변경 없이 ADE 모드와 공유 분석 엔진에 적용했다. YAGNI/KISS/DRY에 따라 기존 CodeInput·MenuController·LSP·DB catalog를 재사용했다.

## 동작

- 코드와 SQL 후보는 실제 native 입력 커서 아래에 나타난다. 글꼴·수평 스크롤에 추정 문자 폭을 쓰지 않는다. 하단 공간이 부족하면 위로 전환한다. Popup wrapper를 항상 유지해 Tab 입력 포커스가 터미널로 이동하던 문제도 수정했다.
- 일반 코드에서 식별자 입력 시 자동 요청, Ctrl+Space 명시 요청, Enter/Tab 적용, Escape 닫기. 클라이언트 prefix filtering은 표시 상한 전에 수행한다. 기본 LSP snippet은 안전한 plain text로 변환하며 지원하지 않는 복잡한 형태는 거절한다.
- 일반 언어 설정은 16개 서버 계열·45개 확장자로 확대했다. 설치·검증·개인 설정 보존 범위는 [T69a](T69a-file-analysis.md). Markdown heading 구조와 rich preview를 유지한다.
- SQL은 pinned CodeMirror SQL의 Lezer parser를 headless bundle로 사용한다. 별칭·JOIN·CTE·파생/상관 서브쿼리의 scope를 분석하고, DB 콘솔의 연결 catalog로 테이블·컬럼을 보완한다. [T69b](T69b-sql-completion.md)에 문법·라이선스·한계를 기록했다.
- schema 목록과 참조된 테이블 컬럼만 읽고 console 안에서 캐시한다. 새로 읽기 버튼으로 갱신할 수 있다. 미완성 FROM 이름을 실제 테이블로 조회하지 않는다. 비밀번호는 parser나 catalog cache에 전달하지 않는다. 자동완성은 사용자 SQL을 실행하지 않는다.
- revision·문서·프로젝트·커서 전환·종료 시 늦은 응답을 버리고 IME 조합을 건드리지 않는다. 후보 적용은 한 번의 undo로 복원된다.

## 검증 근거

- 실제 Herdr의 소유 SQLite fixture에서 FROM cu → customers 후보 표시 및 Tab 적용 확인. CTE+JOIN 쿼리의 c.em → email 추천 확인. 82번째 줄 부근에서 popup이 커서 위로 전환되는 결과 확인.
- 실제 TypeScript 편집기에서 Math.a → abs/acos 등 후보 표시와 Tab → Math.abs 적용 확인. 실제 JSON 오류 진단도 확인했다. schema 없는 JSON 값 문맥은 서버가 빈 completion을 반환할 수 있으므로 비어 있지 않은 JSON 후보까지 검증했다고 주장하지 않는다.
- 소유 DB 연결·테스트 작업 공간·파일은 삭제하고 기존 작업 공간으로 복귀했다. 사용자 쿼리 실행 및 업무 파일 변경 없음. 새 엔진 runner t5h는 유지했다.
- SQL assist/parser, 일반 completion, CodeInput, editor/lease/DB editor 회귀 검사 및 shared design system 검사 통과. partial FROM 경고 회귀, stale 응답, IME, Tab/undo/Escape 포함. sync_ui --check ade/codenav/activity, git diff --check 통과.
- Go 전체·race 및 설치된 13개 문서 dialect의 실제 언어 서버 RPC/6개 진단 buffer 검증은 T69a 참조. 6개 플랫폼 엔진 build·설치 검증 통과. SQL parser native probe 통과. ade/codenav/activity의 herdr-app check 통과.
- 배포 엔진 0.1.0-d4e84bc15651, 최신 ADE 설치 backup 1794210663548530000.

## 지원 범위

모든 파일 종류에 서버가 생기는 것은 아니다. XML은 설정만 추가했고 LemMinX 설치가 필요하다. 언어별 SDK·프로젝트 설정·schema 유무에 따라 후보/진단 범위가 다르다. SQL은 문맥 자동완성이며 전체 SQL lint·타입 추론은 추가하지 않았다. 독립 .sql 파일은 키워드·CTE/파생 projection을 추천하고 실제 DB 컬럼은 연결된 DB 콘솔에서 제공한다. native 파일 저장 성공 여부는 이 검증의 완료 근거에 포함하지 않는다.
