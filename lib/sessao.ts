/**
 * Leitura da sessão do app web — o coração do "logue uma vez no site".
 *
 * POR QUE PELA API DE COOKIES, E NÃO POR `fetch(..., credentials: 'include')`:
 *   O app grava a sessão em cookie `SameSite=Lax` (padrão do @supabase/ssr).
 *   Lax só acompanha navegação de topo, então uma requisição disparada pela
 *   extensão para o domínio do app não tem garantia de levar o cookie junto.
 *   Já `browser.cookies` lê o pote de cookies direto: SameSite e httpOnly não
 *   se aplicam a ela.
 *
 * POR QUE A EXTENSÃO NÃO RENOVA O TOKEN:
 *   O Supabase rotaciona refresh tokens. Se a extensão renovasse com o token
 *   que leu do cookie, o app ficaria com uma cópia velha — e o uso do token
 *   revogado derruba a sessão inteira. Então a extensão é LEITORA da sessão.
 *
 * DIAGNÓSTICO: cada etapa registra o que encontrou. Só nomes, contagens e
 * tamanhos — NUNCA o valor do cookie nem o token, que dariam a sessão inteira
 * a quem lesse o console.
 *
 * Este módulo roda SÓ no background: é lá que o JWT deve viver.
 */
import { APP_URL, SUPABASE_URL } from './config';

export type SessaoDoApp = {
  access_token: string;
  expires_at: number | null;
  usuario_id: string | null;
  email: string | null;
};

export type LeituraSessao = {
  sessao: SessaoDoApp | null;
  diagnostico: string[];
};

/** `sb-<ref>-auth-token`, com ou sem sufixo de pedaço (`.0`, `.1`, ...). */
const NOME_COOKIE = /^sb-.+-auth-token(\.(\d+))?$/;

const PREFIXO_BASE64 = 'base64-';

type CookieLido = { name: string; value: string; domain?: string; path?: string };

/**
 * A permissão está DECLARADA no manifest e CONCEDIDA em runtime?
 *
 * São coisas diferentes, e a diferença é invisível no comportamento: com a
 * permissão de host retida, `chrome.cookies` continua existindo e o `getAll`
 * devolve lista vazia — sem erro, sem aviso. É exatamente o sintoma que
 * estamos investigando, então vale medir em vez de supor.
 */
async function conferirPermissoes(diagnostico: string[]): Promise<void> {
  const manifest = browser.runtime.getManifest() as {
    permissions?: string[];
    host_permissions?: string[];
  };

  diagnostico.push(
    `manifest carregado: permissions=[${(manifest.permissions ?? []).join(', ')}] | ` +
      `host_permissions=[${(manifest.host_permissions ?? []).join(', ')}]`,
  );

  if (!browser.permissions?.contains) {
    diagnostico.push('browser.permissions indisponível — não dá para conferir concessão');
    return;
  }

  // Separadas de propósito: juntas, um `false` não diria QUAL das duas faltou.
  try {
    const api = await browser.permissions.contains({ permissions: ['cookies'] });
    diagnostico.push(`permissão de API "cookies" concedida: ${api}`);
  } catch (erro) {
    diagnostico.push(`contains(cookies) LANÇOU: ${erro instanceof Error ? erro.message : erro}`);
  }

  try {
    const host = await browser.permissions.contains({ origins: [`${APP_URL}/*`] });
    diagnostico.push(`permissão de host "${APP_URL}/*" concedida: ${host}`);
  } catch (erro) {
    diagnostico.push(`contains(origins) LANÇOU: ${erro instanceof Error ? erro.message : erro}`);
  }
}

/**
 * Procura o cookie pelo nome exato, deduzido da URL do Supabase
 * (`https://<ref>.supabase.co` -> `sb-<ref>-auth-token`).
 *
 * `getAll` e `get` percorrem caminhos diferentes na implementação do Chrome.
 * Se a busca por nome achar o que a listagem não achou, o problema é de
 * enumeração; se nenhuma das duas achar, é de acesso ao pote.
 */
