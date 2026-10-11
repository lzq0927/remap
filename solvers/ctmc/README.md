The solver reads one JSON request from stdin and prints one JSON result. Requests use row-generator convention `p(t) = p0 exp(Q t)`. `Q` is square, off-diagonal rates nonnegative and row sums zero; `p0` sums to one. Times are nonnegative and sorted. Rewards are finite values assigned to states.

The stationary distribution must be unique, or the request fails explicitly. Transient probabilities are evaluated with SciPy's matrix exponential. `integratedReward` is the expected cumulative reward from time zero to the last requested time, obtained from an augmented matrix exponential. Rates and times must use reciprocal units.

Set `RELIABILITY_PYTHON` to a Python executable when the bundled runtime is absent. The Node adapter prepends this folder's ignored `.python-deps` directory to `PYTHONPATH`. Install prerequisites locally:

```powershell
& $env:RELIABILITY_PYTHON -m pip install --target solvers/ctmc/.python-deps -r solvers/ctmc/requirements.txt
```

Verified runtime: Python 3.12, SciPy 1.17.1, NumPy 2.5.3, pytest 9.0.2. No system packages were modified. The plugin limits states to 128, requested times to 1000 and wall time to 30 seconds. CTMC does not replace the non-Markov expert training model.
