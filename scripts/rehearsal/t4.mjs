import * as B from './bot.mjs';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let r = await B.openRound(); log('round', r.id, r.balloon, 'cap', r.capacity_sol, 'min tickets from config');
// guesses on the NEXT balloon (not forced this time)
for (const [i, c] of [[0, 'green'], [2, 'blue'], [3, 'red'], [4, 'gold']]) log('guess bot' + i, c, JSON.stringify((await B.pick(i, c)).body));
await B.buy(5, 1);
log('only 1 ticket bought: the round must extend 3 times and then be postponed');
await B.fee(0.2);
const t0 = Date.now();
for (;;) { const x = (await B.rest(`rounds?select=phase,extensions&id=eq.${r.id}`))[0]; if (x.phase === 'postponed') { log('postponed after', Math.round((Date.now() - t0) / 1000), 's, extensions', x.extensions); break; } if (Date.now() - t0 > 120000) { log('TIMEOUT', JSON.stringify(x)); break; } await B.sleep(1000); }
await B.sleep(4000);
const p = (await B.rest(`rounds?select=id,phase,next_seed,seed_secret&id=eq.${r.id}`))[0]; log('postponed round reveals its seed:', !!p.next_seed, !!p.seed_secret);
const n = (await B.rest('rounds?select=id,balloon,carried_sol,postpone_streak&order=id.desc&limit=1'))[0]; log('next round', JSON.stringify(n));
log('tickets carried', JSON.stringify((await B.rest(`tickets?select=wallet,count,kind&round_id=eq.${n.id}`)).map(x => [x.wallet.slice(0, 4), x.count, x.kind])));
log('guesses', JSON.stringify((await B.rest(`predictions?select=wallet,color,tickets_if_win,status&round_id=eq.${r.id}`)).map(x => [x.wallet.slice(0, 4), x.color, x.tickets_if_win, x.status])));
log('DONE');
