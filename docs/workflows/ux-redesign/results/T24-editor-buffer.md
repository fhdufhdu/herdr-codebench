# T24 DOM 없는 편집 문서 모델 구현 결과

2026-11-06. `11-custom-editor-implementation.md`의 EditorBuffer 계약을 구현했다. 앱 본체·기본 routing·기존 편집기·다른 source·UI 생성물·설치는 변경하지 않았다.

## 구현과 라이브러리 재사용

- `mods/codenav/editor-buffer.js`: 단일 UTF-16 원문과 방향성 anchor/head, selection, revision, readonly, edit/movement/erase, undo/redo의 문서 owner다. IO·입력부·렌더·LSP·shared 상태를 소유하지 않는다.
- 생성 `mods/codenav/editor-state-vendor.js`: CodeMirror state의 실제 `Text`, `ChangeSet`, `EditorSelection`과 unicode-segmenter의 `graphemeSegments`를 self-contained ESM으로 번들링했다. Node/DOM/Intl.Segmenter 의존이 없다.
- `design/editor/`: exact npm manifest/lock, entry, build/check, README, 실제 native 실행 fixture, dependency license 원문. production bundle에는 runtime dependency의 MIT license 전문도 내장하여 mod만 배포해도 고지가 유지된다.

확인·고정한 버전은 `@codemirror/state@6.7.6`, `@marijn/find-cluster-break@1.0.4`(CodeMirror 의존성 포함 정확 고정), `unicode-segmenter@0.17.3`, build-only `esbuild@0.28.2`다. npm metadata와 설치된 package.json/LICENSE를 확인했으며 모두 MIT다. unicode-segmenter package는 Unicode17.0.0/UAX29 데이터를 사용한다. CodeMirror 기본 cluster helper만으로 Hangul Jamo 등의 전체 경계를 가정하지 않고, 자체 movement/erase에는 Unicode segmentation library를 사용했다. [CodeMirror 공식 state reference](https://codemirror.net/docs/ref/#state), [unicode-segmenter 공식 저장소](https://github.com/cometkim/unicode-segmenter), [CodeMirror cluster helper 설명](https://github.com/marijnh/find-cluster-break).

## 확정 계약

부모와 사전 합의한 보완은 `constructor(text,{readOnly=false}={})`의 선택 옵션이다. 나머지는 요청된 getter와 `line/position/offset/select/replace/apply/move/erase/undo/redo`를 제공한다.

- 좌표는0-based UTF-16이다. LF가 줄을 나누고 CRLF의 CR도 원문에 보존되므로 line.text에는 CR이 남을 수 있다. line/position/offset은 같은 규칙을 사용한다. offset의 column은 EOL에서 clamp하며 surrogate 중간은 거부한다.
- apply의 모든 edit는 같은 변경 전 문서 기준이다. 정렬 후 겹침·동일 시작점의 모호한 edit·역방향·범위 초과·surrogate 분할을 거부한다. 명시 anchor/head는 변경 후 좌표다. selection 생략 시 실제 ChangeSet으로 mapping한다. 실패는 원문/선택/history를 바꾸지 않는다.
- move는 left/right/up/down/home/end/doc-start/doc-end, erase는 left/right다. home/end는 현재 줄이며, 좌우 이동/삭제는 실제 grapheme 경계를 사용한다. 위아래는 긴 줄→짧은 줄→긴 줄에서도 선호 column을 유지한다. word는 문자·숫자·underscore/공백/구두점 run 기준의 단순 코드 편집 정책이며 locale word segmentation으로 보고하지 않는다.
- revision은 실제 원문 변화에만 증가한다. undo/redo도 원문 변경이므로 단조 증가한다. select·move·selection-only apply는 revision을 늘리지 않는다. readonly는 선택/이동/복사를 허용하고 mutation은 false다.
- history는 최대100 transaction과 변경 payload1,048,576 UTF-16 units(삽입+삭제)의 retention budget이다. 정확한 heap byte 제한은 아니다. 가장 오래된 기록부터 버리고 초과 단일 edit는 적용하되 undo 기록을 남기지 않는다. 같은 명시 group의 연속 edit만 묶으며 selection/move/undo/redo가 group 경계다. paste/newline/command/시간 경계의 group 분리는 caller가 소유한다.
- grapheme cache는 최대32줄이며 text 변경 시 비운다. 긴 한 줄 segmentation과 전체 text 추출은 입력 크기에 선형이다. 이 모델 결과만으로 대용량파일 성능이나 IME commit·화면 rendering 완료를 주장하지 않는다.

## 실제 검증

`design/idea/check_editor_buffer.mjs`는 mock Text/ChangeSet 구현을 쓰지 않고 production bundle과 EditorBuffer를 직접 실행한다. VM에는 DOM·Node global·Intl을 주지 않는다. 다음을 검증했다.

- 빈 원문·마지막 빈 줄·한글/emoji/CRLF 보존, line/offset/position 왕복.
- 역방향 selection, 실제 multi-edit·selection mapping·변경 후 명시 selection, 잘못된 transaction의 atomic rejection.
- surrogate pair 분할/잘못된 surrogate 입력 거부, revision·readonly·selection-only 변경.
- emoji modifier/ZWJ family·flag·combining mark·Hangul Jamo·Indic conjunct·CRLF의 이동/삭제.
- up/down 선호 column, home/end·문서끝·extend·word 이동/삭제.
- 같은 group undo·selection 경계·redo branch 제거·100entry/변경량 budget.
- 고정 seed의90회 실제 edit를 문자열 oracle과 비교하고 역순 undo 검증.

다음 명령이 모두 통과했다.

```sh
npm run --prefix design/editor check
npm run --prefix design/editor test
npm run --prefix design/editor check:native
git diff --check -- design/editor mods/codenav/editor-buffer.js mods/codenav/editor-state-vendor.js design/idea/check_editor_buffer.mjs
```

check는 exact dependency·self-contained imports·금지 host dependency·생성 artifact/license 재현성을 검증한다. production vendor는 license 포함56,875 bytes다. native 검사는 두 production 파일을 임시 synthetic mod에 복사하고 실제 `herdr-app check`에서 Unicode 이동·실제 edit·undo/redo/revision을 실행해 통과했다. 성공 후 fixture를 삭제하며 설치나 실제 사용자 문서를 변경하지 않는다.

## 부모 통합에 남은 범위

문서 모델은 ready지만 실제 OS 입력/IME 경계·caret 화면/scroll·clipboard/키 context·LSP revision/owner·파일 저장/close는 별도 소유자 작업이다. readonly 설정은 생성 시 고정이며 변경하려면 명시적인 문서 교체 판단이 필요하다. group 분리, 큰 edit가 undo budget을 넘는 경우의 UI 정책, CRLF 줄 표시 시 CR glyph 처리도 caller가 모델 좌표 규칙과 일치시켜야 한다. 기존 source/native/codebench 경로는 입력·통합 회귀 gate 전까지 유지한다.
