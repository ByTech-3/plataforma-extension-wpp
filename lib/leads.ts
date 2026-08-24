/**
 * Consulta e criação de leads a partir da extensão.
 *
 * Roda SÓ no background, com o JWT do vendedor. Tudo aqui passa pela RLS:
 * a regra de carteira e o bloqueio por licença são os mesmos do app web, e
 * este arquivo não tenta reimplementá-los.
 *
 * NÃO grava em `activities`: criação de lead e entrada no funil já são
 * registradas pelos triggers do banco (migration 0002). Gravar aqui
 * duplicaria a linha do tempo.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ehTokenRecusado, traduzirErro } from './erros';
import type {
  ContatoConsultado,
  LeadResumo,
  NovoLead,
  ResultadoConsulta,
  ResultadoCriacao,
  TagDoLead,
} from './mensagens';

function soDigitos(texto: string | null | undefined): string {
  return (texto ?? '').replace(/\D/g, '');
}

/**
 * Dois telefones são a mesma pessoa?
 *
 * Compara pelo FIM, até 11 dígitos. Comparar pelo fim absorve as diferenças de
 * formatação que sempre existem entre o que o WhatsApp entrega
 * (`5511987654321`) e o que alguém digitou na ficha (`(11) 98765-4321`).
 *
 * O teto de 11 é o que evita o falso positivo clássico: sem ele, comparar só
 * os 8 finais faria `11 98765-4321` e `21 98765-4321` — dois estados
 * diferentes — parecerem o mesmo lead.
 */
export function mesmoTelefone(a: string | null, b: string | null): boolean {
  const da = soDigitos(a);
  const db = soDigitos(b);
  if (da.length < 8 || db.length < 8) return false;

  const comparar = Math.min(da.length, db.length, 11);
  return da.slice(-comparar) === db.slice(-comparar);
}

