/**
 * Interface da extensão dentro do WhatsApp Web.
 *
 * Só interface. Nenhuma chamada ao Supabase acontece aqui: o content script
 * pergunta ao background e desenha a resposta, para o JWT do vendedor não
 * circular no contexto de uma página de terceiro.
 *
 * Nenhum seletor do WhatsApp aparece neste arquivo — quem lê o DOM deles é a
 * WhatsAppAdapter, e só ela.
 *
 * Tudo é montado dentro de um Shadow DOM: o WhatsApp tem CSS global agressivo
 * e troca de layout sem aviso; sem essa barreira, um `div { }` deles desmonta
 * o painel — e um `*` nosso desmontaria o deles.
 */
import { URL_CRM, URL_LOGIN, urlDoLead } from '../lib/config';
import {
  ORIGENS,
  ORIGEM_PADRAO_EXTENSAO,
  type EstadoSessao,
  type LeadResumo,
  type ResultadoConsulta,
  type ResultadoCriacao,
} from '../lib/mensagens';
import {
  ESTILOS,
  bloco,
  botao,
  caixa,
  campo,
  etiquetas,
  formatarTelefone,
  link,
  paragrafo,
  selecao,
} from '../lib/ui';
import { WhatsAppAdapter, type ContatoAtual } from '../lib/whatsapp-adapter';

const ID_RAIZ = 'bytech3-raiz';
const CHAVE_ABERTO = 'painel_aberto';

const ROTULO_PAPEL: Record<string, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  vendedor: 'Vendedor',
};

export default defineContentScript({
  matches: ['*://web.whatsapp.com/*'],

  main() {
    montar();
  },
});

