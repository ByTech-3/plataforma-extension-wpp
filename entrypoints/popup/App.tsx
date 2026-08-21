/**
 * Popup da barra de ferramentas.
 *
 * Mesma pergunta do painel do WhatsApp, feita ao mesmo background: "estou
 * conectado?". Serve para o vendedor conferir o login sem precisar abrir o
 * WhatsApp Web.
 */
import { useCallback, useEffect, useState } from 'react';
import { URL_CRM, URL_LOGIN } from '@/lib/config';
import type { EstadoSessao } from '@/lib/mensagens';
import './App.css';

const ROTULO_PAPEL: Record<string, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  vendedor: 'Vendedor',
};

function App() {
  const [estado, setEstado] = useState<EstadoSessao | null>(null);

  const verificar = useCallback(async () => {
    setEstado(null);
    try {
      setEstado((await browser.runtime.sendMessage({ tipo: 'sessao/estado' })) as EstadoSessao);
    } catch {
      setEstado({
        estado: 'erro',
        mensagem: 'A extensão precisa ser recarregada.',
      });
    }
  }, []);

  useEffect(() => {
    void verificar();
  }, [verificar]);

  return (
    <div className="painel">
      <header className="cabecalho">ByTech3 CRM</header>
      <div className="corpo">{conteudo(estado, verificar)}</div>
    </div>
  );
}

function conteudo(estado: EstadoSessao | null, verificar: () => void) {
  if (!estado) return <p className="fraco">Verificando seu login…</p>;

  if (estado.estado === 'conectada') {
    return (
      <>
        <Dado rotulo="Conectado como" valor={estado.email ?? 'vendedor'} />
        <Dado rotulo="Organização" valor={estado.organizacao.nome} />
        <Dado
          rotulo="Seu acesso"
          valor={ROTULO_PAPEL[estado.organizacao.papel] ?? estado.organizacao.papel}
        />

        {!estado.organizacao.acesso_ativo && (
          <p className="aviso">
            O período de teste terminou. Você continua vendo os dados, mas gravações são recusadas
            pelo servidor.
          </p>
        )}

        <a className="acao" href={URL_CRM} target="_blank" rel="noopener noreferrer">
          Abrir o CRM
        </a>
      </>
    );
  }

  if (estado.estado === 'sem-sessao' || estado.estado === 'expirada') {
    const primeiraVez = estado.estado === 'sem-sessao';
    return (
      <>
        <p>
          {primeiraVez
            ? 'Entre no ByTech3 para usar a extensão no WhatsApp.'
            : 'Sua sessão expirou. Abra o ByTech3 para reconectar.'}
        </p>
        <a
          className="acao"
          href={primeiraVez ? URL_LOGIN : URL_CRM}
          target="_blank"
          rel="noopener noreferrer"
        >
          {primeiraVez ? 'Entrar no ByTech3' : 'Reconectar'}
        </a>
        <button type="button" className="secundaria" onClick={verificar}>
          Verificar de novo
        </button>
      </>
    );
  }

  if (estado.estado === 'sem-organizacao') {
    return (
      <>
        <p>Sua conta ainda não faz parte de uma organização.</p>
        <a className="acao" href={URL_CRM} target="_blank" rel="noopener noreferrer">
          Concluir cadastro
        </a>
      </>
    );
  }

  return (
    <>
      <p className="erro">{estado.mensagem}</p>
      <button type="button" className="secundaria" onClick={verificar}>
        Tentar de novo
      </button>
    </>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="bloco">
      <div className="rotulo">{rotulo}</div>
      <div className="valor">{valor}</div>
    </div>
  );
}

export default App;
