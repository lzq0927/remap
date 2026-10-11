import chokidar from "chokidar";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Store } from "../../assets/src/store";
import { parseInput } from "./parser";
export function watchInputs(store: Store, roots: string[], canIngest = () => true) {
  if (!roots.length) return undefined;
  const watcher = chokidar.watch(
    roots.map((r) => resolve(r)),
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 750, pollInterval: 100 },
      ignored: (path) => path.includes("node_modules") || path.includes(".git"),
    },
  );
  const ingest = async (path: string) => {
    try {
      if (!canIngest()) return;
      const bytes = await readFile(path);
      if (bytes.length > 20 * 1024 * 1024) return;
      const d = await parseInput(basename(path), bytes);
      if (!canIngest()) return;
      store.putDocument("input", {
        ...d,
        watchedPath: path,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      if (!canIngest()) return;
      store.putDocument("watch-error", {
        path,
        error: String(e),
        createdAt: new Date().toISOString(),
      });
    }
  };
  watcher.on("add", ingest).on("change", ingest);
  return watcher;
}
