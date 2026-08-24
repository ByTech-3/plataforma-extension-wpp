import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  manifest: {
    name: 'ByTech3 CRM para WhatsApp',
    description:
      'Vê e cadastra leads do seu CRM direto no WhatsApp Web, usando o mesmo login do app.',

    // `cookies` + host_permissions do app: é assim que a extensão lê a sessão
    // que o vendedor já criou no site. Sem a permissão de host o navegador
    // recusa a leitura, mesmo com `cookies` declarada.
    //
    // Nenhuma permissão a mais: sem `tabs`, sem `<all_urls>`, sem acesso ao
    // histórico. O que a extensão não precisa, ela não pede.
    permissions: ['cookies', 'storage'],

    host_permissions: [
      'https://plataforma-web-wpp.vercel.app/*',
      'http://localhost:3000/*',
      'https://*.supabase.co/*',
      // O envio pelo app precisa achar a aba do WhatsApp, navegar até a
      // conversa e falar com o content script dela. Com permissão de host, o
      // `tabs.query({url})` funciona SEM a permissão `tabs` — que daria acesso
      // ao título e à URL de todas as abas do vendedor, inclusive as que não
      // têm nada a ver com este produto.
      'https://web.whatsapp.com/*',
    ],
  },
});
