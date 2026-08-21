/**
 * Peças de interface do painel.
 *
 * Só construção de DOM e estilo — nenhum seletor do WhatsApp mora aqui (isso é
 * exclusividade da WhatsAppAdapter) e nenhuma chamada ao Supabase (isso é
 * exclusividade do background).
 */

export const ESTILOS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }

  .badge {
    position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px; border: none; border-radius: 999px;
    background: #059669; color: #fff;
    font-size: 13px; font-weight: 600; line-height: 1;
    box-shadow: 0 2px 12px rgba(0,0,0,.25); cursor: pointer;
  }
  .badge:hover { background: #047857; }
  .badge[hidden] { display: none; }
  .ponto { width: 8px; height: 8px; border-radius: 50%; background: #d1fae5; }

  .painel {
    position: fixed; top: 0; right: 0; z-index: 2147483000;
    display: flex; flex-direction: column;
    width: 340px; height: 100vh;
    background: #fff; color: #111827;
    border-left: 1px solid rgba(0,0,0,.12);
    box-shadow: -2px 0 16px rgba(0,0,0,.14);
    font-size: 14px; line-height: 1.5;
  }
  .painel[hidden] { display: none; }

  .cabecalho {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 14px 16px; background: #059669; color: #fff;
  }
  .titulo { font-size: 14px; font-weight: 700; letter-spacing: .02em; }
  .fechar {
    border: none; background: transparent; color: #fff;
    font-size: 20px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 6px;
  }
  .fechar:hover { background: rgba(255,255,255,.18); }

  .corpo { flex: 1; overflow-y: auto; padding: 16px; }
  .secao + .secao { margin-top: 18px; padding-top: 18px; border-top: 1px solid rgba(0,0,0,.08); }

  .rotulo { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; }
  .valor { font-size: 15px; font-weight: 600; color: #111827; margin-top: 2px; word-break: break-word; }
  .bloco + .bloco { margin-top: 12px; }
  .texto { color: #374151; margin: 10px 0 0; }
  .fraco { color: #6b7280; font-size: 13px; margin: 10px 0 0; }

  .aviso {
    margin-top: 12px; padding: 10px 12px; border-radius: 8px;
    background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; font-size: 13px;
  }
  .erro {
    margin-top: 12px; padding: 10px 12px; border-radius: 8px;
    background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; font-size: 13px;
  }
  .sucesso {
    margin-top: 12px; padding: 10px 12px; border-radius: 8px;
    background: #ecfdf5; border: 1px solid #6ee7b7; color: #065f46; font-size: 13px;
  }

  .acao, .secundaria {
    display: inline-block; margin-top: 12px; padding: 10px 14px;
    border-radius: 8px; font-size: 13px; font-weight: 600;
    text-decoration: none; cursor: pointer;
  }
  .acao { border: none; background: #059669; color: #fff; }
  .acao:hover { background: #047857; }
  .acao:disabled { opacity: .6; cursor: default; }
  .secundaria {
    border: 1px solid rgba(0,0,0,.15); background: #fff; color: #374151;
  }
  .secundaria:hover { background: #f9fafb; }
  .linha-acoes { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .linha-acoes > * { margin-top: 12px; }

  .campo { display: block; margin-top: 12px; }
  .campo > span { display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px; }
  .campo input, .campo select {
    width: 100%; padding: 9px 10px; font-size: 14px;
    border: 1px solid rgba(0,0,0,.2); border-radius: 8px;
    background: #fff; color: #111827;
  }
  .campo input:focus, .campo select:focus { outline: 2px solid #05966955; border-color: #059669; }
  .dica { font-size: 12px; color: #6b7280; margin-top: 4px; }

  .etiquetas { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; padding: 0; list-style: none; }
  .etiqueta {
    padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600;
    background: rgba(0,0,0,.06); color: #374151;
  }
`;

export function bloco(rotulo: string, valor: string): HTMLElement {
  const caixa = document.createElement('div');
  caixa.className = 'bloco';

  const titulo = document.createElement('div');
  titulo.className = 'rotulo';
  titulo.textContent = rotulo;

  const conteudo = document.createElement('div');
  conteudo.className = 'valor';
  conteudo.textContent = valor;

  caixa.append(titulo, conteudo);
  return caixa;
}

export function paragrafo(texto: string, classe = 'texto'): HTMLElement {
  const elemento = document.createElement('p');
  elemento.className = classe;
  elemento.textContent = texto;
  return elemento;
}

export function caixa(classe: 'aviso' | 'erro' | 'sucesso', texto: string): HTMLElement {
  const elemento = document.createElement('div');
  elemento.className = classe;
  elemento.textContent = texto;
  return elemento;
}

export function link(texto: string, url: string, classe = 'acao'): HTMLAnchorElement {
  const elemento = document.createElement('a');
  elemento.className = classe;
  elemento.href = url;
  elemento.target = '_blank';
  elemento.rel = 'noopener noreferrer';
  elemento.textContent = texto;
  return elemento;
}

export function botao(texto: string, aoClicar: () => void, classe = 'acao'): HTMLButtonElement {
  const elemento = document.createElement('button');
  elemento.type = 'button';
  elemento.className = classe;
  elemento.textContent = texto;
  elemento.addEventListener('click', aoClicar);
  return elemento;
}

export function campo(
  rotulo: string,
  valor: string,
  opcoes: { dica?: string; tipo?: string; placeholder?: string } = {},
): { raiz: HTMLElement; entrada: HTMLInputElement } {
  const raiz = document.createElement('label');
  raiz.className = 'campo';

  const texto = document.createElement('span');
  texto.textContent = rotulo;

  const entrada = document.createElement('input');
  entrada.type = opcoes.tipo ?? 'text';
  entrada.value = valor;
  if (opcoes.placeholder) entrada.placeholder = opcoes.placeholder;

  raiz.append(texto, entrada);

  if (opcoes.dica) {
    const dica = document.createElement('div');
    dica.className = 'dica';
    dica.textContent = opcoes.dica;
    raiz.append(dica);
  }

  return { raiz, entrada };
}

export function selecao(
  rotulo: string,
  opcoes: readonly string[],
  selecionado: string,
): { raiz: HTMLElement; entrada: HTMLSelectElement } {
  const raiz = document.createElement('label');
  raiz.className = 'campo';

  const texto = document.createElement('span');
  texto.textContent = rotulo;

  const entrada = document.createElement('select');
  for (const opcao of opcoes) {
    const item = document.createElement('option');
    item.value = opcao;
    item.textContent = opcao;
    entrada.append(item);
  }
  entrada.value = selecionado;

  raiz.append(texto, entrada);
  return { raiz, entrada };
}

export function etiquetas(nomes: { id: string; nome: string; cor: string | null }[]): HTMLElement {
  const lista = document.createElement('ul');
  lista.className = 'etiquetas';

  for (const tag of nomes) {
    const item = document.createElement('li');
    item.className = 'etiqueta';
    item.textContent = tag.nome;
    if (tag.cor) {
      item.style.background = `${tag.cor}22`;
      item.style.color = tag.cor;
    }
    lista.append(item);
  }

  return lista;
}

/**
 * Deixa legível o número que veio do WhatsApp, sem alterar o conteúdo: só
 * formata quando o padrão é reconhecido (Brasil, com DDI e DDD). Qualquer
 * outro formato é devolvido como está — melhor cru que mascarado errado.
 */
export function formatarTelefone(digitos: string): string {
  const numero = digitos.replace(/\D/g, '');

  const brasil = numero.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (brasil) return `+55 (${brasil[1]}) ${brasil[2]}-${brasil[3]}`;

  return digitos;
}
