/**
 * Peças de interface do painel.
 *
 * Só construção de DOM e estilo — nenhum seletor do WhatsApp mora aqui (isso é
 * exclusividade da WhatsAppAdapter) e nenhuma chamada ao Supabase (isso é
 * exclusividade do background).
 */

/**
 * Largura do painel, em pixels.
 *
 * Uma constante só: o mesmo número dimensiona o painel e o espaço que o
 * WhatsApp cede para ele. Dois valores independentes divergiriam no primeiro
 * ajuste de layout, e sobraria uma fresta ou uma sobreposição.
 */
export const LARGURA_PAINEL = 340;

/**
 * Mesma linguagem visual do app: neutro frio, verde reservado à ação
 * principal, menos borda e mais superfície, grade de 4px.
 *
 * Os valores estão escritos à mão em vez de importados do app porque são
 * projetos separados — e um painel que vive dentro do WhatsApp não pode
 * depender de CSS carregado de fora.
 */
export const ESTILOS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }

  :host {
    --fundo: #fafafa;
    --superficie: #ffffff;
    --superficie-2: #f4f4f5;
    --texto: #18181b;
    --texto-2: #52525b;
    --texto-3: #a1a1aa;
    --linha: #e4e4e7;
    --linha-forte: #d4d4d8;
    --acao: #059669;
    --acao-forte: #047857;
    --acao-suave: #ecfdf5;
    --acao-texto: #065f46;
    --alerta: #b45309;
    --alerta-suave: #fffbeb;
    --alerta-linha: #fcd34d;
    --perigo: #b91c1c;
    --perigo-suave: #fef2f2;
    --perigo-linha: #fca5a5;
    --raio: 10px;
  }

  /* Botão redondo, na altura da mão: um terço da tela a partir do topo, e não
     no rodapé, onde disputava espaço com o campo de digitação do WhatsApp. */
  .badge {
    position: fixed; right: 18px; top: 34%; z-index: 2147483000;
    display: flex; align-items: center; justify-content: center;
    width: 52px; height: 52px; padding: 0;
    border: none; border-radius: 50%;
    background: var(--acao); color: #fff;
    box-shadow: 0 4px 14px rgb(24 24 27 / .28); cursor: pointer;
    transition: transform .12s ease, background .12s ease;
  }
  .badge:hover { background: var(--acao-forte); transform: scale(1.06); }
  .badge:active { transform: scale(.97); }
  .badge[hidden] { display: none; }
  .badge svg { width: 24px; height: 24px; display: block; }

  .painel {
    position: fixed; top: 0; right: 0; z-index: 2147483000;
    display: flex; flex-direction: column;
    width: var(--bytech3-largura, 340px); height: 100vh;
    background: var(--fundo); color: var(--texto);
    border-left: 1px solid var(--linha);
    box-shadow: -4px 0 20px rgb(24 24 27 / .10);
    font-size: 14px; line-height: 1.5;
  }
  .painel[hidden] { display: none; }

  .cabecalho {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 14px 16px;
    background: var(--superficie); border-bottom: 1px solid var(--linha);
  }
  .titulo { font-size: 13px; font-weight: 600; letter-spacing: .02em; color: var(--texto); }
  .fechar {
    border: none; background: transparent; color: var(--texto-3);
    font-size: 20px; line-height: 1; cursor: pointer;
    padding: 2px 8px; border-radius: var(--raio);
  }
  .fechar:hover { background: var(--superficie-2); color: var(--texto); }

  .corpo { flex: 1; overflow-y: auto; padding: 16px; }
  .secao + .secao { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--linha); }

  .rotulo { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--texto-3); font-weight: 500; }
  .valor { font-size: 15px; font-weight: 600; color: var(--texto); margin-top: 2px; word-break: break-word; }
  .bloco + .bloco { margin-top: 12px; }
  .texto { color: var(--texto-2); margin: 10px 0 0; }
  .fraco { color: var(--texto-3); font-size: 13px; margin: 10px 0 0; }

  .aviso, .erro, .sucesso {
    margin-top: 12px; padding: 10px 12px; border-radius: var(--raio);
    font-size: 13px; border: 1px solid;
  }
  .aviso { background: var(--alerta-suave); border-color: var(--alerta-linha); color: var(--alerta); }
  .erro { background: var(--perigo-suave); border-color: var(--perigo-linha); color: var(--perigo); }
  .sucesso { background: var(--acao-suave); border-color: #6ee7b7; color: var(--acao-texto); }

  .acao, .secundaria {
    display: inline-flex; align-items: center; justify-content: center;
    margin-top: 12px; padding: 10px 14px;
    border-radius: var(--raio); font-size: 13px; font-weight: 600;
    text-decoration: none; cursor: pointer; transition: background .12s ease;
  }
  .acao { border: none; background: var(--acao); color: #fff; }
  .acao:hover { background: var(--acao-forte); }
  .acao:disabled { opacity: .5; cursor: default; }
  .secundaria {
    border: 1px solid var(--linha-forte); background: var(--superficie); color: var(--texto);
  }
  .secundaria:hover { background: var(--superficie-2); }
  .linha-acoes { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .linha-acoes > * { margin-top: 12px; }

  .campo { display: block; margin-top: 12px; }
  .campo > span { display: block; font-size: 12px; font-weight: 500; color: var(--texto); margin-bottom: 4px; }
  .campo input, .campo select {
    width: 100%; padding: 9px 10px; font-size: 14px;
    border: 1px solid var(--linha-forte); border-radius: var(--raio);
    background: var(--superficie); color: var(--texto);
  }
  .campo input:focus, .campo select:focus {
    outline: 2px solid rgb(5 150 105 / .25); border-color: var(--acao);
  }
  .dica { font-size: 12px; color: var(--texto-3); margin-top: 4px; }

  .etiquetas { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; padding: 0; list-style: none; }
  .etiqueta {
    padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 500;
    background: var(--superficie-2); color: var(--texto-2);
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
