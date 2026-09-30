import { NextResponse } from 'next/server';

/** Forwards the burn signature to the engine, which verifies it on-chain and records the tickets. */
export async function POST(req: Request) {
  const { signature } = await req.json();
  if (typeof signature !== 'string' || signature.length < 60) return NextResponse.json({ error: 'bad signature' }, { status: 400 });
  const res = await fetch(`${process.env.ENGINE_URL}/tickets/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-engine-secret': process.env.ENGINE_API_SECRET! },
    body: JSON.stringify({ signature }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
