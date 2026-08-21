/**
 * Leitura da sessão do app web — o coração do "logue uma vez no site".
 *
 * POR QUE PELA API DE COOKIES, E NÃO POR `fetch(..., credentials: 'include')`:
 *   O app grava a sessão em cookie `SameSite=Lax` (padrão do @supabase/ssr).
 *   Lax só acompanha navegação de topo, então uma requisição disparada pela
 *   extensão para o domínio do app não tem garantia de levar o cookie junto.
 *   Já `browser.cookies` lê o pote de cookies direto: SameSite e httpOnly não
 *   se aplicam a ela. É a diferença entre depender de um detalhe de
 *   comportamento do navegador e usar a API feita para isto.
 *
 * POR QUE A EXTENSÃO NÃO RENOVA O TOKEN SOZINHA:
 *   O Supabase rotaciona refresh tokens. Se a extensão renovasse com o token
 *   que leu do cookie, o app ficaria com uma cópia velha — e o uso do token
 *   revogado derruba a sessão inteira. O vendedor seria deslogado do nada, no
 *   meio do trabalho. Então a extensão é LEITORA da sessão: quando o token
 *   expira, ela convida a abrir o app (que renova sozinho) em vez de tentar
 *   renovar por conta própria.
 *
 * Este módulo roda SÓ no background: é lá que o JWT deve viver, longe do
 * contexto da página do WhatsApp.
 */
import { APP_URL } from './config';

export type SessaoDoApp = {
  access_token: string;
  expires_at: number | null;
  usuario_id: string | null;
  email: string | null;
};

/** `sb-<ref>-auth-token`, com ou sem sufixo de pedaço (`.0`, `.1`, ...). */
const NOME_COOKIE = /^sb-.+-auth-token(\.(\d+))?$/;

const PREFIXO_BASE64 = 'base64-';

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
 * cada um é desescapado ANTES de juntar — juntar primeiro corromperia
 * caracteres partidos na fronteira.
 */
function juntarPedacos(cookies: { name: string; value: string }[]): string | null {
  const pedacos: { indice: number; valor: string }[] = [];

  for (const cookie of cookies) {
    const partes = cookie.name.match(NOME_COOKIE);
    if (!partes) continue;

    let valor = cookie.value;
    try {
      valor = decodeURIComponent(valor);
    } catch {
      // Valor sem escape: usa como veio.
    }

    pedacos.push({ indice: partes[2] ? Number(partes[2]) : 0, valor });
  }

  if (pedacos.length === 0) return null;

  return pedacos
    .sort((a, b) => a.indice - b.indice)
    .map((pedaco) => pedaco.valor)
    .join('');
}

/**
 * A sessão gravada pelo app, ou `null` quando não há login.
 *
 * Nunca lança por cookie ausente ou ilegível: sem sessão utilizável é um
 * estado normal do produto, não uma falha.
 */
export async function lerSessaoDoApp(): Promise<SessaoDoApp | null> {
  let cookies: { name: string; value: string }[];

  try {
    cookies = await browser.cookies.getAll({ url: APP_URL });
  } catch (erro) {
    console.warn('[ByTech3] Não foi possível ler os cookies do app.', erro);
    return null;
  }

  const bruto = juntarPedacos(cookies);
  if (!bruto) return null;

  const texto = bruto.startsWith(PREFIXO_BASE64)
    ? (() => {
        try {
          return deBase64Url(bruto.slice(PREFIXO_BASE64.length));
        } catch {
          return null;
        }
      })()
    : bruto;

  if (!texto) return null;

  try {
    const sessao = JSON.parse(texto) as {
      access_token?: string;
      expires_at?: number;
      user?: { id?: string; email?: string };
    };

    if (!sessao.access_token) return null;

    return {
      access_token: sessao.access_token,
      expires_at: sessao.expires_at ?? null,
      usuario_id: sessao.user?.id ?? null,
      email: sessao.user?.email ?? null,
    };
  } catch {
    // Cookie pela metade (o app estava gravando durante a leitura). Tratar
    // como ausente é melhor que operar com sessão corrompida.
    return null;
  }
}

/** Com 60s de folga: token que vence no meio da requisição não serve. */
export function estaExpirada(sessao: SessaoDoApp): boolean {
  if (!sessao.expires_at) return false;
  return sessao.expires_at * 1000 <= Date.now() + 60_000;
}
