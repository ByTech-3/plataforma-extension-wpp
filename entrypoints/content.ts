/**
 * Interface da extensão dentro do WhatsApp Web.
 *
 * Só interface: nenhuma chamada ao Supabase acontece aqui. O content script
 * pergunta ao background e desenha a resposta, para o JWT do vendedor não
 * circular no contexto de uma página de terceiro.
 *
 * Tudo é montado dentro de um Shadow DOM. O WhatsApp tem CSS global agressivo
 * e troca de layout sem aviso; sem a barreira do shadow root, um `div { }`
 * deles desmonta o painel — e um `*` nosso desmontaria o deles.
 */
import type { EstadoSessao } from '../lib/mensagens';
import { URL_CRM, URL_LOGIN } from '../lib/config';

const ID_RAIZ = 'bytech3-raiz';
const CHAVE_ABERTO = 'painel_aberto';

const ESTILOS = `
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
    width: 320px; height: 100vh;
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
  .rotulo { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; }
  .valor { font-size: 15px; font-weight: 600; color: #111827; margin-top: 2px; word-break: break-word; }
  .bloco + .bloco { margin-top: 14px; }
  .texto { color: #374151; }
  .fraco { color: #6b7280; font-size: 13px; }

  .aviso {
    margin-top: 14px; padding: 10px 12px; border-radius: 8px;
    background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; font-size: 13px;
  }
  .erro {
    margin-top: 14px; padding: 10px 12px; border-radius: 8px;
    background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; font-size: 13px;
  }

  .acao {
    display: inline-block; margin-top: 14px; padding: 10px 14px;
    border: none; border-radius: 8px; background: #059669; color: #fff;
    font-size: 13px; font-weight: 600; text-decoration: none; cursor: pointer;
  }
  .acao:hover { background: #047857; }
  .secundaria {
    display: inline-block; margin-top: 10px; margin-left: 8px;
    padding: 10px 14px; border-radius: 8px;
    border: 1px solid rgba(0,0,0,.15); background: #fff; color: #374151;
    font-size: 13px; font-weight: 600; text-decoration: none; cursor: pointer;
  }
  .secundaria:hover { background: #f9fafb; }
`;

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

  cabecalho.append(titulo, fechar);
  painel.append(cabecalho, corpo);
  shadow.append(estilo, badge, painel);
  document.body.appendChild(raiz);

  async function abrir() {
    painel.hidden = false;
    badge.hidden = true;
    await guardarAberto(true);
    void atualizarSessao(corpo);
  }

  async function fecharPainel() {
    painel.hidden = true;
    badge.hidden = false;
    await guardarAberto(false);
  }

  badge.addEventListener('click', () => void abrir());
  fechar.addEventListener('click', () => void fecharPainel());

  // Voltar para a aba depois de entrar no app deve refletir na hora, sem
  // precisar clicar em "verificar de novo".
  window.addEventListener('focus', () => {
    if (!painel.hidden) void atualizarSessao(corpo);
  });

  // O WhatsApp troca a árvore inteira ao navegar; se levar o painel junto,
  // remonta.
  setInterval(() => {
    if (!document.getElementById(ID_RAIZ)) montar();
  }, 5000);

  void (async () => {
    if (await estavaAberto()) {
      await abrir();
    }
  })();
}

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

async function atualizarSessao(corpo: HTMLElement) {
  corpo.replaceChildren(paragrafo('Verificando seu login…', 'fraco'));

  let estado: EstadoSessao;
  try {
    estado = (await browser.runtime.sendMessage({ tipo: 'sessao/estado' })) as EstadoSessao;
  } catch {
    estado = {
      estado: 'erro',
      mensagem: 'A extensão precisa ser recarregada. Feche e abra o WhatsApp Web.',
    };
  }

  desenharSessao(corpo, estado);
}

function desenharSessao(corpo: HTMLElement, estado: EstadoSessao) {
  corpo.replaceChildren();

  if (estado.estado === 'conectada') {
    corpo.append(
      bloco('Conectado como', estado.email ?? 'vendedor'),
      bloco('Organização', estado.organizacao.nome),
      bloco('Seu acesso', ROTULO_PAPEL[estado.organizacao.papel] ?? estado.organizacao.papel),
    );

    if (!estado.organizacao.acesso_ativo) {
      corpo.append(
        caixa(
          'aviso',
          'O período de teste desta organização terminou. Você continua vendo os dados, ' +
            'mas gravações são recusadas pelo servidor.',
        ),
      );
    }

    corpo.append(
      link('Abrir o CRM', URL_CRM, 'acao'),
      paragrafo(
        estado.organizacao.papel === 'vendedor'
          ? 'Você vê os seus leads e os que estão sem responsável.'
          : 'Você vê todos os leads da organização.',
        'fraco',
      ),
    );
    return;
  }

  if (estado.estado === 'sem-sessao' || estado.estado === 'expirada') {
    const primeiraVez = estado.estado === 'sem-sessao';

    corpo.append(
      paragrafo(
        primeiraVez
          ? 'Entre no ByTech3 para usar a extensão aqui no WhatsApp.'
          : 'Sua sessão expirou. Abra o ByTech3 para reconectar — é só carregar a página.',
        'texto',
      ),
      link(primeiraVez ? 'Entrar no ByTech3' : 'Reconectar', primeiraVez ? URL_LOGIN : URL_CRM, 'acao'),
      botaoVerificar(corpo),
      paragrafo(
        'A extensão usa o mesmo login do site. Nada é salvo enquanto você não estiver conectado.',
        'fraco',
      ),
    );
    return;
  }

  if (estado.estado === 'sem-organizacao') {
    corpo.append(
      paragrafo('Sua conta ainda não faz parte de uma organização.', 'texto'),
      link('Concluir cadastro', URL_CRM, 'acao'),
      botaoVerificar(corpo),
    );
    return;
  }

  corpo.append(caixa('erro', estado.mensagem), botaoVerificar(corpo));
}

function botaoVerificar(corpo: HTMLElement): HTMLButtonElement {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'secundaria';
  botao.textContent = 'Verificar de novo';
  botao.addEventListener('click', () => void atualizarSessao(corpo));
  return botao;
}

function bloco(rotulo: string, valor: string): HTMLElement {
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

function paragrafo(texto: string, classe: string): HTMLElement {
  const elemento = document.createElement('p');
  elemento.className = classe;
  elemento.style.margin = '0';
  elemento.style.marginTop = '10px';
  elemento.textContent = texto;
  return elemento;
}

function caixa(classe: 'aviso' | 'erro', texto: string): HTMLElement {
  const elemento = document.createElement('div');
  elemento.className = classe;
  elemento.textContent = texto;
  return elemento;
}

function link(texto: string, url: string, classe: string): HTMLAnchorElement {
  const elemento = document.createElement('a');
  elemento.className = classe;
  elemento.href = url;
  elemento.target = '_blank';
  elemento.rel = 'noopener noreferrer';
  elemento.textContent = texto;
  return elemento;
}
