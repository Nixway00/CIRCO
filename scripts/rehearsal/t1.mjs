import * as B from './bot.mjs';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let r = await B.openRound(); log('round', r.id, r.balloon, 'cap', r.capacity_sol, 'collected', r.collected_sol);
// 1) fees: half by the webhook path is not possible here, so all fees come through the safety net (reconcile)
await B.fee(0.04); await B.fee(0.04);
await B.sleep(9000);
r = await B.openRound(); log('after 0.08 SOL of fees (30% goes to the jackpot):', r.phase, 'collected', r.collected_sol);
const stats = await B.rest('fees?select=amount_sol,jackpot_sol,round_id'); log('fees rows', JSON.stringify(stats));
// 2) tickets
log('buy bot0 x3', JSON.stringify((await B.buy(0, 3)).body));
log('buy bot1 x2 (no confirm call: must be found by the safety net)', (await B.buy(1, 2, { confirm: false })).sig.slice(0, 8));
log('buy bot0 x9 (only 7 fit under the cap of 10, 2 become credits)', JSON.stringify((await B.buy(0, 9)).body));
await B.sleep(6000);
const t = await B.rest(`tickets?select=wallet,count,kind&round_id=eq.${r.id}`); log('tickets', JSON.stringify(t.map(x => [x.wallet.slice(0, 4), x.count, x.kind])));
const cr = await B.rest('ticket_credits?select=*'); log('credits', JSON.stringify(cr.map(x => [x.wallet.slice(0, 4), x.tickets])));
