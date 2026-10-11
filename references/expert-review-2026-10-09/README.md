# Expert event and mechanism review reference

Pinned upstream: https://github.com/zy009197/ai-cluster-reliability at `683afe829313bfdcb249bc593e48df5b29813666`, directory `catalogs/review-2026-10-09`.

The reference HTML, raw input and mechanism catalogs, original engines, result data and review checks are preserved byte for byte. `config.json` is extracted from results; hashes are recorded in `manifest.json`.

ReMAP's `audit` operation uses retained clean progress / window hours. End-of-task pollution retains the last clean checkpoint. The legacy `training` V4 operation remains strict-clean-end and is not directly comparable.

The adapted `packages/solvers/src/vendor/review-engine.cjs` accepts isolated catalogs and mechanism policies, computes arrival rates from explicit category FIT totals, and supports an explicit permutation of replay/elastic/process fallback stages. Its default path is regression checked against the original engine and 4,000-trial reference baseline. Evidence labels are scenario provenance, not verified production observations. Updating interruption FIT never rescales the untouched slow/silent catalogs.

Original reference CI uses 1.96; ReMAP uses its existing fixed-sample Student-t interval with approximate quantiles. Tests match pathwise values, means and accounting; CI half-widths are intentionally not asserted identical.