function montar() {
  if (document.getElementById(ID_RAIZ)) return;

  const raiz = document.createElement('div');
  raiz.id = ID_RAIZ;
  const shadow = raiz.attachShadow({ mode: 'open' });

  const estilo = document.createElement('style');
  estilo.textContent = ESTILOS;

  const badge = document.createElement('button');
  badge.className = 'badge';
  badge.type = 'button';
  badge.innerHTML = '<span class="ponto"></span><span>ByTech3 CRM</span>';
  badge.title = 'Abrir o painel do ByTech3';

  const painel = document.createElement('aside');
  painel.className = 'painel';
  painel.hidden = true;

  const cabecalho = document.createElement('div');
  cabecalho.className = 'cabecalho';

  const titulo = document.createElement('span');
  titulo.className = 'titulo';
  titulo.textContent = 'ByTech3 CRM';

  const fechar = document.createElement('button');
  fechar.className = 'fechar';
  fechar.type = 'button';
  fechar.setAttribute('aria-label', 'Fechar painel');
  fechar.textContent = '×';

  const corpo = document.createElement('div');
  corpo.className = 'corpo';

  const areaSessao = document.createElement('div');
  areaSessao.className = 'secao';

  const areaContato = document.createElement('div');
  areaContato.className = 'secao';

  corpo.append(areaSessao, areaContato);
  cabecalho.append(titulo, fechar);
  painel.append(cabecalho, corpo);
  shadow.append(estilo, badge, painel);
  document.body.appendChild(raiz);

  // ---- estado local da interface ----
  let contato: ContatoAtual = WhatsAppAdapter.getCurrentContact();
  let conectado = false;

  async function recarregarSessao() {
    areaSessao.replaceChildren(paragrafo('Verificando seu login…', 'fraco'));
    areaContato.replaceChildren();

    const estado = await pedirSessao();
    conectado = estado.estado === 'conectada';
    desenharSessao(areaSessao, estado, recarregarSessao);

    if (conectado) {
      void atualizarContato();
    }
  }

  async function atualizarContato() {
    if (!conectado || painel.hidden) return;

    if (!contato.temConversaAberta) {
      areaContato.replaceChildren(
        paragrafo('Abra uma conversa para ver o lead correspondente.', 'fraco'),
      );
      return;
    }

    if (contato.ehGrupo) {
      areaContato.replaceChildren(
        bloco('Conversa', contato.nome ?? 'Grupo'),
        paragrafo(
          'Esta é uma conversa em grupo. A extensão trabalha com contatos individuais.',
          'fraco',
        ),
      );
      return;
    }

    areaContato.replaceChildren(paragrafo('Consultando o CRM…', 'fraco'));

    // Trocar de conversa enquanto a consulta está no ar é comum. Sem esta
    // marca, a resposta da conversa antiga chegaria depois e desenharia o lead
    // errado sobre a conversa nova — o tipo de erro que ninguém percebe até
    // ligar para a pessoa errada.
    const chavePedida = contato.chave;
    const resultado = await pedirConsulta(contato);
    if (contato.chave !== chavePedida) return;

    if (resultado.estado === 'sessao-invalida') {
      void recarregarSessao();
      return;
    }

    desenharContato(resultado);
  }

  function desenharContato(resultado: ResultadoConsulta) {
    areaContato.replaceChildren();

    if (resultado.estado === 'e-lead') {
      areaContato.append(...cartaoDoLead(resultado.lead));

      if (resultado.correspondencia === 'nome') {
        areaContato.append(
          caixa(
            'aviso',
            'Encontrado pelo NOME, porque não foi possível ler o telefone desta conversa. ' +
              'Confirme se é a mesma pessoa antes de usar a ficha.',
          ),
          botao('Não é essa pessoa — salvar como novo', abrirFormulario, 'secundaria'),
        );
      }
      return;
    }

    if (resultado.estado === 'nao-e-lead') {
      areaContato.append(
        bloco('Contato', contato.nome ?? 'Sem nome'),
        paragrafo('Este contato ainda não é lead na sua organização.', 'texto'),
        botao('Salvar como lead', abrirFormulario),
      );
      return;
    }

    if (resultado.estado === 'grupo') {
      areaContato.append(paragrafo('Conversa em grupo.', 'fraco'));
      return;
    }

    if (resultado.estado === 'sem-conversa') {
      areaContato.append(paragrafo('Abra uma conversa para ver o lead.', 'fraco'));
      return;
    }

    // A sessão pode cair entre a abertura do painel e a consulta.
    if (resultado.estado === 'sessao-invalida') {
      void recarregarSessao();
      return;
    }

    areaContato.append(
      caixa('erro', resultado.mensagem),
      botao('Tentar de novo', () => void atualizarContato(), 'secundaria'),
    );
  }

  /**
   * Formulário curto de criação.
   *
   * O telefone aparece SEMPRE, pré-preenchido quando a Adapter conseguiu lê-lo
   * com confiança e vazio quando não conseguiu. É a confirmação do vendedor:
   * lead sem telefone é quase inútil para follow-up, e telefone adivinhado é
   * pior ainda.
   */
  function abrirFormulario() {
    areaContato.replaceChildren();

    const nome = campo('Nome', contato.nome ?? '', { placeholder: 'Nome do lead' });

    const telefoneLido = contato.telefone ? formatarTelefone(contato.telefone) : '';
    const telefone = campo('Telefone', telefoneLido, {
      tipo: 'tel',
      placeholder: '(11) 98765-4321',
      dica: contato.telefone
        ? 'Lido desta conversa. Confira antes de salvar.'
        : 'Não foi possível ler o número desta conversa. Informe se souber — pode ficar em branco.',
    });

    const origem = selecao('Origem', ORIGENS, ORIGEM_PADRAO_EXTENSAO);

    const acoes = document.createElement('div');
    acoes.className = 'linha-acoes';

    const salvar = botao('Salvar lead', () => void enviar());
    const cancelar = botao('Cancelar', () => void atualizarContato(), 'secundaria');
    acoes.append(salvar, cancelar);

    const aviso = document.createElement('div');

    areaContato.append(
      nome.raiz,
      telefone.raiz,
      origem.raiz,
      paragrafo('Você fica como responsável por este lead.', 'fraco'),
      acoes,
      aviso,
    );

    async function enviar() {
      aviso.replaceChildren();

      if (nome.entrada.value.trim().length < 2) {
        aviso.replaceChildren(caixa('erro', 'Informe o nome do lead (mínimo 2 caracteres).'));
        return;
      }

      salvar.disabled = true;
      salvar.textContent = 'Salvando…';

      const chavePedida = contato.chave;
      const resultado = await pedirCriacao({
        nome: nome.entrada.value.trim(),
        telefone: telefone.entrada.value.trim() || null,
        origem: origem.entrada.value,
      });

      // Se o vendedor trocou de conversa durante o salvamento, o lead foi
      // criado do mesmo jeito — mas desenhar o resultado aqui colocaria a
      // ficha dele sobre outra conversa.
      if (contato.chave !== chavePedida) return;

      salvar.disabled = false;
      salvar.textContent = 'Salvar lead';

      if (!resultado.ok) {
        // Nunca fingir sucesso: a recusa do banco aparece com o motivo.
        aviso.replaceChildren(caixa('erro', resultado.erro));
        return;
      }

      areaContato.replaceChildren(
        caixa('sucesso', 'Lead salvo.'),
        ...cartaoDoLead(resultado.lead),
      );

      if (!resultado.entrouNoFunil) {
        areaContato.append(
          caixa(
            'aviso',
            'O lead foi salvo, mas não entrou em nenhum funil. Abra a ficha no CRM para ' +
              'colocá-lo no quadro.',
          ),
        );
      }
    }
  }

  // ---- abrir / fechar ----
  async function abrir() {
    painel.hidden = false;
    badge.hidden = true;
    await guardarAberto(true);
    void recarregarSessao();
  }

  async function fecharPainel() {
    painel.hidden = true;
    badge.hidden = false;
    await guardarAberto(false);
  }

  badge.addEventListener('click', () => void abrir());
  fechar.addEventListener('click', () => void fecharPainel());

  // Voltar para a aba depois de entrar no app deve refletir na hora.
  window.addEventListener('focus', () => {
    if (!painel.hidden) void recarregarSessao();
  });

  // Troca de conversa: quem detecta é a Adapter.
  WhatsAppAdapter.observarConversa((novo) => {
    contato = novo;
    void atualizarContato();
  });

  // O WhatsApp troca a árvore inteira ao navegar; se levar o painel junto,
  // remonta.
  setInterval(() => {
    if (!document.getElementById(ID_RAIZ)) montar();
  }, 5000);

  void (async () => {
    if (await estavaAberto()) await abrir();
  })();
}

