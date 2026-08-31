/**
 * WhatsAppAdapter — ÚNICO lugar que conhece a estrutura do WhatsApp Web.
 *
 * Se o WhatsApp mudar de layout, o conserto é aqui e só aqui. Nenhum seletor
 * de DOM do WhatsApp deve aparecer em qualquer outro arquivo da extensão.
 *
 * PRINCÍPIO: nunca inventar dado. Cada leitura declara a própria confiança.
 * Um telefone lido com dúvida é pior que telefone nenhum — vira lead duplicado
 * ou follow-up para o número errado, e ninguém descobre até o cliente reclamar.
 */

import type { ConversaCapturada, MensagemLida, ResultadoCaptura } from './mensagens';

export type OrigemDoTelefone =
  /** Veio do identificador da conversa (`<numero>@c.us`). É o número real. */
  | 'jid'
  /** O título da conversa é o próprio número: contato não salvo na agenda. */
  | 'titulo'
  /** Não deu para ler com confiança. */
  | null;

export interface ContatoAtual {
  /** Título da conversa. Para contato não salvo, é o próprio número. */
  nome: string | null;
  /** Só dígitos, sem máscara. `null` quando não deu para ler com confiança. */
  telefone: string | null;
  origemDoTelefone: OrigemDoTelefone;
  ehGrupo: boolean;
  temConversaAberta: boolean;
  /** Identifica a conversa para detectar troca. Não é exibido. */
  chave: string | null;
}

const CONTATO_VAZIO: ContatoAtual = {
  nome: null,
  telefone: null,
  origemDoTelefone: null,
  ehGrupo: false,
  temConversaAberta: false,
  chave: null,
};

/**
 * O identificador da conversa aparece no atributo `data-id` das mensagens, no
 * formato `false_5511987654321@c.us_3EB0...`.
 *
 * Só `@c.us` é telefone. `@g.us` é grupo e `@lid` é um identificador interno
 * do WhatsApp que PARECE número e não é — tratar `@lid` como telefone gravaria
 * um número inexistente na ficha do lead.
 */
const JID_CONTATO = /(\d{8,15})@c\.us/;
const JID_GRUPO = /@g\.us/;

/** Título que é um número: "+55 11 98765-4321", "+1 (555) 010-9999". */
const TITULO_TELEFONE = /^\+?[\d\s().-]{9,}$/;

function soDigitos(texto: string): string {
  return texto.replace(/\D/g, '');
}

function lerJid(main: Element): { telefone: string | null; ehGrupo: boolean; jid: string | null } {
  // A primeira mensagem com data-id basta: todas carregam o mesmo JID de chat.
  const elemento = main.querySelector('[data-id]');
  const bruto = elemento?.getAttribute('data-id') ?? '';

  if (JID_GRUPO.test(bruto)) {
    return { telefone: null, ehGrupo: true, jid: bruto };
  }

  const contato = bruto.match(JID_CONTATO);
  if (contato?.[1]) {
    return { telefone: contato[1], ehGrupo: false, jid: contato[0] };
  }

  return { telefone: null, ehGrupo: false, jid: null };
}

const ID_ESTILO_LAYOUT = 'bytech3-layout';
const CLASSE_ABERTO = 'bytech3-painel-aberto';

/**
 * Encolhe o WhatsApp para o painel ocupar faixa própria.
 *
 * As três larguras são declaradas de propósito: o `body`, o `#app` e o filho
 * direto dele. O WhatsApp posiciona parte do layout com `position: fixed`, e
 * elemento fixo resolve `width: 100%` contra a JANELA, não contra o pai — ou
 * seja, encolher só o `#app` deixaria a conversa passando por baixo do painel.
 */
