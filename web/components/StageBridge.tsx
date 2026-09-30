'use client';
import { PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import bs58 from 'bs58';
import { supabase } from '@/lib/supabase';
import { buildTicketTx, buildGameTx, buildMemoBurnTx, circoBalanceClient } from '@/lib/tickets';

/**
 * The 3D stage runs in an iframe in "live data" mode. This component is its only source of truth:
 * it reads the game from Supabase (Realtime), sends it to the stage, and turns the stage's
 * requests (buy tickets, chat, mission, connect) into real wallet actions.
 */
/** Changes on every deploy, so phones never keep an old copy of the stage. */
const STAGE_VERSION = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 8);

export default function StageBridge() {
  const frame = useRef<HTMLIFrameElement>(null);
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const price = useRef(10000);
  const chatMin = useRef(10000);
  const showCfg = useRef<any>({});
  const meRef = useRef<string | null>(null);

  const post = useCallback((m: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ type: 'circo-state', ...m }, window.location.origin);
  }, []);

  // Live, per-round data: small queries, re-run on every game event.
  // wallet -> nickname, refreshed every minute; the stage only ever sees the nickname when there is one
  const nicks = useRef(new Map<string, string>());
  const nickAge = useRef(0);
  const loadNicks = useCallback(async (wallets: (string | null | undefined)[]) => {
    if (Date.now() - nickAge.current > 60_000) { nicks.current.clear(); nickAge.current = Date.now(); }
    const need = [...new Set(wallets.filter((w): w is string => !!w && w.length > 30 && !nicks.current.has(w)))];
    if (!need.length) return;
    const { data } = await supabase.from('profiles').select('wallet,nickname,x_handle').in('wallet', need);
    for (const w of need) nicks.current.set(w, '');
    for (const p of data ?? []) nicks.current.set(p.wallet, p.x_handle ? '@' + p.x_handle : p.nickname);
  }, []);
  const nm = (w: string | null | undefined) => (w && nicks.current.get(w)) || w;

  const pushLive = useCallback(async () => {
    const [{ data: rounds }, { data: trades }, { data: chat }, { data: cfgRows }] = await Promise.all([
      supabase.from('rounds').select('*').order('id', { ascending: false }).limit(2),
      supabase.from('trades').select('tx,wallet,side,amount_sol').order('id', { ascending: false }).limit(12),
      supabase.from('chat_messages').select('id,wallet,body,is_ringmaster,source,author').order('id', { ascending: false }).limit(40),
      supabase.from('config').select('key,value').in('key', ['ticket_price_tokens', 'chat_min_tokens', 'game_price_tokens', 'game_shots', 'game_hit_chance', 'game_daily_ticket_cap', 'fx_prices', 'pick_price_tokens', 'pick_return', 'balloons', 'jackpot_share', 'jackpot_chance', 'team_reward_tickets']),
    ]);
    const raw = Object.fromEntries((cfgRows ?? []).map(c => [c.key, c.value as any]));
    const cfgMap = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)]));
    showCfg.current = {
      fxPrices: raw.fx_prices ?? undefined, pickPrice: cfgMap.pick_price_tokens || undefined, pickReturn: cfgMap.pick_return || undefined,
      jackpotShare: raw.jackpot_share !== undefined ? cfgMap.jackpot_share : undefined, jackpotChance: raw.jackpot_chance !== undefined ? cfgMap.jackpot_chance : undefined,
      teamReward: raw.team_reward_tickets !== undefined ? cfgMap.team_reward_tickets : undefined, gameCap: raw.game_daily_ticket_cap !== undefined ? cfgMap.game_daily_ticket_cap : undefined,
      weights: raw.balloons ? Object.fromEntries(Object.entries(raw.balloons).map(([k, v]: [string, any]) => [k, v.weight])) : undefined,
    };
    if (cfgMap.ticket_price_tokens) price.current = cfgMap.ticket_price_tokens;
    if (cfgMap.chat_min_tokens !== undefined) chatMin.current = cfgMap.chat_min_tokens;
    let wonToday = 0;
    if (meRef.current) {
      const d = new Date(), day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
      const { data: g } = await supabase.from('games').select('tickets_given,credited').eq('wallet', meRef.current).eq('status', 'played').gte('played_at', day);
      wonToday = (g ?? []).reduce((a, x) => a + (x.tickets_given ?? 0) + (x.credited ?? 0), 0);
    }
    const gameInfo = { price: cfgMap.game_price_tokens ?? 10000, shots: cfgMap.game_shots ?? 3, chance: cfgMap.game_hit_chance ?? 0.3, remaining: Math.max(0, (cfgMap.game_daily_ticket_cap ?? 5) - wonToday) };
    const round = rounds?.[0], prev = rounds?.[1];
    let tickets: { wallet: string; tickets: number }[] = [], lastBuyer: string | null = null;
    if (round) {
      const { data: t } = await supabase.from('tickets').select('wallet,count,kind,created_at').eq('round_id', round.id).order('created_at');
      const m = new Map<string, number>();
      for (const x of t ?? []) { m.set(x.wallet, (m.get(x.wallet) ?? 0) + x.count); if (x.kind === 'burn' || x.kind === 'late') lastBuyer = x.wallet; }
      tickets = [...m].map(([wallet, n]) => ({ wallet, tickets: n }));
    }
    let myPick: any = null, pickResult: any = null;
    if (meRef.current && round) {
      const [{ data: cur }, { data: last }] = await Promise.all([
        supabase.from('predictions').select('round_id,color,tickets_if_win').eq('wallet', meRef.current).eq('round_id', round.id).maybeSingle(),
        supabase.from('predictions').select('id,status,tickets_if_win').eq('wallet', meRef.current).neq('status', 'open').order('id', { ascending: false }).limit(1).maybeSingle(),
      ]);
      myPick = cur ?? null; pickResult = last ?? null;
    }
    await loadNicks([...tickets.map(t => t.wallet), lastBuyer, ...(trades ?? []).map(t => t.wallet), ...(chat ?? []).map(c => c.wallet), round?.winner_wallet, round?.last_buyer, prev?.winner_wallet, prev?.last_buyer, meRef.current]);
    tickets = tickets.map(t => ({ ...t, wallet: nm(t.wallet)! }));
    lastBuyer = nm(lastBuyer) ?? null;
    const named = (r: any) => r && { ...r, winner_wallet: nm(r.winner_wallet), last_buyer: nm(r.last_buyer) };
    const pumpUrl = (process.env.NEXT_PUBLIC_PUMPFUN_URL ?? '').startsWith('https://pump.fun/coin/') && !(process.env.NEXT_PUBLIC_PUMPFUN_URL ?? '').includes('YOUR_MINT') ? process.env.NEXT_PUBLIC_PUMPFUN_URL : undefined;
    post({ round: named(round), prev: named(prev), tickets, lastBuyer, trades: (trades ?? []).map(t => ({ ...t, wallet: nm(t.wallet) })).reverse(), chat: (chat ?? []).map(c => ({ ...c, wallet: c.is_ringmaster ? c.wallet : c.source === 'pumpfun' ? (c.author || 'pump.fun') : nm(c.wallet) })).reverse(), price: price.current, chatMin: chatMin.current, pumpUrl, gameInfo, showCfg: showCfg.current, myPick, pickResult });
  }, [post, loadNicks]);

  // Stats, leaderboard and history: one precomputed snapshot written by the engine, never aggregated here.
  const pushSnapshots = useCallback(async () => {
    const B2T: Record<string, string> = { green: 'verde', blue: 'blu', red: 'rosso', gold: 'oro' };
    const { data: snaps } = await supabase.from('snapshots').select('key,data');
    const snap = (k: string) => snaps?.find(x => x.key === k)?.data;
    const st = snap('stats') ?? {};
    const stats = { burned: Number(st.tokens_burned ?? 0), buyback: Number(st.sol_bought_back ?? 0), prizes: Number(st.sol_paid ?? 0), rounds: Number(st.rounds_played ?? 0) };
    const me = meRef.current;
    const mine = new Map<number, number>();
    let leaderboard: any[] = (snap('leaderboard') as any[]) ?? [];
    if (me) {
      const [{ data: myT }, { data: meRow }] = await Promise.all([
        supabase.from('tickets').select('round_id,count').eq('wallet', me).order('id', { ascending: false }).limit(500),
        leaderboard.some(l => l.wallet === me) ? Promise.resolve({ data: null }) : supabase.from('leaderboard').select('*').eq('wallet', me).maybeSingle(),
      ]);
      for (const t of myT ?? []) mine.set(t.round_id, (mine.get(t.round_id) ?? 0) + t.count);
      if (meRow) leaderboard = [...leaderboard, meRow];
    }
    await loadNicks([...leaderboard.map(l => l.wallet), ...(((snap('history') as any[]) ?? []).flatMap(r => [r.winner_wallet, r.last_buyer]))]);
    leaderboard = leaderboard.map(l => ({ ...l, wallet: nm(l.wallet) }));
    const history = ((snap('history') as any[]) ?? []).map(r => ({
      round: r.id, type: B2T[r.balloon], cap: Number(r.capacity_sol), tickets: r.total_tickets, wallets: r.wallets,
      mine: mine.get(r.id) ?? 0, rinvio: r.phase === 'postponed', winner: nm(r.winner_wallet), winT: r.winner_tickets ?? 0,
      main: Number(r.prize_sol ?? 0) * 0.95, last: nm(r.last_buyer), bonus: r.last_buyer ? Number(r.prize_sol ?? 0) * 0.05 : 0,
    }));
    post({ stats, history, leaderboard, jackpot: Number(st.jackpot_sol ?? 0), queue: Number(st.queue_sol ?? 0), teams: snap('teams') ?? undefined });
  }, [post, loadNicks]);

  const pushState = useCallback(async () => { await Promise.all([pushLive(), pushSnapshots()]); }, [pushLive, pushSnapshots]);

  // who you are on the stage: display name (X handle or nickname), and whether you still need a nickname
  const sendIdentity = useCallback(async (addr: string) => {
    nicks.current.delete(addr);
    const { data: prof } = await supabase.from('profiles').select('nickname,x_handle,team,team_set_at').eq('wallet', addr).maybeSingle();
    const display = prof ? (prof.x_handle ? '@' + prof.x_handle : prof.nickname) : '';
    nicks.current.set(addr, display);
    const balance = await circoBalanceClient(connection, new PublicKey(addr)).catch(() => 0);
    post({ me: display || addr, balance, nick: prof?.nickname ?? '', xHandle: prof?.x_handle ?? '', team: prof?.team ?? '', teamSetAt: prof?.team_set_at ?? null, needNick: !prof });
  }, [connection, post]);

  // live updates: game tables re-send the round, the snapshot table re-sends stats (both debounced)
  useEffect(() => {
    let tLive: ReturnType<typeof setTimeout> | null = null, tSnap: ReturnType<typeof setTimeout> | null = null;
    const live = () => { if (tLive) clearTimeout(tLive); tLive = setTimeout(pushLive, 250); };
    const snaps = () => { if (tSnap) clearTimeout(tSnap); tSnap = setTimeout(pushSnapshots, 500); };
    const ch = supabase.channel('stage')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, live)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, live)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trades' }, live)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, live)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'snapshots' }, snaps)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'effects' }, async (p: any) => {
        const e = p.new; if (!e) return;
        await loadNicks([e.wallet]);
        post({ fx: { effect: e.effect, who: nm(e.wallet) } });
      })
      .subscribe();
    const safety = setInterval(pushState, 30_000);
    return () => { supabase.removeChannel(ch); clearInterval(safety); };
  }, [pushLive, pushSnapshots, pushState, loadNicks]);

  // wallet identity and balance for the chat gate
  useEffect(() => {
    meRef.current = publicKey ? publicKey.toBase58() : null;
    pushState();
    if (!publicKey) { post({ me: null, balance: 0, nick: '' }); return; }
    const addr = publicKey.toBase58();
    sendIdentity(addr);
  }, [publicKey, connection, post, pushState, loadNicks, sendIdentity]);

  // coming back from X: tell the player how the link went
  useEffect(() => {
    const x = new URLSearchParams(window.location.search).get('x');
    if (!x) return;
    const msg = x.startsWith('linked:') ? `X account linked: @${x.slice(7)}` : x === 'taken' ? 'That X account is already linked to another wallet.' : x === 'cancelled' ? 'X linking cancelled.' : 'Could not link X. Try again.';
    setTimeout(() => post({ toast: msg }), 1500);
    window.history.replaceState(null, '', window.location.pathname);
  }, [post]);

  // requests coming from the stage
  useEffect(() => {
    async function signed(action: string, extra?: string) {
      if (!publicKey || !signMessage) throw new Error('Connect a wallet that can sign messages.');
      const message = `${action}:${publicKey.toBase58()}:${Date.now()}${extra ? ':' + extra : ''}`;
      const sig = await signMessage(new TextEncoder().encode(message));
      return { wallet: publicKey.toBase58(), message, signature: bs58.encode(sig) };
    }
    async function onMessage(e: MessageEvent) {
      if (e.source !== frame.current?.contentWindow) return;
      const m = e.data as { type: string; n?: number; round?: number; text?: string; url?: string; nick?: string; team?: string; effect?: string; color?: string };
      try {
        if (m.type === 'circo-ready') { pushState(); return; }
        if (m.type === 'circo-connect') { setVisible(true); return; }
        if (!publicKey) { setVisible(true); post(m.type === 'circo-game' ? { gameError: 'Connect your wallet first.' } : m.type === 'circo-nick' ? { nickError: 'Connect your wallet first.' } : { toast: 'Connect your wallet first.' }); return; }
        // playing needs a nickname: buying, chatting, games and the mission all ask for one first
        if (['circo-buy', 'circo-chat', 'circo-game', 'circo-mission', 'circo-fx', 'circo-pick'].includes(m.type) && !nicks.current.get(publicKey.toBase58())) {
          const { data: prof } = await supabase.from('profiles').select('wallet').eq('wallet', publicKey.toBase58()).maybeSingle();
          if (!prof) { post({ needNick: true, ...(m.type === 'circo-game' ? { gameError: 'Choose a nickname first.' } : {}) }); return; }
        }
        if (m.type === 'circo-buy' && m.round && m.n) {
          const tx = await buildTicketTx(connection, publicKey, m.round, m.n, price.current);
          const sig = await sendTransaction(tx, connection);
          post({ toast: 'Burning… waiting for confirmation.' });
          await connection.confirmTransaction(sig, 'confirmed');
          const res = await fetch('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature: sig }) });
          const out = await res.json();
          post({ toast: !res.ok ? out.error : out.credited > 0 ? `Done: ${out.given} tickets this round, ${out.credited} saved for the next rounds.` : `Done: you hold ${out.tickets} tickets this round.` });
          circoBalanceClient(connection, publicKey).then(balance => post({ me: publicKey.toBase58(), balance }));
        }
        if (m.type === 'circo-nick' && typeof m.nick === 'string') {
          try {
            const res = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await signed('nickname', m.team ? `${m.nick}:${m.team}` : m.nick)) });
            const out = await res.json();
            if (!res.ok) { post({ nickError: out.error }); return; }
            post({ nickSaved: out.nickname });
            await sendIdentity(publicKey.toBase58());
            pushState();
          } catch (err) { post({ nickError: (err as Error).message }); }
          return;
        }
        if (m.type === 'circo-team' && m.team) {
          try {
            const res = await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await signed('team', m.team)) });
            const out = await res.json();
            post({ toast: res.ok ? `Welcome to the ${m.team === 'clowns' ? 'Clowns 🤡' : 'Acrobats 🤸'}!` : out.error });
            if (res.ok) await sendIdentity(publicKey.toBase58());
          } catch (err) { post({ toast: (err as Error).message }); }
          return;
        }
        if (m.type === 'circo-fx' && m.effect) {
          try {
            const cost = showCfg.current.fxPrices?.[m.effect];
            if (!cost) { post({ toast: 'That effect is not available.' }); return; }
            const sig = await sendTransaction(await buildMemoBurnTx(connection, publicKey, cost, `CIRCO-FX:${m.effect}`), connection);
            await connection.confirmTransaction(sig, 'confirmed');
            const res = await fetch('/api/fx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature: sig }) });
            if (!res.ok) post({ toast: (await res.json()).error });
          } catch (err) { post({ toast: (err as Error).message }); }
          return;
        }
        if (m.type === 'circo-pick' && m.color && m.round) {
          try {
            const cost = showCfg.current.pickPrice ?? 10000;
            const sig = await sendTransaction(await buildMemoBurnTx(connection, publicKey, cost, `CIRCO-PICK:${m.round}:${m.color}`), connection);
            await connection.confirmTransaction(sig, 'confirmed');
            const res = await fetch('/api/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature: sig }) });
            const out = await res.json();
            post({ toast: !res.ok ? out.error : out.refunded ? out.reason : `Guess saved: ${m.color}. It pays ${out.ticketsIfWin} tickets if it comes up.` });
            pushLive();
          } catch (err) { post({ toast: (err as Error).message }); }
          return;
        }
        if (m.type === 'circo-xlink') {
          try {
            const res = await fetch('/api/x/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await signed('xlink')) });
            const out = await res.json();
            if (!res.ok) { post({ toast: out.error }); return; }
            window.location.href = out.url;           // X login, then back to /?x=...
          } catch (err) { post({ toast: (err as Error).message }); }
          return;
        }
        if (m.type === 'circo-xunlink') {
          try {
            const res = await fetch('/api/x/unlink', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await signed('xunlink')) });
            const out = await res.json();
            if (!res.ok) { post({ toast: out.error }); return; }
            post({ toast: 'X account unlinked.' });
            await sendIdentity(publicKey.toBase58()); pushState();
          } catch (err) { post({ toast: (err as Error).message }); }
          return;
        }
        if (m.type === 'circo-game') {
          try {
            const st = await fetch('/api/game/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: publicKey.toBase58() }) });
            const game = await st.json();
            if (!st.ok) { post({ gameError: game.error }); return; }
            const tx = await buildGameTx(connection, publicKey, game.id, game.price);
            const sig = await sendTransaction(tx, connection);
            await connection.confirmTransaction(sig, 'confirmed');
            const pl = await fetch('/api/game/play', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: game.id, signature: sig }) });
            const out = await pl.json();
            if (!pl.ok) { post({ gameError: out.error }); return; }
            post({ game: out });
            pushLive();
          } catch (err) { post({ gameError: (err as Error).message }); }
          return;
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
  }, [publicKey, connection, sendTransaction, signMessage, setVisible, post, pushState, pushLive, sendIdentity]);

  return <iframe ref={frame} className="stage" src={`/stage/index.html?data=live&v=${STAGE_VERSION}`} title="$CIRCO live stage" allow="autoplay" />;
}
