// WhatsAppAdapter — ÚNICO lugar que conhece a estrutura do WhatsApp Web.
// Se o WhatsApp mudar o layout, conserta-se SÓ aqui.

export interface ContatoAtual {
  nome: string | null;
}

export const WhatsAppAdapter = {
  // Retorna o contato da conversa aberta, ou null se nenhuma estiver aberta.
  getCurrentContact(): ContatoAtual {
    const header = document.querySelector('#main header');
    if (!header) {
      return { nome: null };
    }

    // o texto vem como "Nome\nAdicionar à lista" — pegamos só a primeira linha
    const textoCompleto = (header as HTMLElement).innerText || '';
    const nome = textoCompleto.split('\n')[0]?.trim() || null;

    return { nome };
  },
};