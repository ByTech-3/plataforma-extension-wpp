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

    // NÃO acrescente hosts aqui sem necessidade real. Quando uma extensão JÁ
    // INSTALADA ganha um host novo, o Chrome RETÉM todo o conjunto até o
    // usuário reautorizar — e nesse estado `cookies.get` devolve nulo sem
    // erro, fazendo a extensão parecer deslogada. Foi exatamente isso que
    // aconteceu quando `web.whatsapp.com` entrou aqui no bloco E.
    //
    // O WhatsApp saiu da lista: falar com a aba dele não precisa de permissão
    // de host, porque o nosso content script já roda lá (declarado em
    // `content_scripts`). Quem descobre a aba é o próprio content script, que
    // se apresenta ao background — não o `tabs.query({url})`, que era o único
    // motivo da permissão.
    host_permissions: [
      'https://plataforma-web-wpp.vercel.app/*',
      'http://localhost:3000/*',
      'https://*.supabase.co/*',
    ],
  },
});
