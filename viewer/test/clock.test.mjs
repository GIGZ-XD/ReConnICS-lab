// node viewer/test/clock.test.mjs  - the replay clock stands still while paused and scales with speed.
import assert from 'node:assert/strict';
import { ReplayClock, fmtClock } from '../js/clock.js';

let t = 0; const c = new ReplayClock(() => t);
t = 2; assert.equal(c.get(), 2);
c.set({ paused: true }); t = 10; assert.equal(c.get(), 2);
c.set({ paused: false, speed: 2 }); t = 11; assert.equal(c.get(), 4);
c.set({ speed: 0.5 }); t = 13; assert.equal(c.get(), 5);
c.set({ speed: 3 }); t = 15; assert.equal(c.get(), 6);               // not an allowed speed: ignored
c.reset(); assert.equal(c.get(), 0);
assert.equal(fmtClock(42.9), '0:42'); assert.equal(fmtClock(90), '1:30'); assert.equal(fmtClock(0), '0:00');
console.log('clock ok');
