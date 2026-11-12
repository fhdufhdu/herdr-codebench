# T69 · 파일 분석 범위와 SQL 문맥 자동완성

구현·설치·자동 검사·실제 입력 검증 완료. [통합 결과](../results/T69-completion-integration.md). YAGNI/KISS/DRY, 기존 LSP·CodeInput·공통 목록 재사용. Herdr 앱 소스 변경 없음.

## 요구·계약
- R1 일반 파일: 설치 가능한 언어 서버 설정 확대, 정확한 languageId, 입력 시 자동 후보. 지원/미설치 구분. 임의 프로젝트 패키지·빌드 실행 금지.
- R2 SQL: DB 콘솔에서 연결 메타데이터의 테이블/컬럼, 별칭·조인·CTE·서브쿼리 문맥 추천. 문자열/주석 제외, Enter/Tab 적용, Esc 닫기, Ctrl+Space 명시 요청. 실행하지 않고 메타데이터만 조회.
- R3 입력/이동/문서 전환/연결 변경의 stale 결과 폐기, 비밀번호 등 연결 자격은 완성 파서에 전달하지 않음.
- SQL 순수 함수 계약: `completeSQL(text, offset, {tables:[{name,schema?,database?,columns:[{name,type?}]}], driver})` → `{from,to,items:[{label,insertText,detail?}], ...}`. 문자열 인덱스는 JS UTF16. 스키마는 UI 계층이 기존 db_catalog로 수집. 함수는 파일/네트워크 부수 효과 없음.

## 분담·검증
- T69a (medium: 확정된 기존 LSP 계약 확장): 일반 파일 언어 설정·languageId·문서화와 적합한 엔진 테스트. 다른 파일 편집 금지, 결과 `results/T69a-file-analysis.md`.
- T69b (high: SQL 중첩 scope와 부분 입력 분석): 순수 SQL parser/completion 모듈·vendor 생성·테스트. 기존 라이브러리 적극 사용, 실제 버전/라이선스 기록. UI 파일 편집 금지. 결과 `results/T69b-sql-completion.md`.
- 상위: SQL metadata/UI 통합·자동완성 공통 동작·입력 triggers·native 검증·전체 검토.
- 검증: 일반 파일 언어 매핑, SQL FROM/JOIN/SELECT/별칭/CTE/서브쿼리/다중구문/주석/quote/UTF16, stale metadata, native popup·선택 적용·기존 실행 보존. 실제 연결은 소유 SQLite fixture만 사용.
