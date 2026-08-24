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
import { LIMITE_CONVERSAS, URL_CRM, URL_KANBAN, URL_LOGIN, urlDoLead } from '../lib/config';
import {
  ORIGENS,
  ORIGEM_PADRAO_EXTENSAO,
  type EstadoSessao,
  type Mensagem,
  type LeadResumo,
  type NovoLead,
  type ConversaCapturada,
  type EtapaDestino,
  type ResultadoConsulta,
  type ResultadoDestinos,
  type ResultadoSincronizacao,
  type ResultadoCriacao,
} from '../lib/mensagens';
import {
  ESTILOS,
  LARGURA_PAINEL,
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
  // Propriedade customizada atravessa o shadow root: o painel e o espaço que o
  // WhatsApp cede saem os dois deste mesmo número.
  raiz.style.setProperty('--bytech3-largura', `${LARGURA_PAINEL}px`);
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

  const areaInbox = document.createElement('div');
  areaInbox.className = 'secao';

  corpo.append(areaSessao, areaContato, areaInbox);
  cabecalho.append(titulo, fechar);
  painel.append(cabecalho, corpo);
  shadow.append(estilo, badge, painel);
  document.body.appendChild(raiz);

  // ---- estado local da interface ----
  let contato: ContatoAtual = WhatsAppAdapter.getCurrentContact();
  let conectado = false;
  let descarregada = false;
  let capturando = false;
  let jaCapturouNestaAba = false;
  let pararObservador: (() => void) | null = null;
  let statusInbox: HTMLElement | null = null;
  let botaoAtualizar: HTMLButtonElement | null = null;

  async function recarregarSessao() {
    if (descarregada) return;

    areaSessao.replaceChildren(paragrafo('Verificando seu login…', 'fraco'));
    areaContato.replaceChildren();

    const estado = await pedirSessao();
    if (estado === 'descarregada') return;

    conectado = estado.estado === 'conectada';
    desenharSessao(areaSessao, estado, recarregarSessao);

    areaInbox.replaceChildren();
    if (conectado) {
      desenharInbox();
      void atualizarContato();
    }
  }

  /**
   * Captura das conversas para a Inbox do Kanban.
   *
   * SOB DEMANDA, e o botão deixa isso explícito: ler a lista exige rolar o
   * painel do WhatsApp, o que é intrusivo demais para acontecer sozinho. E
   * varredura contínua da conversa alheia não é coisa que um CRM deva fazer
   * sem o vendedor mandar.
   */
  function desenharInbox() {
    statusInbox = document.createElement('div');

    botaoAtualizar = botao('Atualizar conversas', () => void capturar(false), 'secundaria');

    areaInbox.replaceChildren(
      bloco('Inbox do Kanban', 'Conversas recentes'),
      paragrafo(
        'Envia a lista de conversas recentes para a primeira coluna do quadro. Nenhuma vira lead sozinha.',
        'fraco',
      ),
      botaoAtualizar,
      statusInbox,
    );
  }

  function mostrarNaInbox(...elementos: Node[]) {
    statusInbox?.replaceChildren(...elementos);
  }

  /**
   * Lê a lista e manda para a Inbox.
   *
   * `automatica` só muda o quanto a operação aparece: no automático, silêncio
   * quando não há nada a dizer — o vendedor não pediu, e um aviso que ele não
   * provocou vira ruído.
   */
  async function capturar(automatica: boolean): Promise<boolean> {
    if (descarregada || capturando) return false;
    capturando = true;

    if (botaoAtualizar) {
      botaoAtualizar.disabled = true;
      botaoAtualizar.textContent = automatica ? 'Atualizando…' : 'Lendo conversas…';
    }
    if (!automatica) mostrarNaInbox(paragrafo('Percorrendo a lista do WhatsApp…', 'fraco'));

    const leitura = await WhatsAppAdapter.listarConversasRecentes(LIMITE_CONVERSAS);

    const encerrar = () => {
      capturando = false;
      if (botaoAtualizar) {
        botaoAtualizar.disabled = false;
        botaoAtualizar.textContent = 'Atualizar conversas';
      }
    };

    if (leitura.aviso === 'lista-arquivadas') {
      encerrar();
      mostrarNaInbox(
        caixa(
          'aviso',
          'Você está vendo as conversas arquivadas. Volte para a lista principal e atualize de novo — ' +
            'arquivadas não entram na Inbox.',
        ),
      );
      return false;
    }

    if (leitura.conversas.length === 0) {
      encerrar();
      if (!automatica) {
        mostrarNaInbox(
          caixa(
            'aviso',
            'Nenhuma conversa foi lida. Confira se a lista de conversas está visível nesta janela.',
          ),
        );
      }
      return false;
    }

    if (botaoAtualizar) botaoAtualizar.textContent = 'Enviando…';
    const resultado = await pedirSincronizacao(leitura.conversas);
    encerrar();

    if (resultado === 'descarregada') return false;

    if (!resultado.ok) {
      // Falha de gravação aparece mesmo no automático: se a licença venceu, o
      // vendedor precisa saber por que a Inbox não atualiza mais.
      mostrarNaInbox(caixa('erro', resultado.erro));
      return false;
    }

    await marcarCapturaFeita();
    mostrarNaInbox(
      caixa(
        'sucesso',
        `${resultado.total} conversa(s) na Inbox. Abra o Kanban para transformá-las em leads.`,
      ),
      link('Abrir o Kanban', URL_KANBAN, 'secundaria'),
    );
    return true;
  }

  /**
   * Captura uma vez ao conectar, sem clique.
   *
   * NÃO vira varredura contínua: a leitura rola a lista do vendedor, e repetir
   * isso sozinho seria intrusivo. Duas travas garantem: uma por aba (só uma
   * vez por carregamento) e uma por tempo, guardada entre recargas — recarregar
   * o WhatsApp cinco vezes seguidas não dispara cinco varreduras.
   */
  async function capturarAoConectar(): Promise<void> {
    if (descarregada || jaCapturouNestaAba) return;
    if (!(await passouIntervaloDeCaptura())) return;

    const estado = await pedirSessao();
    if (estado === 'descarregada' || estado.estado !== 'conectada') return;

    // O WhatsApp pode estar sincronizando: a lista ainda não existe e a
    // captura volta vazia. Sem estas tentativas, a aba passaria o dia inteiro
    // sem Inbox por causa de alguns segundos de atraso no carregamento.
    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      if (descarregada) return;

      if (await capturar(true)) {
        jaCapturouNestaAba = true;
        return;
      }

      await esperarUmPouco(5000);
    }
  }

  /**
   * Extensão atualizada com a aba aberta. Uma tela só, com a saída à mão —
   * e o observador de conversa parado, para não insistir num canal morto.
   */
  function mostrarDescarregada() {
    descarregada = true;
    pararObservador?.();

    painel.hidden = false;
    badge.hidden = true;

    areaSessao.replaceChildren(
      caixa('aviso', 'A extensão foi atualizada e esta aba ficou para trás.'),
      paragrafo('Recarregue a página para voltar a usar o painel. Nada foi perdido.', 'texto'),
      botao('Recarregar a página', () => window.location.reload()),
    );
    areaContato.replaceChildren();
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
    if (resultado === 'descarregada') return;
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

    // Destino: qual quadro e qual etapa. Carregado sob demanda e guardado em
    // memória — abrir o formulário duas vezes não recarrega os funis.
    const destino = selecao('Enviar para', ['Carregando funis…'], 'Carregando funis…');
    destino.entrada.disabled = true;
    void preencherDestinos(destino.entrada);

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
      destino.raiz,
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
        stage_id: destino.entrada.disabled ? null : destino.entrada.value || null,
      });

      // Se o vendedor trocou de conversa durante o salvamento, o lead foi
      // criado do mesmo jeito — mas desenhar o resultado aqui colocaria a
      // ficha dele sobre outra conversa.
      if (resultado === 'descarregada') return;
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
    // O WhatsApp cede a faixa em vez de ficar por baixo: sobrepor esconderia
    // justamente a conversa que o vendedor está lendo para decidir.
    WhatsAppAdapter.reservarEspacoParaPainel(LARGURA_PAINEL);
    await guardarAberto(true);
    void recarregarSessao();
  }

  async function fecharPainel() {
    painel.hidden = true;
    badge.hidden = false;
    WhatsAppAdapter.reservarEspacoParaPainel(null);
    await guardarAberto(false);
  }

  badge.addEventListener('click', () => void abrir());
  fechar.addEventListener('click', () => void fecharPainel());

  // Voltar para a aba depois de entrar no app deve refletir na hora.
  window.addEventListener('focus', () => {
    if (!painel.hidden) void recarregarSessao();
  });

  // Qualquer mensagem que falhe por extensão descarregada cai aqui, uma vez só.
  registrarDescarregamento(mostrarDescarregada);

  // Troca de conversa: quem detecta é a Adapter.
  pararObservador = WhatsAppAdapter.observarConversa((novo) => {
    contato = novo;
    void atualizarContato();
  });

  // O WhatsApp troca a árvore inteira ao navegar; se levar o painel junto,
  // remonta. Depois de descarregada, remontar não adianta: o canal morreu.
  const vigia = setInterval(() => {
    if (descarregada) {
      clearInterval(vigia);
      return;
    }
    if (!document.getElementById(ID_RAIZ)) montar();
  }, 5000);

  void (async () => {
    if (await estavaAberto()) await abrir();

    // A captura ao conectar roda com o painel aberto OU fechado: a Inbox é
    // consumida no Kanban, e o vendedor pode passar o dia no WhatsApp sem
    // nunca abrir este painel. Espera o WhatsApp montar a lista antes.
    await esperarUmPouco(4000);
    void capturarAoConectar();
  })();
}

