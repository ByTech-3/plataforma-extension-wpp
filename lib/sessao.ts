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
 * POR QUE POR `get` COM NOME DERIVADO, E NÃO POR `getAll`:
 *   Achado em campo, não preferência de estilo. Num Chrome real, com a
 *   permissão de API e a de host as duas concedidas (confirmado por
 *   `permissions.contains`), um único cookie store e o cookie presente no
 *   navegador, `getAll` devolveu lista vazia em TODOS os filtros — url,
 *   domain, sem filtro e por storeId — enquanto `get` com o nome exato
 *   devolveu o cookie de 3180 caracteres na hora. As duas chamadas percorrem
 *   caminhos diferentes na implementação do Chrome, e só a enumeração falhou.
 *
 *   Como o nome do cookie é derivável do ref do projeto Supabase, não há
 *   motivo para depender da listagem para descobrir o que já se sabe.
 *   `getAll` continua como rede de segurança, nunca como caminho principal.
 *
 * POR QUE A EXTENSÃO NÃO RENOVA O TOKEN:
 *   O Supabase rotaciona refresh tokens. Se a extensão renovasse com o token
 *   que leu do cookie, o app ficaria com uma cópia velha — e o uso do token
 *   revogado derruba a sessão inteira. Então a extensão é LEITORA da sessão.
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

/** `sb-<ref>-auth-token`, com ou sem sufixo de pedaço (`.0`, `.1`, ...). */
const NOME_COOKIE = /^sb-.+-auth-token(\.(\d+))?$/;

const PREFIXO_BASE64 = 'base64-';

/**
 * Teto de pedaços. O @supabase/ssr fatia em 3180 chars, então 10 pedaços são
 * ~31 KB — muitas vezes maior que qualquer sessão real. Existe para o laço não
 * girar sem fim se o `get` passar a devolver algo inesperado.
 */
const MAX_PEDACOS = 10;

type CookieLido = { name: string; value: string };

/** `https://<ref>.supabase.co` -> `sb-<ref>-auth-token`. */
function nomeBaseDoCookie(): string | null {
  const ref = SUPABASE_URL.match(/^https?:\/\/([^.]+)\./)?.[1];
  return ref ? `sb-${ref}-auth-token` : null;
}

async function pegarCookie(nome: string): Promise<CookieLido | null> {
  try {
    return ((await browser.cookies.get({ url: APP_URL, name: nome })) as CookieLido) ?? null;
  } catch {
    return null;
  }
}

/** CAMINHO PRINCIPAL: cada cookie buscado pelo nome exato. */
async function lerPorNomeDerivado(): Promise<CookieLido[] | null> {
  const base = nomeBaseDoCookie();
  if (!base) return null;

  // Formato não fatiado: hoje o Supabase sempre fatia, mas isso é detalhe de
  // implementação deles, não contrato.
  const inteiro = await pegarCookie(base);
  if (inteiro?.value) return [inteiro];

  const pedacos: CookieLido[] = [];
  for (let indice = 0; indice < MAX_PEDACOS; indice += 1) {
    const pedaco = await pegarCookie(`${base}.${indice}`);
    if (!pedaco?.value) break;
    pedacos.push(pedaco);
  }

  return pedacos.length > 0 ? pedacos : null;
}

/** REDE DE SEGURANÇA: só para quando o nome não é derivável. */
async function lerPorEnumeracao(): Promise<CookieLido[]> {
  if (!browser.cookies?.getAll) return [];

  for (const filtro of [{ url: APP_URL }, {}]) {
    try {
      const cookies = (await browser.cookies.getAll(filtro)) as CookieLido[];
      if (cookies.some((cookie) => NOME_COOKIE.test(cookie.name))) return cookies;
    } catch {
      // Filtro seguinte.
    }
  }

  return [];
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
 * Junta os pedaços na ordem certa.
 *
 * Cada pedaço é gravado com escape próprio, então cada um é desescapado ANTES
 * de juntar.
 */
function juntarPedacos(cookies: CookieLido[]): string | null {
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
 * A sessão gravada pelo app, ou `null` quando não há login utilizável.
 *
 * Nunca lança: sem sessão é estado normal do produto, não falha. Só registra
 * no console o que for falha de verdade — cookie ilegível, JSON corrompido —,
 * nunca o caso comum de não haver login.
 */
export async function lerSessaoDoApp(): Promise<SessaoDoApp | null> {
  if (!browser?.cookies?.get) {
    console.warn('[ByTech3] browser.cookies indisponível — permissão "cookies" ausente.');
    return null;
  }

  const cookies = (await lerPorNomeDerivado()) ?? (await lerPorEnumeracao());
  if (cookies.length === 0) return null;

  const bruto = juntarPedacos(cookies);
  if (!bruto) return null;

  let texto: string | null = bruto;
  if (bruto.startsWith(PREFIXO_BASE64)) {
    try {
      texto = deBase64Url(bruto.slice(PREFIXO_BASE64.length));
    } catch (erro) {
      console.warn('[ByTech3] cookie de sessão ilegível (base64).', erro);
      texto = null;
    }
  }

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
