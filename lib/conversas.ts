/**
 * Sincronização da Inbox e destinos de lead (lado background).
 *
 * A conversa é do VENDEDOR: a policy `conversa_select_propria` só devolve as
 * dele, e o `user_id` gravado aqui é sempre o do próprio usuário. Nem gestor
 * nem admin veem a lista de conversas de outra pessoa.
 *
 * NÃO grava mensagem nenhuma — a tabela nem tem coluna para isso.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { traduzirErro } from './erros';
import type {
  ConversaCapturada,
  EtapaDestino,
  ResultadoDestinos,
  ResultadoSincronizacao,
} from './mensagens';

/**
 * Grava a lista capturada e remove o que saiu dela.
 *
 * Por que remover: a Inbox mostra "conversas recentes". Sem a limpeza, uma
 * conversa de três meses atrás continuaria ocupando lugar com a posição antiga
 * e apareceria à frente das novas.
 *
 * Conversas que JÁ VIRARAM LEAD nunca são removidas: o vínculo com o lead é o
 * que impede a Inbox de oferecer o mesmo contato de novo.
 */
export async function sincronizarConversas(
  supabase: SupabaseClient,
  organizationId: string,
  usuarioId: string,
  conversas: ConversaCapturada[],
): Promise<ResultadoSincronizacao> {
  const limpas = conversas
    .filter((conversa) => conversa.chat_id && conversa.chat_id.length <= 300)
    .map((conversa) => ({
      organization_id: organizationId,
      user_id: usuarioId,
      chat_id: conversa.chat_id.slice(0, 300),
      origem_do_id: conversa.origem_do_id,
      titulo: conversa.titulo?.slice(0, 300) ?? null,
      // O banco exige 8 a 20 dígitos; o que não passa disso vira nulo em vez
      // de derrubar a sincronização inteira por uma linha ruim.
      telefone:
        conversa.telefone && /^[0-9]{8,20}$/.test(conversa.telefone) ? conversa.telefone : null,
      eh_grupo: conversa.eh_grupo,
      posicao: Math.max(0, Math.trunc(conversa.posicao)),
    }));

  if (limpas.length > 0) {
    const { error } = await supabase
      .from('whatsapp_conversas')
      .upsert(limpas, { onConflict: 'organization_id,user_id,chat_id' });

    if (error) {
      return { ok: false, erro: traduzirErro(error, 'salvar as conversas') };
    }
  }

  // Limpeza: o que não veio nesta captura e ainda não virou lead.
  const { data: existentes, error: erroExistentes } = await supabase
    .from('whatsapp_conversas')
    .select('id, chat_id')
    .eq('organization_id', organizationId)
    .eq('user_id', usuarioId)
    .is('lead_id', null);

  if (erroExistentes) {
    // A gravação deu certo; só a faxina falhou. Não é motivo para dizer ao
    // vendedor que a atualização não funcionou.
    return { ok: true, total: limpas.length, removidas: 0 };
  }

  const capturados = new Set(limpas.map((conversa) => conversa.chat_id));
  const sobrando = ((existentes ?? []) as { id: string; chat_id: string }[])
    .filter((conversa) => !capturados.has(conversa.chat_id))
    .map((conversa) => conversa.id);

  if (sobrando.length > 0) {
    await supabase.from('whatsapp_conversas').delete().in('id', sobrando.slice(0, 200));
  }

  return { ok: true, total: limpas.length, removidas: sobrando.length };
}

/**
 * Etapas para onde o vendedor pode mandar um lead, agrupadas por funil.
 *
 * Só funis ativos. A primeira etapa do funil padrão vem marcada, para o painel
 * pré-selecionar o mesmo destino que o app usaria.
 */
export async function listarDestinos(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<ResultadoDestinos> {
  const [funisResposta, etapasResposta] = await Promise.all([
    supabase
      .from('pipelines')
      .select('id, nome, padrao, posicao')
      .eq('organization_id', organizationId)
      .eq('arquivado', false)
      .order('padrao', { ascending: false })
      .order('posicao', { ascending: true }),
    supabase
      .from('pipeline_stages')
      .select('id, nome, pipeline_id, posicao')
      .eq('organization_id', organizationId)
      .order('posicao', { ascending: true }),
  ]);

  const erro = funisResposta.error ?? etapasResposta.error;
  if (erro) {
    return { ok: false, erro: traduzirErro(erro, 'carregar os funis') };
  }

  const funis = (funisResposta.data ?? []) as {
    id: string;
    nome: string;
    padrao: boolean;
  }[];

  const etapas = (etapasResposta.data ?? []) as {
    id: string;
    nome: string;
    pipeline_id: string;
  }[];

  const destinos: EtapaDestino[] = [];

  for (const funil of funis) {
    const doFunil = etapas.filter((etapa) => etapa.pipeline_id === funil.id);
    doFunil.forEach((etapa, indice) => {
      destinos.push({
        stage_id: etapa.id,
        etapa: etapa.nome,
        funil: funil.nome,
        // O destino que o app usaria por conta própria: primeira etapa do
        // funil padrão.
        padrao: funil.padrao && indice === 0,
      });
    });
  }

  return { ok: true, destinos };
}
