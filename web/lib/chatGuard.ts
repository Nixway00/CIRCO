// Anti-scam rules for the chat. Scammers post fake contract addresses and phishing links in memecoin
// chats: here neither can appear, except the official mint address.
const LINK = /(https?:\/\/|www\.|t\.me\/|discord\.(gg|com)|\b[a-z0-9-]+\.(com|io|xyz|fun|app|net|org|gg|co|me|link|site|online|live|pro|vip|top|cc|ru|to)\b)/i;
const ADDRESS = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

// names people say all the time are fine: pump.fun itself and our own site
const ALLOWED = ['pump.fun', (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')].filter(Boolean);

export function chatProblem(text: string, officialMint = process.env.NEXT_PUBLIC_CIRCO_MINT ?? ''): string | null {
  let t = text;
  for (const d of ALLOWED) t = t.split(d).join(' ');
  if (/https?:\/\//i.test(text) && !ALLOWED.some(d => text.includes('://' + d))) return 'Links are not allowed in the chat (anti-scam).';
  if (LINK.test(t)) return 'Links are not allowed in the chat (anti-scam).';
  const addrs = t.match(ADDRESS) ?? [];
  if (addrs.some(a => a !== officialMint)) return 'Wallet or token addresses are not allowed in the chat (anti-scam). The only contract address is on this site.';
  return null;
}
