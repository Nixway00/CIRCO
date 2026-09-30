import { env } from './env.ts';
import { db } from './db.ts';

/**
 * Posts one line on X for every pop. No links on purpose: X charges $0.015 per post
 * and $0.20 per post with a link (pay-per-use pricing, 2026). The site link lives in the bio.
 *
 * Auth: OAuth 2 user context with offline.access. Access tokens last about 2 hours and refresh
 * tokens rotate on every use, so the latest refresh token is kept in the private
 * `engine_secrets` table. Seed it once with X_REFRESH_TOKEN from the first login.
 */
let access: { token: string; expiresAt: number } | null = null;

async function refreshToken(): Promise<string | null> {
  if (!env.X_CLIENT_ID) return null;
  const { data } = await db.from('engine_secrets').select('value').eq('key', 'x_refresh_token').maybeSingle();
  const refresh = data?.value ?? env.X_REFRESH_TOKEN;
  if (!refresh) return null;
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (env.X_CLIENT_SECRET) headers.Authorization = 'Basic ' + Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST', headers,
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: env.X_CLIENT_ID }),
  });
  if (!res.ok) { console.error('X token refresh failed', res.status, await res.text()); return null; }
  const out = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
  if (out.refresh_token) await db.from('engine_secrets').upsert({ key: 'x_refresh_token', value: out.refresh_token, updated_at: new Date().toISOString() });
  access = { token: out.access_token, expiresAt: Date.now() + (out.expires_in - 120) * 1000 };
  return access.token;
}

async function token(): Promise<string | null> {
  if (access && Date.now() < access.expiresAt) return access.token;
  return refreshToken();
}

export async function postPop(text: string): Promise<void> {
  const t = await token();
  if (!t) return;
  const res = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 280) }),
  });
  if (res.status === 401) access = null;           // refresh on the next pop
  if (!res.ok) console.error('X post failed', res.status, await res.text());
}
