import { useState } from "react";
import { useTaskApi } from "./api";
import AuditExperimentResult from "./AuditExperimentResult";
import { layerDecisionSvg } from "../../../packages/reports/src/audit-layer-decision";
export default function AuditTrainingScenarioHistory() {
  const { api, url } = useTaskApi();
  const [runs, setRuns] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [comparison, setComparison] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const download = (data: Blob, filename: string) => {
    const u = URL.createObjectURL(data),
      a = document.createElement("a");
    a.href = u;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };
  const exportDiagram = async (png: boolean) => {
    try {
      const svg = layerDecisionSvg(
        comparison.result,
        comparison.result.request.cards,
      );
      const blob = new Blob([svg], { type: "image/svg+xml" });
      if (!png) {
        download(blob, "remap-training-layer-comparison.svg");
        return;
      }
      const u = URL.createObjectURL(blob);
      try {
        const im = new Image();
        im.src = u;
        await im.decode();
        const canvas = document.createElement("canvas");
        canvas.width = im.width;
        canvas.height = im.height;
        canvas.getContext("2d")!.drawImage(im, 0, 0);
        const out = await new Promise<Blob | null>((r) =>
          canvas.toBlob(r, "image/png"),
        );
        if (!out) throw Error("图片导出失败，请使用SVG");
        download(out, "remap-training-layer-comparison.png");
      } finally {
        URL.revokeObjectURL(u);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <details className="training-scenario-history">
      <summary>600小时场景历史与横向比较</summary>
      <p>
        分别载入、确认并完成各档评估后，在此刷新并选择最近100次主评估中的训练场景。保持相同架构、窗口与目标，允许调整FIT和措施；比较图沿用现状轮的分层预算，不修改旧结果。
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const history = (
              await api("/runs?view=summary&operation=audit&limit=100")
            ).items.filter(
              (r: any) =>
                r.status === "succeeded" &&
                r.kind === "expert-review-audit" &&
                r.trainingScenarioVersion === "training-600h.v1",
            );
            setRuns(history);
            setSelected((s) =>
              s.filter((id) => history.some((r: any) => r.id === id)),
            );
            setError("");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        刷新训练场景历史
      </button>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>选择</th>
              <th>已完成场景</th>
              <th>主规模可用度</th>
              <th>运行 / 时间</th>
              <th>报告</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              return (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`比较场景 ${r.id}`}
                      checked={selected.includes(r.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, r.id]
                            : selected.filter((id) => id !== r.id),
                        )
                      }
                    />
                  </td>
                  <th>{r.trainingScenarioName}</th>
                  <td>
                    {r.availability == null
                      ? "—"
                      : (r.availability * 100).toFixed(3) + "%"}
                  </td>
                  <td>
                    {r.id.slice(0, 8)}
                    <br />
                    {r.createdAt}
                  </td>
                  <td>
                    <a href={url(`/runs/${r.id}/report?format=html`)}>
                      独立报告
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        disabled={busy || selected.length < 2 || selected.length > 12}
        onClick={async () => {
          setBusy(true);
          try {
            setComparison(
              await api("/audit/compare?view=result", { runIds: selected }),
            );
            setError("");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        比较所选训练场景
      </button>
      {error && <p role="alert">{error}</p>}
      {comparison && (
        <>
          <p>
            <a href={url(`/runs/${comparison.id}/report?format=html`)}>
              下载训练场景比较报告
            </a>
          </p>
          <button type="button" onClick={() => exportDiagram(false)}>
            导出三档分层总图 SVG
          </button>
          <button type="button" onClick={() => exportDiagram(true)}>
            导出三档分层总图 PNG
          </button>
          <AuditExperimentResult result={comparison.result} />
        </>
      )}
    </details>
  );
}
