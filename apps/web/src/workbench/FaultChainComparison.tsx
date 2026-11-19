import {
  applyMeasures,
  faultKindNames,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import { duration, hours, percent } from "./format";
import { Disclosure } from "./ui";

export default function FaultChainComparison() {
  const { model, analysis } = useWorkbench();
  const before = analysis.baseline.modules.flatMap((m) => m.modes);
  const after = analysis.design.modules.flatMap((m) => m.modes);
  const resolved = applyMeasures(model).modes;
  return (
    <Disclosure title="部件与故障模式：恢复链参数、频次和周损失前后对照">
      <p>
        按现状周损失排序。检测→恢复→回滚是检出分支，漏检另走总损失分支；影响系数把局部降容折算为整系统损失。表内为组合生效值，适用比例已计入。
      </p>
      <div className="rw-table-wrap">
        <table className="rw-table">
          <thead>
            <tr>
              <th>部件 / 故障模式</th>
              <th>阶段</th>
              <th>次/周</th>
              <th>检出率</th>
              <th>检测→恢复→回滚</th>
              <th>漏检总损失</th>
              <th>影响系数</th>
              <th>周损失</th>
              <th>对应措施</th>
            </tr>
          </thead>
          <tbody>
            {[...before]
              .sort((a, b) => b.lossHours - a.lossHours)
              .flatMap((b) => {
                const mode = model.modes.find((m) => m.id === b.id)!,
                  d = after.find((m) => m.id === b.id)!;
                return [b, d].map((row, i) => {
                  const p = i ? resolved.find((m) => m.id === b.id)! : mode;
                  return (
                    <tr key={`${b.id}-${i}`}>
                      <th>
                        {
                          model.modules.find((m) => m.id === mode.moduleId)
                            ?.name
                        }{" "}
                        · {mode.name}（{faultKindNames[mode.kind]}）
                      </th>
                      <td>{i ? "设计后" : "现状"}</td>
                      <td>{(row.rate * 168).toFixed(4)}</td>
                      <td>{percent(p.coverage, 3)}</td>
                      <td>
                        {duration(p.detectHours)} → {duration(p.recoverHours)} →{" "}
                        {duration(p.reworkHours)}
                      </td>
                      <td>{duration(p.missedLossHours)}</td>
                      <td>{percent(p.impact, 5)}</td>
                      <td>
                        {hours((row.lossHours * 168) / model.scenario.hours)}
                      </td>
                      <td>
                        {i
                          ? model.measures
                              .filter(
                                (m) => m.enabled && m.modeIds.includes(b.id),
                              )
                              .map((m) => m.name)
                              .join("；")
                          : "冻结现状故障链"}
                      </td>
                    </tr>
                  );
                });
              })}
          </tbody>
        </table>
      </div>
    </Disclosure>
  );
}
