'use client';
import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import bs58 from 'bs58';
import { supabase } from '@/lib/supabase';

type Balloons = Record<'green' | 'blue' | 'red' | 'gold', { capacity_sol: number; weight: number; min_tickets: number; shape: string }>;

const SETTINGS: { key: string; label: string; help: string; step?: number; min?: number; max?: number; bool?: boolean; opts?: [string, string][] }[] = [
  { key: 'ticket_price_mode', label: 'Ticket price mode', help: 'Automatic: the engine keeps the ticket near the dollar target. Manual: you set the tokens per ticket above.', opts: [['usd', 'Automatic (in dollars)'], ['manual', 'Manual']] },
  { key: 'jackpot_cap_sol', label: 'Mega Jackpot cap (SOL)', help: 'Above this the jackpot stops taking fees, so the hot wallet never holds too much (0 = no cap).', step: 1, min: 0 },
  { key: 'jackpot_share', label: 'Mega Jackpot share', help: 'Part of each prize-wallet fee that feeds the jackpot (0 to 0.3, e.g. 0.05 = 5%).', step: 0.01, min: 0, max: 0.3 },
  { key: 'jackpot_chance', label: 'Mega Pop chance', help: 'Chance that a draw is a Mega Pop (0 to 0.2, e.g. 0.02 = 2%).', step: 0.005, min: 0, max: 0.2 },
  { key: 'pick_price_tokens', label: 'Guess price ($CIRCO)', help: 'Cost of one guess on the next balloon.', min: 1 },
  { key: 'pick_return', label: 'Guess return', help: 'Average return of a guess as a share of its cost. Keep it under 1 (e.g. 0.9).', step: 0.05, min: 0.1, max: 0.99 },
  { key: 'game_price_tokens', label: 'Shooting gallery price ($CIRCO)', help: 'Cost of one game.', min: 1 },
  { key: 'game_shots', label: 'Shots per game', help: '1 to 10.', min: 1, max: 10 },
  { key: 'game_hit_chance', label: 'Hit chance per shot', help: 'e.g. 0.3 = 30%. Shots x chance should stay under 1 ticket per ticket price.', step: 0.05, min: 0, max: 0.9 },
  { key: 'game_daily_ticket_cap', label: 'Game tickets per day', help: 'Most tickets a wallet can win in games each day.', min: 0, max: 100 },
  { key: 'team_reward_tickets', label: 'Team reward (tickets)', help: 'Bonus tickets for each active member of the weekly winning team.', min: 0, max: 20 },
  { key: 'pumpfun_chat_relay', label: 'pump.fun chat in the site chat', help: 'Turn the pump.fun chat bridge on or off.', bool: true },
  { key: 'hot_countdown_sec', label: 'Hot mode: express countdown (seconds)', help: 'Countdown when the queue already pays for the next balloon (0 = off).', min: 0, max: 600 },
  { key: 'supercharge_share', label: 'Hot mode: supercharge share', help: 'Share of a big queue added to the next balloon (0.5 = half, 0 = off).', step: 0.1, min: 0, max: 1 },
  { key: 'loyalty_min_tokens', label: 'Loyalty: tokens to hold', help: 'Hold at least this for a full day to get loyalty tickets (0 = off).', min: 0 },
  { key: 'loyalty_tickets', label: 'Loyalty: tickets per day', help: 'Free tickets for each loyal holder, every day.', min: 0, max: 10 },
  { key: 'ticket_usd_target', label: 'Ticket price target ($)', help: 'In automatic mode the engine keeps a ticket near this value (e.g. 0.25).', step: 0.05, min: 0.01 },
  { key: 'snipe_window_sec', label: 'Last-ticket war: window (s)', help: 'A ticket in the last N seconds pushes the end back (0 = off).', min: 0, max: 120 },
  { key: 'snipe_cap_sec', label: 'Last-ticket war: most extra time (s)', help: 'The war can add at most this much to the countdown.', min: 0, max: 900 },
  { key: 'timer_min_fill', label: 'Timer: minimum fill', help: 'The 30-minute timer only pops a balloon at least this full (0.25 = 25%).', step: 0.05, min: 0, max: 1 },
  { key: 'lucky_every', label: 'Lucky meter', help: 'Losing tickets needed for 1 free ticket (0 = off).', min: 0, max: 1000 },
  { key: 'buyback_dip_pct', label: 'Buyback: dip size', help: 'Drop from the 30-minute high that triggers a dip buy (0.12 = 12%).', step: 0.01, min: 0.02, max: 0.8 },
  { key: 'buyback_quiet_volume_sol', label: 'Buyback: quiet market (SOL in 30 min)', help: 'Under this volume a drifting chart gets gentle support.', step: 0.5, min: 0 },
  { key: 'buyback_max_hold_sol', label: 'Buyback: most SOL to hold', help: 'Above this the buyback drips its SOL out even without a dip.', step: 0.5, min: 0.1 },
  { key: 'buyback_max_hold_hours', label: 'Buyback: longest wait (hours)', help: 'Nothing waits longer than this.', min: 1, max: 720 },
  { key: 'buyback_max_impact', label: 'Buyback: max price impact per chunk', help: 'e.g. 0.02 = 2%.', step: 0.005, min: 0.001, max: 0.1 },
];