function cartaoDoLead(lead: LeadResumo): HTMLElement[] {
  const partes: HTMLElement[] = [bloco('Já é lead', lead.nome)];

  if (lead.telefone) partes.push(bloco('Telefone', lead.telefone));
  partes.push(bloco('Etapa', lead.etapa ?? 'Fora do funil'));
  if (lead.funil) partes.push(bloco('Funil', lead.funil));
  partes.push(bloco('Responsável', lead.responsavel ?? 'Sem responsável'));

  if (lead.tags.length > 0) {
    const area = document.createElement('div');
    area.className = 'bloco';

    const rotulo = document.createElement('div');
    rotulo.className = 'rotulo';
    rotulo.textContent = 'Tags';

    area.append(rotulo, etiquetas(lead.tags));
    partes.push(area);
  }

  partes.push(link('Abrir ficha no CRM', urlDoLead(lead.id)));
  return partes;
}

function desenharSessao(area: HTMLElement, estado: EstadoSessao, recarregar: () => void) {
  area.replaceChildren();

  if (estado.estado === 'conectada') {
    area.append(bloco('Organização', estado.organizacao.nome));

    const acesso = document.createElement('p');
    acesso.className = 'fraco';
    acesso.textContent = `${estado.email ?? 'vendedor'} · ${
      ROTULO_PAPEL[estado.organizacao.papel] ?? estado.organizacao.papel
    }`;
    area.append(acesso);

    if (!estado.organizacao.acesso_ativo) {
      area.append(
        caixa(
          'aviso',
          'O período de teste desta organização terminou. Você continua consultando, mas ' +
            'o servidor recusa gravações.',
        ),
      );
    }
    return;
  }

  if (estado.estado === 'sem-sessao' || estado.estado === 'expirada') {
    const primeiraVez = estado.estado === 'sem-sessao';

    area.append(
      paragrafo(
        primeiraVez
          ? 'Entre no ByTech3 para usar a extensão aqui no WhatsApp.'
          : 'Sua sessão expirou. Abra o ByTech3 para reconectar — basta carregar a página.',
      ),
      link(primeiraVez ? 'Entrar no ByTech3' : 'Reconectar', primeiraVez ? URL_LOGIN : URL_CRM),
      botao('Verificar de novo', recarregar, 'secundaria'),
      paragrafo(
        'A extensão usa o mesmo login do site. Nada é salvo enquanto você não estiver conectado.',
        'fraco',
      ),
    );
    return;
  }

  if (estado.estado === 'sem-organizacao') {
    area.append(
      paragrafo('Sua conta ainda não faz parte de uma organização.'),
      link('Concluir cadastro', URL_CRM),
      botao('Verificar de novo', recarregar, 'secundaria'),
    );
    return;
  }

  area.append(caixa('erro', estado.mensagem), botao('Tentar de novo', recarregar, 'secundaria'));
}