function garantirEstiloDeLayout(): void {
  if (document.getElementById(ID_ESTILO_LAYOUT)) return;

  const estilo = document.createElement('style');
  estilo.id = ID_ESTILO_LAYOUT;
  estilo.textContent = `
    html.${CLASSE_ABERTO} { overflow-x: hidden; }
    html.${CLASSE_ABERTO} body,
    html.${CLASSE_ABERTO} #app,
    html.${CLASSE_ABERTO} #app > div {
      width: calc(100vw - var(--bytech3-painel, 0px)) !important;
      max-width: calc(100vw - var(--bytech3-painel, 0px)) !important;
      transition: width .15s ease;
    }
  `;
  document.head.appendChild(estilo);
}

/** Painel lateral com a lista de conversas. */
const SELETOR_LISTA = '#pane-side';

/**
 * Uma conversa na lista. O WhatsApp já trocou esses nomes mais de uma vez, por
 * isso são candidatos em ordem de preferência, e não um seletor único.
 */
const SELETORES_LINHA = [
  '[role="listitem"]',
  '[data-testid="cell-frame-container"]',
  '[data-testid="list-item-container"]',
];

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => window.setTimeout(resolver, ms));
}

/** Linhas da lista, pelo primeiro seletor que devolver algo. */
function linhasDaLista(painel: Element): Element[] {
  for (const seletor of SELETORES_LINHA) {
    const achadas = painel.querySelectorAll(seletor);
    if (achadas.length > 0) return Array.from(achadas);
  }
  return [];
}

/** O JID aparece em `data-id` na própria linha ou em algum descendente. */
function jidDaLinha(linha: Element): string | null {
  const candidatos = [linha, ...Array.from(linha.querySelectorAll('[data-id]'))];

  for (const elemento of candidatos) {
    const bruto = elemento.getAttribute?.('data-id') ?? '';
    if (JID_GRUPO.test(bruto) || JID_CONTATO.test(bruto)) return bruto;
  }

  return null;
}

/**
 * "Arquivadas", "Archived" — o rótulo da entrada que leva à lista de
 * arquivadas, e o título do cabeçalho quando o vendedor está dentro dela.
 */
const ROTULO_ARQUIVADAS = /^(arquivad[ao]s?|archived)$/i;

/**
 * A linha é a ENTRADA para os arquivados, e não uma conversa?
 *
 * Ela mora no topo da lista e é lida como qualquer outra linha — foi assim que
 * "Arquivadas" foi parar na Inbox como se fosse um contato. Uma conversa de
 * verdade tem JID; a entrada, não. Por isso a checagem só vale quando o JID
 * está ausente: um contato realmente chamado "Arquivadas" continua entrando.
 */
function ehEntradaDeArquivadas(linha: Element, titulo: string | null, jid: string | null): boolean {
  if (jid) return false;
  if (linha.querySelector('[data-testid="archived-button"]')) return true;

  const rotulo = linha.getAttribute('aria-label')?.trim() ?? '';
  if (ROTULO_ARQUIVADAS.test(rotulo)) return true;

  return titulo ? ROTULO_ARQUIVADAS.test(titulo.trim()) : false;
}

/**
 * O vendedor está com a lista de ARQUIVADAS aberta?
 *
 * Dentro dela, as linhas são conversas de verdade, com JID — indistinguíveis
 * das ativas. Então não dá para filtrar uma a uma: o jeito honesto é não
 * capturar e dizer por quê, em vez de encher a Inbox de contatos que o
 * vendedor arquivou justamente para tirar da frente.
 *
 * Heurística: o cabeçalho acima da lista mostra o título "Arquivadas".
 */
function estaVendoArquivadas(painel: Element): boolean {
  const cabecalho = painel.parentElement?.querySelector('header');
  const primeiraLinha = (cabecalho as HTMLElement | null)?.innerText?.split('\n')[0]?.trim() ?? '';
  return ROTULO_ARQUIVADAS.test(primeiraLinha);
}

function tituloDaLinha(linha: Element): string | null {
  // `span[title]` é o nome exibido. Pega o primeiro com título não vazio: os
  // seguintes costumam ser a prévia da última mensagem, que não queremos nem
  // ler, muito menos guardar.
  const marcado = linha.querySelector('span[title]');
  const titulo = marcado?.getAttribute('title')?.trim();
  if (titulo) return titulo;

  const texto = (linha as HTMLElement).innerText?.split('\n')[0]?.trim();
  return texto || null;
}