/** Team panel: every game setting. The engine reloads settings every minute. */
export default function Admin() {
  const { publicKey, signMessage } = useWallet();
  const [price, setPrice] = useState(10000);
  const [chatMin, setChatMin] = useState(10000);
  const [balloons, setBalloons] = useState<Balloons | null>(null);
  const [msg, setMsg] = useState('');
  const [cfg, setCfg] = useState<Record<string, any>>({});

  useEffect(() => {
    supabase.from('config').select('key,value').then(({ data }) => {
      for (const r of data ?? []) {
        if (r.key === 'ticket_price_tokens') setPrice(Number(r.value));
        if (r.key === 'chat_min_tokens') setChatMin(Number(r.value));
        if (r.key === 'balloons') setBalloons(r.value as Balloons);
      }
      setCfg(Object.fromEntries((data ?? []).map(r => [r.key, r.value])));
    });
  }, []);

  async function save(key: string, value: unknown) {
    if (!publicKey || !signMessage) { setMsg('Connect an admin wallet first.'); return; }
    const message = `admin:${publicKey.toBase58()}:${Date.now()}`;
    const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
    const res = await fetch('/api/admin/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: publicKey.toBase58(), message, signature, key, value }) });
    setMsg(res.ok ? `Saved ${key}. The engine picks it up within a minute.` : (await res.json()).error);
  }

  const field = { display: 'flex', flexDirection: 'column' as const, gap: 6, marginBottom: 16 };
  const input = { height: 44, borderRadius: 10, border: '1px solid #3a4580', background: '#0a1440', color: '#EAF2FF', padding: '0 12px', fontSize: 16 };
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 32 }}>
      <h1>$CIRCO team panel</h1>
      <WalletMultiButton />
      <p>Announce price changes on X before saving them.</p>
      <div style={field}>
        <label htmlFor="price">Ticket price ($CIRCO per ticket)</label>
        <input id="price" type="number" min={1} value={price} onChange={e => setPrice(Number(e.target.value))} style={input} />
        <button type="button" className="primary" onClick={() => save('ticket_price_tokens', price)}>Save ticket price</button>
      </div>
      <div style={field}>
        <label htmlFor="chat">Chat minimum ($CIRCO held)</label>
        <input id="chat" type="number" min={0} value={chatMin} onChange={e => setChatMin(Number(e.target.value))} style={input} />
        <button type="button" className="primary" onClick={() => save('chat_min_tokens', chatMin)}>Save chat minimum</button>
      </div>
      {balloons && (
        <div style={field}>
          <h2>Balloons</h2>
          {(Object.keys(balloons) as (keyof Balloons)[]).map(k => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '80px repeat(3, 1fr)', gap: 8, alignItems: 'center' }}>
              <b>{k}</b>
              <label>SOL<input type="number" step="0.01" value={balloons[k].capacity_sol} onChange={e => setBalloons({ ...balloons, [k]: { ...balloons[k], capacity_sol: Number(e.target.value) } })} style={input} /></label>
              <label>chance<input type="number" value={balloons[k].weight} onChange={e => setBalloons({ ...balloons, [k]: { ...balloons[k], weight: Number(e.target.value) } })} style={input} /></label>
              <label>min tickets<input type="number" value={balloons[k].min_tickets} onChange={e => setBalloons({ ...balloons, [k]: { ...balloons[k], min_tickets: Number(e.target.value) } })} style={input} /></label>
            </div>
          ))}
          <button type="button" className="primary" onClick={() => save('balloons', balloons)}>Save balloons</button>
        </div>
      )}
      <h2>Show features</h2>
      {SETTINGS.map(st => (
        <div key={st.key} style={field}>
          <label htmlFor={st.key}>{st.label}</label>
          {st.opts
            ? <select id={st.key} value={String(cfg[st.key] ?? st.opts[0][0])} onChange={e => setCfg({ ...cfg, [st.key]: e.target.value })} style={input}>{st.opts.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>
            : st.bool
            ? <select id={st.key} value={String(cfg[st.key] ?? true)} onChange={e => setCfg({ ...cfg, [st.key]: e.target.value === 'true' })} style={input}><option value="true">On</option><option value="false">Off</option></select>
            : <input id={st.key} type="number" step={st.step ?? 1} min={st.min} max={st.max} value={cfg[st.key] ?? ''} onChange={e => setCfg({ ...cfg, [st.key]: Number(e.target.value) })} style={input} />}
          <small style={{ opacity: .7 }}>{st.help}</small>
          <button type="button" className="primary" onClick={() => save(st.key, cfg[st.key])}>Save</button>
        </div>
      ))}
      {cfg.fx_prices && (
        <div style={field}>
          <h3>Effect prices ($CIRCO burned)</h3>
          {Object.keys(cfg.fx_prices).map(k => (
            <label key={k}>{k}<input type="number" min={1} value={cfg.fx_prices[k]} onChange={e => setCfg({ ...cfg, fx_prices: { ...cfg.fx_prices, [k]: Number(e.target.value) } })} style={input} /></label>
          ))}
          <button type="button" className="primary" onClick={() => save('fx_prices', cfg.fx_prices)}>Save effect prices</button>
        </div>
      )}
      {msg && <p role="status">{msg}</p>}
    </main>
  );
}
