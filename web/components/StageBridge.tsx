'use client';
import { useCallback, useEffect, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import bs58 from 'bs58';
import { supabase } from '@/lib/supabase';
import { buildTicketTx, circoBalanceClient } from '@/lib/tickets';

/**
 * The 3D stage runs in an iframe in "live data" mode. This component is its only source of truth:
 * it reads the game from Supabase (Realtime), sends it to the stage, and turns the stage's
 * requests (buy tickets, chat, mission, connect) into real wallet actions.
 */
export default function StageBridge() {
  const frame = useRef<HTMLIFrameElement>(null);
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const price = useRef(10000);
  const meRef = useRef<string | null>(null);

  const post = useCallback((m: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ type: 'circo-state', ...m }, window.location.origin);
  }, []);

  const pushState = useCallback(async () => {
    const [{ data: rounds }, { data: trades }, { data: chat }, { data: cfg }] = await Promise.all([
      supabase.from('rounds').select('*').order('id', { ascending: false }).limit(2),
      supabase.from('trades').select('tx,wallet,side,amount_sol').order('id', { ascending: false }).limit(12),
      supabase.from('chat_messages').select('id,wallet,body,is_ringmaster').order('id', { ascending: false }).limit(30),
      supabase.from('config').select('value').eq('key', 'ticket_price_tokens').maybeSingle(),
    ]);
    if (cfg) price.current = Number(cfg.value);
    const round = rounds?.[0], prev = rounds?.[1];
    let tickets: { wallet: string; tickets: number }[] = [], lastBuyer: string | null = null;
    if (round) {
      const { data: t } = await supabase.from('tickets').select('wallet,count,kind,created_at').eq('round_id', round.id).order('created_at');
      const m = new Map<string, number>();
      for (const x of t ?? []) { m.set(x.wallet, (m.get(x.wallet) ?? 0) + x.count); if (x.kind === 'burn') lastBuyer = x.wallet; }
      tickets = [...m].map(([wallet, n]) => ({ wallet, tickets: n }));
    }
    const { data: lb } = await supabase.from('leaderboard').select('tokens_burned');
    const { data: bb } = await supabase.from('buybacks').select('sol_spent');
    const { data: done } = await supabase.from('rounds').select('prize_sol').eq('phase', 'done');
    const stats = {
      burned: (lb ?? []).reduce((a, r) => a + Number(r.tokens_burned), 0),
      buyback: (bb ?? []).reduce((a, r) => a + Number(r.sol_spent), 0),
      prizes: (done ?? []).reduce((a, r) => a + Number(r.prize_sol), 0),
      rounds: (done ?? []).length,
    };
    // History, Leaderboards and Profile inside the stage
    const B2T: Record<string, string> = { green: 'verde', blue: 'blu', red: 'rosso', gold: 'oro' };
    const me = meRef.current;
    const [{ data: summary }, { data: board }] = await Promise.all([
      supabase.from('round_summary').select('*').order('id', { ascending: false }).limit(30),
      supabase.from('leaderboard').select('*').order('sol_won', { ascending: false }).limit(50),
    ]);
    let mine = new Map<number, number>();
    if (me) {
      const { data: myT } = await supabase.from('tickets').select('round_id,count').eq('wallet', me);
      for (const t of myT ?? []) mine.set(t.round_id, (mine.get(t.round_id) ?? 0) + t.count);
    }
    const history = (summary ?? []).map(r => ({
      round: r.id, type: B2T[r.balloon], cap: Number(r.capacity_sol), tickets: r.total_tickets, wallets: r.wallets,
      mine: mine.get(r.id) ?? 0, rinvio: r.phase === 'postponed', winner: r.winner_wallet, winT: r.winner_tickets ?? 0,
      main: Number(r.prize_sol ?? 0) * 0.95, last: r.last_buyer, bonus: r.last_buyer ? Number(r.prize_sol ?? 0) * 0.05 : 0,
    }));
    let leaderboard = board ?? [];
    if (me && !leaderboard.some(l => l.wallet === me)) {
      const { data: meRow } = await supabase.from('leaderboard').select('*').eq('wallet', me).maybeSingle();
      if (meRow) leaderboard = [...leaderboard, meRow];
    }
    post({ round, prev, tickets, lastBuyer, trades: (trades ?? []).reverse(), chat: (chat ?? []).reverse(), stats, history, leaderboard });
  }, [post]);

  // live updates: any change in the game tables re-sends the state (debounced)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (timer) clearTimeout(timer); timer = setTimeout(pushState, 250); };
    const ch = supabase.channel('stage')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, bump)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trades' }, bump)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, bump)
      .subscribe();
    const safety = setInterval(pushState, 15_000);
    return () => { supabase.removeChannel(ch); clearInterval(safety); };
  }, [pushState]);

  // wallet identity and balance for the chat gate
  useEffect(() => {
    meRef.current = publicKey ? publicKey.toBase58() : null;
    pushState();
    if (!publicKey) { post({ me: null, balance: 0 }); return; }
    circoBalanceClient(connection, publicKey).then(balance => post({ me: publicKey.toBase58(), balance })).catch(() => post({ me: publicKey.toBase58(), balance: 0 }));
  }, [publicKey, connection, post, pushState]);

  // requests coming from the stage
  useEffect(() => {
    async function signed(action: string) {
      if (!publicKey || !signMessage) throw new Error('Connect a wallet that can sign messages.');
      const message = `${action}:${publicKey.toBase58()}:${Date.now()}`;
      const sig = await signMessage(new TextEncoder().encode(message));
      return { wallet: publicKey.toBase58(), message, signature: bs58.encode(sig) };
    }
    async function onMessage(e: MessageEvent) {
      if (e.source !== frame.current?.contentWindow) return;
      const m = e.data as { type: string; n?: number; round?: number; text?: string; url?: string };
      try {
        if (m.type === 'circo-ready') { pushState(); return; }
        if (m.type === 'circo-connect') { setVisible(true); return; }
        if (!publicKey) { setVisible(true); post({ toast: 'Connect your wallet first.' }); return; }
        if (m.type === 'circo-buy' && m.round && m.n) {
          const tx = await buildTicketTx(connection, publicKey, m.round, m.n, price.current);
          const sig = await sendTransaction(tx, connection);
          post({ toast: 'Burning… waiting for confirmation.' });
          await connection.confirmTransaction(sig, 'confirmed');
          const res = await fetch('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature: sig }) });
          const out = await res.json();
          post({ toast: res.ok ? `Done: you hold ${out.tickets} tickets this round.` : out.error });
          circoBalanceClient(connection, publicKey).then(balance => post({ me: publicKey.toBase58(), balance }));
        }
        if (m.type === 'circo-chat' && m.text) {
          const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(await signed('chat')), body: m.text }) });
          if (!res.ok) post({ toast: (await res.json()).error });
        }
        if (m.type === 'circo-mission' && m.url) {
          const res = await fetch('/api/mission', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(await signed('mission')), url: m.url }) });
          const out = await res.json();
          post({ toast: res.ok ? `Claimed ${out.tickets} bonus tickets for round ${out.round}.` : out.error });
        }
      } catch (err) { post({ toast: (err as Error).message }); }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [publicKey, connection, sendTransaction, signMessage, setVisible, post, pushState]);

  return <iframe ref={frame} className="stage" src="/stage/index.html?data=live" title="$CIRCO live stage" allow="autoplay" />;
}