// ---- conversa com o background ----

async function pedirSessao(): Promise<EstadoSessao> {
  try {
    const estado = (await browser.runtime.sendMessage({
      tipo: 'sessao/estado',
    })) as EstadoSessao;

    // O console do service worker do MV3 perde o histórico quando ele
    // hiberna. Este console — o da página — fica aberto, então é aqui que o
    // rastro é capturável de verdade.
    console.info(
      `[ByTech3] sessão: ${estado?.estado ?? 'resposta vazia'}` +
        (estado?.diagnostico?.length
          ? `\n${estado.diagnostico.map((linha) => `  · ${linha}`).join('\n')}`
          : ''),
    );

    return estado;
  } catch (erro) {
    console.error('[ByTech3] o service worker não respondeu.', erro);
    return {
      estado: 'erro',
      mensagem: 'A extensão precisa ser recarregada. Feche e abra o WhatsApp Web.',
    };
  }
}

async function pedirConsulta(contato: ContatoAtual): Promise<ResultadoConsulta> {
  try {
    return (await browser.runtime.sendMessage({
      tipo: 'lead/consultar',
      contato: { nome: contato.nome, telefone: contato.telefone },
    })) as ResultadoConsulta;
  } catch {
    return { estado: 'erro', mensagem: 'Não foi possível consultar o CRM. Tente de novo.' };
  }
}

async function pedirCriacao(dados: {
  nome: string;
  telefone: string | null;
  origem: string;
}): Promise<ResultadoCriacao> {
  try {
    return (await browser.runtime.sendMessage({ tipo: 'lead/criar', dados })) as ResultadoCriacao;
  } catch {
    return { ok: false, erro: 'Não foi possível salvar o lead. Tente de novo.' };
  }
}

// ---- preferência de painel aberto ----

async function estavaAberto(): Promise<boolean> {
  try {
    const guardado = await browser.storage.local.get(CHAVE_ABERTO);
    return guardado[CHAVE_ABERTO] === true;
  } catch {
    return false;
  }
}

async function guardarAberto(aberto: boolean): Promise<void> {
  try {
    await browser.storage.local.set({ [CHAVE_ABERTO]: aberto });
  } catch {
    // Preferência de interface. Perder isso não quebra nada.
  }
}
