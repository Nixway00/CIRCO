// Bridge to the coin's pump.fun live chat (the chat shown under the token and during pump.fun livestreams).
// pump.fun has no official chat API: this speaks the same socket.io protocol as their website. Reading is
// public; posting (our big moments) needs the auth token of a pump.fun account in PUMPFUN_CHAT_TOKEN.
// If pump.fun changes the protocol, the bridge just stops relaying and the game carries on unaffected.
import WebSocket from 'ws';
import { db } from './db.ts';

const URL = 'wss://livechat.pump.fun/socket.io/?EIO=4&transport=websocket';
const HEADERS = { Origin: 'https://pump.fun', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36' };

interface PfMessage { id: string; username: string; userAddress?: string; message: string; timestamp?: string }

export class PumpFunChat {
  private ws: WebSocket | null = null;
  private ack = 0;
  private pending = new Map<number, string>();
  private retry = 0;
  private stopped = false;
  authenticated = false;

  private mint: string;
  private token: string | null;
  private enabled: () => boolean;

  constructor(mint: string, token: string | null, enabled: () => boolean) {
    this.mint = mint; this.token = token; this.enabled = enabled;   // no parameter properties: the engine runs with plain type stripping
  }

  start() { this.stopped = false; this.connect(); }
  stop() { this.stopped = true; this.ws?.close(); }

  private next(ev: string) { const id = this.ack; this.ack = (this.ack + 1) % 10; this.pending.set(id, ev); return id; }
  private send(s: string) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(s); }

  private connect() {
    if (this.stopped) return;
    const ws = new WebSocket(URL, { headers: HEADERS });
    this.ws = ws;
    ws.on('message', (raw) => this.onFrame(raw.toString()));
    ws.on('close', () => this.reconnect());
    ws.on('error', () => { /* 'close' follows and reconnects */ });
  }

  private reconnect() {
    this.authenticated = false;
    if (this.stopped) return;
    const wait = Math.min(60_000, 2_000 * 2 ** Math.min(this.retry++, 5));
    setTimeout(() => this.connect(), wait);
  }

  private onFrame(s: string) {
    if (s === '2') return this.send('3');                                  // engine.io ping
    if (s.startsWith('0')) return this.send(`40${JSON.stringify({ origin: 'https://pump.fun', timestamp: Date.now(), token: this.token })}`);
    if (s.startsWith('40')) {
      this.retry = 0;
      return this.send(`42${this.next('joinRoom')}${JSON.stringify(['joinRoom', { roomId: this.mint, username: 'CIRCO Ringmaster' }])}`);
    }
    if (s.startsWith('43')) {                                             // acknowledgement: 43<id>[payload]
      const id = Number(s[2]); const ev = this.pending.get(id); this.pending.delete(id);
      let payload: any; try { payload = JSON.parse(s.slice(3))?.[0]; } catch { return; }
      if (ev === 'joinRoom') { this.authenticated = !!payload?.authenticated; this.history(); }
      if (ev === 'getMessageHistory' && Array.isArray(payload)) for (const m of payload.slice(-30)) this.store(m).catch(() => {});
      return;
    }
    if (s.startsWith('42')) {
      let arr: any; try { arr = JSON.parse(s.slice(2)); } catch { return; }
      const [ev, payload] = arr ?? [];
      if (ev === 'setCookie') this.history();
      if (ev === 'newMessage') this.store(payload).catch(() => {});
    }
  }

  private history() { this.send(`42${this.next('getMessageHistory')}${JSON.stringify(['getMessageHistory', { roomId: this.mint, before: null, limit: 30 }])}`); }

  /** A pump.fun message becomes a site chat line (deduplicated by its pump.fun id). */
  private async store(m: PfMessage) {
    if (!m?.id || !m.message || !this.enabled()) return;
    if (m.username === 'CIRCO Ringmaster') return;                       // our own relayed lines
    await db.from('chat_messages').upsert({
      ext_id: `pf:${m.id}`, source: 'pumpfun', author: String(m.username || 'anon').slice(0, 24),
      wallet: m.userAddress || 'pump.fun', body: String(m.message).slice(0, 200), is_ringmaster: false,
    }, { onConflict: 'ext_id', ignoreDuplicates: true });
  }

  /** Big moments (winners, Mega Pops) are also posted in the pump.fun chat, if we are logged in there. */
  say(text: string) {
    if (!this.authenticated || !this.enabled()) return;
    this.send(`42${this.next('sendMessage')}${JSON.stringify(['sendMessage', { roomId: this.mint, message: text.slice(0, 200), username: 'CIRCO Ringmaster' }])}`);
  }
}
