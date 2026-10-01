// Animated explainer: how the $CIRCO buyback bot buys. Draws one frame for a given minute of the story.
// Data comes from the real strategy (engine/src/buybackStrategy.ts) run on a story chart.
(function () {
  const C = { night: '#030716', navy: '#0A1442', line: 'rgba(120,150,255,.16)', ink: '#EAF0FF', muted: '#93A0C8',
    cyan: '#5CE1FF', red: '#FF3D6E', gold: '#FFD34D', mint: '#2EF2A6', grey: '#56618A' };
  const W = 1600, H = 900;
  const box = { x: 96, y: 236, w: 1090, h: 460 };
  const LBL = { dip_1: 'Step 1', dip_2: 'Step 2', dip_3: 'Step 3', quiet_support: 'Quiet support' };

  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function pill(ctx, text, x, y, bg, fg, font) {
    ctx.font = font || '600 20px Onest'; const w = ctx.measureText(text).width + 28;
    ctx.fillStyle = bg; rr(ctx, x, y - 18, w, 36, 18); ctx.fill(); ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 14, y + 1); return w;
  }

  window.drawFrame = function (ctx, S, tf) {
    const F = S.frames, N = F.length, t = Math.min(N - 1, Math.floor(tf));
    const ps = F.map(f => f.p), lo = Math.min(...ps) * 0.93, hi = Math.max(...ps) * 1.04;
    const X = i => box.x + (i / (N - 1)) * box.w, Y = p => box.y + box.h - ((p - lo) / (hi - lo)) * box.h;

    // background: night with faint big-top stripes
    ctx.fillStyle = C.night; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.35, 120, 50, W * 0.35, 120, 900); g.addColorStop(0, 'rgba(47,123,255,.20)'); g.addColorStop(1, 'rgba(47,123,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 16; i++) { if (i % 2) continue; ctx.fillStyle = 'rgba(255,61,110,.025)'; ctx.fillRect(i * 100, 0, 100, H); }

    // title
    ctx.fillStyle = C.ink; ctx.textBaseline = 'alphabetic';
    ctx.font = '800 46px Unbounded'; ctx.fillText('How our buyback bot buys', 96, 112);
    ctx.font = '400 24px Onest'; ctx.fillStyle = C.muted;
    ctx.fillText('It waits for a real dip, then buys in three steps, each only once the price stops falling.', 96, 156);
    ctx.fillText('Everything it buys is burned.', 96, 188);

    // grid
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const y = box.y + (k / 4) * box.h; ctx.beginPath(); ctx.moveTo(box.x, y); ctx.lineTo(box.x + box.w, y); ctx.stroke(); }

    // dip episode: band and step levels
    const ep = F[t].ep;
    if (ep) {
      const yRef = Y(ep.ref);
      ctx.fillStyle = 'rgba(255,61,110,.08)'; ctx.fillRect(box.x, yRef, box.w, Y(ep.ref * (1 - ep.levels[2] - 0.08)) - yRef);
      ep.levels.forEach((L, i) => {
        const y = Y(ep.ref * (1 - L));
        ctx.setLineDash([8, 8]); ctx.strokeStyle = ep.fired[i] ? 'rgba(46,242,166,.7)' : 'rgba(255,61,110,.75)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(box.x, y); ctx.lineTo(box.x + box.w, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = '600 18px Onest'; ctx.fillStyle = ep.fired[i] ? C.mint : C.red; ctx.textBaseline = 'middle';
        ctx.fillText(`${LBL['dip_' + (i + 1)]}: −${Math.round(L * 100)}% · buys ${[25, 35, 40][i]}% of the dip budget${ep.fired[i] ? ' ✓' : ''}`, box.x + box.w - 470, y - 14);
      });
      ctx.setLineDash([3, 6]); ctx.strokeStyle = 'rgba(234,240,255,.35)'; ctx.beginPath(); ctx.moveTo(box.x, yRef); ctx.lineTo(box.x + box.w, yRef); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '500 16px Onest'; ctx.fillStyle = C.muted; ctx.textBaseline = 'bottom'; ctx.fillText('recent high', box.x + 6, yRef - 4);
    }

    // price line with glow
    ctx.save(); ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = C.cyan; ctx.shadowColor = 'rgba(92,225,255,.7)'; ctx.shadowBlur = 14;
    ctx.beginPath(); for (let i = 0; i <= t; i++) { const x = X(i), y = Y(F[i].p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); ctx.restore();
    // area under
    const ga = ctx.createLinearGradient(0, box.y, 0, box.y + box.h); ga.addColorStop(0, 'rgba(92,225,255,.18)'); ga.addColorStop(1, 'rgba(92,225,255,0)');
    ctx.fillStyle = ga; ctx.beginPath(); ctx.moveTo(X(0), box.y + box.h); for (let i = 0; i <= t; i++) ctx.lineTo(X(i), Y(F[i].p)); ctx.lineTo(X(t), box.y + box.h); ctx.fill();
    // head dot
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(t), Y(F[t].p), 7, 0, 7); ctx.fill();

    // waiting / quiet notes next to the head
    const note = F[t].note || '';
    if (ep && note.indexOf('waiting') >= 0) pill(ctx, '⏳ still falling: the bot waits', Math.min(X(t) + 18, box.x + box.w - 330), Y(F[t].p) + 40, 'rgba(255,61,110,.92)', '#fff');
    const quiet = t > 262 && t < 380;
    if (quiet) { ctx.font = '600 18px Onest'; ctx.fillStyle = C.muted; ctx.textBaseline = 'alphabetic'; ctx.fillText('quiet market, little volume', X(285), box.y + box.h - 18); }

    // the fixed-clock bot lane
    const laneY = box.y + box.h + 58;
    ctx.font = '600 18px Onest'; ctx.fillStyle = C.grey; ctx.textBaseline = 'middle'; ctx.fillText('A bot on a fixed clock', box.x, laneY - 30);
    ctx.strokeStyle = 'rgba(86,97,138,.5)'; ctx.beginPath(); ctx.moveTo(box.x, laneY); ctx.lineTo(box.x + box.w, laneY); ctx.stroke();
    S.events.forEach(e => { if (e.kind !== 'clock' || e.t > t) return; ctx.fillStyle = C.grey; ctx.fillRect(X(e.t) - 1.5, laneY - 9, 3, 18); });
    ctx.fillStyle = C.grey; ctx.font = '400 17px Onest'; ctx.fillText('buys every 10 minutes, at any price: easy for other bots to front-run', box.x + 220, laneY - 30);

    // our buys: markers and burn sparks
    S.events.forEach(e => {
      if (e.kind === 'clock' || e.t > t) return;
      const x = X(e.t), y = Y(F[e.t].p), age = t - e.t;
      const big = e.kind !== 'quiet_support';
      ctx.fillStyle = C.mint; ctx.shadowColor = 'rgba(46,242,166,.9)'; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(x, y, big ? 11 : 8, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      if (age < 26) {   // flame sparks rising: the tokens are burned
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2, rise = age * 3.2, sx = x + Math.cos(a) * (10 + age * 1.4), sy = y - rise - Math.sin(a) * 8;
          ctx.globalAlpha = Math.max(0, 1 - age / 26); ctx.fillStyle = k % 2 ? C.gold : C.red; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      // label stays a while, then the marker remains
      if (age < 60) {
        ctx.globalAlpha = Math.min(1, (60 - age) / 12);
        const label = `${LBL[e.kind]} · buys ${e.sol.toFixed(2)} SOL · burned 🔥`;
        pill(ctx, label, Math.min(x + 16, box.x + box.w - 380), y + (big ? 34 : -34), 'rgba(46,242,166,.95)', '#03140d');
        ctx.globalAlpha = 1;
      }
    });

    // right panel: dip reserve and burned per SOL
    const px = 1250, pw = 254;
    ctx.fillStyle = 'rgba(10,20,66,.75)'; rr(ctx, px, box.y - 20, pw, box.h + 130, 22); ctx.fill();
    ctx.strokeStyle = 'rgba(120,150,255,.25)'; ctx.stroke();
    ctx.fillStyle = C.ink; ctx.font = '700 22px Unbounded'; ctx.textBaseline = 'alphabetic'; ctx.fillText('Dip reserve', px + 24, box.y + 22);
    ctx.font = '400 16px Onest'; ctx.fillStyle = C.muted; ctx.fillText('fees fill it, dips spend it', px + 24, box.y + 48);
    const maxBal = Math.max(...F.map(f => f.bal)), bh = 230, by = box.y + 70, fill = (F[t].bal / maxBal) * bh;
    ctx.fillStyle = 'rgba(255,211,77,.12)'; rr(ctx, px + 24, by, 60, bh, 12); ctx.fill();
    ctx.fillStyle = C.gold; rr(ctx, px + 24, by + bh - fill, 60, Math.max(6, fill), 12); ctx.fill();
    ctx.fillStyle = C.gold; ctx.font = '800 34px Unbounded'; ctx.fillText(F[t].bal.toFixed(1), px + 104, by + bh - 34);
    ctx.font = '500 18px Onest'; ctx.fillStyle = C.muted; ctx.fillText('SOL ready', px + 106, by + bh - 8);

    // tokens burned per SOL so far: clock vs ours
    let cs = 0, ct = 0, ss = 0, stt = 0;
    S.events.forEach(e => { if (e.t > t) return; const p = F[e.t].p; if (e.kind === 'clock') { cs += e.sol; ct += e.sol / p; } else { ss += e.sol; stt += e.sol / p; } });
    const ratio = ss && cs ? (stt / ss) / (ct / cs) : null;
    const ty = by + bh + 60;
    ctx.fillStyle = C.ink; ctx.font = '700 20px Unbounded'; ctx.fillText('Burned per SOL', px + 24, ty);
    const bw = pw - 48;
    ctx.font = '500 16px Onest'; ctx.fillStyle = C.grey; ctx.fillText('fixed clock', px + 24, ty + 34);
    ctx.fillStyle = 'rgba(86,97,138,.8)'; rr(ctx, px + 24, ty + 44, bw * 0.62, 16, 8); ctx.fill();
    ctx.fillStyle = C.mint; ctx.fillText('our bot', px + 24, ty + 88);
    const ours = ratio ? Math.min(1, 0.62 * ratio) : 0;
    ctx.fillStyle = C.mint; rr(ctx, px + 24, ty + 98, Math.max(16, bw * ours), 16, 8); ctx.fill();
    if (ratio) { ctx.font = '800 26px Unbounded'; ctx.fillStyle = C.mint; ctx.fillText(`+${Math.round((ratio - 1) * 100)}%`, px + 24, ty + 150); ctx.font = '400 15px Onest'; ctx.fillStyle = C.muted; ctx.fillText('more $CIRCO burned', px + 24, ty + 172); }

    // closing card after the chart has played
    if (tf > N + 6) {
      const k = Math.min(1, (tf - N - 6) / 12);
      ctx.globalAlpha = k; ctx.fillStyle = 'rgba(3,7,22,.78)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = C.ink; ctx.font = '800 64px Unbounded'; ctx.textBaseline = 'alphabetic';
      const r = S.result.smart / S.result.clock;
      ctx.fillText('Same SOL.', 160, 380);
      ctx.fillStyle = C.mint; ctx.fillText(`+${Math.round((r - 1) * 100)}% more $CIRCO burned.`, 160, 470);
      ctx.fillStyle = C.muted; ctx.font = '400 28px Onest';
      ctx.fillText('Bought in the dips, in steps, never on a clock other bots can predict.', 160, 540);
      ctx.fillText('Over 160 simulated days the gain was between +26% and +49%.', 160, 584);
      ctx.globalAlpha = 1;
    }
    // footer
    ctx.font = '800 22px Unbounded'; ctx.fillStyle = C.ink; ctx.fillText('$CIRCO', 96, H - 44);
    ctx.font = '400 17px Onest'; ctx.fillStyle = C.muted; ctx.fillText('Simulated chart. The buy decisions come from the real bot code, open on GitHub.', 236, H - 46);
  };
})();
