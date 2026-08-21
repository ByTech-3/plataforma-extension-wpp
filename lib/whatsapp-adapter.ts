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

export const WhatsAppAdapter = {
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
