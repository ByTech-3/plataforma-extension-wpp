/**
 * Cliente Supabase da extensão.
 *
 * Duas diferenças importantes em relação ao cliente do app web:
 *
 *  1. A sessão NÃO é persistida nem renovada aqui. Quem é dono da sessão é o
 *     app; a extensão só apresenta o token que leu do cookie dele. Renovar por
 *     conta própria rotacionaria o refresh token e derrubaria o login do
 *     vendedor no site (ver lib/sessao.ts).
 *
 *  2. O token vai no cabeçalho `Authorization` de cada cliente criado. É esse
 *     JWT que faz a RLS enxergar o vendedor certo: organização, papel e
 *     carteira valem exatamente como valem no app. A extensão não tem — e não
 *     pode ter — nenhum poder a mais.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export function clienteComSessao(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
