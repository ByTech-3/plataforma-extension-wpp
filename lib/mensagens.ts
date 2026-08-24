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
  | { tipo: 'conversas/sincronizar'; conversas: ConversaCapturada[] }
  | { tipo: 'funis/destinos' }
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
  /** Etapa escolhida no painel. Sem ela, vale a primeira do funil padrão. */
  stage_id?: string | null;
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

// ------------------------------------------------------------------ INBOX

/**
 * Uma conversa lida da lista lateral do WhatsApp.
 *
 * `origem_do_id` diz se a identificação é forte (JID real do WhatsApp) ou
 * fraca (chave derivada do título). Sem essa distinção, duas conversas
 * homônimas seriam tratadas como a mesma.
 */
export type ConversaCapturada = {
  chat_id: string;
  origem_do_id: 'jid' | 'titulo';
  titulo: string | null;
  /** Só dígitos, e só quando lido com confiança. Nunca deduzido. */
  telefone: string | null;
  eh_grupo: boolean;
  posicao: number;
};

export type ResultadoSincronizacao =
  | { ok: true; total: number; removidas: number }
  | { ok: false; erro: string };

/** Uma etapa de destino no seletor "enviar para" do painel. */
export type EtapaDestino = {
  stage_id: string;
  etapa: string;
  funil: string;
  padrao: boolean;
};

export type ResultadoDestinos =
  | { ok: true; destinos: EtapaDestino[] }
  | { ok: false; erro: string };
