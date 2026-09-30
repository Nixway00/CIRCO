import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { sha256, drawSeed, seedFloat, winningTicket, balloonFromFloat } from '@/lib/draw';

type Props = { params: Promise<{ round: string }> };
const NAMES: Record<string, string> = { green: 'Green balloon dog', blue: 'Blue balloon', red: 'Red rocket', gold: 'Gold trophy' };

async function getRound(id: string) {
  const { data } = await supabase.from('rounds').select('*').eq('id', Number(id)).eq('phase', 'done').maybeSingle();
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { round } = await params;
  const r = await getRound(round);
  const title = r ? `${(Number(r.prize_sol) * 0.95).toFixed(2)} SOL won on $CIRCO, round ${r.id}` : '$CIRCO round';
  return { title, openGraph: { title, description: 'The 24/7 memecoin circus' }, twitter: { card: 'summary_large_image', title } };
}

/** One page per win: pasting this link on X shows the card (opengraph-image.tsx) automatically. */
export default async function WinPage({ params }: Props) {
  const { round } = await params;
  const r = await getRound(round);
  if (!r) return <main style={{ padding: 32 }}>This round is not finished yet.</main>;
  const main = Number(r.prize_sol) * 0.95, bonus = Number(r.prize_sol) * 0.05;
  const [{ data: rows }, { data: cfgRows }] = await Promise.all([
    supabase.from('tickets').select('wallet,count').eq('round_id', r.id),
    supabase.from('config').select('key,value').in('key', ['jackpot_chance', 'balloons']),
  ]);
  const m = new Map<string, number>(); for (const t of rows ?? []) m.set(t.wallet, (m.get(t.wallet) ?? 0) + t.count);
  const totals = [...m].map(([wallet, tickets]) => ({ wallet, tickets }));
  const cfg = Object.fromEntries((cfgRows ?? []).map(c => [c.key, c.value as any]));
  const commitOk = !!r.seed_secret && sha256(r.seed_secret) === r.seed_commit;
  const seed = r.seed_secret && r.close_blockhash ? drawSeed(r.seed_secret, r.close_blockhash, r.id) : '';
  const win = seed ? winningTicket(totals, seed) : null;
  const mega = seed ? seedFloat(seed, 'mega') : 0, chance = Number(cfg.jackpot_chance ?? 0);
  const nextF = seed ? seedFloat(seed, 'balloon') : 0;
  const weights = Object.fromEntries(Object.entries(cfg.balloons ?? {}).map(([k, v]: [string, any]) => [k, Number(v.weight)]));
  const nextBalloon = balloonFromFloat(nextF, weights);
  const tx = (sig: string | null) => sig ? <a href={`https://solscan.io/tx/${sig}`} target="_blank" rel="noopener">transaction ↗</a> : null;
  return (
    <main style={{ padding: 32, maxWidth: 720, margin: '0 auto', lineHeight: 1.6 }}>
      <h1>Round {r.id}: {NAMES[r.balloon]}</h1>
      <p><b>{r.winner_wallet}</b> won <b>{(main + Number(r.jackpot_won ?? 0)).toFixed(2)} SOL</b>{r.mega ? ' (Mega Pop, balloon + jackpot)' : ''} with {r.winner_tickets} tickets. {tx(r.winner_payout_tx)}</p>
      {r.last_buyer && <p>Last-ticket bonus: <b>{bonus.toFixed(2)} SOL</b> to {r.last_buyer}. {tx(r.bonus_payout_tx)}</p>}
      <h2>Check the draw yourself</h2>
      <p>Seed commit, published when the round started: <code>{r.seed_commit}</code></p>
      <p>Revealed secret: <code>{r.seed_secret}</code> · closing blockhash (slot {r.close_slot}): <code>{r.close_blockhash}</code></p>
      <ul>
        <li>sha256(secret) = <code>{commitOk ? 'matches the commit ✓' : 'does NOT match the commit ✗'}</code></li>
        <li>seed = sha256(secret:blockhash:round) = <code>{seed}</code></li>
        <li>Winning ticket = seed modulo {win?.total ?? 0} tickets = <b>#{win?.index ?? '-'}</b>, with wallets sorted by address: <b>{win?.wallet ?? '-'}</b> {win && win.wallet === r.winner_wallet ? '✓' : ''}</li>
        <li>Mega Pop draw: sha256(seed:mega) = <code>{mega.toFixed(6)}</code>. It is a Mega Pop when this is below the Mega Pop chance ({(chance * 100).toFixed(1)}%) and the jackpot is not empty: {r.mega ? <b>Mega Pop, {Number(r.jackpot_won).toFixed(4)} SOL jackpot paid ✓</b> : 'no Mega Pop'}.</li>
        <li>Next balloon: sha256(seed:balloon) = <code>{nextF.toFixed(6)}</code> → <b>{NAMES[nextBalloon] ?? nextBalloon}</b>, unless the first rounds or the daily gold guarantee fixed it.</li>
      </ul>
      <p>Tickets in the draw: {(totals ?? []).map(t => `${t.wallet.slice(0, 4)}…${t.wallet.slice(-4)} ${t.tickets}`).join(' · ')}</p>
      <p><a href="/">Back to the show</a></p>
    </main>
  );
}
