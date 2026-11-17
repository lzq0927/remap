import { useEffect, useState } from "react";
import { api } from "../api";
import Home, { type Task } from "./Home";
import Workbench from "./Workbench";

const taskUrl = (id?: string) =>
  location.pathname + (id ? "?task=" + encodeURIComponent(id) : "");

/** 入口：没有打开任务时显示任务主页，否则进入四步工作台。 */
export default function Root() {
  const [task, setTask] = useState<Task>(),
    [opening, setOpening] = useState(() =>
      new URLSearchParams(location.search).has("task"),
    );
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("task");
    if (!id) return;
    void api("/tasks/" + encodeURIComponent(id))
      .then((selected: Task) => {
        if (selected.status === "archived")
          history.replaceState(null, "", taskUrl());
        else setTask(selected);
      })
      .catch(() => history.replaceState(null, "", taskUrl()))
      .finally(() => setOpening(false));
  }, []);
  const open = (selected?: Task) => {
    history.replaceState(null, "", taskUrl(selected?.id));
    setTask(selected);
  };
  if (opening)
    return (
      <p className="rw-loading" role="status">
        正在打开任务…
      </p>
    );
  if (!task) return <Home onOpen={open} />;
  return (
    <Workbench
      key={task.id}
      task={task}
      onHome={() => open()}
      onRename={(name) => setTask({ ...task, name })}
    />
  );
}
