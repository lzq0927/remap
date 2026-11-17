import React from "react";
import { createRoot } from "react-dom/client";

/**
 * 默认进入四步工作台；经典工作台（专家模式）按需加载，样式互不影响。
 * 入口由地址栏 ?ui=classic 选择，自动化回归用 localStorage 的 remap.ui 固定。
 */
const requested = new URLSearchParams(location.search).get("ui");
const classic =
  (requested ?? localStorage.getItem("remap.ui") ?? "workbench") === "classic";
const root = createRoot(document.getElementById("root")!);

function ReturnToWorkbench() {
  return (
    <button
      type="button"
      onClick={() => {
        const params = new URLSearchParams(location.search);
        params.set("ui", "workbench");
        location.assign(location.pathname + "?" + params.toString());
      }}
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 1000,
        padding: "8px 14px",
        borderRadius: 999,
        border: "1px solid #cfd4dc",
        background: "#ffffff",
        color: "#101828",
        font: "500 13px system-ui, sans-serif",
        boxShadow: "0 4px 14px rgba(16,24,40,.12)",
        cursor: "pointer",
      }}
    >
      ← 返回四步工作台
    </button>
  );
}

if (classic)
  void Promise.all([
    import("./App"),
    import("./style.css"),
    import("./workspace.css"),
  ]).then(([{ default: App }]) =>
    root.render(
      <React.StrictMode>
        <App />
        {requested === "classic" && <ReturnToWorkbench />}
      </React.StrictMode>,
    ),
  );
else
  void Promise.all([
    import("./workbench/Root"),
    import("./workbench/workbench.css"),
  ]).then(([{ default: Root }]) =>
    root.render(
      <React.StrictMode>
        <Root />
      </React.StrictMode>,
    ),
  );
