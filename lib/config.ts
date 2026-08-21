/**
 * Configuração da extensão.
 *
 * O app web é a origem da sessão: é dele que a extensão lê o cookie de login e
 * é para ele que o vendedor é mandado quando não há sessão. A URL precisa
 * estar em `host_permissions` no wxt.config.ts, senão o navegador recusa a
 * leitura do cookie.
 */

const APP_URL_PADRAO = 'https://plataforma-web-wpp.vercel.app';

function semBarraFinal(url: string) {
  return url.replace(/\/+$/, '');
}

export const APP_URL = semBarraFinal(import.meta.env.WXT_APP_URL || APP_URL_PADRAO);

export const SUPABASE_URL = import.meta.env.WXT_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.WXT_SUPABASE_ANON_KEY;

export const URL_LOGIN = `${APP_URL}/login`;
export const URL_CRM = `${APP_URL}/crm`;

export function urlDoLead(leadId: string) {
  return `${APP_URL}/crm/${leadId}`;
}

/** Falta de configuração é erro de instalação, não de uso. Falha cedo e claro. */
export function conferirConfiguracao(): string | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return (
      'Extensão sem configuração: defina WXT_SUPABASE_URL e WXT_SUPABASE_ANON_KEY ' +
      'no arquivo .env da extensão e gere o build de novo.'
    );
  }
  return null;
}
