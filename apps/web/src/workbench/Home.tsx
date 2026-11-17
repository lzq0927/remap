import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowRight,
  Copy,
  Download,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Upload,
} from "lucide-react";
import { api } from "../api";

export type Task = {
  id: string;
  name: string;
  workspacePath?: string;
  archived?: boolean;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
};

const steps = [
  ["目标分配", "把系统可用度目标分到每个模块"],
  ["可用度评估", "看清各模块的故障率、损失时间和差距"],
  ["机制设计", "选择提升 MTBF、降低 MTTR 的措施"],
  ["机制验证", "用独立仿真确认设计能否达标"],
];

export default function Home({ onOpen }: { onOpen: (task: Task) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]),
    [loaded, setLoaded] = useState(false),
    [name, setName] = useState(""),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(""),
    [rename, setRename] = useState(""),
    [showArchived, setShowArchived] = useState(false),
    fileInput = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    const result = await api("/tasks?includeArchived=true");
    setTasks(Array.isArray(result) ? result : (result.tasks ?? []));
    setLoaded(true);
  };
  useEffect(() => {
    void refresh().catch((e) => setError((e as Error).message));
  }, []);
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await run();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const isArchived = (task: Task) =>
      task.archived || task.status === "archived",
    active = tasks.filter((task) => !isArchived(task)),
    archived = tasks.filter(isArchived),
    needle = query.trim().toLocaleLowerCase(),
    visible = (showArchived ? archived : active).filter((task) =>
      task.name.toLocaleLowerCase().includes(needle),
    );
  return (
    <main className="rw-home">
      <header className="rw-home-hero">
        <div className="rw-brand">
          <span className="rw-logo" aria-hidden>
            R
          </span>
          <span>ReMAP</span>
        </div>
        <h1>系统可用度设计与评估</h1>
        <p>从目标到验证，四步完成一次可用度设计。</p>
        <ol className="rw-home-steps">
          {steps.map(([title, text], index) => (
            <li key={title}>
              <span>{index + 1}</span>
              <div>
                <strong>{title}</strong>
                <small>{text}</small>
              </div>
            </li>
          ))}
        </ol>
      </header>
      <section className="rw-home-body">
        <form
          className="rw-home-create"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () =>
              onOpen(await api("/tasks", { name: name.trim() })),
            );
          }}
        >
          <input
            aria-label="新任务名称"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="给新任务起个名字，例如：50 万卡集群周度可用度"
          />
          <button
            className="rw-button is-primary"
            disabled={busy || !name.trim()}
          >
            <Plus size={16} aria-hidden />
            新建任务
          </button>
          <button
            type="button"
            className="rw-button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={16} aria-hidden />
            导入任务包
          </button>
          <input
            ref={fileInput}
            hidden
            aria-label="导入任务包"
            type="file"
            accept="application/json,.json"
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
        </form>
        {error && (
          <p className="rw-alert is-bad" role="alert">
            {error}
          </p>
        )}
        <div className="rw-home-toolbar">
          <div className="rw-tabs" role="tablist" aria-label="任务筛选">
            <button
              role="tab"
              aria-selected={!showArchived}
              className={!showArchived ? "is-active" : ""}
              onClick={() => setShowArchived(false)}
            >
              进行中 {active.length}
            </button>
            <button
              role="tab"
              aria-selected={showArchived}
              className={showArchived ? "is-active" : ""}
              onClick={() => setShowArchived(true)}
            >
              已归档 {archived.length}
            </button>
          </div>
          <label className="rw-search">
            <Search size={15} aria-hidden />
            <input
              aria-label="搜索任务"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索任务"
            />
          </label>
        </div>
        <section aria-label="任务列表" className="rw-task-list">
          {loaded && visible.length === 0 && (
            <p className="rw-empty">
              {needle
                ? "没有匹配的任务。"
                : showArchived
                  ? "没有已归档的任务。"
                  : "还没有任务。在上方输入名称，新建第一个任务。"}
            </p>
          )}
          {visible.map((task) => {
            const prefix = "/tasks/" + encodeURIComponent(task.id);
            return (
              <article key={task.id} className="rw-task">
                {editing === task.id ? (
                  <form
                    className="rw-task-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(async () => {
                        await api(prefix, { name: rename.trim() }, "PATCH");
                        setEditing("");
                      });
                    }}
                  >
                    <input
                      aria-label="重命名任务"
                      autoFocus
                      required
                      maxLength={120}
                      value={rename}
                      onChange={(e) => setRename(e.target.value)}
                    />
                    <button className="rw-button is-primary" disabled={busy}>
                      保存
                    </button>
                    <button
                      type="button"
                      className="rw-button"
                      onClick={() => setEditing("")}
                    >
                      取消
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      className="rw-task-open"
                      disabled={busy}
                      onClick={() =>
                        showArchived
                          ? void act(async () =>
                              onOpen(await api(prefix + "/restore", {})),
                            )
                          : onOpen(task)
                      }
                    >
                      <strong>{task.name}</strong>
                      <span>
                        {showArchived ? (
                          <>
                            <RotateCcw size={14} aria-hidden />
                            恢复并打开
                          </>
                        ) : (
                          <>
                            打开
                            <ArrowRight size={14} aria-hidden />
                          </>
                        )}
                      </span>
                    </button>
                    {!showArchived && (
                      <div className="rw-task-actions">
                        <button
                          className="rw-icon-button"
                          title="重命名"
                          aria-label={"重命名 " + task.name}
                          onClick={() => {
                            setEditing(task.id);
                            setRename(task.name);
                          }}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="rw-icon-button"
                          title="复制"
                          aria-label={"复制 " + task.name}
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
                          <Copy size={15} />
                        </button>
                        <a
                          className="rw-icon-button"
                          title="导出任务包"
                          aria-label={"导出 " + task.name}
                          href={"/api" + prefix + "/export"}
                          download
                        >
                          <Download size={15} />
                        </a>
                        <button
                          className="rw-icon-button"
                          title="归档"
                          aria-label={"归档 " + task.name}
                          disabled={busy}
                          onClick={() =>
                            void act(() => api(prefix + "/archive", {}))
                          }
                        >
                          <Archive size={15} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}
