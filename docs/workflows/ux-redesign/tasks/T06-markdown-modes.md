# T06 Markdown 모드 선택

사용자 추가 지시로 source viewer를 유지한다. Markdown 눈 아이콘의 의미와 현재 상태를 드러내는 text mode control을 구현한다. effort medium.

- idea source viewer는 원문·미리보기, native editor는 편집·미리보기 두 상태를 나란히 보여 준다. 영문은 Source·Preview와 Edit·Preview다.
- canonical `uiModeSwitch(id, items, current, onChange)`를 두 mod와 component gallery에서 재사용한다. 아이콘 교체만으로 해결하지 않는다.
- 선택한 항목은 fill·outline과 Button.selected로 표시한다. 현재 선택을 다시 누르면 no-op이다. native Button의 Tab·Enter·Space와 focus·label을 사용한다.
- source viewer의 별도 Edit 연필과 기존 preview shortcut·command를 유지한다. native buffer·undo·dirty는 mode 전환으로 교체하지 않는다. codebench의 눈 아이콘과 native 3상태 순환은 유지한다.
- 소유 범위는 design/idea/ui.js·check_system.mjs, mods/codenav/code.js·design-preview.js·i18n.js, mods/activity/editor.js·i18n.js, check_editor_context.mjs와 이 task/result다. 생성 파일은 sync만 사용한다.
- API·engine·routing·설치·CUA 변경은 이 태스크에 포함하지 않는다. 부모가 통합 UI 확인을 수행한다.

## 근거

NN/g는 대부분의 아이콘이 문맥에 따라 다르게 해석되므로 상시 보이는 텍스트 label로 의미를 설명하고 hover에만 의존하지 말 것을 권한다. 두 목적지를 한꺼번에 이름으로 보여 주는 선택기를 적용한다. [Icon Usability](https://www.nngroup.com/articles/icon-usability/)

Fluent 2는 짧고 문법적·개념적으로 평행한 label, 첫 표시의 기본 선택과 현재 선택의 식별을 안내한다. 이 내용은 label·상태 설계의 근거로 사용한다. 실제 구현은 native Button 두 개로 구성하며 tablist의 DOM/ARIA·키보드 동작을 표방하지 않는다. [Fluent 2 Tablist usage](https://fluent2.microsoft.design/components/web/react/core/tablist/usage)
