# ByTech3 CRM para WhatsApp (extensão)

Extensão de navegador que mostra o CRM dentro do WhatsApp Web. Feita com
[WXT](https://wxt.dev) + React, Manifest V3.

## Como ela reconhece o vendedor

O vendedor entra **uma vez no app web**. A extensão lê o cookie de sessão que o
app gravou (`sb-<ref>-auth-token`, no domínio do app) através da API
`browser.cookies`, e usa aquele JWT nas chamadas ao Supabase. Toda leitura e
escrita passa pela RLS com a identidade do vendedor: organização, papel e regra
de carteira valem exatamente como valem no site. A extensão não tem — e não
pode ter — nenhum poder a mais.

Três consequências que valem saber:

- **A extensão nunca renova a sessão.** O Supabase rotaciona refresh tokens; se
  a extensão renovasse por conta própria, a cópia guardada pelo app ficaria
  velha e o uso dela derrubaria o login do vendedor no meio do trabalho. Quando
  o token expira, a extensão convida a abrir o app — que renova sozinho — em vez
  de tentar renovar.
- **O JWT vive só no background.** O content script cuida da interface e pede os
  dados por mensagem. O token não é injetado no contexto da página do WhatsApp.
- **Sem sessão, a extensão não opera.** Mostra o convite para entrar, sem erro
  técnico na cara do usuário.

## Configuração

```bash
cp .env.example .env   # preencha com os dados do MESMO projeto Supabase do app
npm install
```

| Variável | Obrigatória | Para quê |
|---|---|---|
| `WXT_SUPABASE_URL` | sim | projeto Supabase |
| `WXT_SUPABASE_ANON_KEY` | sim | chave `anon` (nunca a `service_role`) |
| `WXT_APP_URL` | não | app de onde vem a sessão; sem ela, a produção |

## Desenvolvimento

```bash
npm run dev        # Chrome com a extensão carregada e recarga automática
npm run compile    # typecheck
npm run build      # build de produção em .output/chrome-mv3
npm run zip        # pacote para publicar
```

Para carregar um build manualmente: `chrome://extensions` → ativar o **modo do
desenvolvedor** → **Carregar sem compactação** → escolher `.output/chrome-mv3`.

## Permissões pedidas, e por quê

| Permissão | Por quê |
|---|---|
| `cookies` | ler a sessão que o vendedor já criou no app web |
| `storage` | lembrar se o painel estava aberto |
| host: app web | sem permissão de host, o navegador recusa a leitura do cookie |
| host: `*.supabase.co` | chamadas ao banco a partir do background |

Não pede `tabs`, não pede `<all_urls>`, não lê histórico. O que a extensão não
precisa, ela não pede — e uma extensão que roda no navegador do cliente é
revisada por essa lista antes de qualquer coisa.

## Estrutura

```
entrypoints/
  background.ts   dono da sessão; único que fala com o Supabase
  content.ts      interface dentro do WhatsApp (Shadow DOM), só desenha
  popup/          popup da barra: mostra o estado do login
lib/
  config.ts       URLs e variáveis
  sessao.ts       leitura do cookie do app (formato do @supabase/ssr)
  supabase.ts     cliente com o JWT do vendedor, sem persistir nem renovar
  mensagens.ts    contrato entre content script e background
  whatsapp-adapter.ts   ÚNICO lugar que conhece o DOM do WhatsApp
```

Se o WhatsApp mudar de layout, o conserto é no `whatsapp-adapter.ts` — e só
nele. Nenhum seletor de DOM do WhatsApp deve aparecer em outro arquivo.
