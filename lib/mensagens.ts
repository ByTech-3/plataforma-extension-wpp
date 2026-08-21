/**
 * Contrato de mensagens entre o content script e o background.
 *
 * O content script roda dentro da página do WhatsApp e cuida só da interface.
 * Quem fala com o Supabase é o background — assim o JWT do vendedor nunca é
 * carregado no contexto de uma página de terceiro.
 */

/** Lista fixa do banco (`check` em `leads.origem`). Divergir daqui = INSERT recusado. */
export const ORIGENS = [
  'WhatsApp direto',
  'Instagram',
  'Facebook',
  'Google',
  'Indicação',
  'Campanha específica',
  'Site',
  'Outro',
  'Não identificado',
] as const;

export type Origem = (typeof ORIGENS)[number];

export const ORIGEM_PADRAO_EXTENSAO: Origem = 'WhatsApp direto';

export type Mensagem =
  | { tipo: 'sessao/estado' }
  | { tipo: 'lead/consultar'; contato: ContatoConsultado }
  | { tipo: 'lead/criar'; dados: NovoLead };

export type ContatoConsultado = {
  nome: string | null;
  /** Só dígitos. `null` quando a Adapter não conseguiu ler com confiança. */
  telefone: string | null;
};

export type NovoLead = {
  nome: string;
  telefone: string | null;
  origem: string;
};

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
export type EstadoSessao = (
  | { estado: 'sem-sessao' }
  | { estado: 'expirada' }
  | { estado: 'sem-organizacao'; email: string | null }
  | { estado: 'erro'; mensagem: string }
  | {
      estado: 'conectada';
      email: string | null;
      organizacao: Organizacao;
    }
) & {
  /**
   * Rastro do que aconteceu na leitura da sessão, para diagnóstico.
   *
   * Vai junto da resposta de propósito: o console do service worker do
   * Manifest V3 perde o histórico quando ele hiberna, então o mesmo rastro é
   * registrado também no console da página, que fica aberto.
   *
   * Nunca contém valor de cookie nem token — só nomes, contagens e tamanhos.
   */
  diagnostico?: string[];
};

export type TagDoLead = { id: string; nome: string; cor: string | null };

export type LeadResumo = {
  id: string;
  nome: string;
  telefone: string | null;
  responsavel: string | null;
  funil: string | null;
  etapa: string | null;
  tags: TagDoLead[];
};

/**
 * Como o lead foi reconhecido.
 *
 *  `telefone` — mesmo número. É identidade, não palpite.
 *  `nome`     — mesmo nome, sem telefone para conferir. É PISTA: pode ser
 *               homônimo, e por isso a tela pede confirmação em vez de afirmar.
 */
export type TipoCorrespondencia = 'telefone' | 'nome';

export type ResultadoConsulta =
  | { estado: 'sem-conversa' }
  | { estado: 'grupo' }
  | { estado: 'sessao-invalida' }
  | { estado: 'erro'; mensagem: string }
  | { estado: 'nao-e-lead' }
  | { estado: 'e-lead'; lead: LeadResumo; correspondencia: TipoCorrespondencia };

export type ResultadoCriacao =
  | { ok: true; lead: LeadResumo; entrouNoFunil: boolean }
  | { ok: false; erro: string };
