import { useMemo, useState } from "react";
import FullscreenLayer from "./FullscreenLayer";
import {
  analysisContext,
  analysisWorkbenchHtml,
  analysisNodeDetail,
  analysisViews,
  type WorkflowAnalysisView as AnalysisView,
} from "../../../packages/reports/src/audit-analysis-workbench";
import { analysisWorkbenchCss } from "../../../packages/reports/src/audit-analysis-styles";
export default function AuditAnalysisWorkbench({
  result,
  cards: controlledCards,
  onCardsChange,
}: {
  result: any;
  cards?: number;
  onCardsChange?: (n: number) => void;
}) {
  const [localCards, setCards] = useState(result.request?.cards ?? 500000),
    [view, setView] = useState<AnalysisView>("overview"),
    [stageName, setStageName] = useState<string>(),
    [parentId, setParentId] = useState("system"),
    [detail, setDetail] = useState(""),
    [full, setFull] = useState(false);
  const cards = controlledCards ?? localCards;
  const ctx = useMemo(
    () => analysisContext(result, cards, stageName),
    [result, cards, stageName],
  );
  const html = useMemo(
    () => analysisWorkbenchHtml(result, cards, view, stageName, parentId),
    [result, cards, view, stageName, parentId],
  );
  if (!ctx)
    return (
      <p className="analysis-empty">
        本快照未保存超节点分层证据；可在分层诊断中查看原有数据。
      </p>
    );
  const d = ctx.d;
  const selectCards = (value: number) => {
    setCards(value);
    onCardsChange?.(value);
    setDetail("");
  };
  const download = () => {
    const output = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>ReMAP ${ctx.stage.name} 分析</title><style>${analysisWorkbenchCss}</style>${html}</html>`;
    const u = URL.createObjectURL(
      new Blob([output], { type: "text/html;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = `ReMAP-${cards}-${view}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };
  const content = (
    <section
      className={full ? "analysis-full" : "analysis-workbench"}
      aria-label="现状与目标分析工作台"
    >
      <style>{analysisWorkbenchCss}</style>
      <div className="analysis-toolbar">
        <strong>可靠性分析</strong>
        <label>
          规模{" "}
          <select
            aria-label="分析规模"
            value={ctx.scale.cards}
            onChange={(e) => selectCards(Number(e.target.value))}
          >
            {d.scales.map((s) => (
              <option key={s.cards} value={s.cards}>
                {(s.cards / 10000).toLocaleString()}万卡
              </option>
            ))}
          </select>
        </label>
        <label>
          快照{" "}
          <select
            aria-label="分析快照"
            value={ctx.stage.name}
            onChange={(e) => {
              setStageName(e.target.value);
              setDetail("");
            }}
          >
            {ctx.scale.scenarios.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
                {s.name === ctx.scale.reference ? "（分配参照）" : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setFull(!full)}>
          {full ? "退出分析全屏（Esc）" : "全屏分析"}
        </button>
        <button type="button" onClick={download}>
          导出当前分析 HTML
        </button>
      </div>
      <div className="analysis-tabs" role="group" aria-label="可靠性分析内容">
        {analysisViews.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => {
              setView(v.id);
              setDetail("");
            }}
          >
            {v.name}
          </button>
        ))}
        <label>
          更多分析
          <select
            aria-label="更多分析视图"
            value={["scales", "research"].includes(view) ? view : ""}
            onChange={(e) => {
              setView(e.target.value as AnalysisView);
              setDetail("");
            }}
          >
            <option value="" disabled>
              选择补充视图
            </option>
            <option value="scales">分规模与三阶段</option>
            <option value="research">2026实践与资源条件</option>
          </select>
        </label>
      </div>
      {view === "architecture" && (
        <label>
          分解层级{" "}
          <select
            aria-label="分析分解层级"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="system">系统六个责任域</option>
            {ctx.stage.nodes
              .filter(
                (n) =>
                  n.id !== "system" &&
                  ctx.stage.nodes.some((c) => c.parentId === n.id),
              )
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <div
        onClick={(e) => {
          const target = (e.target as Element).closest<HTMLElement>(
            "[data-analysis-node]",
          );
          if (target) setDetail(target.dataset.analysisNode ?? "");
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
  return (
    <>
      {full ? (
        <FullscreenLayer label="可靠性分析全屏" onClose={() => setFull(false)}>
          {content}
        </FullscreenLayer>
      ) : (
        content
      )}
      {detail && (
        <FullscreenLayer label="子系统分解详情" onClose={() => setDetail("")}>
          <div className="analysis-detail-dialog">
            <style>{analysisWorkbenchCss}</style>
            <button type="button" onClick={() => setDetail("")}>
              关闭部件详情
            </button>
            <div
              dangerouslySetInnerHTML={{
                __html: analysisNodeDetail(ctx.stage, d, cards, detail),
              }}
            />
          </div>
        </FullscreenLayer>
      )}
    </>
  );
}
