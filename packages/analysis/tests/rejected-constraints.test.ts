import {test,expect} from 'vitest';
import {search} from '../src/index';
import {getTrainingDefaults} from '../../solvers/src/training';
import {allocate} from '../../allocation/src/index';
test('unknown search constraints are rejected rather than ignored',()=>{expect(()=>search({base:getTrainingDefaults(),designSpace:{saveSeconds:[0]},locked:{saveSeconds:10}}as any)).toThrow(/Unsupported/);});
test('unknown or malformed availability bounds are rejected',()=>{for(const bounds of [null,[],{minimum:.9}])expect(()=>allocate({method:'availability',target:.99,hours:10,items:[{id:'a',bounds:bounds as any}]})).toThrow(/bounds/);});