/**
 * Campo de digitação e botão de enviar.
 *
 * O rodapé tem DOIS `contenteditable` em algumas versões (a busca e o campo de
 * mensagem), por isso a busca é feita dentro do `footer` do `#main`.
 */
const SELETORES_CAMPO = [
  '#main footer [contenteditable="true"]',
  '#main [data-testid="conversation-compose-box-input"]',
];

const SELETORES_ENVIAR = [
  '#main footer [data-testid="send"]',
  '#main footer button[aria-label*="nviar" i]',
  '#main footer span[data-icon="send"]',
];

/** Balões de mensagem dentro da conversa aberta. */
const SELETOR_BALAO = '#main [data-id]';

/** Texto da mensagem. `selectable-text` é a classe do corpo há muitas versões. */
const SELETORES_TEXTO = ['.selectable-text', '[data-testid="conversation-text"]'];

function primeiroElemento<T extends Element>(seletores: string[]): T | null {
  for (const seletor of seletores) {
    const achado = document.querySelector<T>(seletor);
    if (achado) return achado;
  }
  return null;
}

/** Campo de busca da lista lateral. */
const SELETORES_BUSCA = [
  '#side [contenteditable="true"]',
  '[data-testid="chat-list-search"]',
  '#side input[type="text"]',
];

/**
 * Resultado de abrir uma conversa, com o rastro de cada estratégia.
 *
 * `sem-conversa-previa` é o ÚNICO estado que autoriza o último recurso da
 * URL, que recarrega a página — e ele só acontece quando a busca do WhatsApp
 * não devolveu nada. `nao-encontrada` significa que a conversa existe na lista
 * mas não deu para confirmar qual é — e aí falhar é melhor que recarregar.
 */
export type AberturaDeConversa = {
  estado: 'ja-aberta' | 'aberta' | 'nao-encontrada' | 'sem-conversa-previa';
  registro: string[];
};

function mesmoNumero(a: string, b: string): boolean {
  const da = soDigitos(a);
  const db = soDigitos(b);
  if (da.length < 8 || db.length < 8) return false;
  const comparar = Math.min(da.length, db.length, 11);
  return da.slice(-comparar) === db.slice(-comparar);
}

/** Espera a conversa do telefone virar a conversa aberta. */
async function esperarConversaAbrir(telefone: string, tentativas = 20): Promise<boolean> {
  for (let i = 0; i < tentativas; i += 1) {
    if (WhatsAppAdapter.conversaAbertaEh(telefone)) return true;
    await esperar(150);
  }
  return false;
}

/**
 * Clica na linha da conversa.
 *
 * O alvo do clique varia entre versões: às vezes a própria linha responde,
 * às vezes só um filho interno. Tentar os dois é mais barato que descobrir
 * qual é a versão de hoje.
 */
function clicarNaLinha(linha: Element): void {
  const alvo =
    linha.querySelector<HTMLElement>('[role="gridcell"]') ??
    linha.querySelector<HTMLElement>('span[title]')?.closest<HTMLElement>('div') ??
    (linha as HTMLElement);

  alvo.click();
  if (alvo !== linha) (linha as HTMLElement).click?.();
}

/**
 * Procura o telefone entre as linhas JÁ VISÍVEIS e clica.
 *
 * POR QUE ISTO SÓ FUNCIONA PARA CONTATO FORA DA AGENDA:
 *   A linha da lista lateral NÃO carrega o identificador da conversa — o
 *   `data-id` fica nas mensagens, dentro do `#main`. Então, aqui, a única
 *   forma de reconhecer o contato pelo número é quando o próprio TÍTULO é o
 *   número, que é o caso de quem não está salvo na agenda.
 *
 *   Para "Amor❤️" — ou qualquer nome — esta estratégia não tem como acertar,
 *   e é por isso que a busca abaixo existe: lá, quem confirma a identidade é a
 *   conversa depois de aberta, não a linha antes do clique.
 */
