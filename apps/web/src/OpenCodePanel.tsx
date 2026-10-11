import { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  RefreshCw,
  Plus,
  Copy,
  Link2,
  Settings,
} from "lucide-react";
import { useTaskApi } from "./api";

export default function OpenCodePanel({
  session,
  taskName,
  onSession,
  context,
  onNotice,
  onError,
  onExpand,
  beforeContext,
}: {
  session: string;
  taskName: string;
  onSession: (id: string) => void;
  context: unknown;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
  onExpand: () => void;
  beforeContext: () => Promise<unknown>;
}) {
  const { api, taskId } = useTaskApi();
  const [web, setWeb] = useState<any>();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const refreshing = useRef(false),
    disposed = useRef(false);
  const refresh = async () => {
    if (refreshing.current || disposed.current) return;
    refreshing.current = true;
    try {
      let info = await api("/agent/web");
      if (disposed.current) return;
      const selected = sessionRef.current;
      if (!selected || !info.sessions.some((s: any) => s.id === selected)) {
        const primary = await api("/agent/session", { purpose: "primary" });
        if (disposed.current) return;
        sessionRef.current = primary.sessionId;
        onSession(primary.sessionId);
        info = await api("/agent/web");
      }
      if (disposed.current) return;
      setWeb(info);
      setConnected(true);
    } catch {
      if (!disposed.current) setConnected(false);
    } finally {
      refreshing.current = false;
    }
  };
  useEffect(() => {
    disposed.current = false;
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      disposed.current = true;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!web?.url) return;
    setUrl(session ? web.projectUrl + "/" + encodeURIComponent(session) : "");
  }, [session, web?.url, web?.directory]);
  const create = async (purpose: "primary" | "topic" = "primary") => {
    setBusy(true);
    try {
      const s = await api("/agent/session", {
        name: `[${taskId.slice(0, 8)}] ${taskName} · ${purpose === "primary" ? "主会话" : "专题"}`,
        purpose,
      });
      onSession(s.sessionId);
      await refresh();
      onNotice("已创建本地 OpenCode 会话；模型与 Provider 在官方界面选择。");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="agent official-agent" aria-label="本地官方 OpenCode">
      <div className="agent-head">
        <div>
          <strong>OpenCode</strong>
          <span className="badge">本地官方界面</span>
        </div>
        <span className={"connection " + (connected ? "online" : "")}>
          {connected ? `已连接 · ${web?.version ?? ""}` : "未连接"}
        </span>
      </div>
      <div className="agent-toolbar">
        <label>
          关联会话
          <select
            aria-label="关联 OpenCode 会话"
            value={session}
            onChange={(e) => onSession(e.target.value)}
          >
            <option value="">请创建或选择当前任务的会话</option>
            {web?.sessions?.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.title} · {s.id.slice(-6)}
              </option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button disabled={busy || !connected} onClick={() => void create()}>
            <Plus size={14} />
            新建关联会话
          </button>
          <button
            disabled={busy || !connected}
            onClick={() => void create("topic")}
          >
            新建专题会话
          </button>
          <button
            disabled={!session || !connected || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await beforeContext();
                await api(`/agent/${session}/context`, context);
                onNotice(
                  "当前设计已写入关联会话；尚未调用模型。请在官方输入框提出评估要求。",
                );
              } catch (e) {
                onError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Link2 size={14} />
            同步当前设计
          </button>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText("/sd-dfr-remap");
                onNotice("已复制 /sd-dfr-remap，粘贴到官方输入框后发送。");
              } catch {
                onNotice("请在官方输入框输入 /sd-dfr-remap。");
              }
            }}
          >
            <Copy size={14} />
            复制 Skill 命令
          </button>
        </div>
        <div className="agent-controls">
          <button disabled={!web} onClick={() => setUrl(web.url + "/")}>
            <Settings size={14} />
            官方设置
          </button>
          <button
            disabled={!session || !web}
            onClick={() => setUrl(web.projectUrl + "/" + session)}
          >
            返回关联会话
          </button>
          <button onClick={onExpand}>放大面板</button>
          <button
            aria-label="刷新 OpenCode 页面"
            onClick={() => {
              void refresh();
              setUrl(url ? url.split("?")[0] + "?remReload=" + Date.now() : "");
            }}
          >
            <RefreshCw size={14} />
          </button>
          {web && (
            <a
              href={url || web.url}
              target="_blank"
              rel="noreferrer"
              aria-label="独立打开本地 OpenCode"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
        <p>
          模型选择在官方输入框旁；API Key、自定义 Base URL 与模型在官方「设置 →
          提供商」配置。请使用上方按钮创建任务会话；此列表只显示当前任务绑定的会话。
        </p>
      </div>
      {connected && url ? (
        <iframe
          className="opencode-frame"
          title="本地官方 OpenCode Web"
          src={url}
          allow="clipboard-read; clipboard-write"
        />
      ) : connected ? (
        <div className="agent-offline">
          <h3>当前任务尚未关联会话</h3>
          <p>创建任务会话后，在官方界面选择模型和提供商。</p>
        </div>
      ) : (
        <div className="agent-offline">
          <h3>启动本地 OpenCode</h3>
          <p>
            在项目目录运行 <code>pnpm agent</code>，连接后会直接载入官方 Web
            界面。
          </p>
          <button onClick={refresh}>重新检测</button>
        </div>
      )}
    </aside>
  );
}
