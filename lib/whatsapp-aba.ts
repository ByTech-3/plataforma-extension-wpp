/**
 * Comando da aba do WhatsApp a partir do service worker.
 *
 * O trabalho de DOM em si é todo da WhatsAppAdapter, no content script. Este
 * arquivo só acha a aba certa e encaminha a ordem.
 *
 * POR QUE UM REGISTRO DE ABAS, E NÃO `tabs.query({url})`:
 *   O filtro por URL do `tabs.query` exige permissão de host para aquele
 *   endereço. Foi por causa dessa permissão — acrescentada ao manifest depois
 *   que a extensão já estava instalada — que o Chrome reteve TODAS as
 *   permissões de host e a leitura da sessão parou de funcionar.
 *
 *   Aqui a aba se apresenta: o content script do WhatsApp avisa o background
 *   quando carrega, e o id fica guardado. Falar com uma aba onde o NOSSO
 *   content script já roda não exige permissão nenhuma além da própria
 *   injeção, que já está declarada em `content_scripts`.
 *
 *   Menos uma permissão no manifest, uma causa de falha a menos, e uma
 *   revisão mais simples na Chrome Web Store.
 */
import type { MensagemLida, PedidoPonte, RespostaPonte } from './mensagens';

/** Quanto esperar a conversa abrir quando foi preciso recarregar a página. */
const ESPERA_MAXIMA_MS = 20_000;
const INTERVALO_TENTATIVA_MS = 700;

/**
 * `storage.session` sobrevive à hibernação do service worker (que acontece a
 * cada poucos segundos de ociosidade) e é limpo ao fechar o navegador — que é
 * exatamente o tempo de vida de uma aba aberta.
 */
const CHAVE_ABAS = 'abas_whatsapp';

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

type OrdemParaAba =
  | { tipo: 'whatsapp/conversa-aberta-e'; telefone: string }
  | { tipo: 'whatsapp/abrir-conversa'; telefone: string }
  | { tipo: 'whatsapp/navegar-para'; telefone: string }
  | { tipo: 'whatsapp/ler-mensagens' }
  | { tipo: 'whatsapp/enviar-mensagem'; texto: string };

async function abasConhecidas(): Promise<number[]> {
  try {
    const guardado = await browser.storage.session.get(CHAVE_ABAS);
    const ids = guardado[CHAVE_ABAS];
    return Array.isArray(ids) ? (ids as number[]) : [];
  } catch {
    return [];
  }
}

async function guardarAbas(ids: number[]): Promise<void> {
  try {
    await browser.storage.session.set({ [CHAVE_ABAS]: [...new Set(ids)] });
  } catch {
    // Sem registro, a próxima carga da aba do WhatsApp reapresenta.
  }
}

/** O content script do WhatsApp avisa que está de pé nesta aba. */
export async function registrarAba(tabId: number): Promise<void> {
  const ids = await abasConhecidas();
  if (!ids.includes(tabId)) await guardarAbas([...ids, tabId]);
}

async function esquecerAba(tabId: number): Promise<void> {
  const ids = await abasConhecidas();
  await guardarAbas(ids.filter((id) => id !== tabId));
}

async function mandarParaAba<T>(tabId: number, ordem: OrdemParaAba): Promise<T | null> {
  try {
    return (await browser.tabs.sendMessage(tabId, ordem)) as T;
  } catch {
    // Aba fechada, recarregando, ou content script ainda não escutando.
    return null;
  }
}

/**
 * A primeira aba do WhatsApp que ainda responde.
 *
 * Testar em vez de confiar no registro: aba fechada continua no storage até
 * alguém tentar falar com ela.
 */
async function acharAba(): Promise<number | null> {
  for (const tabId of await abasConhecidas()) {
    const vivo = await mandarParaAba<boolean>(tabId, { tipo: 'whatsapp/conversa-aberta-e', telefone: '' });
    // `false` é resposta válida (não é a conversa pedida); `null` é silêncio.
    if (vivo !== null) return tabId;
    await esquecerAba(tabId);
  }

  return null;
}

/**
 * Garante que a conversa do telefone está aberta na aba.
 *
 * Ordem: já aberta > clique na lista > busca interna > recarregar. As três
 * primeiras acontecem dentro da própria página, sem recarregar nada.
 */
async function garantirConversa(
  tabId: number,
  telefone: string,
): Promise<{ ok: boolean; navegou: boolean; recarregou: boolean }> {
  const abertura = await mandarParaAba<'ja-aberta' | 'aberta' | 'nao-encontrada'>(tabId, {
    tipo: 'whatsapp/abrir-conversa',
    telefone,
  });

  if (abertura === 'ja-aberta') return { ok: true, navegou: false, recarregou: false };
  if (abertura === 'aberta') return { ok: true, navegou: true, recarregou: false };

  // ÚLTIMO RECURSO: contato com quem nunca se conversou não existe na lista
  // nem na busca — só o link `?phone=` cria a conversa, e isso RECARREGA o
  // WhatsApp Web. Quem navega é a própria página, não `tabs.update`: assim
  // não é preciso permissão de host para a aba.
  await mandarParaAba(tabId, { tipo: 'whatsapp/navegar-para', telefone });

  const limite = Date.now() + ESPERA_MAXIMA_MS;
  while (Date.now() < limite) {
    await esperar(INTERVALO_TENTATIVA_MS);

    const abriu = await mandarParaAba<boolean>(tabId, {
      tipo: 'whatsapp/conversa-aberta-e',
      telefone,
    });

    if (abriu === true) return { ok: true, navegou: true, recarregou: true };
  }

  return { ok: false, navegou: true, recarregou: true };
}

export async function atenderPonte(pedido: PedidoPonte): Promise<RespostaPonte> {
  const tabId = await acharAba();
  if (tabId === null) return { estado: 'sem-aba' };

  if (pedido.tipo === 'whatsapp/status') {
    return { estado: 'ok' };
  }

  const conversa = await garantirConversa(tabId, pedido.telefone);
  if (!conversa.ok) return { estado: 'conversa-nao-abriu' };

  if (pedido.tipo === 'whatsapp/ler') {
    const mensagens = await mandarParaAba<MensagemLida[]>(tabId, {
      tipo: 'whatsapp/ler-mensagens',
    });

    return {
      estado: 'ok',
      mensagens: mensagens ?? [],
      navegou: conversa.navegou,
      recarregou: conversa.recarregou,
    };
  }

  const envio = await mandarParaAba<{ ok: boolean; erro?: string }>(tabId, {
    tipo: 'whatsapp/enviar-mensagem',
    texto: pedido.texto,
  });

  if (!envio) {
    return { estado: 'erro', mensagem: 'A aba do WhatsApp não respondeu. Tente de novo.' };
  }
  if (!envio.ok) {
    return { estado: 'erro', mensagem: envio.erro ?? 'Não foi possível enviar a mensagem.' };
  }

  return { estado: 'ok', navegou: conversa.navegou, recarregou: conversa.recarregou };
}
