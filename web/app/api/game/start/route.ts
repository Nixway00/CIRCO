import { NextResponse } from 'next/server';

/** Shooting gallery, step 1: the engine commits to a secret before the player burns anything. */
export async function POST(req: Request) {
  const { wallet } = await req.json();
  if (typeof wallet !== 'string' || wallet.length < 32 || wallet.length > 44) return NextResponse.json({ error: 'bad wallet' }, { status: 400 });
  const res = await fetch(`${process.env.ENGINE_URL}/games/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-engine-secret': process.env.ENGINE_API_SECRET! },
    body: JSON.stringify({ wallet }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
