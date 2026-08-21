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
import { APP_URL } from './config';

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
