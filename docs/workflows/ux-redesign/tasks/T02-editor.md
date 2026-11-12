# T02 편집기 독립 개선

- 요구사항 U03·U04. effort medium. 기존 buffer·save 계약을 보완한다.
- 수정 범위 mods/activity/editor.js, 필요한 activity/i18n.js 문구와 해당 회귀 검사만. 공통 routing·디자인 시스템은 변경하지 않는다.
- idea 모드에서 Markdown 새 문서는 edit가 기본이며 눈 버튼은 edit↔preview 두 상태만 사용한다. codebench의 기존 split 동작은 보존한다. 전환 중 동일 native buffer·undo·dirty 유지.
- idea에서 legacy spec.edit의 편집 종료가 read-only source로 돌아가게 하는 close 경로는 최종 routing 계약이 미확정이므로 이번 태스크에서 변경하지 않는다.
- 저장 중 파일·space 이동에서 native buffer를 release하거나 다른 문서의 original/saving/dirty를 덮어쓰지 않도록 실제 캡처된 buffer를 소유한다. 동작 보존을 위한 최소 수정으로 해결하고 불필요한 저장소·모델을 추가하지 않는다.
- caret·selection·reveal API를 추정 호출하지 않는다. 최종 단일 편집기 routing은 runtime 확인 후 부모가 별도 결정한다.
- regression은 Markdown 모드·버퍼 정체성, 느린 save 중 추가 입력·space 전환·취소·실패, 현재 dirty close 계약을 포함한다. 결과 results/T02-editor.md에 기록한다.
