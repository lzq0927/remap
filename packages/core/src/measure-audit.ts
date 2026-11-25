import type { CoreModel } from "./model";

/**
 * 早期措施库把“阶段节省”写成了整段恢复时间（252 秒减去节省量），会抹掉校准后的恢复残差。
 * 这里只识别库里这六项的原始数值，不改动人工编辑过的目标。
 */
const stageSavings: Record<
  string,
  { seconds: number; name: string; rationale: string }
> = {
  "recovery-classify": {
    seconds: 64.8,
    name: "故障诊断与自动恢复编排",
    rationale:
      "候选：诊断后选择重试、进程重启、隔离换卡等动作，将额外2小时人工升级概率从1%降到0.1%，仅减少期望人工耗时64.8秒；保留其余恢复段和校准残差。适用事件、误判与额外尝试开销待验证；这些概率不是厂商实测指标。",
  },
  "runtime-snapshot": {
    seconds: 45,
    name: "运行时初始化快照",
    rationale:
      "用初始化镜像恢复运行时，启动阶段从 60 秒缩到 15 秒，恢复总时长减少 45 秒。",
  },
  "warm-process": {
    seconds: 40,
    name: "预热进程与可信状态接替",
    rationale:
      "保持预热的备用进程，启动阶段从 60 秒缩到 20 秒，恢复总时长减少 40 秒。",
  },
  "hccl-elastic": {
    seconds: 45,
    name: "HCCL 通信域弹性重建",
    rationale: "通信重建阶段从 60 秒压到 15 秒，恢复总时长减少 45 秒。",
  },
  "cann-graph": {
    seconds: 22.5,
    name: "CANN 图准备与启动缓存",
    rationale:
      "缓存图编译与准备结果，图准备阶段从 30 秒降到 7.5 秒，恢复总时长减少 22.5 秒。",
  },
  "lossless-checkpoint": {
    seconds: 20,
    name: "无损检查点压缩",
    rationale:
      "检查点压缩后读取 30 秒、解压 10 秒，读取阶段从 60 秒降到 40 秒，恢复总时长减少 20 秒。不改变保存周期。",
  },
};
const elasticNote = {
  name: "DP副本级局部恢复",
  rationale:
    "候选：50个训练DP副本，98%的适用事件仅一个副本暂停，健康副本继续；其余退回全局恢复。DP副本不是机柜或超节点，须验证TP/PP边界、框架成员变化、备用资源及可信状态。当前只用影响系数近似，50与98%未获工程确认。",
};

export function auditLibraryMeasures(model: CoreModel) {
  return model.measures.flatMap((measure) => {
    const saving = stageSavings[measure.id];
    if (!saving) return [];
    // 早期的“恢复时间”读入后对应 CKPT 回滚一级的耗时。
    return measure.effects.flatMap((effect, index) =>
      effect.param === "restart.hours" &&
      effect.op === "set" &&
      Math.abs(effect.value * 3600 - (252 - saving.seconds)) < 1e-8
        ? [
            {
              id: measure.id,
              name: measure.name,
              index,
              seconds: saving.seconds,
            },
          ]
        : [],
    );
  });
}

/** 显式修正：返回一份新模型，由调用方保留旧模型和旧的验证记录。 */
export function correctLibraryMeasures(model: CoreModel): CoreModel {
  const next = structuredClone(model);
  for (const issue of auditLibraryMeasures(model)) {
    const measure = next.measures.find((m) => m.id === issue.id)!,
      source = stageSavings[issue.id];
    measure.effects[issue.index] = {
      param: "restart.hours",
      op: "subtract",
      value: issue.seconds / 3600,
    };
    measure.name = source.name;
    measure.rationale = source.rationale;
    measure.source += "；2026-11-19审计：仅扣阶段节省，保留校准恢复残差";
  }
  const elastic = next.measures.find((m) => m.id === "elastic-recover");
  if (elastic?.name === "域级弹性恢复") {
    elastic.name = elasticNote.name;
    elastic.rationale = elasticNote.rationale;
  }
  return next;
}
