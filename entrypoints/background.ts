/**
 * Background service worker — dono da sessão e único que fala com o Supabase.
 *
 * O content script pede informação por mensagem e recebe dados já prontos.
 * O JWT do vendedor não sai daqui: não é injetado na página do WhatsApp.
 */
import { conferirConfiguracao } from '../lib/config';
import type { EstadoSessao, Mensagem } from '../lib/mensagens';
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
    return { estado: 'erro', mensagem: erroConfiguracao };
  }

  const sessao = await lerSessaoDoApp();
  if (!sessao) return { estado: 'sem-sessao' };
  if (estaExpirada(sessao)) return { estado: 'expirada' };

  const supabase = clienteComSessao(sessao.access_token);
  const { data, error } = await supabase.rpc('meu_contexto');

  if (error) {
    // 401/PGRST301 = o Supabase recusou o token. Do ponto de vista do
    // vendedor isso é "precisa entrar de novo", não erro técnico.
    const recusado =
      error.code === 'PGRST301' ||
      /jwt|token|expired|unauthorized/i.test(`${error.message} ${error.code ?? ''}`);

    if (recusado) return { estado: 'expirada' };

    return {
      estado: 'erro',
      mensagem: 'Não foi possível falar com o servidor. Tente de novo em instantes.',
    };
  }

  const contexto = (data ?? []) as LinhaContexto[];
  const organizacao = contexto[0];

  if (!organizacao) {
    return { estado: 'sem-organizacao', email: sessao.email };
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
  };
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((mensagem: Mensagem, _remetente, responder) => {
    if (mensagem?.tipo === 'sessao/estado') {
      // `return true` mantém o canal aberto para a resposta assíncrona.
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

    return false;
  });
});