async function sondarNomeExato(diagnostico: string[]): Promise<void> {
  const ref = SUPABASE_URL.match(/^https?:\/\/([^.]+)\./)?.[1];
  if (!ref) {
    diagnostico.push(`não foi possível deduzir o ref do projeto a partir de ${SUPABASE_URL}`);
    return;
  }

  const base = `sb-${ref}-auth-token`;

  for (const nome of [base, `${base}.0`]) {
    try {
      const cookie = await browser.cookies.get({ url: APP_URL, name: nome });
      diagnostico.push(
        `get(name=${nome}): ${cookie ? `ENCONTRADO (${cookie.value?.length ?? 0} chars)` : 'null'}`,
      );
    } catch (erro) {
      diagnostico.push(
        `get(name=${nome}) LANÇOU: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
    }
  }
}

/** Potes de cookies visíveis. Mais de um = perfis/contextos distintos. */
async function listarCookieStores(diagnostico: string[]): Promise<string[]> {
  if (!browser.cookies?.getAllCookieStores) {
    diagnostico.push('getAllCookieStores indisponível');
    return [];
  }

  try {
    const stores = (await browser.cookies.getAllCookieStores()) as {
      id: string;
      tabIds: number[];
    }[];

    diagnostico.push(
      `cookie stores: ${stores.length} — ` +
        stores.map((store) => `id=${store.id} (${store.tabIds?.length ?? 0} aba(s))`).join(', '),
    );

    return stores.map((store) => store.id);
  } catch (erro) {
    diagnostico.push(
      `getAllCookieStores LANÇOU: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
    return [];
  }
}

/** base64url -> texto, respeitando UTF-8 (nome com acento não pode quebrar). */
function deBase64Url(valor: string): string {
  const normalizado = valor.replace(/-/g, '+').replace(/_/g, '/');
  const preenchido = normalizado + '='.repeat((4 - (normalizado.length % 4)) % 4);
  const binario = atob(preenchido);
  const bytes = Uint8Array.from(binario, (caractere) => caractere.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Junta os pedaços do cookie na ordem certa.
 *
 * O @supabase/ssr quebra a sessão em `nome.0`, `nome.1`... quando ela passa do
 * tamanho máximo de um cookie. Cada pedaço é gravado com escape próprio, então
 * cada um é desescapado ANTES de juntar.
 */
function juntarPedacos(cookies: CookieLido[], diagnostico: string[]): string | null {
  const pedacos: { indice: number; valor: string }[] = [];

  for (const cookie of cookies) {
    const partes = cookie.name.match(NOME_COOKIE);
    if (!partes) continue;

    let valor = cookie.value;
    try {
      valor = decodeURIComponent(valor);
    } catch {
      diagnostico.push(`aviso: "${cookie.name}" não pôde ser desescapado; usando valor cru`);
    }

    pedacos.push({ indice: partes[2] ? Number(partes[2]) : 0, valor });
  }

  if (pedacos.length === 0) {
    diagnostico.push('nenhum cookie com nome sb-<ref>-auth-token entre os visíveis');
    return null;
  }

  const ordenados = pedacos.sort((a, b) => a.indice - b.indice);
  diagnostico.push(
    `pedaços da sessão: ${ordenados.length} (${ordenados
      .map((pedaco) => `.${pedaco.indice}=${pedaco.valor.length} chars`)
      .join(', ')})`,
  );

  return ordenados.map((pedaco) => pedaco.valor).join('');
}

/**
 * Busca os cookies em camadas.
 *
 * `getAll({url})` aplica casamento de caminho e de flag `secure`; `{domain}` é
 * mais frouxo; e a varredura final mostra TUDO que a extensão consegue
 * enxergar — que é só o dos hosts declarados em `host_permissions`, nunca o
 * navegador inteiro. Serve para separar três causas que produzem o mesmo
 * sintoma: permissão negada, domínio errado e cookie inexistente.
 */
async function buscarCookies(diagnostico: string[]): Promise<CookieLido[] | null> {
  if (!browser?.cookies?.getAll) {
    diagnostico.push('ERRO: browser.cookies indisponível — permissão "cookies" ausente no manifest');
    return null;
  }

  const hostname = (() => {
    try {
      return new URL(APP_URL).hostname;
    } catch {
      return null;
    }
  })();

  diagnostico.push(`APP_URL = ${APP_URL}${hostname ? ` (host ${hostname})` : ' (URL INVÁLIDA)'}`);

  await conferirPermissoes(diagnostico);
  await sondarNomeExato(diagnostico);
  const stores = await listarCookieStores(diagnostico);

  // Varredura por store: se os cookies existirem em OUTRO pote que não o
  // consultado por padrão, é aqui que eles aparecem — e o log diz em qual.
  for (const store of stores) {
    try {
      const doStore = (await browser.cookies.getAll({ storeId: store })) as CookieLido[];
      const daSessao = doStore.filter((cookie) => NOME_COOKIE.test(cookie.name));
      diagnostico.push(
        `getAll(storeId=${store}): ${doStore.length} cookie(s) | de sessão: ${daSessao.length}`,
      );
      if (daSessao.length > 0) return doStore;
    } catch (erro) {
      diagnostico.push(
        `getAll(storeId=${store}) LANÇOU: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
    }
  }

  const tentativas: { rotulo: string; filtro: Record<string, string> }[] = [
    { rotulo: 'url', filtro: { url: APP_URL } },
    ...(hostname ? [{ rotulo: 'domain', filtro: { domain: hostname } }] : []),
    { rotulo: 'todos os hosts permitidos', filtro: {} },
  ];

  for (const tentativa of tentativas) {
    let cookies: CookieLido[];
    try {
      cookies = (await browser.cookies.getAll(tentativa.filtro)) as CookieLido[];
    } catch (erro) {
      diagnostico.push(
        `getAll(${tentativa.rotulo}) LANÇOU: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      continue;
    }

    const nomes = cookies.map((cookie) => cookie.name);
    const daSessao = nomes.filter((nome) => NOME_COOKIE.test(nome));

    diagnostico.push(
      `getAll(${tentativa.rotulo}): ${cookies.length} cookie(s)` +
        (nomes.length > 0 ? ` [${nomes.slice(0, 12).join(', ')}]` : '') +
        ` | de sessão: ${daSessao.length}`,
    );

    if (daSessao.length > 0) return cookies;
  }

  return [];
}

/**
 * A sessão gravada pelo app, ou `null` quando não há login utilizável.
 *
 * Nunca lança: sem sessão é estado normal do produto, não falha.
 */
export async function lerSessaoDoApp(): Promise<LeituraSessao> {
  const diagnostico: string[] = [];

  const cookies = await buscarCookies(diagnostico);
  if (!cookies || cookies.length === 0) {
    return { sessao: null, diagnostico };
  }

  const bruto = juntarPedacos(cookies, diagnostico);
  if (!bruto) return { sessao: null, diagnostico };

  const temPrefixo = bruto.startsWith(PREFIXO_BASE64);
  diagnostico.push(
    `valor remontado: ${bruto.length} chars | prefixo base64-: ${temPrefixo ? 'sim' : 'não'}`,
  );

  let texto: string | null = bruto;
  if (temPrefixo) {
    try {
      texto = deBase64Url(bruto.slice(PREFIXO_BASE64.length));
      diagnostico.push(`base64url decodificado: ${texto.length} chars`);
    } catch (erro) {
      diagnostico.push(
        `ERRO ao decodificar base64url: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      texto = null;
    }
  }

  if (!texto) return { sessao: null, diagnostico };

  try {
    const sessao = JSON.parse(texto) as {
      access_token?: string;
      expires_at?: number;
      user?: { id?: string; email?: string };
    };

    if (!sessao.access_token) {
      diagnostico.push(`JSON válido, mas SEM access_token. Campos: ${Object.keys(sessao).join(', ')}`);
      return { sessao: null, diagnostico };
    }

    const expiraEm = sessao.expires_at ? new Date(sessao.expires_at * 1000).toISOString() : 'sem data';
    diagnostico.push(
      `sessão lida: access_token com ${sessao.access_token.length} chars | expira ${expiraEm} | ` +
        `usuário ${sessao.user?.email ?? 'sem e-mail'}`,
    );

    return {
      sessao: {
        access_token: sessao.access_token,
        expires_at: sessao.expires_at ?? null,
        usuario_id: sessao.user?.id ?? null,
        email: sessao.user?.email ?? null,
      },
      diagnostico,
    };
  } catch (erro) {
    // Cookie pela metade (o app estava gravando durante a leitura). Tratar
    // como ausente é melhor que operar com sessão corrompida.
    diagnostico.push(
      `ERRO no JSON.parse: ${erro instanceof Error ? erro.message : String(erro)} | ` +
        `início do texto: ${texto.slice(0, 40)}`,
    );
    return { sessao: null, diagnostico };
  }
}

/** Com 60s de folga: token que vence no meio da requisição não serve. */
export function estaExpirada(sessao: SessaoDoApp): boolean {
  if (!sessao.expires_at) return false;
  return sessao.expires_at * 1000 <= Date.now() + 60_000;
}
