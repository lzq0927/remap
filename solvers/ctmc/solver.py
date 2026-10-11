"""SciPy CTMC solver; JSON stdin/stdout, no external side effects."""
import json
import sys
import numpy as np
from scipy.linalg import expm

def solve(request):
    if not isinstance(request, dict):
        raise ValueError('CTMC request must be an object')
    unsupported = set(request) - {'Q', 'p0', 'times', 'rewards', 'distribution'}
    if unsupported:
        raise ValueError('unsupported CTMC schema keys: ' + ', '.join(sorted(unsupported)))
    if request.get('distribution', 'exponential') != 'exponential':
        raise ValueError('CTMC supports only exponential holding-time distributions')
    q = np.asarray(request['Q'], dtype=float)
    if q.ndim != 2 or q.shape[0] != q.shape[1] or not 1 <= len(q) <= 128:
        raise ValueError('generator Q must be square with 1..128 states')
    n = len(q)
    off = q.copy()
    np.fill_diagonal(off, 0)
    if not np.all(np.isfinite(q)) or np.any(off < 0) or np.any(np.diag(q) > 0) or not np.allclose(q.sum(axis=1), 0, atol=1e-10, rtol=0):
        raise ValueError('invalid generator: nonnegative off-diagonal and zero row sums required')
    p0 = np.asarray(request['p0'], dtype=float)
    if p0.shape != (n,) or not np.all(np.isfinite(p0)) or np.any(p0 < 0) or not np.isclose(p0.sum(), 1):
        raise ValueError('p0 must be a probability vector')
    times = np.asarray(request['times'], dtype=float)
    if times.ndim != 1 or not 1 <= len(times) <= 1000 or not np.all(np.isfinite(times)) or np.any(times < 0) or np.any(np.diff(times) < 0):
        raise ValueError('times must be nondecreasing finite nonnegative values, at most 1000')
    rewards = np.asarray(request.get('rewards', [1] + [0]*(n-1)), dtype=float)
    if rewards.shape != (n,) or not np.all(np.isfinite(rewards)):
        raise ValueError('rewards must be a finite state vector')
    # Uniqueness is structural: exactly one closed communicating class.
    # Numerical rank can incorrectly treat an arbitrarily small positive rate as zero.
    reach = off > 0
    np.fill_diagonal(reach, True)
    for state in range(n):
        reach |= reach[:, state, None] & reach[None, state, :]
    unassigned = set(range(n))
    closed_classes = []
    while unassigned:
        representative = min(unassigned)
        component = np.flatnonzero(reach[representative] & reach[:, representative])
        unassigned.difference_update(component.tolist())
        outside = np.array([i for i in range(n) if i not in component], dtype=int)
        if not len(outside) or not np.any(off[np.ix_(component, outside)] > 0):
            closed_classes.append(component)
    if len(closed_classes) != 1:
        raise ValueError('stationary distribution is not unique; multiple closed communicating classes')
    closed = closed_classes[0]
    system = q[np.ix_(closed, closed)].T.copy()
    system[-1] = 1
    rhs = np.zeros(len(closed))
    rhs[-1] = 1
    stationary = np.zeros(n)
    stationary[closed] = np.linalg.solve(system, rhs)
    if np.any(stationary < -1e-9) or np.max(np.abs(stationary @ q)) > 1e-8:
        raise ValueError('stationary solution failed residual checks')
    rows = []
    for t in times:
        p = p0 @ expm(q*t)
        if np.min(p) < -1e-9 or abs(p.sum()-1) > 1e-8:
            raise ValueError('transient probability residual check failed')
        rows.append({'time':float(t), 'probabilities':p.tolist(), 'reward':float(p @ rewards)})
    augmented = np.zeros((n+1,n+1))
    augmented[:n,:n] = q
    augmented[:n,n] = rewards
    integrated = float(p0 @ expm(augmented*times[-1])[:n,n])
    return {'solver':'SciPy expm', 'stationary':stationary.tolist(), 'stationaryReward':float(stationary @ rewards), 'transient':rows, 'integratedReward':integrated, 'diagnostics':{'stationaryResidual':float(np.max(np.abs(stationary @ q))), 'generatorResidual':float(np.max(np.abs(q.sum(axis=1))))}, 'assumptions':['Finite homogeneous continuous-time Markov chain', 'Rates in inverse units of times']}

if __name__ == '__main__':
    try:
        print(json.dumps(solve(json.load(sys.stdin)), allow_nan=False))
    except Exception as error:
        print(json.dumps({'error':str(error)}))
        sys.exit(1)
