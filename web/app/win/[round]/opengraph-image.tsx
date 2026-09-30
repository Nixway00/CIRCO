import { ImageResponse } from 'next/og';
import { supabase } from '@/lib/supabase';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
const NAMES: Record<string, string> = { green: 'Green balloon dog', blue: 'Blue balloon', red: 'Red rocket', gold: 'Gold trophy' };
const COLORS: Record<string, string> = { green: '#2EF2A6', blue: '#2F7BFF', red: '#FF3D6E', gold: '#FFD34D' };

export default async function Image({ params }: { params: Promise<{ round: string }> }) {
  const { round } = await params;
  const { data: r } = await supabase.from('rounds').select('*').eq('id', Number(round)).maybeSingle();
  const won = r ? (Number(r.prize_sol) * 0.95).toFixed(2) : '0.00';
  const color = COLORS[r?.balloon ?? 'blue'];
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: 'linear-gradient(#0b2170, #030716)', color: '#EAF2FF', padding: 64, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
          <div style={{ fontSize: 30, color: '#5CE1FF' }}>$CIRCO · Round {round}</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 64, fontWeight: 800 }}>I won the pop</div>
            <div style={{ fontSize: 120, fontWeight: 800, color: '#FFD34D' }}>{won} SOL</div>
            <div style={{ fontSize: 32, color: '#A4B8EC' }}>{NAMES[r?.balloon ?? 'blue']}, {r?.winner_tickets ?? 0} tickets</div>
          </div>
          <div style={{ fontSize: 30, color: '#5CE1FF' }}>The 24/7 memecoin circus</div>
        </div>
        <div style={{ width: 300, height: 360, borderRadius: '50%', background: color, alignSelf: 'center', boxShadow: `0 0 120px ${color}` }} />
      </div>
    ),
    size,
  );
}