function esperarUmPouco(ms: number): Promise<void> {
  return new Promise((resolver) => window.setTimeout(resolver, ms));
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

/**
 * A extensão foi descarregada por baixo desta página?
 *
 * Acontece toda vez que a extensão é atualizada, recarregada ou desinstalada
 * com a aba aberta — inclusive numa atualização automática pela Chrome Web
 * Store, no meio do expediente do cliente. O content script antigo continua na
 * página, mas o canal com o service worker morreu para sempre: `sendMessage`
 * falha com "Extension context invalidated".
 *
 * NÃO é falha para "tentar de novo": nenhuma tentativa vai funcionar até a
 * página ser recarregada. Dizer "tente de novo" faria o vendedor repetir um
 * salvamento que nunca vai acontecer.
 */
function extensaoDescarregada(erro: unknown): boolean {
  if (!browser.runtime?.id) return true;
  const mensagem = erro instanceof Error ? erro.message : String(erro ?? '');
  return /context invalidated|receiving end does not exist|message port closed/i.test(mensagem);
}

/** Avisado uma vez só: o observador de conversa dispararia isto sem parar. */
let aoDescarregar: (() => void) | null = null;
let jaAvisouDescarregada = false;

function registrarDescarregamento(aoAcontecer: () => void) {
  aoDescarregar = aoAcontecer;
}

async function enviar<T>(mensagem: Mensagem, aoFalhar: T): Promise<T | 'descarregada'> {
  try {
    return (await browser.runtime.sendMessage(mensagem)) as T;
  } catch (erro) {
    if (extensaoDescarregada(erro)) {
      if (!jaAvisouDescarregada) {
        jaAvisouDescarregada = true;
        console.warn('[ByTech3] extensão atualizada; esta aba precisa ser recarregada.');
        aoDescarregar?.();
      }
      return 'descarregada';
    }

    console.error('[ByTech3] o service worker não respondeu.', erro);
    return aoFalhar;
  }
}

async function pedirSessao(): Promise<EstadoSessao | 'descarregada'> {
  return enviar<EstadoSessao>({ tipo: 'sessao/estado' }, {
    estado: 'erro',
    mensagem: 'Não foi possível verificar seu login. Tente de novo.',
  });
}

async function pedirConsulta(contato: ContatoAtual): Promise<ResultadoConsulta | 'descarregada'> {
  return enviar<ResultadoConsulta>(
    {
      tipo: 'lead/consultar',
      contato: { nome: contato.nome, telefone: contato.telefone },
    },
    { estado: 'erro', mensagem: 'Não foi possível consultar o CRM. Tente de novo.' },
  );
}

async function pedirCriacao(dados: NovoLead): Promise<ResultadoCriacao | 'descarregada'> {
  return enviar<ResultadoCriacao>({ tipo: 'lead/criar', dados }, {
    ok: false,
    erro: 'Não foi possível salvar o lead. Tente de novo.',
  });
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

async function pedirSincronizacao(
  conversas: ConversaCapturada[],
): Promise<ResultadoSincronizacao | 'descarregada'> {
  return enviar<ResultadoSincronizacao>({ tipo: 'conversas/sincronizar', conversas }, {
    ok: false,
    erro: 'Não foi possível atualizar as conversas. Tente de novo.',
  });
}

async function pedirDestinos(): Promise<ResultadoDestinos | 'descarregada'> {
  return enviar<ResultadoDestinos>({ tipo: 'funis/destinos' }, {
    ok: false,
    erro: 'Não foi possível carregar os funis.',
  });
}

/**
 * Destinos guardados em memória: abrir o formulário de novo não recarrega os
 * funis. O service worker pode hibernar entre uma abertura e outra, mas a
 * lista de funis não muda de minuto em minuto.
 */
let destinosEmCache: EtapaDestino[] | null = null;

async function preencherDestinos(entrada: HTMLSelectElement): Promise<void> {
  if (!destinosEmCache) {
    const resultado = await pedirDestinos();
    if (resultado === 'descarregada') return;

    if (!resultado.ok || resultado.destinos.length === 0) {
      entrada.replaceChildren(new Option('Funil padrão', ''));
      entrada.disabled = false;
      return;
    }

    destinosEmCache = resultado.destinos;
  }

  entrada.replaceChildren();
  for (const item of destinosEmCache) {
    const opcao = new Option(`${item.funil} › ${item.etapa}`, item.stage_id);
    entrada.add(opcao);
  }

  // Pré-seleciona a primeira etapa do funil padrão: o mesmo destino que o app
  // web usaria sozinho, para os dois caminhos combinarem.
  const padrao = destinosEmCache.find((item) => item.padrao);
  if (padrao) entrada.value = padrao.stage_id;

  entrada.disabled = false;
}

/**
 * Trava de tempo da captura automática.
 *
 * Sem ela, cada recarga do WhatsApp rolaria a lista do vendedor de novo. Com
 * ela, a captura automática acontece no máximo uma vez a cada 10 minutos — o
 * botão continua disponível para quando ele quiser agora.
 */
const INTERVALO_CAPTURA_MS = 10 * 60 * 1000;
const CHAVE_ULTIMA_CAPTURA = 'ultima_captura_em';

async function passouIntervaloDeCaptura(): Promise<boolean> {
  try {
    const guardado = await browser.storage.local.get(CHAVE_ULTIMA_CAPTURA);
    const ultima = Number(guardado[CHAVE_ULTIMA_CAPTURA] ?? 0);
    return Date.now() - ultima >= INTERVALO_CAPTURA_MS;
  } catch {
    // Sem storage, é melhor capturar do que nunca capturar.
    return true;
  }
}

async function marcarCapturaFeita(): Promise<void> {
  try {
    await browser.storage.local.set({ [CHAVE_ULTIMA_CAPTURA]: Date.now() });
  } catch {
    // Só a trava de tempo se perde; a captura em si deu certo.
  }
}

/**
 * Ordens vindas do service worker para agir na conversa aberta.
 *
 * Quem executa é sempre a WhatsAppAdapter: este listener só traduz a ordem em
 * chamada dela e devolve o resultado.
 */
browser.runtime.onMessage.addListener(
  (
    ordem: { tipo: string; telefone?: string; texto?: string },
    _remetente,
    responder: (resposta: unknown) => void,
  ) => {
    if (ordem?.tipo === 'whatsapp/conversa-aberta-e') {
      responder(WhatsAppAdapter.conversaAbertaEh(ordem.telefone ?? ''));
      return false;
    }

    if (ordem?.tipo === 'whatsapp/abrir-conversa') {
      WhatsAppAdapter.abrirConversaPorTelefone(ordem.telefone ?? '')
        .then(responder)
        .catch((erro) => {
          console.error('[ByTech3] Falha ao abrir a conversa.', erro);
          responder('nao-encontrada');
        });
      return true;
    }

    if (ordem?.tipo === 'whatsapp/ler-mensagens') {
      responder(WhatsAppAdapter.lerUltimasMensagens());
      return false;
    }

    if (ordem?.tipo === 'whatsapp/enviar-mensagem') {
      WhatsAppAdapter.enviarMensagem(ordem.texto ?? '')
        .then(responder)
        .catch((erro) => {
          console.error('[ByTech3] Falha ao enviar a mensagem.', erro);
          responder({ ok: false, erro: 'Não foi possível enviar a mensagem.' });
        });
      return true;
    }

    return false;
  },
);
