import math
import pytest
from solver import solve

def test_two_state_exact():
    r=solve({'Q':[[-.01,.01],[1,-1]], 'p0':[1,0], 'times':[0,1,10], 'rewards':[1,0]})
    assert r['stationary'][0] == pytest.approx(1/1.01, abs=1e-12)
    assert r['transient'][1]['reward'] == pytest.approx(1/1.01+.01/1.01*math.exp(-1.01),abs=1e-12)
    assert r['integratedReward'] == pytest.approx(10/1.01+.01/1.01**2*(1-math.exp(-10.1)),abs=1e-12)

def test_nonunique_stationary_rejected():
    with pytest.raises(ValueError,match='unique'):
        solve({'Q':[[0,0],[0,0]],'p0':[1,0],'times':[1]})

def test_generator_rejected():
    with pytest.raises(ValueError,match='generator'):
        solve({'Q':[[-1,2],[1,-1]],'p0':[1,0],'times':[1]})

def test_schema_and_distribution_rejected():
    base={'Q':[[-.01,.01],[1,-1]],'p0':[1,0],'times':[1]}
    with pytest.raises(ValueError,match='exponential'):
        solve({**base,'distribution':'weibull'})
    with pytest.raises(ValueError,match='unsupported'):
        solve({**base,'extra':1})

def test_unique_closed_class_with_tiny_transient_rate():
    r=solve({'Q':[[-1e-18,1e-18,0],[0,-1,1],[0,1,-1]],'p0':[1,0,0],'times':[1]})
    assert r['stationary'] == pytest.approx([0,.5,.5],abs=1e-12)
