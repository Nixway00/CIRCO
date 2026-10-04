'use client';
import { PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import bs58 from 'bs58';
import { buildTicketTx, buildGameTx, buildMemoBurnTx } from '@/lib/tickets';
import type { Connection } from '@solana/web3.js';

/** Waits for a transaction by polling its status (no websocket needed, so it works through the RPC proxy). */
/** Reads a JSON reply, or turns a server crash into a readable error. */
async function readJson(res: Response): Promise<any> {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { error: res.ok ? 'Unexpected reply from the server.' : `Server error (${res.status}). Try again in a minute.` }; }
}

async function waitForSignature(connection: Connection, sig: string, timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = (await connection.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error('The transaction failed on chain.');
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Not confirmed yet. If it lands, your tickets will still be counted.');
}

/**
 * The 3D stage runs in an iframe in "live data" mode. This component is its only source of truth:
 * it reads the game from a cached endpoint (/api/live) shared by every viewer, sends it to the stage, and turns the stage's
 * requests (buy tickets, chat, mission, connect) into real wallet actions.
 */
/** Changes on every deploy, so phones never keep an old copy of the stage. */
const STAGE_VERSION = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 8);

export default function StageBridge({ broadcast = false, sound = false }: { broadcast?: boolean; sound?: boolean } = {}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signMessage, wallets } = useWallet();
  const { setVisible } = useWalletModal();
  // On a phone's normal browser (Safari, Chrome) no wallet is installed in the page: signing would bounce
  // between apps and lose the session. Open the site inside Phantom's own browser instead, where it just works.
  const openWallet = useCallback(() => {
    const mobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
    const w = window as any;
    const injected = !!(w.phantom?.solana || w.solana || w.solflare || w.backpack);
    const hasWallet = injected || wallets.some(x => x.readyState === 'Installed' || x.readyState === 'Loadable');
    if (mobile && !hasWallet) {
      const here = window.location.href;
      window.location.href = `https://phantom.app/ul/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(window.location.origin)}`;
      return;
    }
    setVisible(true);
  }, [wallets, setVisible]);
  const price = useRef(10000);
  const chatMin = useRef(10000);
  const showCfg = useRef<any>({});
  const meRef = useRef<string | null>(null);

  const post = useCallback((m: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ type: 'circo-state', ...m }, window.location.origin);
  }, []);

  // ---------- data: one cached snapshot for everyone, plus a small per-wallet request ----------
  // The public state comes from /api/live, cached by the CDN for a second: a thousand viewers cost the
  // database the same as one, with no per-viewer realtime connections.
  const live = useRef<any>(null);
  const slowData = useRef<any>({});
  const balAt = useRef(0);
  const askedNick = useRef<string | null>(null);
  const me = useRef<any>(null);
  const lastFx = useRef<number | null>(null);

  const publish = useCallback(() => {
    if (!live.current) return;
    const L = { ...slowData.current, ...live.current };
    const M = me.current;
    const raw = L.config ?? {};
    const n = (k: string) => (raw[k] !== undefined && raw[k] !== null ? Number(raw[k]) : undefined);
    if (n('ticket_price_tokens')) price.current = n('ticket_price_tokens')!;
    if (n('chat_min_tokens') !== undefined) chatMin.current = n('chat_min_tokens')!;
    showCfg.current = {
      fxPrices: raw.fx_prices ?? undefined, pickPrice: n('pick_price_tokens'), pickReturn: n('pick_return'),
      jackpotShare: n('jackpot_share'), jackpotChance: n('jackpot_chance'), teamReward: n('team_reward_tickets'), gameCap: n('game_daily_ticket_cap'),
      weights: raw.balloons ? Object.fromEntries(Object.entries(raw.balloons).map(([k, v]: [string, any]) => [k, v.weight])) : undefined,
      balloonCfg: raw.balloons ?? undefined,
    };
    const gameInfo = { price: n('game_price_tokens') ?? 10000, shots: n('game_shots') ?? 3, chance: n('game_hit_chance') ?? 0.3, remaining: Math.max(0, (n('game_daily_ticket_cap') ?? 5) - (M?.wonToday ?? 0)) };
    const pumpUrl = (process.env.NEXT_PUBLIC_PUMPFUN_URL ?? '').startsWith('https://pump.fun/coin/') && !(process.env.NEXT_PUBLIC_PUMPFUN_URL ?? '').includes('YOUR_MINT') ? process.env.NEXT_PUBLIC_PUMPFUN_URL : undefined;
    let leaderboard: any[] = L.leaderboard ?? [];
    if (M?.leaderboardRow && !leaderboard.some(l => l.address === meRef.current)) leaderboard = [...leaderboard, { ...M.leaderboardRow, wallet: M.display || M.leaderboardRow.wallet }];
    const history = (L.history ?? []).map((h: any) => ({ ...h, mine: M?.mine?.[h.round] ?? 0 }));
    post({
      round: L.round, prev: L.prev, tickets: L.tickets, lastBuyer: L.lastBuyer, ticketsRound: L.ticketsRound, prevTickets: L.prevTickets, trades: L.trades, chat: L.chat,
      price: price.current, chatMin: chatMin.current, pumpUrl, gameInfo, showCfg: showCfg.current,
      myPick: M?.myPick ?? null, pickResult: M?.pickResult ?? null,
      lucky: M ? { losing: M.lucky.losing, given: M.lucky.given, every: n('lucky_every') ?? 20 } : undefined,
      stats: L.stats, history, leaderboard, jackpot: L.jackpot, queue: L.queue, reserve: L.reserve, teams: L.teams ?? undefined,
      milestone: L.milestone ?? undefined, siteHost: typeof window !== 'undefined' ? window.location.host : undefined,
    });
    // stage effects bought by anyone: play the new ones (not the ones that happened before you arrived)
    const fx: any[] = L.effects ?? [];
    const maxId = fx.reduce((a, e) => Math.max(a, e.id), 0);
    if (lastFx.current === null) lastFx.current = maxId;
    else for (const e of fx) if (e.id > lastFx.current) { post({ fx: { effect: e.effect, who: e.who } }); lastFx.current = Math.max(lastFx.current, e.id); }
  }, [post]);

  const refreshLive = useCallback(async () => {
    try { const r = await fetch('/api/live', { cache: 'no-store' }); if (r.ok) { live.current = await r.json(); publish(); } } catch { /* next poll */ }
  }, [publish]);
  const refreshSlow = useCallback(async () => {
    try { const r = await fetch('/api/live?part=slow', { cache: 'no-store' }); if (r.ok) { slowData.current = await r.json(); publish(); } } catch { /* next poll */ }
  }, [publish]);
  const refreshMe = useCallback(async () => {
    const addr = meRef.current;
    if (!addr) { me.current = null; post({ me: null, balance: 0, nick: '' }); publish(); return; }
    try {
      const withBal = Date.now() - balAt.current > 60_000;      // the balance costs an RPC call: once a minute, or right after an action
      const r = await fetch(`/api/me?wallet=${addr}${withBal ? '&bal=1' : ''}`, { cache: 'no-store' }); if (!r.ok) return;
      const m = await r.json();
      if (withBal) balAt.current = Date.now(); else m.balance = me.current?.balance ?? 0;
      me.current = m;
      const ask = m.needNick && askedNick.current !== addr;   // the window opens once; actions ask again if still needed
      if (ask) askedNick.current = addr;
      post({ me: m.display || addr, balance: m.balance, nick: m.nick, xHandle: m.xHandle, team: m.team, teamSetAt: m.teamSetAt, needNick: ask });
      publish();
    } catch { /* next poll */ }
  }, [post, publish]);
  const pushLive = refreshLive;
  const pushState = useCallback(async () => { balAt.current = 0; await Promise.all([refreshLive(), refreshSlow(), refreshMe()]); }, [refreshLive, refreshSlow, refreshMe]);
  const sendIdentity = useCallback(async (_addr: string) => { await refreshMe(); }, [refreshMe]);

  // polling: every 1.5 s while the page is visible, every 15 s in the background; your own data every 8 s
  useEffect(() => {
    let alive = true;
    const loop = async () => { if (!alive) return; await refreshLive(); setTimeout(loop, document.visibilityState === 'visible' ? 2000 : 20000); };
    loop(); refreshSlow();
    const slowTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshSlow(); }, 20000);
    const meTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshMe(); }, 10000);
    return () => { alive = false; clearInterval(meTimer); clearInterval(slowTimer); };
  }, [refreshLive, refreshSlow, refreshMe]);

  // wallet identity and balance for the chat gate
  useEffect(() => {
    meRef.current = publicKey ? publicKey.toBase58() : null;
    refreshMe();
  }, [publicKey, refreshMe]);

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
        if (m.type === 'circo-connect') { openWallet(); return; }
        if (!publicKey) { openWallet(); post(m.type === 'circo-game' ? { gameError: 'Connect your wallet first.' } : m.type === 'circo-nick' ? { nickError: 'Connect your wallet first.' } : { toast: 'Connect your wallet first.' }); return; }
        // playing needs a nickname: buying, chatting, games and the mission all ask for one first
        if (['circo-buy', 'circo-chat', 'circo-game', 'circo-mission', 'circo-fx', 'circo-pick'].includes(m.type)) {
          if (!me.current || me.current.needNick) await refreshMe();     // fresh answer from the server, never a stale one
          if (!me.current) { post({ toast: 'Could not reach the server, try again in a moment.' }); return; }
          if (me.current.needNick) { post({ needNick: true, toast: 'Choose a nickname first, then try again.', ...(m.type === 'circo-game' ? { gameError: 'Choose a nickname first.' } : {}) }); return; }
        }
        if (m.type === 'circo-buy' && m.round && m.n) {
          balAt.current = 0; await refreshMe();
          const need = m.n * price.current, have = Number(me.current?.balance ?? 0);
          if (have < need) { post({ toast: `You need ${need.toLocaleString('en-US')} $CIRCO for ${m.n} ticket${m.n > 1 ? 's' : ''}, you have ${Math.floor(have).toLocaleString('en-US')}. Buy some on Pump.fun first.` }); return; }
          const tx = await buildTicketTx(connection, publicKey, m.round, m.n, price.current);
          const sig = await sendTransaction(tx, connection);
          post({ toast: 'Burning… waiting for confirmation.' });
          await waitForSignature(connection, sig);
          const res = await fetch('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature: sig }) });
          const out = await readJson(res);
          post({ toast: !res.ok ? out.error : out.credited > 0 ? `Done: ${out.given} tickets this round, ${out.credited} saved for the next rounds.` : `Done: you hold ${out.tickets} tickets this round.` });
          balAt.current = 0; refreshMe(); refreshLive();
        }
        if (m.type === 'circo-nick' && typeof m.nick === 'string') {
          try {
            const res = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await signed('nickname', m.team ? `${m.nick}:${m.team}` : m.nick)) });
            const out = await readJson(res);
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
            const out = await readJson(res);
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
            await waitForSignature(connection, sig);
            const res = await fetch('/api/fx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature: sig }) });
            if (!res.ok) post({ toast: (await readJson(res)).error });
          } catch (err) { post({ toast: (err as Error).message }); }
          return;
        }
        if (m.type === 'circo-pick' && m.color && m.round) {
          try {
            const cost = showCfg.current.pickPrice ?? 10000;
            const sig = await sendTransaction(await buildMemoBurnTx(connection, publicKey, cost, `CIRCO-PICK:${m.round}:${m.color}`), connection);
            await waitForSignature(connection, sig);
            const res = await fetch('/api/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature: sig }) });
            const out = await readJson(res);
            post({ toast: !res.ok ? out.error : out.refunded ? out.reason : `Guess saved: ${m.color}. It pays ${out.ticketsIfWin} tickets if it comes up.` });
            pushLive();
          } catch (err) { post({ toast: (err as Error).message }); }
          return;
        }
        if (m.type === 'circo-xlink') {
          try {
            const res = await fetch('/api/x/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await signed('xlink')) });
            const out = await readJson(res);
            if (!res.ok) { post({ toast: out.error }); return; }
            window.location.href = out.url;           // X login, then back to /?x=...
          } catch (err) { post({ toast: (err as Error).message }); }
          return;
        }
        if (m.type === 'circo-xunlink') {
          try {
            const res = await fetch('/api/x/unlink', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await signed('xunlink')) });
            const out = await readJson(res);
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
            await waitForSignature(connection, sig);
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
          if (!res.ok) post({ toast: (await readJson(res)).error });
        }
        if (m.type === 'circo-mission' && m.url) {
          const res = await fetch('/api/mission', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(await signed('mission')), url: m.url }) });
          const out = await readJson(res);
          post({ toast: res.ok ? `Claimed ${out.tickets} bonus tickets for round ${out.round}.` : out.error });
        }
      } catch (err) { post({ toast: (err as Error).message }); }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [publicKey, connection, sendTransaction, signMessage, setVisible, openWallet, post, pushState, pushLive, sendIdentity, refreshMe, refreshLive]);

  return <iframe ref={frame} className="stage" src={`/stage/index.html?data=live&v=${STAGE_VERSION}${broadcast ? "&live=1" : ""}${sound ? "&sound=1" : ""}`} title="$CIRCO live stage" allow="autoplay" />;
}
