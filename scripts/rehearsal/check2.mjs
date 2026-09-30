import * as B from './bot.mjs';
const id = Number(process.argv[2]);
const d = (await B.rest(`rounds?select=*&id=eq.${id}`))[0];
console.log('round', id, d.phase, d.balloon, 'winner', d.winner_wallet?.slice(0, 4), d.winner_tickets, '/', d.draw_total_tickets, 'last buyer', d.last_buyer?.slice(0, 4), 'MEGA', d.mega, 'jackpot won', d.jackpot_won, 'prize', d.prize_sol);
const pays = await B.rest(`payouts?select=kind,wallet,lamports,status,signature&round_id=eq.${id}`);
console.log('payouts', JSON.stringify(pays.map(p => [p.kind, p.wallet.slice(0, 4), p.lamports, p.status])));
const t = await B.rest(`tickets?select=wallet,count,kind,burn_slot&round_id=eq.${id}&order=id`); console.log('tickets', JSON.stringify(t.map(x => [x.wallet.slice(0, 4), x.count, x.kind, x.burn_slot])));
console.log('bots', [0,1,2,3,4,5].map(i => i + ':' + B.addr(i).slice(0, 4)).join(' '));
console.log('prize wallet', await B.sol(B.prizeAddr));
