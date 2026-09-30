import { NextResponse } from 'next/server';

/** Shooting gallery, step 2: the engine checks the burn and settles the shots. */
export async function POST(req: Request) {
  const { id, signature } = await req.json();
  if (typeof id !== 'string' || typeof signature !== 'string') return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const res = await fetch(`${process.env.ENGINE_URL}/games/play`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-engine-secret': process.env.ENGINE_API_SECRET! },
    body: JSON.stringify({ id, signature }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
