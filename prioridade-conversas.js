/**
 * Sistema de Prioridade de Conversas
 * 
 * Quando cliente clica em "Falar com atendente", a conversa precisa ficar no topo.
 * 
 * Estratégias implementadas:
 * 1. Enviar mensagem imediata (faz conversa subir)
 * 2. Enviar follow-up após 30s (mantém conversa ativa)
 * 3. Marcar conversa como "prioridade" no sistema
 */

// Armazenar conversas que pediram atendente (prioridade)
const conversasPrioridade = new Map();

/**
 * Marcar conversa como prioridade (pediu atendente)
 */
function marcarComoPrioridade(remetente) {
  conversasPrioridade.set(remetente, {
    timestamp: Date.now(),
    ultimaMensagem: Date.now()
  });
  
  // Log para admin ver quais conversas precisam atenção
  console.log(`🔔 CONVERSA PRIORITÁRIA: ${remetente} pediu atendimento`);
}

/**
 * Verificar se conversa é prioridade
 */
function ehPrioridade(remetente) {
  return conversasPrioridade.has(remetente);
}

/**
 * Enviar mensagem de atendimento (faz conversa subir no topo)
 */
async function enviarMensagemAtendimento(remetente) {
  const mensagem = `👋 *ATENDIMENTO HUMANIZADO*

Olá! Um de nossos atendentes vai te responder em breve.

Enquanto isso, você pode continuar fazendo seu pedido normalmente! 😊

*Digite qualquer coisa que nossa equipe verá sua mensagem.*`;

  await enviarMensagem(remetente, mensagem);
  
  // Marcar como prioridade
  marcarComoPrioridade(remetente);
  
  // Follow-up após 30 segundos para manter conversa no topo
  setTimeout(async () => {
    if (conversasPrioridade.has(remetente)) {
      await enviarMensagem(remetente, '💬 *Sua mensagem foi recebida!*\n\nNossa equipe está verificando e vai te responder em breve. Obrigado pela paciência! 🙏');
    }
  }, 30000);
}

/**
 * Listar conversas prioritárias (para admin)
 */
function listarConversasPrioritarias() {
  const prioritarias = Array.from(conversasPrioridade.entries())
    .map(([remetente, info]) => ({
      remetente,
      tempoEspera: Math.floor((Date.now() - info.timestamp) / 1000 / 60) // minutos
    }))
    .sort((a, b) => b.tempoEspera - a.tempoEspera); // Mais antigas primeiro
  
  return prioritarias;
}

// Exportar funções
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    marcarComoPrioridade,
    ehPrioridade,
    enviarMensagemAtendimento,
    listarConversasPrioritarias,
    conversasPrioridade
  };
}
