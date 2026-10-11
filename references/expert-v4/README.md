Pinned repository: https://github.com/zy009197/ai-cluster-reliability

Commit: `683afe829313bfdcb249bc593e48df5b29813666`.

The acceptance entry for the legacy `training` operation is the root `正确有效产出改进分析.html`, model `4.0-domain-ledger`. `config.json` and `baseline.json` are extracted from its `precomputed` JSON. Baseline is 7200 seconds compute and 10 seconds checkpoint save. Unresolved terminal corruption sets all delivery to zero. The `audit` operation instead follows `../expert-review-2026-10-09`, retaining the last clean checkpoint at task end. These are distinct metrics; neither is an interchangeable oracle for the other.

The standalone `正确有效产出改进分析数据.json` at this commit differs from the HTML: its 1000-card baseline mean is 0.9793583278785303, while the HTML is 0.984938646066475. Tests use the HTML precomputed data explicitly.

`manifest.json` records SHA256 for downloaded source snapshots and extracted inputs. `packages/solvers/src/vendor/monthly-engine.cjs` and `shapley.cjs` are byte-identical copies of the root JS sources, with only filenames changed for CommonJS loading. Tests compare original and adapter pathwise values, conserve loss ledgers, verify terminal semantics and match the HTML's 2048-trial baseline.

The upstream code provides no license file in the root tree snapshot. Distribution permission must be resolved before public release.
