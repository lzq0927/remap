import { useEffect, useState } from "react";
import { api } from "./api";
export type Task = {
  id: string;
  name: string;
  workspacePath: string;
  archived?: boolean;
  status?: string;
};
export default function TaskHome({ onOpen }: { onOpen: (task: Task) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]),
    [runtime, setRuntime] = useState<{
      profile: string;
      provider?: { name: string };
    }>(),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(""),
    [rename, setRename] = useState(""),
    [query, setQuery] = useState("");
  const matching = tasks.filter((task) =>
    task.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const refresh = async () => {
    const result = await api("/tasks?includeArchived=true");
    setTasks(Array.isArray(result) ? result : (result.tasks ?? []));
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    void api("/settings")
      .then((settings) => setRuntime(settings.runtime))
      .catch(() => undefined);
  }, []);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="task-home">
      <span className="eyebrow">
        ReMAP / Reliability Modeling and Analysis Platform
      </span>
      <h1>可靠性设计任务</h1>
      {runtime?.profile === "internal" && (
        <p className="note">
          企业模式 · {runtime.provider?.name} ·
          企业资产与运行记录保存到本机数据目录。
        </p>
      )}
      <p>
        新建或打开任务，开始设计、评估与交付。每个任务保存独立的输入、资产、流程和
        OpenCode 会话。
      </p>
      <form
        className="task-create paper"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () =>
            onOpen(await api("/tasks", { name: name.trim() })),
          );
        }}
      >
        <label>
          任务名称
          <input
            aria-label="新任务名称"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：训练集群可靠性设计"
          />
        </label>
        <button className="primary" disabled={busy || !name.trim()}>
          新建任务
        </button>
      </form>
      <label className="task-import">
        导入任务包
        <input
          aria-label="导入任务包"
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void act(async () =>
                onOpen(
                  await api("/tasks/import", {
                    bundle: JSON.parse(await file.text()),
                  }),
                ),
              );
            e.target.value = "";
          }}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="task-search">
        <label>
          搜索任务
          <input
            aria-label="搜索任务"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按任务名称查找"
          />
        </label>
        <span>
          {matching.length} / {tasks.length} 个任务
        </span>
      </div>
      <section aria-label="任务列表" className="task-list">
        {tasks.length === 0 && <p className="empty">暂无任务，请新建任务。</p>}
        {tasks.length > 0 && matching.length === 0 && (
          <p className="empty">没有匹配的任务</p>
        )}
        {matching.map((task) => {
          const archived = task.archived || task.status === "archived",
            prefix = "/tasks/" + encodeURIComponent(task.id);
          return (
            <article className="paper task-card" key={task.id}>
              <h2>{task.name}</h2>
              <span className="badge">{archived ? "已归档" : "进行中"}</span>
              {editing === task.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      await api(prefix, { name: rename }, "PATCH");
                      setEditing("");
                    });
                  }}
                >
                  <label>
                    重命名
                    <input
                      aria-label="重命名任务"
                      required
                      value={rename}
                      onChange={(e) => setRename(e.target.value)}
                    />
                  </label>
                  <button disabled={busy}>保存名称</button>
                  <button type="button" onClick={() => setEditing("")}>
                    取消
                  </button>
                </form>
              ) : (
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      archived
                        ? void act(async () =>
                            onOpen(await api(prefix + "/restore", {})),
                          )
                        : onOpen(task)
                    }
                  >
                    {archived ? "重新打开" : "打开任务"}
                  </button>
                  {!archived && (
                    <a
                      className="button"
                      href={"/api" + prefix + "/export"}
                      download
                    >
                      导出任务包
                    </a>
                  )}
                  {!archived && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(async () =>
                            onOpen(
                              await api(prefix + "/copy", {
                                name: task.name + " 副本",
                              }),
                            ),
                          )
                        }
                      >
                        复制任务
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setEditing(task.id);
                          setRename(task.name);
                        }}
                      >
                        重命名
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(() => api(prefix + "/archive", {}))
                        }
                      >
                        归档
                      </button>
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
