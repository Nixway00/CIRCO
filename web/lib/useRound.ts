'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface Round {
  id: number; balloon: 'green' | 'blue' | 'red' | 'gold'; capacity_sol: number; collected_sol: number;
  phase: 'inflate' | 'countdown' | 'drawing' | 'done' | 'postponed'; countdown_ends_at: string | null;
  extensions: number; winner_wallet: string | null; last_buyer: string | null; prize_sol: number | null;
}

/** Live current round through Supabase Realtime: every viewer sees the same balloon. */
export function useRound() {
  const [round, setRound] = useState<Round | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase.from('rounds').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
      if (alive && data) setRound(data as Round);
    };
    load();
    const ch = supabase.channel('rounds').on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, () => load()).subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, []);
  return round;
}
