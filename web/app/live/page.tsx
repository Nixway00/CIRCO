import type { Metadata } from 'next';
import StageBridge from '@/components/StageBridge';

export const metadata: Metadata = { title: '$CIRCO · Live', robots: { index: false } };

/**
 * The broadcast view for the 24/7 stream: the stage in live mode (no buttons, big HUD, chat overlay,
 * "play at" bar). Capture it in OBS as a browser source at 1920×1080 and stream it to pump.fun.
 */
export default async function Live({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sound = (await searchParams)?.sound === '1';   // /live?sound=1: the broadcast plays the stage sound
  return (
    <main style={{ position: 'fixed', inset: 0, background: '#030716' }}>
      <style>{`.stage{ position:absolute; inset:0; width:100%; height:100%; border:0; display:block; }`}</style>
      <StageBridge broadcast sound={sound} />
    </main>
  );
}
