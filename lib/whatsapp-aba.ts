/**
 * Comando da aba do WhatsApp a partir do service worker.
 *
 * O trabalho de DOM em si é todo da WhatsAppAdapter, no content script. Este
 * arquivo só acha a aba certa, garante que a conversa pedida está aberta e
 * encaminha a ordem.
 */
import type { MensagemLida, PedidoPonte, RespostaPonte } from './mensagens';

const URL_WHATSAPP = '*://web.whatsapp.com/*';

/** Quanto esperar a conversa abrir depois de mandar a aba navegar. */
const ESPERA_MAXIMA_MS = 20_000;
const INTERVALO_TENTATIVA_MS = 700;

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

type OrdemParaAba =
  | { tipo: 'whatsapp/conversa-aberta-e'; telefone: string }
  | { tipo: 'whatsapp/abrir-conversa'; telefone: string }
  | { tipo: 'whatsapp/ler-mensagens' }
  | { tipo: 'whatsapp/enviar-mensagem'; texto: string };

async function mandarParaAba<T>(tabId: number, ordem: OrdemParaAba): Promise<T | null> {
  try {
    return (await browser.tabs.sendMessage(tabId, ordem)) as T;
  } catch {
    // Aba recarregando: o content script ainda não está escutando.
    return null;
  }
}

/** A primeira aba do WhatsApp Web, ou `null` se não houver nenhuma. */
async function acharAba(): Promise<number | null> {
  try {
    const abas = await browser.tabs.query({ url: URL_WHATSAPP });
    return abas[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Garante que a conversa do telefone está aberta na aba.
 *
 * Se já estiver, não faz nada. Se a aba estiver em OUTRA conversa, navega até
 * a certa — a decisão do produto foi levar o vendedor até lá em vez de recusar
 * e mandar ele procurar. Navegar recarrega o WhatsApp Web, por isso a espera
 * generosa: é a página inteira subindo de novo.
 */
async function garantirConversa(
  tabId: number,
  telefone: string,
): Promise<{ ok: boolean; navegou: boolean; recarregou: boolean }> {
  // Caminho normal: a própria página abre a conversa, clicando na lista ou
  // usando a busca interna. Nada recarrega, e leva menos de um segundo.
  const abertura = await mandarParaAba<'ja-aberta' | 'aberta' | 'nao-encontrada'>(tabId, {
    tipo: 'whatsapp/abrir-conversa',
    telefone,
  });

  if (abertura === 'ja-aberta') return { ok: true, navegou: false, recarregou: false };
  if (abertura === 'aberta') return { ok: true, navegou: true, recarregou: false };

  // ÚLTIMO RECURSO: contato com quem nunca se conversou não existe na lista
  // nem na busca — só o link `?phone=` cria a conversa. Isso RECARREGA o
  // WhatsApp Web, então só acontece quando não há outro caminho.
  const digitos = telefone.replace(/\D/g, '');
  await browser.tabs.update(tabId, { url: `https://web.whatsapp.com/send?phone=${digitos}` });

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
