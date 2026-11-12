import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, closeOverlay } from "herdr";
import { ADE, adeColors, adeUI, adeSize, adeButton, adeGutterAction, adeCompletionPopup, adeRow, adeTab, adePanel, adeDialog, adeNote, adeManagedList, MenuController } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
const icon = (name,size=ADE.iconSize) => uiIcon(name,size);
const caption = text => div().text_size(adeSize(11)).text_color(adeColors().secondary).whitespace_normal().child(text);
export default class Collection {
  init(_props, cx) { this.sample = 0; this.selected = "row-0"; this.verified = null; this.menu = new MenuController(cx); this.completionMenu = new MenuController(cx); this.completionSelected = "email"; this.focus = this.menu.focus; }
  release() { this.menu.release(); this.focus.release(); this.completionMenu.release(); this.completionMenu.focus.release(); }
  render(cx) { return this.gallery(cx); }
  gallery(cx) {
    const c = adeColors(), dismiss = () => closeOverlay(props().overlay);
    return adePanel("collection", "ADE 디자인 시스템 · 네이티브 구성 요소", v_flex().flex_1().min_h(0).id("collection-scroll").overflow_y_scrollbar().p(20).gap(16)
      .child(caption("승인 데모의 색·치수·아이콘을 공유합니다. 아래 상태는 예시이며 실제 작업을 실행하지 않습니다."))
      .child(h_flex().gap(8).children(["quiet", "outline", "primary"].map(kind => adeButton(`sample-${kind}`, kind === "primary" ? "주요 작업" : kind === "outline" ? "보조 작업" : "일반 작업", (_e, eventCx) => { this.sample++; eventCx.notify(); }, { kind })))
        .child(adeButton("sample-disabled", "사용 불가", null, { disabled: true })))
      .child(caption(`버튼 활성화 ${this.sample}회 · Tab으로 포커스 확인`))
      .child(v_flex().h(180).flex_none().relative().child(caption("공통 자동완성 · 코드/SQL · 예시 선택은 문서를 변경하지 않습니다."))
        .child(adeCompletionPopup("sample-completion", ["email", "name", "customer_id"].map(name => ({ id: name, label: name, detail: "customers · TEXT" })), this.completionMenu, cx, {
          bounds: { width: 380, height: 145, headerHeight: 32 }, selectedId: this.completionSelected,
          onSelect: (id, _event, eventCx) => { this.completionSelected = id; eventCx.notify(); },
          onActivate: (_id, _event, eventCx) => { this.sample++; eventCx.notify(); }, onClose: () => {},
        })))
      .child(h_flex().gap(8).items_center().child(caption("줄 번호 오른쪽 탐색"))
        .children([["super", "상위 선언·인터페이스", "arrow-up"], ["implementation", "구현", "arrow-down"], ["spring", "Spring 빈", "layers"], ["http", "HTTP 요청 실행", "play"]].map(([kind, title, role]) =>
          adeGutterAction(`sample-gutter-${kind}`, { kind, title }, { graphic: () => icon(role, 14), onActivate: (_event, eventCx) => { this.sample++; eventCx.notify(); } }))))
      .child(v_flex().gap(4).child(adeNote("Git 파일 상태 · 색과 텍스트를 함께 표시"))
        .children([["fileModified", "수정됨"], ["fileAdded", "추가됨"], ["fileUntracked", "추적 안 됨"], ["fileRenamed", "이름 변경"], ["fileDeleted", "삭제됨"], ["fileConflict", "충돌"], ["fileIgnored", "Git 제외"]].map(([role, label]) => adeRow(`sample-${role}`, "example.ts", { labelColor: c[role], detail: label, icon: icon("file-text") }))))
      .child(v_flex().gap(4).child(adeRow("sample-row", "선택된 문서", { icon: icon("file-text"), selected: true })).child(adeRow("sample-detail", "보조 정보가 있는 항목", { icon: icon("folder"), detail: "샘플" })))
      .child(h_flex().gap(4).child(adeTab("sample-tab", "README.md", { icon: icon("file-text"), selected: true, onSelect: () => {} })))
      .child(caption(`관리 목록 · 행 위에서 동작 확인 / End·Home·PageUp·PageDown·휠 · ${this.verified ? `확인한 행: ${this.verified}` : "확인 동작 전"}`))
      .child(v_flex().h(240).flex_none().min_h(0).child(adeManagedList("sample-managed", [{ id: "sample-heading", heading: true, label: "관리 항목", detail: "100" }, ...Array.from({ length: 100 }, (_value, i) => ({ id: `row-${i}`, label: `관리 항목 ${i + 1}`, detail: "예시", icon: () => icon("folder") }))], this.menu, cx, {
        selectedId: this.selected, onSelect: (id, _event, eventCx) => { this.selected = id; eventCx.notify(); }, onClose: dismiss,
        rowActions: () => [{ id: "verify", label: "이 행 확인 · 예시", icon: () => icon("check"), action: (id, _event, eventCx) => { this.verified = id; eventCx.notify(); } }],
      })))
      .child(v_flex().h(180).flex_none().child(adeDialog("sample-dialog", { title: "다이얼로그 · 불투명 표면", body: caption("배경의 문서가 비치지 않는 ADE 공통 창입니다."), footer: [adeButton("sample-dialog-confirm", "확인 · 예시", () => {}, { kind: "primary" })] }).h(180)))
      .child(adeNote("빈 상태 · 아직 표시할 항목이 없습니다."))
      .child(caption("진행 상태 예시 · 데이터를 불러오는 중…"))
      .child(div().text_color(c.error).child("오류 상태 예시 · 연결하지 못했습니다. 다시 시도할 수 있습니다."))
      .child(h_flex().gap(8).children(["canvas", "editor", "surface", "selection", "accent"].map(role => v_flex().gap(5).child(div().w(90).h(35).rounded(4).border_1().border_color(c.separator).bg(c[role])).child(caption(role)))))
      .child(caption("상단 48 · 도구 제목 36 · 행 28 · 탭 40 · 하단 26 · 분할 경계 6px")), {
        actions: [adeButton("close-collection", null, dismiss, { icon: icon("x"), square: true, tip: "디자인 시스템 닫기" })],
      }).w(780).h(600);
  }
}
