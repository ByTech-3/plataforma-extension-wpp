/**
 * Background service worker — dono da sessão e único que fala com o Supabase.
 *
 * O content script pede informação por mensagem e recebe dados já prontos.
 * O JWT do vendedor não sai daqui: não é injetado na página do WhatsApp.
 */
import { conferirConfiguracao } from '../lib/config';
import { consultarLead, criarLead } from '../lib/leads';
import type {
  EstadoSessao,
  Mensagem,
  ResultadoConsulta,
  ResultadoCriacao,
} from '../lib/mensagens';
import { estaExpirada, lerSessaoDoApp } from '../lib/sessao';
import { clienteComSessao } from '../lib/supabase';

type LinhaContexto = {
  organization_id: string;
  organizacao_nome: string;
  papel: 'admin' | 'gestor' | 'vendedor';
  acesso_ativo: boolean;
};

/**
 * Estado da sessão do vendedor.
 *
 * Faz uma chamada real ao banco (`meu_contexto()`) em vez de confiar só no
 * cookie: é ela que prova que o token ainda é aceito pelo Supabase e que traz
 * organização, papel e situação da licença já filtrados pela RLS.
 */
async function obterEstadoSessao(): Promise<EstadoSessao> {
  const erroConfiguracao = conferirConfiguracao();
  if (erroConfiguracao) {
    return { estado: 'erro', mensagem: erroConfiguracao, diagnostico: [erroConfiguracao] };
  }

  const { sessao, diagnostico } = await lerSessaoDoApp();

  // O console do service worker do MV3 some quando ele hiberna. Registrar aqui
  // ajuda quem está com o inspetor aberto; a cópia que vai na resposta cobre
  // quem não estava.
  console.info('[ByTech3] leitura da sessão:\n' + diagnostico.map((l) => `  · ${l}`).join('\n'));

  if (!sessao) return { estado: 'sem-sessao', diagnostico };

  if (estaExpirada(sessao)) {
    diagnostico.push('token vencido (ou vencendo em menos de 60s)');
    return { estado: 'expirada', diagnostico };
  }

  const supabase = clienteComSessao(sessao.access_token);
  const { data, error } = await supabase.rpc('meu_contexto');

  if (error) {
    diagnostico.push(`meu_contexto() falhou: ${error.code ?? 'sem código'} — ${error.message}`);

    // 401/PGRST301 = o Supabase recusou o token. Do ponto de vista do
    // vendedor isso é "precisa entrar de novo", não erro técnico.
    const recusado =
      error.code === 'PGRST301' ||
      /jwt|token|expired|unauthorized/i.test(`${error.message} ${error.code ?? ''}`);

    if (recusado) return { estado: 'expirada', diagnostico };

    return {
      estado: 'erro',
      mensagem: 'Não foi possível falar com o servidor. Tente de novo em instantes.',
      diagnostico,
    };
  }

  const contexto = (data ?? []) as LinhaContexto[];
  diagnostico.push(`meu_contexto() devolveu ${contexto.length} organização(ões)`);

  const organizacao = contexto[0];
  if (!organizacao) {
    return { estado: 'sem-organizacao', email: sessao.email, diagnostico };
  }

  return {
    estado: 'conectada',
    email: sessao.email,
    organizacao: {
      id: organizacao.organization_id,
      nome: organizacao.organizacao_nome,
      papel: organizacao.papel,
      acesso_ativo: organizacao.acesso_ativo,
    },
    diagnostico,
  };
}

/**
 * Sessão pronta para uso: cliente autenticado + organização.
 *
 * Toda operação de dados passa por aqui, então nenhuma delas roda com sessão
 * ausente ou vencida — e a interface recebe sempre um estado que sabe desenhar.
 */
async function comSessao<T>(
  aoConectar: (
    supabase: ReturnType<typeof clienteComSessao>,
    organizationId: string,
    usuarioId: string,
  ) => Promise<T>,
  aoFalhar: (motivo: 'sessao' | 'erro', mensagem: string) => T,
): Promise<T> {
  const estado = await obterEstadoSessao();

  if (estado.estado !== 'conectada') {
    if (estado.estado === 'erro') return aoFalhar('erro', estado.mensagem);
    return aoFalhar('sessao', 'Sua sessão expirou. Abra o ByTech3 para reconectar.');
  }

  const { sessao } = await lerSessaoDoApp();
  if (!sessao?.usuario_id) {
    return aoFalhar('sessao', 'Sua sessão expirou. Abra o ByTech3 para reconectar.');
  }

  return aoConectar(
    clienteComSessao(sessao.access_token),
    estado.organizacao.id,
    sessao.usuario_id,
  );
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((mensagem: Mensagem, _remetente, responder) => {
    // `return true` mantém o canal aberto para a resposta assíncrona.
    if (mensagem?.tipo === 'sessao/estado') {
      obterEstadoSessao()
        .then(responder)
        .catch((erro) => {
          console.error('[ByTech3] Falha ao apurar a sessão.', erro);
          responder({
            estado: 'erro',
            mensagem: 'Não foi possível verificar seu login. Tente de novo.',
          } satisfies EstadoSessao);
        });
      return true;
    }

    if (mensagem?.tipo === 'lead/consultar') {
      const contato = mensagem.contato;

      comSessao<ResultadoConsulta>(
        (supabase, organizationId) => consultarLead(supabase, organizationId, contato),
        (motivo, texto) =>
          motivo === 'sessao' ? { estado: 'sessao-invalida' } : { estado: 'erro', mensagem: texto },
      )
        .then(responder)
        .catch((erro) => {
          console.error('[ByTech3] Falha ao consultar o lead.', erro);
          responder({
            estado: 'erro',
            mensagem: 'Não foi possível consultar o CRM. Tente de novo.',
          } satisfies ResultadoConsulta);
        });
      return true;
    }

    if (mensagem?.tipo === 'lead/criar') {
      const dados = mensagem.dados;

      comSessao<ResultadoCriacao>(
        (supabase, organizationId, usuarioId) =>
          criarLead(supabase, organizationId, usuarioId, dados),
        (_motivo, texto) => ({ ok: false, erro: texto }),
      )
        .then(responder)
        .catch((erro) => {
          console.error('[ByTech3] Falha ao salvar o lead.', erro);
          responder({
            ok: false,
            erro: 'Não foi possível salvar o lead. Tente de novo.',
          } satisfies ResultadoCriacao);
        });
      return true;
    }

    return false;
  });
});
