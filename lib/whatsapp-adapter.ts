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

import type { ConversaCapturada } from './mensagens';

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
  async listarConversasRecentes(limite = 50): Promise<ConversaCapturada[]> {
    const painel = document.querySelector(SELETOR_LISTA);
    if (!painel) return [];

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

    return Array.from(encontradas.values());
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
