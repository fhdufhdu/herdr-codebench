import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { shared, setShared, closeOverlay } from "herdr";
import { currentProject, projectKey, documentState } from "./workspace.js";
import { adeButton, adeNote, adeDialog, uiSpinner } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";

export function fileAnalysisState(context = currentProject()) {
  const key = projectKey(context), path = documentState(context).active;
  if ((shared("ade.editor-mode")?.[key] ?? "file") !== "file" || !path) return { status: "idle", path: null };
  if (context.machine) return { status: "unsupported", path, message: "원격 파일은 로컬 언어 서버를 사용하지 않습니다." };
  if (/\.(http|rest)$/i.test(path)) return { status: "local", path, message: "HTTP 메서드·URL·헤더 형식을 검사하고, 메서드·헤더·파일 변수 자동완성을 제공합니다." };
  if (/\.sql$/i.test(path)) return { status: "local", path, message: "이 파일은 로컬 문맥 분석을 사용합니다. DB 컬럼 추천은 연결된 SQL 콘솔에서 제공합니다." };
  const outline = shared("ade.outline")?.[key];
  return outline?.path === path ? { path, status: outline.lspStatus ?? outline.status, error: outline.lspError ?? outline.error,
    diagnostics: outline.diagnosticCount, revision: outline.revision } : { path, status: "pending" };
}
export const fileAnalysisLabel = state => ({ idle: "파일 분석", pending: "파일 분석 중", loading: "파일 분석 중", syncing: "파일 분석 중",
  requesting: "파일 분석 중", ready: "LSP 준비됨", preview: "문서 미리보기", unsupported: "LSP 미지원", unavailable: "LSP 연결 없음", local: "문맥 분석", error: "LSP 확인 필요" }[state?.status] ?? "파일 분석 중");
export function fileAnalysisButton(action) {
  const state = fileAnalysisState(), busy = ["pending", "loading", "syncing", "requesting"].includes(state.status);
  return adeButton("file-analysis", fileAnalysisLabel(state), action, {
    icon: busy ? uiSpinner(() => uiIcon("progress", 14), { size: 14 }) : uiIcon(state.status === "error" ? "triangle-alert" : state.status === "ready" ? "check" : "layers", 14),
    tip: state.path ? `${state.path} · 현재 파일 분석 상태` : "파일을 열면 해당 파일의 언어 서버를 연결합니다.",
  });
}
export class FileAnalysisView {
  init(props) { this.props = props; }
  retry(context, state, cx) {
    if (!state.path) return;
    setShared("ade.analysis-request", { ...shared("ade.analysis-request"), [projectKey(context)]: { path: state.path, at: Date.now() } });
    cx.notify();
  }
  render(cx) {
    const context = this.props.context ?? currentProject(), state = fileAnalysisState(context);
    return adeDialog("file-analysis-dialog", { title: "현재 파일 분석",
      body: v_flex().flex_1().min_h(0).gap(12)
        .child(div().font_semibold().whitespace_normal().child(state.path || "열린 소스 파일이 없습니다."))
        .child(adeNote(fileAnalysisLabel(state)))
        .when(Boolean(state.error || state.message), element => element.child(adeNote(state.error || state.message)))
        .when(state.diagnostics != null, element => element.child(adeNote(`진단 ${state.diagnostics}개 · 문서 revision ${state.revision ?? "—"}`)))
        .child(adeNote("파일을 열 때 분석을 연결합니다. 프로젝트 전체 사전 준비는 실행하지 않습니다.")),
      footer: [adeButton("file-analysis-retry", "다시 연결", (_event, eventCx) => this.retry(context, state, eventCx), { disabled: !state.path || context.machine || ["unsupported", "local", "preview"].includes(state.status) }),
        adeButton("file-analysis-close", "닫기", () => closeOverlay(this.props.overlay))],
    }).h(320);
  }
}
