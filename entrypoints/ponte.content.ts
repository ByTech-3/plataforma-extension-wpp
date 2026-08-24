/**
 * Ponte entre o app web e a extensão.
 *
 * O app roda em plataforma-web-wpp.vercel.app e a extensão trabalha em
 * web.whatsapp.com — origens diferentes, sem canal direto. Este content script
 * roda NAS PÁGINAS DO APP e repassa os pedidos ao service worker, que fala com
 * a aba do WhatsApp.
 *
 * POR QUE ASSIM, E NÃO POR `externally_connectable`:
 *   Aquele mecanismo exige o ID da extensão fixado no código do app. O ID muda
 *   entre a versão carregada sem compactação e a publicada na Chrome Web Store,
 *   então o app teria um valor que quebra dependendo de como a extensão foi
 *   instalada. Aqui não há ID nenhum: se a extensão estiver instalada, ela
 *   responde; se não estiver, o app não recebe resposta e diz isso ao vendedor.
 *
 * SEGURANÇA: só aceita mensagens da PRÓPRIA janela (`event.source === window`)
 * e com a marca do app. Um iframe de terceiro na página não consegue pedir
 * envio de mensagem em nome do vendedor.
 */
import type { PedidoPonte, RespostaPonte } from '../lib/mensagens';

const MARCA_APP = 'bytech3-app';
const MARCA_EXTENSAO = 'bytech3-extensao';

type Envelope = {
  fonte: typeof MARCA_APP;
  id: string;
  pedido: PedidoPonte;
};

export default defineContentScript({
  // As mesmas origens declaradas em host_permissions: produção e a máquina do
  // desenvolvedor.
  matches: ['https://plataforma-web-wpp.vercel.app/*', 'http://localhost:3000/*'],

  main() {
    window.addEventListener('message', (evento) => {
      if (evento.source !== window) return;

      const dados = evento.data as Envelope | null;
      if (!dados || dados.fonte !== MARCA_APP || typeof dados.id !== 'string') return;

      responder(dados.id, dados.pedido);
    });

    // Avisa a página de que a extensão está presente. O app usa isto para
    // mostrar "enviar pelo WhatsApp" só quando há como enviar.
    window.postMessage({ fonte: MARCA_EXTENSAO, id: 'presenca', resposta: { estado: 'ok' } }, '*');
  },
});

async function responder(id: string, pedido: PedidoPonte): Promise<void> {
  let resposta: RespostaPonte;

  try {
    resposta = (await browser.runtime.sendMessage({
      tipo: 'ponte',
      pedido,
    })) as RespostaPonte;
  } catch {
    // Extensão atualizada com a aba do app aberta: o canal morreu.
    resposta = {
      estado: 'erro',
      mensagem: 'A extensão foi atualizada. Recarregue esta página para continuar.',
    };
  }

  window.postMessage({ fonte: MARCA_EXTENSAO, id, resposta }, '*');
}
