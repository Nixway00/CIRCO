import { NextResponse } from 'next/server';

/** Forwards a confirmed burn to the engine, which checks it on chain and records it. */
export async function POST(req: Request) {
  const { signature } = await req.json();
  if (typeof signature !== 'string' || signature.length < 60) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const res = await fetch(`${process.env.ENGINE_URL}/fx/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-engine-secret': process.env.ENGINE_API_SECRET! },
    body: JSON.stringify({ signature }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
