// Deterministic story chart for the article animation, decided by the REAL strategy code.
import { decideBuyback, initialState, dipThreshold } from '../../../engine/src/buybackStrategy.ts';
import { writeFileSync } from 'node:fs';
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
const r = rng(7); const g = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const N = 600; const P = [1]; const vol: number[] = [];
const seg = (t: number) => t < 80 ? [0, 0.006, 30] : t < 140 ? [0.0045, 0.008, 60] : t < 166 ? [-0.019, 0.007, 80] : t < 260 ? [0.0011, 0.007, 40]
  : t < 380 ? [-0.0006, 0.003, 1.5] : t < 400 ? [-0.026, 0.006, 70] : [0.0016, 0.007, 45];
for (let t = 1; t < N; t++) { const [d, s] = seg(t); P.push(P[t - 1] * Math.exp(d + s * g())); }
for (let t = 0; t < N; t++) vol.push(seg(t)[2] as number);
const cfg = { dipPct: 0.12, quietVolumeSol: 5, maxHoldSol: 10, maxHoldHours: 24, minBuySol: 0.05 };
let st = initialState(), bal = 4, next = 0; const ev: any[] = []; const frames: any[] = [];
const rand = rng(3);
let clockSpent = 0, clockTok = 0, smartSpent = 0, smartTok = 0, clockBal = 4;
for (let t = 0; t < N; t++) {
  bal += 0.03; clockBal += 0.03;
  if (t % 10 === 0) { clockSpent += clockBal; clockTok += clockBal / P[t]; ev.push({ t, kind: 'clock', sol: clockBal }); clockBal = 0; }
  const prices = P.slice(Math.max(0, t - 360), t + 1).map((p, i, a) => ({ t: (t - (a.length - 1 - i)) * 60000, p }));
  const vol30 = vol.slice(Math.max(0, t - 30), t + 1).reduce((a, b) => a + b, 0) / Math.min(31, t + 1) * 30 / 30;
  let note = '';
  if (t >= next) {
    const o = decideBuyback(st, bal, { prices, volume30mSol: vol[t] < 5 ? 2 : 40, now: t * 60000 }, cfg, rand);
    st = o.state; note = (o.decision as any).note ?? '';
    if (o.decision.reason !== 'wait') { const sp = (o.decision as any).spendSol; bal -= sp; smartSpent += sp; smartTok += sp / P[t]; ev.push({ t, kind: o.decision.reason, sol: +sp.toFixed(3) }); next = t + 4; }
  }
  frames.push({ t, p: +P[t].toFixed(5), bal: +bal.toFixed(3), ep: st.episode ? { ref: st.episode.refHigh, levels: st.episode.levels, fired: st.episode.fired } : null, note });
}
const out = { frames, events: ev, result: { clock: clockTok / clockSpent, smart: smartTok / smartSpent } };
writeFileSync('story.json', JSON.stringify(out));
console.log('events', ev.filter(e => e.kind !== 'clock').map(e => `${e.t}:${e.kind}:${e.sol}`).join('  '));
console.log('tokens per SOL vs clock', ((out.result.smart / out.result.clock) * 100).toFixed(0) + '%', 'min price', Math.min(...P).toFixed(3), 'max', Math.max(...P).toFixed(3));
