import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';

export const revalidate = 30;
export const metadata: Metadata = {
  title: 'The circus in numbers · $CIRCO',
  description: 'Every burn, every prize, every buyback of $CIRCO, live and verifiable.',
};

const REASON: Record<string, string> = { dip_1: 'Dip, step 1', dip_2: 'Dip, step 2', dip_3: 'Dip, step 3', quiet_support: 'Quiet-chart support', drip: 'Drip', dip: 'Dip', deep_dip: 'Deep dip' };
const NAME: Record<string, string> = { green: 'Green balloon dog', blue: 'Blue balloon', red: 'Red rocket', gold: 'Gold trophy' };
const big = (n: number) => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toString();
const sol = (n: number, d = 2) => Number(n ?? 0).toFixed(d);
const short = (a: string) => a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '';
const tx = (s: string) => `https://solscan.io/tx/${s}`;
const acct = (s: string) => `https://solscan.io/account/${s}`;

export default async function Stats() {
  const { data: snaps } = await supabase.from('snapshots').select('key,data,updated_at').in('key', ['stats', 'stats_page', 'history']);
  const get = (k: string) => snaps?.find(s => s.key === k);
  const st: any = get('stats')?.data ?? {};
  const pg: any = get('stats_page')?.data ?? {};
  const history: any[] = (get('history')?.data as any[]) ?? [];
  const updated = get('stats_page')?.updated_at ?? get('stats')?.updated_at;

  const burnedOnChain = pg.supply_now != null ? pg.supply_start - pg.supply_now : null;
  const burnedPct = burnedOnChain != null ? (burnedOnChain / pg.supply_start) * 100 : null;
  const daily: any[] = pg.daily ?? [];
  const maxDay = Math.max(1, ...daily.map(d => Number(d.player_burn) + Number(d.buyback_burn)));
  const breakdown: any[] = (pg.breakdown ?? []).filter((b: any) => Number(b.tokens) > 0).sort((a: any, b: any) => Number(b.tokens) - Number(a.tokens));
  const maxSrc = Math.max(1, ...breakdown.map(b => Number(b.tokens)));
  const W = 700, H = 220, bw = W / Math.max(1, daily.length);

  return (
    <main className="stats">
      <style>{CSS}</style>
      <header>
        <a href="/" className="back">← Back to the show</a>
        <h1>The circus in numbers</h1>
        <p className="lede">Every burn, every prize and every buyback of $CIRCO, read from the chain and the game's public data. Updated every few minutes{updated ? `, last at ${new Date(updated).toUTCString().slice(17, 22)} UTC` : ''}.</p>
      </header>

      <section className="figures">
        <div><b>{burnedPct != null ? burnedPct.toFixed(2) + '%' : big(Number(st.tokens_burned ?? 0))}</b><span>{burnedPct != null ? `of the supply burned (${big(burnedOnChain!)} $CIRCO, on-chain)` : '$CIRCO burned by players'}</span></div>
        <div><b>{sol(st.sol_paid)} SOL</b><span>paid to winners</span></div>
        <div><b>{sol(st.sol_bought_back)} SOL</b><span>spent on buybacks, all burned</span></div>
        <div><b>{Number(st.rounds_played ?? 0)}</b><span>balloons popped</span></div>
      </section>

      <section>
        <h2>Burned per day</h2>
        <p className="note">Players (tickets, games, guesses, effects) and the buyback bot, last 14 days.</p>
        <div className="chart">
          <svg viewBox={`0 0 ${W} ${H + 28}`} role="img" aria-label="Tokens burned per day, last 14 days">
            {daily.map((d, i) => {
              const p = Number(d.player_burn), b = Number(d.buyback_burn);
              const hp = (p / maxDay) * H, hb = (b / maxDay) * H;
              return (
                <g key={d.day}>
                  <rect x={i * bw + 6} y={H - hp - hb} width={bw - 12} height={hb} rx="4" fill="#2EF2A6"><title>{`${d.day}: buyback ${big(b)}`}</title></rect>
                  <rect x={i * bw + 6} y={H - hp} width={bw - 12} height={hp} rx="4" fill="#FF3D6E"><title>{`${d.day}: players ${big(p)}`}</title></rect>
                  {i % 2 === 0 && <text x={i * bw + bw / 2} y={H + 20} textAnchor="middle">{String(d.day).slice(5)}</text>}
                </g>
              );
            })}
          </svg>
        </div>
        <p className="legend"><i style={{ background: '#FF3D6E' }} /> players <i style={{ background: '#2EF2A6' }} /> buyback</p>
      </section>

      <section>
        <h2>Where the burns come from</h2>
        <ul className="bars">
          {breakdown.map(b => (
            <li key={b.source}><span>{b.source}</span><em style={{ width: `${(Number(b.tokens) / maxSrc) * 100}%` }} /><b>{big(Number(b.tokens))}</b></li>
          ))}
          {!breakdown.length && <li className="empty">Nothing burned yet. The first ticket starts the count.</li>}
        </ul>
      </section>

      <section className="money">
        <h2>The money, live</h2>
        <dl>
          <div><dt>Mega Jackpot</dt><dd>{sol(st.jackpot_sol, 3)} SOL</dd></div>
          <div><dt>Buyback waiting for the next dip</dt><dd>{sol(st.buyback_reserve_sol, 3)} SOL</dd></div>
          <div><dt>Queued for the next balloons</dt><dd>{sol(st.queue_sol, 3)} SOL</dd></div>
        </dl>
        <p className="note">The three wallets fee sharing pays into. Check every movement yourself:</p>
        <ul className="wallets">
          {(['prize', 'buyback', 'team'] as const).map(k => pg.wallets?.[k] && (
            <li key={k}><span>{k === 'prize' ? 'Prize (45%)' : k === 'buyback' ? 'Buyback (45%)' : 'Team (10%)'}</span><a href={acct(pg.wallets[k].address)} target="_blank" rel="noopener">{short(pg.wallets[k].address)} ↗</a><b>{sol(pg.wallets[k].sol, 3)} SOL</b></li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Latest buybacks</h2>
        <table>
          <thead><tr><th>When (UTC)</th><th>Why</th><th>SOL</th><th>Burned</th><th>Transaction</th></tr></thead>
          <tbody>
            {(pg.buybacks ?? []).map((b: any, i: number) => (
              <tr key={i}>
                <td>{new Date(b.created_at).toISOString().slice(5, 16).replace('T', ' ')}</td>
                <td>{REASON[b.reason] ?? b.reason ?? 'Buyback'}</td>
                <td>{Number(b.sol_spent) > 0 ? sol(b.sol_spent, 3) : ''}</td>
                <td>{Number(b.tokens_burned) > 0 ? big(Number(b.tokens_burned)) : ''}</td>
                <td><a href={tx(b.swap_tx ?? b.burn_tx)} target="_blank" rel="noopener">{b.swap_tx ? 'swap' : 'burn'} ↗</a></td>
              </tr>
            ))}
            {!(pg.buybacks ?? []).length && <tr><td colSpan={5} className="empty">No buybacks yet: the bot waits for the first dip.</td></tr>}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Biggest wins</h2>
        <ol className="wins">
          {(pg.biggest ?? []).map((r: any) => (
            <li key={r.id}><a href={`/win/${r.id}`}>Round {r.id}</a><span>{short(r.winner_wallet)}</span><b>{sol(Number(r.prize_sol) * 0.95 + Number(r.jackpot_won ?? 0))} SOL{r.mega ? ' · Mega Pop' : ''}</b></li>
          ))}
          {!(pg.biggest ?? []).length && <li className="empty">The first winner will be here.</li>}
        </ol>
      </section>

      <section>
        <h2>Check any draw</h2>
        <p className="note">Every finished round can be recomputed from public data. Open its page, or run <code>node scripts/verify-round.mjs &lt;round&gt;</code> from the <a href="https://github.com/Nixway00/CIRCO" target="_blank" rel="noopener">open-source repository ↗</a>.</p>
        <ul className="rounds">
          {history.filter(r => r.phase === 'done').slice(0, 12).map(r => (
            <li key={r.id}><a href={`/win/${r.id}`}>Round {r.id}</a><span>{NAME[r.balloon] ?? r.balloon}</span><b>{sol(r.prize_sol)} SOL</b></li>
          ))}
        </ul>
      </section>

      <footer><p>$CIRCO is a memecoin. Its price can go to zero. Burned tokens cannot be recovered. Not financial advice.</p></footer>
    </main>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800&family=Onest:wght@400;500;600&display=swap');
body{ margin:0; background:#030716; }
.stats{ --ink:#EAF0FF; --muted:#93A0C8; --line:rgba(120,150,255,.18); --mint:#2EF2A6; --red:#FF3D6E; --gold:#FFD34D; --cyan:#5CE1FF;
  color:var(--ink); font:400 17px/1.6 Onest, system-ui, sans-serif; max-width:820px; margin:0 auto; padding:calc(28px + env(safe-area-inset-top,0px)) 20px calc(60px + env(safe-area-inset-bottom,0px));
  background:radial-gradient(900px 500px at 40% -10%, rgba(47,123,255,.18), transparent 70%); }
.stats a{ color:var(--cyan); text-underline-offset:3px; }
.back{ font-size:15px; text-decoration:none; }
h1{ font:800 clamp(32px,6vw,52px)/1.05 Unbounded, system-ui, sans-serif; margin:22px 0 12px; letter-spacing:-.01em; }
h2{ font:700 22px/1.25 Unbounded, system-ui, sans-serif; margin:0 0 10px; }
.lede{ color:var(--muted); margin:0 0 30px; max-width:62ch; }
section{ padding:30px 0; border-top:1px solid var(--line); }
.note{ color:var(--muted); font-size:15px; margin:0 0 16px; }
.figures{ display:grid; grid-template-columns:repeat(4,1fr); gap:24px; }
.figures b{ display:block; font:800 clamp(24px,3.6vw,34px)/1.1 Unbounded, system-ui, sans-serif; color:var(--gold); }
.figures div:first-child b{ color:var(--red); }
.figures span{ color:var(--muted); font-size:14px; }
@media (max-width:700px){ .figures{ grid-template-columns:1fr 1fr; } }
.chart{ overflow-x:auto; } .chart svg{ width:100%; min-width:520px; height:auto; display:block; }
.chart text{ fill:#93A0C8; font:12px Onest, sans-serif; }
.legend{ color:var(--muted); font-size:14px; display:flex; gap:10px; align-items:center; margin:10px 0 0; }
.legend i{ width:12px; height:12px; border-radius:3px; display:inline-block; margin-left:6px; }
.bars{ list-style:none; padding:0; margin:0; }
.bars li{ display:grid; grid-template-columns:150px 1fr 80px; gap:14px; align-items:center; padding:7px 0; }
.bars em{ height:12px; border-radius:99px; background:linear-gradient(90deg,#FF3D6E,#FFD34D); display:block; min-width:4px; }
.bars b{ text-align:right; font-weight:600; }
.money dl{ display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin:6px 0 24px; }
.money dt{ color:var(--muted); font-size:14px; } .money dd{ margin:4px 0 0; font:800 24px Unbounded, system-ui, sans-serif; color:var(--mint); }
@media (max-width:700px){ .money dl{ grid-template-columns:1fr; } }
.wallets, .wins, .rounds{ list-style:none; padding:0; margin:0; }
.wallets li, .wins li, .rounds li{ display:grid; grid-template-columns:1fr auto auto; gap:16px; padding:10px 0; border-bottom:1px solid var(--line); align-items:baseline; }
.wallets b, .wins b, .rounds b{ font-weight:600; text-align:right; min-width:90px; }
.wins span, .rounds span{ color:var(--muted); }
table{ width:100%; border-collapse:collapse; font-size:15px; display:block; overflow-x:auto; }
th{ text-align:left; color:var(--muted); font-weight:500; padding:8px 12px 8px 0; border-bottom:1px solid var(--line); white-space:nowrap; }
td{ padding:9px 12px 9px 0; border-bottom:1px solid var(--line); white-space:nowrap; }
.empty{ color:var(--muted); }
code{ color:var(--mint); font-family:inherit; }
footer p{ color:var(--muted); font-size:13px; margin:30px 0 0; }
`;
