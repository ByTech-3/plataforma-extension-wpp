/**
 * Tradução dos erros do banco para frases que o vendedor entende.
 *
 * Mesmo princípio do app web: o bloqueio por licença e a regra de carteira são
 * decididos pelas policies de RLS. A extensão não esconde botão para simular
 * bloqueio — ela deixa a tentativa acontecer e explica a recusa que veio do
 * banco. E nunca mostra "salvo!" quando o banco recusou.
 */
import type { PostgrestError } from '@supabase/supabase-js';

export function traduzirErro(erro: PostgrestError, acao: string): string {
  const mensagem = erro.message ?? '';

  if (erro.code === '42501' || /row-level security|violates row-level/i.test(mensagem)) {
    return (
      `Não foi possível ${acao}. O servidor recusou a gravação — normalmente é ` +
      'o período de teste da empresa que terminou. Fale com o administrador da conta.'
    );
  }

  // Exceptions dos triggers já vêm em português e específicas.
  if (erro.code === 'P0001') return mensagem;

  if (erro.code === '23514') {
    if (/origem/i.test(mensagem)) return 'Origem inválida. Escolha uma da lista.';
    return `Dados inválidos para ${acao}.`;
  }

  if (erro.code === '23505') return 'Já existe um registro com estes dados.';

  if (erro.code === '23503') {
    return 'Vínculo inválido: o registro não pertence a esta organização.';
  }

  return `Não foi possível ${acao}. Tente de novo em instantes.`;
}

/** O Supabase recusou o token: para o vendedor, é "entre de novo". */
export function ehTokenRecusado(erro: PostgrestError): boolean {
  return (
    erro.code === 'PGRST301' ||
    /jwt|token|expired|unauthorized/i.test(`${erro.message} ${erro.code ?? ''}`)
  );
}
