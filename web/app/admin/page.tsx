'use client';
import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import bs58 from 'bs58';
import { supabase } from '@/lib/supabase';

type Balloons = Record<'green' | 'blue' | 'red' | 'gold', { capacity_sol: number; weight: number; min_tickets: number; shape: string }>;

/** Team panel: change the ticket price and the balloons. The engine reloads settings every minute. */
export default function Admin() {
  const { publicKey, signMessage } = useWallet();
  const [price, setPrice] = useState(10000);
  const [chatMin, setChatMin] = useState(10000);
  const [balloons, setBalloons] = useState<Balloons | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    supabase.from('config').select('key,value').then(({ data }) => {
      for (const r of data ?? []) {
        if (r.key === 'ticket_price_tokens') setPrice(Number(r.value));
        if (r.key === 'chat_min_tokens') setChatMin(Number(r.value));
        if (r.key === 'balloons') setBalloons(r.value as Balloons);
      }
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
      {msg && <p role="status">{msg}</p>}
    </main>
  );
}