async function clicarNaLista(telefone: string, registro: string[]): Promise<boolean> {
  const painel = document.querySelector(SELETOR_LISTA);
  if (!painel) {
    registro.push('lista: painel lateral não encontrado');
    return false;
  }

  const linhas = linhasDaLista(painel);
  let comTitulaNumerico = 0;

  for (const linha of linhas) {
    const jid = jidDaLinha(linha);
    const doJid = jid?.match(JID_CONTATO)?.[1] ?? null;
    const titulo = tituloDaLinha(linha) ?? '';

    const tituloEhNumero = TITULO_TELEFONE.test(titulo);
    if (tituloEhNumero) comTitulaNumerico += 1;

    const bate =
      (doJid && mesmoNumero(doJid, telefone)) ||
      (tituloEhNumero && mesmoNumero(titulo, telefone));

    if (!bate) continue;

    clicarNaLinha(linha);
    if (await esperarConversaAbrir(telefone)) {
      registro.push('lista: encontrado e aberto');
      return true;
    }
    registro.push('lista: linha casou mas a conversa não abriu');
  }

  registro.push(
    `lista: ${linhas.length} linha(s) visíveis, ${comTitulaNumerico} com título numérico, ` +
      'nenhuma reconhecível pelo número (contato salvo na agenda não expõe o número na lista)',
  );
  return false;
}

/** Espera a lista de resultados parar de mudar, ou desistir. */
async function esperarResultados(painel: Element, maximoMs = 2500): Promise<Element[]> {
  let anterior = -1;

  for (let esperou = 0; esperou < maximoMs; esperou += 250) {
    await esperar(250);
    const linhas = linhasDaLista(painel);

    // Duas leituras seguidas com a mesma contagem: a lista assentou.
    if (linhas.length > 0 && linhas.length === anterior) return linhas;
    anterior = linhas.length;
  }

  return linhasDaLista(painel);
}

type ResultadoBusca = 'aberta' | 'nao-confirmada' | 'sem-resultados' | 'sem-campo';

/**
 * Usa a busca interna do WhatsApp: digita o número, clica no resultado e
 * SÓ ENTÃO confirma quem abriu.
 *
 * A confirmação é a peça central. A linha da lista não diz de quem é, mas a
 * conversa ABERTA diz: o `data-id` das mensagens carrega o `<numero>@c.us`.
 * Então clicamos no candidato e conferimos com `conversaAbertaEh` — clicar é
 * palpite, a conferência é que decide.
 *
 * Distingue "não achei" de "achei e não confirmei", porque as duas levam a
 * caminhos diferentes: a primeira permite o último recurso da URL (contato com
 * quem nunca se conversou); a segunda NÃO, porque a conversa existe e
 * recarregar a página só atrapalharia o vendedor.
 */
