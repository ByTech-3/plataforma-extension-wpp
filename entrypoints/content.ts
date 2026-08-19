import { WhatsAppAdapter } from '../lib/whatsapp-adapter';
import { supabase } from '../lib/supabase';

export default defineContentScript({
  matches: ['*://web.whatsapp.com/*'],

  main() {
    const COR_PRIMARIA = '#2563EB';
    const NOME_MARCA = 'ByTech3';

    const iniciar = () => {
      if (document.getElementById('bytech-painel')) return;

      const painel = document.createElement('div');
      painel.id = 'bytech-painel';
      painel.style.cssText = `
        position: fixed; top: 0; right: 0;
        width: 300px; height: 100vh;
        background: #ffffff;
        border-left: 3px solid ${COR_PRIMARIA};
        box-shadow: -2px 0 12px rgba(0,0,0,0.12);
        z-index: 999999;
        font-family: -apple-system, system-ui, sans-serif;
        display: flex; flex-direction: column;
      `;

      const cabecalho = document.createElement('div');
      cabecalho.style.cssText = `
        background: ${COR_PRIMARIA}; color: #fff;
        padding: 16px; font-size: 16px; font-weight: 600;
      `;
      cabecalho.textContent = `${NOME_MARCA} CRM`;

      const corpo = document.createElement('div');
      corpo.id = 'bytech-corpo';
      corpo.style.cssText = `padding: 16px; color: #333; font-size: 14px; line-height: 1.5;`;
      corpo.textContent = 'Abra uma conversa para ver o contato.';

      // botão salvar
      const botao = document.createElement('button');
      botao.textContent = 'Salvar como lead';
      botao.style.cssText = `
        margin: 0 16px 16px 16px; padding: 12px;
        background: ${COR_PRIMARIA}; color: #fff;
        border: none; border-radius: 8px;
        font-size: 14px; font-weight: 600; cursor: pointer;
      `;

      // área de status (mensagem de sucesso/erro)
      const status = document.createElement('div');
      status.style.cssText = `padding: 0 16px 16px 16px; font-size: 13px;`;

      painel.appendChild(cabecalho);
      painel.appendChild(corpo);
      painel.appendChild(botao);
      painel.appendChild(status);
      document.body.appendChild(painel);

      const atualizarContato = () => {
        const contato = WhatsAppAdapter.getCurrentContact();
        if (contato.nome) {
          corpo.innerHTML = `
            <div style="font-size:12px;color:#888;margin-bottom:4px;">CONTATO ATUAL</div>
            <div style="font-size:18px;font-weight:600;color:#111;">${contato.nome}</div>
          `;
        } else {
          corpo.textContent = 'Abra uma conversa para ver o contato.';
        }
      };
      setInterval(atualizarContato, 1500);

      // ação do botão: grava o contato atual no Supabase
      botao.onclick = async () => {
        const contato = WhatsAppAdapter.getCurrentContact();
        if (!contato.nome) {
          status.style.color = '#c0392b';
          status.textContent = 'Nenhuma conversa aberta.';
          return;
        }

        status.style.color = '#888';
        status.textContent = 'Salvando...';

        const { error } = await supabase
          .from('leads')
          .insert({ nome: contato.nome, origem: 'WhatsApp direto' });

        if (error) {
          status.style.color = '#c0392b';
          status.textContent = 'Erro: ' + error.message;
          console.error('[ByTech3] Erro ao salvar:', error);
        } else {
          status.style.color = '#27ae60';
          status.textContent = `"${contato.nome}" salvo com sucesso!`;
        }
      };

      console.log('[ByTech3] Painel + Adapter + Supabase ativos.');
    };

    setTimeout(iniciar, 3000);
  },
});