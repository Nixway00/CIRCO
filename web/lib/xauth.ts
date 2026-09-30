import { createHash, randomBytes } from 'node:crypto';

// "Sign in with X" (OAuth 2.0 with PKCE), read-only: we only ask who the user is.
export const X_SCOPES = 'users.read tweet.read';
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function newPkce() {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, state: b64url(randomBytes(24)) };
}

export function authorizeUrl(state: string, challenge: string) {
  const p = new URLSearchParams({
    response_type: 'code', client_id: process.env.X_CLIENT_ID!, redirect_uri: process.env.X_REDIRECT_URI!,
    scope: X_SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  return `https://x.com/i/oauth2/authorize?${p}`;
}

export async function exchangeCode(code: string, verifier: string) {
  const res = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: process.env.X_REDIRECT_URI!, code_verifier: verifier }),
  });
  if (!res.ok) throw new Error(`X token exchange failed (${res.status})`);
  return (await res.json()).access_token as string;
}

export async function whoAmI(token: string) {
  const res = await fetch('https://api.x.com/2/users/me?user.fields=profile_image_url', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`X profile lookup failed (${res.status})`);
  const { data } = await res.json();
  return { id: data.id as string, handle: data.username as string, avatar: (data.profile_image_url as string | undefined) ?? null };
}