async function buscarEAbrir(telefone: string, registro: string[]): Promise<ResultadoBusca> {
  const busca = primeiroElemento<HTMLElement>(SELETORES_BUSCA);
  if (!busca) {
    registro.push('busca: campo de busca não encontrado');
    return 'sem-campo';
  }

  const painel = document.querySelector(SELETOR_LISTA);
  if (!painel) {
    registro.push('busca: painel lateral não encontrado');
    return 'sem-campo';
  }

  const digitos = soDigitos(telefone);

  // Formas diferentes porque o WhatsApp casa o texto do jeito que o contato
  // está salvo: com DDI, sem DDI, ou com máscara.
  const consultas = [
    digitos,
    digitos.slice(-11),
    digitos.slice(-9),
    formatarBrasileiro(digitos),
  ].filter(
    (consulta, indice, todas) =>
      consulta.length >= 8 && todas.indexOf(consulta) === indice,
  );

  let houveAlgumResultado = false;

  for (const consulta of consultas) {
    limparBusca(busca);
    busca.focus();
    document.execCommand('insertText', false, consulta);

    const candidatos = await esperarResultados(painel);
    if (candidatos.length === 0) {
      registro.push(`busca "${consulta}": nenhum resultado`);
      continue;
    }

    houveAlgumResultado = true;

    // Teto de dois: cada clique troca a conversa aberta do vendedor, e errar
    // três vezes seguidas seria mais intrusivo que desistir.
    const paraTentar = candidatos.slice(0, 2);
    registro.push(`busca "${consulta}": ${candidatos.length} resultado(s), testando ${paraTentar.length}`);

    for (const [indice, linha] of paraTentar.entries()) {
      clicarNaLinha(linha);

      if (await esperarConversaAbrir(telefone)) {
        registro.push(`busca "${consulta}": resultado ${indice + 1} confirmado`);
        limparBusca(busca);
        return 'aberta';
      }

      const aberta = WhatsAppAdapter.getCurrentContact();
      registro.push(
        `busca "${consulta}": resultado ${indice + 1} abriu "${aberta.nome ?? '?'}" ` +
          `(telefone lido: ${aberta.telefone ?? 'nenhum'}) — não confere`,
      );
    }
  }

  limparBusca(busca);
  return houveAlgumResultado ? 'nao-confirmada' : 'sem-resultados';
}

/** "5511987654321" -> "+55 11 98765-4321", para casar com contato mascarado. */
function formatarBrasileiro(digitos: string): string {
  const brasil = digitos.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return brasil ? `+55 ${brasil[1]} ${brasil[2]}-${brasil[3]}` : digitos;
}

/**
 * Devolve a busca ao estado vazio.
 *
 * Deixar o texto no campo mudaria a lista lateral do vendedor sem ele ter
 * pedido — e ele voltaria para o WhatsApp achando que perdeu as conversas.
 */
function limparBusca(busca: HTMLElement): void {
  busca.focus();
  document.execCommand('selectAll', false);
  document.execCommand('delete', false);
}

