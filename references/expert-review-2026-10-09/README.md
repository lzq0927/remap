# Expert event and mechanism review reference

Pinned upstream: https://github.com/zy009197/ai-cluster-reliability at `683afe829313bfdcb249bc593e48df5b29813666`, directory `catalogs/review-2026-10-09`.

The reference HTML, raw input and mechanism catalogs, original engines, result data and review checks are preserved byte for byte. `config.json` is extracted from results; hashes are recorded in `manifest.json`.

ReMAP's `audit` operation uses retained clean progress / window hours. End-of-task pollution retains the last clean checkpoint. The legacy `training` V4 operation remains strict-clean-end and is not directly comparable.

The adapted `packages/solvers/src/vendor/review-engine.cjs` accepts isolated catalogs and mechanism policies, computes arrival rates from explicit category FIT totals, and supports an explicit permutation of replay/elastic/process fallback stages. Its default path is regression checked against the original engine and 4,000-trial reference baseline. Evidence labels are scenario provenance, not verified production observations. Updating interruption FIT never rescales the untouched slow/silent catalogs.

The original generation script `analyze.cjs` is now pinned too. The reproduction preset uses 4000 main trials (seed 20261009), 2000 trials per Shapley subset (seed 77334411), and 2000 trials per sensitivity point (seed 988133), normal 1.96 intervals, five main scales and four attribution scales. Sensitivity has the original 13 points at 500000 cards. Platform paired sensitivity deltas are relative to a same-count, same-seed current-parameter control; the original script did not calculate these deltas.

Reference-rate floating-point arithmetic is retained only for unchanged FIT catalogs when explicitly requested. Updated catalogs use their actual category FIT sums; historical requests without that option retain catalog arithmetic. Student-t intervals and extended scans remain available. Run `node --import tsx scripts/verify-expert-reproduction.ts` for full numeric acceptance against the pinned output.