/** Resumo exibido no painel: etapa, funil, responsável e tags. */
async function carregarResumo(
  supabase: SupabaseClient,
  organizationId: string,
  lead: { id: string; nome: string; telefone: string | null; responsavel_id: string | null },
): Promise<LeadResumo> {
  const [vinculosResposta, funisResposta, tagsVinculoResposta] = await Promise.all([
    supabase.from('lead_pipeline').select('pipeline_id, stage_id').eq('lead_id', lead.id),
    supabase.from('pipelines').select('id, nome, padrao').eq('organization_id', organizationId),
    supabase.from('lead_tags').select('tag_id').eq('lead_id', lead.id),
  ]);

  const vinculos = (vinculosResposta.data ?? []) as { pipeline_id: string; stage_id: string }[];
  const funis = (funisResposta.data ?? []) as { id: string; nome: string; padrao: boolean }[];

  // Um lead pode estar em mais de um funil. O padrão vence, como na listagem
  // do app web, para as duas telas contarem a mesma história.
  const vinculo =
    vinculos.find((item) => funis.find((funil) => funil.id === item.pipeline_id)?.padrao) ??
    vinculos[0] ??
    null;

  const [etapaResposta, responsavelResposta, tagsResposta] = await Promise.all([
    vinculo
      ? supabase.from('pipeline_stages').select('nome').eq('id', vinculo.stage_id).maybeSingle()
      : Promise.resolve({ data: null }),
    lead.responsavel_id
      ? supabase
          .from('profiles')
          .select('nome_completo, email')
          .eq('id', lead.responsavel_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    (tagsVinculoResposta.data ?? []).length > 0
      ? supabase
          .from('tags')
          .select('id, nome, cor')
          .in(
            'id',
            ((tagsVinculoResposta.data ?? []) as { tag_id: string }[]).map((item) => item.tag_id),
          )
      : Promise.resolve({ data: [] }),
  ]);

  const perfil = responsavelResposta.data as { nome_completo: string | null; email: string | null } | null;

  return {
    id: lead.id,
    nome: lead.nome,
    telefone: lead.telefone,
    responsavel: perfil ? perfil.nome_completo?.trim() || perfil.email || 'Usuário' : null,
    funil: vinculo ? funis.find((funil) => funil.id === vinculo.pipeline_id)?.nome ?? null : null,
    etapa: (etapaResposta.data as { nome: string } | null)?.nome ?? null,
    tags: ((tagsResposta.data ?? []) as TagDoLead[]).slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  };
}

/**
 * Este contato já é lead?
 *
 * ORDEM: telefone primeiro, nome só como último recurso.
 *
 * O telefone é identidade. O nome é pista — o título da conversa é o apelido
 * que o VENDEDOR deu ao contato na agenda dele, que nem sempre é o nome que
 * está na ficha, e homônimo existe. Por isso a correspondência por nome volta
 * marcada, e a tela pede confirmação em vez de afirmar que é a mesma pessoa.
 */
export async function consultarLead(
  supabase: SupabaseClient,
  organizationId: string,
  contato: ContatoConsultado,
): Promise<ResultadoConsulta> {
  const telefone = soDigitos(contato.telefone);
  const nome = (contato.nome ?? '').trim();

  if (!telefone && !nome) return { estado: 'sem-conversa' };

  const campos = 'id, nome, telefone, responsavel_id';

  if (telefone.length >= 8) {
    // Pré-filtro no banco: os 8 dígitos finais em ordem, aceitando qualquer
    // separador entre eles (`%9%8%7%...`). Traz um punhado de candidatos; quem
    // decide de fato é `mesmoTelefone`, aqui no código.
    const sufixo = telefone.slice(-8);
    const padrao = `%${sufixo.split('').join('%')}%`;

    const { data, error } = await supabase
      .from('leads')
      .select(campos)
      .eq('organization_id', organizationId)
      .eq('arquivado', false)
      .ilike('telefone', padrao)
      .limit(50);

    if (error) {
      if (ehTokenRecusado(error)) return { estado: 'sessao-invalida' };
      return { estado: 'erro', mensagem: traduzirErro(error, 'consultar o CRM') };
    }

    const candidatos = (data ?? []) as {
      id: string;
      nome: string;
      telefone: string | null;
      responsavel_id: string | null;
    }[];

    const encontrado = candidatos.find((lead) => mesmoTelefone(lead.telefone, telefone));
    if (encontrado) {
      return {
        estado: 'e-lead',
        lead: await carregarResumo(supabase, organizationId, encontrado),
        correspondencia: 'telefone',
      };
    }
  }

  if (nome) {
    // `ilike` sem curinga = igualdade sem diferenciar maiúsculas. Acento
    // continua contando: "Joao" não encontra "João".
    const { data, error } = await supabase
      .from('leads')
      .select(campos)
      .eq('organization_id', organizationId)
      .eq('arquivado', false)
      .ilike('nome', nome)
      .limit(5);

    if (error) {
      if (ehTokenRecusado(error)) return { estado: 'sessao-invalida' };
      return { estado: 'erro', mensagem: traduzirErro(error, 'consultar o CRM') };
    }

    const porNome = (data ?? []) as {
      id: string;
      nome: string;
      telefone: string | null;
      responsavel_id: string | null;
    }[];

    // Se o contato tem telefone e o lead homônimo tem OUTRO telefone, são
    // pessoas diferentes: dois "João Silva" com números distintos.
    const compativel = porNome.find(
      (lead) => !telefone || !lead.telefone || mesmoTelefone(lead.telefone, telefone),
    );

    if (compativel) {
      return {
        estado: 'e-lead',
        lead: await carregarResumo(supabase, organizationId, compativel),
        correspondencia: 'nome',
      };
    }
  }

  return { estado: 'nao-e-lead' };
}

/**
 * Cria o lead e o coloca no funil padrão, na primeira etapa — mesmo
 * comportamento do app web.
 *
 * O vendedor que salvou fica como responsável: ele está conversando com a
 * pessoa agora. Deixar sem responsável jogaria o lead no bolo da equipe, onde
 * outro vendedor poderia pegá-lo no meio do atendimento.
 */
export async function criarLead(
  supabase: SupabaseClient,
  organizationId: string,
  usuarioId: string,
  dados: NovoLead,
): Promise<ResultadoCriacao> {
  const nome = dados.nome.trim();
  if (nome.length < 2) {
    return { ok: false, erro: 'Informe o nome do lead (mínimo 2 caracteres).' };
  }

  const { data, error } = await supabase
    .from('leads')
    .insert({
      organization_id: organizationId,
      nome,
      telefone: dados.telefone?.trim() || null,
      origem: dados.origem,
      responsavel_id: usuarioId,
      criado_por: usuarioId,
    })
    .select('id, nome, telefone, responsavel_id')
    .single();

  if (error) {
    if (ehTokenRecusado(error)) {
      return { ok: false, erro: 'Sua sessão expirou. Abra o ByTech3 para reconectar.' };
    }
    return { ok: false, erro: traduzirErro(error, 'salvar o lead') };
  }

  const lead = data as {
    id: string;
    nome: string;
    telefone: string | null;
    responsavel_id: string | null;
  };

  const entrouNoFunil = await colocarNoFunil(
    supabase,
    organizationId,
    lead.id,
    dados.stage_id ?? null,
  );

  return {
    ok: true,
    lead: await carregarResumo(supabase, organizationId, lead),
    entrouNoFunil,
  };
}

/**
 * Coloca o lead recém-criado numa etapa.
 *
 * Com `stageId`, vai para a etapa que o vendedor escolheu no painel; sem ele,
 * para a primeira do funil padrão — o mesmo destino que o app web usaria.
 *
 * Falhar aqui não invalida o lead: ele existe, com histórico, e a ficha no app
 * mostra o aviso de "fora do funil" com o botão de reparo. Por isso devolve um
 * booleano em vez de lançar.
 */
async function colocarNoFunil(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
  stageId: string | null,
): Promise<boolean> {
  if (stageId) {
    // A etapa tem que ser desta organização — daí sai o funil de destino.
    const { data: etapa } = await supabase
      .from('pipeline_stages')
      .select('id, pipeline_id')
      .eq('id', stageId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    const escolhida = etapa as { id: string; pipeline_id: string } | null;
    if (escolhida) {
      const { error } = await supabase.from('lead_pipeline').insert({
        organization_id: organizationId,
        lead_id: leadId,
        pipeline_id: escolhida.pipeline_id,
        stage_id: escolhida.id,
        posicao: 0,
      });
      return !error;
    }
    // Etapa inválida (funil apagado entre a abertura do painel e o salvamento):
    // cai para o funil padrão em vez de deixar o lead fora do quadro.
  }

  const { data: funis } = await supabase
    .from('pipelines')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('arquivado', false)
    .order('padrao', { ascending: false })
    .order('posicao', { ascending: true })
    .limit(1);

  const funil = ((funis ?? []) as { id: string }[])[0];
  if (!funil) return false;

  const { data: etapas } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', funil.id)
    .order('posicao', { ascending: true })
    .limit(1);

  const etapa = ((etapas ?? []) as { id: string }[])[0];
  if (!etapa) return false;

  const { error } = await supabase.from('lead_pipeline').insert({
    organization_id: organizationId,
    lead_id: leadId,
    pipeline_id: funil.id,
    stage_id: etapa.id,
    posicao: 0,
  });

  return !error;
}