export const WhatsAppAdapter = {
  /**
   * Abre espaço para o painel (largura em px) ou devolve a largura total
   * (`null`). Sobrepor a conversa esconde justamente o que o vendedor está
   * lendo enquanto decide salvar o lead.
   */
  reservarEspacoParaPainel(largura: number | null): void {
    const raiz = document.documentElement;

    if (largura === null) {
      raiz.classList.remove(CLASSE_ABERTO);
      raiz.style.removeProperty('--bytech3-painel');
      return;
    }

    garantirEstiloDeLayout();
    raiz.style.setProperty('--bytech3-painel', `${largura}px`);
    raiz.classList.add(CLASSE_ABERTO);
  },

  /** O contato da conversa aberta. Campos que não deram para ler vêm nulos. */
  getCurrentContact(): ContatoAtual {
    const main = document.querySelector('#main');
    if (!main) return CONTATO_VAZIO;

    const cabecalho = main.querySelector('header');
    // O texto do cabeçalho vem como "Nome\nonline" ou "Nome\nclique aqui...".
    // Só a primeira linha é o título da conversa.
    const titulo = (cabecalho as HTMLElement | null)?.innerText?.split('\n')[0]?.trim() || null;

    const { telefone: telefoneDoJid, ehGrupo, jid } = lerJid(main);

    let telefone = telefoneDoJid;
    let origemDoTelefone: OrigemDoTelefone = telefoneDoJid ? 'jid' : null;

    // Contato fora da agenda: o WhatsApp mostra o número como título. Só vale
    // quando o título é SÓ número — "Maria (11) 99999" não é telefone legível.
    if (!telefone && !ehGrupo && titulo && TITULO_TELEFONE.test(titulo)) {
      const digitos = soDigitos(titulo);
      if (digitos.length >= 8 && digitos.length <= 15) {
        telefone = digitos;
        origemDoTelefone = 'titulo';
      }
    }

    return {
      nome: titulo,
      telefone,
      origemDoTelefone,
      ehGrupo,
      temConversaAberta: true,
      chave: jid ?? titulo,
    };
  },

  /**
   * As conversas recentes da lista lateral, na ordem em que o WhatsApp as
   * mostra (que já é da mais recente para a mais antiga).
   *
   * SOB DEMANDA, NUNCA CONTÍNUO: a lista é virtualizada — só existem no DOM as
   * linhas visíveis —, então buscar 50 exige rolar o painel. Rolar a tela do
   * vendedor é intrusivo demais para acontecer sozinho; por isso só roda a
   * pedido, e a posição da rolagem é devolvida ao lugar no fim.
   *
   * O QUE NÃO É LIDO: nenhuma mensagem, nenhuma prévia, nenhuma contagem de
   * não lidas. Só quem é a conversa e em que posição ela estava.
   */
  async listarConversasRecentes(limite = 50): Promise<ResultadoCaptura> {
    const painel = document.querySelector(SELETOR_LISTA);
    if (!painel) return { conversas: [], aviso: 'sem-lista' };

    // Conversa arquivada é conversa que o vendedor tirou da frente de
    // propósito. Trazê-la de volta como "contato ativo" na Inbox desfaz a
    // decisão dele.
    if (estaVendoArquivadas(painel)) {
      return { conversas: [], aviso: 'lista-arquivadas' };
    }

    const rolagemOriginal = painel.scrollTop;
    const encontradas = new Map<string, ConversaCapturada>();

    // Teto de passadas: a lista pode ter milhares de conversas, e insistir até
    // o fim travaria a aba do vendedor.
    const MAX_PASSADAS = 15;

    for (let passada = 0; passada < MAX_PASSADAS; passada += 1) {
      const antes = encontradas.size;

      for (const linha of linhasDaLista(painel)) {
        if (encontradas.size >= limite) break;

        const titulo = tituloDaLinha(linha);
        if (!titulo) continue;

        const jid = jidDaLinha(linha);
        if (ehEntradaDeArquivadas(linha, titulo, jid)) continue;

        const ehGrupo = jid ? JID_GRUPO.test(jid) : false;

        let telefone: string | null = null;
        const doJid = jid?.match(JID_CONTATO);
        if (doJid?.[1]) {
          telefone = doJid[1];
        } else if (!ehGrupo && TITULO_TELEFONE.test(titulo)) {
          // Contato fora da agenda: o WhatsApp mostra o número como nome.
          const digitos = soDigitos(titulo);
          if (digitos.length >= 8 && digitos.length <= 15) telefone = digitos;
        }

        // Sem JID, a chave sai do título — identificação mais fraca, e o
        // `origem_do_id` registra isso para ninguém confiar demais nela.
        const chaveForte = jid?.match(/[\w.-]+@(c\.us|g\.us)/)?.[0] ?? null;
        const chat_id = chaveForte ?? `titulo:${titulo.toLowerCase()}`;

        if (encontradas.has(chat_id)) continue;

        encontradas.set(chat_id, {
          chat_id,
          origem_do_id: chaveForte ? 'jid' : 'titulo',
          titulo,
          telefone,
          eh_grupo: ehGrupo,
          posicao: encontradas.size,
        });
      }

      if (encontradas.size >= limite) break;

      const chegouAoFim = painel.scrollTop + painel.clientHeight >= painel.scrollHeight - 4;
      if (chegouAoFim && encontradas.size === antes) break;

      painel.scrollTop += Math.max(painel.clientHeight * 0.8, 200);
      // A lista virtualizada precisa de um respiro para renderizar as novas
      // linhas antes da próxima leitura.
      await esperar(220);
    }

    painel.scrollTop = rolagemOriginal;

    return { conversas: Array.from(encontradas.values()) };
  },

  /** A conversa aberta é a deste telefone? Compara pelo fim, até 11 dígitos. */
  conversaAbertaEh(telefone: string): boolean {
    const atual = soDigitos(WhatsAppAdapter.getCurrentContact().telefone ?? '');
    const alvo = soDigitos(telefone);
    if (atual.length < 8 || alvo.length < 8) return false;

    const comparar = Math.min(atual.length, alvo.length, 11);
    return atual.slice(-comparar) === alvo.slice(-comparar);
  },

  /** Endereço que abre a conversa com um número no WhatsApp Web. */
  enderecoDaConversa(telefone: string): string {
    return `https://web.whatsapp.com/send?phone=${soDigitos(telefone)}`;
  },

  /**
   * Abre a conversa de um telefone SEM recarregar a página.
   *
   * Navegar por `?phone=` derruba e remonta o WhatsApp Web inteiro: são
   * segundos de espera, o estado da aba se perde e, se a conexão estiver
   * lenta, o tempo limite estoura antes de a conversa aparecer. Por isso a
   * ordem é:
   *
   *   1. já está aberta      -> não faz nada
   *   2. está na lista       -> clica na linha
   *   3. não está na lista   -> usa a busca interna do WhatsApp e clica
   *
   * Nenhuma delas recarrega nada. A navegação por URL não acontece aqui: este
   * método só CLASSIFICA a falha, e quem chamou decide. E só há um estado que
   * autoriza recarregar — `sem-conversa-previa`, quando a busca do próprio
   * WhatsApp não devolveu resultado nenhum. Com resultados na tela a conversa
   * existe, e recarregar seria interromper o vendedor à toa.
   *
   * O `registro` acompanha a resposta com o que cada estratégia tentou e por
   * que desistiu: sem ele, uma falha aqui vira adivinhação.
   */
  async abrirConversaPorTelefone(telefone: string): Promise<AberturaDeConversa> {
    const registro: string[] = [];

    if (WhatsAppAdapter.conversaAbertaEh(telefone)) {
      return { estado: 'ja-aberta', registro: ['já era a conversa aberta'] };
    }
    registro.push('não é a conversa aberta; tentando a lista');

    if (await clicarNaLista(telefone, registro)) {
      return { estado: 'aberta', registro };
    }

    const busca = await buscarEAbrir(telefone, registro);
    if (busca === 'aberta') return { estado: 'aberta', registro };

    // A DISTINÇÃO QUE IMPORTA: só quando a busca não devolveu NADA é que se
    // pode supor que nunca houve conversa — e só aí a URL, que recarrega a
    // página, é aceitável. Com resultados na tela, a conversa existe, e
    // recarregar interromperia o trabalho do vendedor sem necessidade.
    if (busca === 'sem-resultados') {
      registro.push('nenhuma busca encontrou a conversa: provavelmente é contato novo');
      return { estado: 'sem-conversa-previa', registro };
    }

    registro.push('a conversa existe, mas não deu para confirmar qual é — sem recarregar');
    return { estado: 'nao-encontrada', registro };
  },

  /**
   * As últimas mensagens da conversa aberta, para dar contexto ao vendedor.
   *
   * EM MEMÓRIA, SEMPRE. Nada disto é enviado ao banco, guardado em storage ou
   * escrito em log: conversa de cliente de terceiro é responsabilidade
   * jurídica que este produto não tem motivo para assumir. O texto vai do DOM
   * para a tela do vendedor e morre ali.
   */
  lerUltimasMensagens(limite = 15): MensagemLida[] {
    const main = document.querySelector('#main');
    if (!main) return [];

    const baloes = Array.from(main.querySelectorAll(SELETOR_BALAO));
    const lidas: MensagemLida[] = [];

    // De trás para frente: as últimas são as que interessam.
    for (let i = baloes.length - 1; i >= 0 && lidas.length < limite; i -= 1) {
      const balao = baloes[i];
      if (!balao) continue;

      const id = balao.getAttribute('data-id') ?? '';

      // `true_` = enviada por mim; `false_` = recebida. É o próprio WhatsApp
      // quem marca isso no id do balão.
      if (!id.startsWith('true_') && !id.startsWith('false_')) continue;

      let texto: string | null = null;
      for (const seletor of SELETORES_TEXTO) {
        const corpo = balao.querySelector(seletor) as HTMLElement | null;
        if (corpo?.innerText?.trim()) {
          texto = corpo.innerText.trim();
          break;
        }
      }

      // Sem texto legível é anexo, áudio ou figurinha. Marcar como tal é mais
      // honesto que sumir com a mensagem do meio da conversa.
      const conteudo = texto ?? '[anexo ou mídia]';

      // "[14:32, 20/08/2026] Fulano: " — só a hora interessa.
      const cabecalho = balao.querySelector('[data-pre-plain-text]');
      const horario =
        cabecalho?.getAttribute('data-pre-plain-text')?.match(/\[(\d{1,2}:\d{2})/)?.[1] ?? null;

      lidas.push({
        direcao: id.startsWith('true_') ? 'saida' : 'entrada',
        texto: conteudo.slice(0, 500),
        horario,
      });
    }

    return lidas.reverse();
  },

  /**
   * Escreve e envia UMA mensagem na conversa aberta.
   *
   * Uma por vez, disparada por clique do vendedor. Não existe fila nem laço
   * aqui de propósito: automação de envio pelo WhatsApp Web é o caminho mais
   * curto para o número do cliente ser banido, e o risco recai sobre ele.
   */
  async enviarMensagem(texto: string): Promise<{ ok: boolean; erro?: string }> {
    const campo = primeiroElemento<HTMLElement>(SELETORES_CAMPO);
    if (!campo) {
      return { ok: false, erro: 'O campo de mensagem não foi encontrado na conversa aberta.' };
    }

    campo.focus();

    // `insertText` é o que dispara os eventos que o editor do WhatsApp escuta.
    // Escrever em `textContent` preenche a caixa visualmente e o botão de
    // enviar continua desabilitado, porque o React deles nunca soube da mudança.
    const inseriu = document.execCommand('insertText', false, texto);
    if (!inseriu) {
      return { ok: false, erro: 'Não foi possível escrever no campo de mensagem.' };
    }

    // Um quadro para o editor processar antes de procurar o botão: ele só
    // aparece depois que há texto.
    await esperar(150);

    const botaoEnviar = primeiroElemento<HTMLElement>(SELETORES_ENVIAR);
    if (!botaoEnviar) {
      return {
        ok: false,
        erro: 'O botão de enviar não apareceu. A mensagem ficou escrita na conversa — envie manualmente.',
      };
    }

    (botaoEnviar.closest('button') ?? botaoEnviar).click();
    await esperar(150);

    return { ok: true };
  },

  /**
   * Avisa quando o vendedor troca de conversa.
   *
   * Por que uma verificação periódica e NÃO um MutationObserver: no WhatsApp o
   * DOM muda o tempo todo — mensagem chegando, indicador de digitação, lista
   * lateral reordenando. Um observer amplo dispararia centenas de vezes por
   * minuto para detectar um evento que acontece algumas vezes por hora, e um
   * observer estreito quebra junto com a próxima mudança de layout deles.
   *
   * A verificação abaixo custa dois `querySelector` por ciclo, só roda com a
   * aba visível e só chama o callback quando a conversa realmente muda.
   */
  observarConversa(aoTrocar: (contato: ContatoAtual) => void, intervaloMs = 800): () => void {
    let chaveAnterior: string | null | undefined;

    const verificar = () => {
      if (document.hidden) return;

      const contato = WhatsAppAdapter.getCurrentContact();
      if (contato.chave === chaveAnterior) return;

      chaveAnterior = contato.chave;
      aoTrocar(contato);
    };

    const timer = window.setInterval(verificar, intervaloMs);
    // Voltar para a aba pode ter mudado a conversa enquanto ela estava oculta.
    document.addEventListener('visibilitychange', verificar);
    verificar();

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', verificar);
    };
  },
};
