/**
 * Contrato de mensagens entre o content script e o background.
 *
 * O content script roda dentro da página do WhatsApp e cuida só da interface.
 * Quem fala com o Supabase é o background — assim o JWT do vendedor nunca é
 * carregado no contexto de uma página de terceiro.
 */

export type Mensagem = { tipo: 'sessao/estado' };

export type Organizacao = {
  id: string;
  nome: string;
  papel: 'admin' | 'gestor' | 'vendedor';
  acesso_ativo: boolean;
};

/**
 * Estados possíveis da sessão. `sem-sessao` e `expirada` são situações normais
 * do produto, com convite para entrar no app — não são erro.
 */
export type EstadoSessao =
  | { estado: 'sem-sessao' }
  | { estado: 'expirada' }
  | { estado: 'sem-organizacao'; email: string | null }
  | { estado: 'erro'; mensagem: string }
  | {
      estado: 'conectada';
      email: string | null;
      organizacao: Organizacao;
    };
