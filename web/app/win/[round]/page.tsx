import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';

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
  const tx = (sig: string | null) => sig ? <a href={`https://solscan.io/tx/${sig}`} target="_blank" rel="noopener">transaction ↗</a> : null;
  return (
    <main style={{ padding: 32, maxWidth: 720, margin: '0 auto', lineHeight: 1.6 }}>
      <h1>Round {r.id}: {NAMES[r.balloon]}</h1>
      <p><b>{r.winner_wallet}</b> won <b>{main.toFixed(2)} SOL</b> with {r.winner_tickets} tickets. {tx(r.winner_payout_tx)}</p>
      {r.last_buyer && <p>Last-ticket bonus: <b>{bonus.toFixed(2)} SOL</b> to {r.last_buyer}. {tx(r.bonus_payout_tx)}</p>}
      <h2>Check the draw yourself</h2>
      <p>Seed commit, published when the round started: <code>{r.seed_commit}</code></p>
      <p>Revealed secret: <code>{r.seed_secret}</code> · closing blockhash (slot {r.close_slot}): <code>{r.close_blockhash}</code></p>
      <p>sha256(secret) must equal the commit, and the winning ticket is sha256(secret:blockhash:round) modulo the total tickets, with wallets sorted by address.</p>
      <p><a href="/">Back to the show</a></p>
    </main>
  );
}
