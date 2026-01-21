/**
 * Bot WhatsApp Conversacional - Tamboril Burguer
 * Fluxo completo de pedido interativo
 */

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const QRCode = require('qrcode-terminal');

// Usar fetch nativo do Node 18+ ou node-fetch
let fetch;
try {
  fetch = globalThis.fetch || require('node-fetch');
} catch {
  fetch = require('node-fetch');
}

const WEBHOOK_URL = 'https://tamboril-burguer.vercel.app/api/webhook/whatsapp';
const STORE_STATUS_URL = 'https://tamboril-burguer.vercel.app/api/store/status';

let sock = null;
let reconectando = false;

// Cache do status da loja (atualizado periodicamente)
let storeStatusCache = {
  isOpen: true,
  nextOpenTime: null,
  message: null,
  lastChecked: null
};

// Verificar status da loja
async function verificarStatusLoja() {
  try {
    const response = await fetch(STORE_STATUS_URL);
    if (response.ok) {
      const data = await response.json();
      storeStatusCache = {
        isOpen: data.isOpen !== false, // Default true se não especificado
        nextOpenTime: data.nextOpenTime || null,
        message: data.message || null,
        lastChecked: new Date()
      };
    }
  } catch (error) {
    console.error('Erro ao verificar status da loja:', error);
    // Em caso de erro, assume que loja está aberta
    storeStatusCache.isOpen = true;
  }
  return storeStatusCache;
}

// Verificar se loja está aberta antes de processar pedido
async function lojaEstaAberta() {
  // Verificar cache (atualizar a cada 1 minuto)
  const agora = new Date();
  if (!storeStatusCache.lastChecked || 
      (agora - storeStatusCache.lastChecked) > 60000) {
    await verificarStatusLoja();
  }
  return storeStatusCache.isOpen;
}

// Obter mensagem de loja fechada
function getMensagemLojaFechada() {
  const status = storeStatusCache;
  let mensagem = `🚫 *LOJA FECHADA*\n\n`;
  
  if (status.message) {
    mensagem += `${status.message}\n\n`;
  }
  
  if (status.nextOpenTime) {
    mensagem += `⏰ *Horário de abertura:* ${status.nextOpenTime}\n\n`;
  } else {
    mensagem += `⏰ Não há previsão de abertura no momento.\n\n`;
  }
  
  mensagem += `Obrigado por escolher Tamboril Burguer! 🍔\n`;
  mensagem += `Volte em breve! 👋`;
  
  return mensagem;
}

// Armazenar estado das conversas
const conversas = new Map();

/**
 * Estados da conversa
 */
const ESTADO = {
  INICIO: 'inicio',
  CARDAPIO: 'cardapio',
  TIPO_HAMBURGUER: 'tipo_hamburguer',
  QUANTIDADE_HAMBURGUER: 'quantidade_hamburguer',
  ADICIONAR_MAIS: 'adicionar_mais',
  TIPO_REFRIGERANTE: 'tipo_refrigerante',
  QUANTIDADE_REFRIGERANTE: 'quantidade_refrigerante',
  TIPO_SUCO: 'tipo_suco',
  QUANTIDADE_SUCO: 'quantidade_suco',
  QUANTIDADE_BEBIDA: 'quantidade_bebida',
  TIPO_PEDIDO: 'tipo_pedido',
  ENDERECO_DELIVERY: 'endereco_delivery',
  NOME_CLIENTE: 'nome_cliente',
  METODO_PAGAMENTO: 'metodo_pagamento',
  FINALIZAR: 'finalizar'
};

/**
 * Preços
 */
const PRECOS = {
  hamburguer_bovino_simples: 18.00,
  hamburguer_bovino_duplo: 28.00,
  hamburguer_suino_simples: 20.00,
  hamburguer_suino_duplo: 30.00,
  refrigerante_coca: 5.00,
  refrigerante_pepsi: 5.00,
  refrigerante_guarana: 5.00,
  refrigerante_fanta: 5.00,
  suco_laranja: 6.00,
  suco_maracuja: 6.00,
  suco_limao: 6.00,
  suco_abacaxi: 6.00,
  agua: 3.00
};

/**
 * Controle de estoque (pode ser expandido com painel admin depois)
 * true = disponível, false = esgotado
 */
const ESTOQUE = {
  hamburguer_bovino_simples: true,
  hamburguer_bovino_duplo: true,
  hamburguer_suino_simples: true,
  hamburguer_suino_duplo: true,
  refrigerante_coca: true,
  refrigerante_pepsi: true,
  refrigerante_guarana: true,
  refrigerante_fanta: true,
  suco_laranja: true,
  suco_maracuja: true,
  suco_limao: true,
  suco_abacaxi: true,
  agua: true
};

/**
 * Verificar se item está disponível
 */
function itemDisponivel(itemId) {
  return ESTOQUE[itemId] !== false; // Retorna true se não estiver marcado como false
}

/**
 * Criar/Obter conversa
 */
function getConversa(remetente) {
  if (!conversas.has(remetente)) {
    conversas.set(remetente, {
      estado: ESTADO.INICIO,
      pedido: {
        nome: '',
        telefone: '',
        itens: [],
        metodoPagamento: '',
        tipoPedido: '', // 'restaurante' ou 'delivery'
        endereco: '', // Endereço para delivery
        total: 0
      }
    });
  }
  return conversas.get(remetente);
}

/**
 * Enviar mensagem
 */
async function enviarMensagem(remetente, texto) {
  try {
    if (!sock) {
      console.error('Socket WhatsApp não está conectado');
      return false;
    }
    await sock.sendMessage(remetente, { text: texto });
    return true;
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    return false;
  }
}

/**
 * Enviar notificação de entrega para cliente
 * @param {string} phone - Telefone do cliente (formato: 21997624873 ou 5521997624873)
 * @param {string} displayId - ID do pedido (ex: #001)
 * @param {string} customerName - Nome do cliente
 * @param {string} deliveryAddress - Endereço de entrega (opcional)
 */
async function enviarNotificacaoEntrega(phone, displayId, customerName, deliveryAddress = null) {
  try {
    // Formatar telefone para WhatsApp
    let whatsappPhone = phone.replace(/\D/g, '');
    if (!whatsappPhone.startsWith('55') && whatsappPhone.length === 11) {
      whatsappPhone = `55${whatsappPhone}`;
    }
    const formattedPhone = `${whatsappPhone}@s.whatsapp.net`;
    
    // Preparar mensagem
    let mensagem = `🚚 *PEDIDO ${displayId} SAIU PARA ENTREGA!*

Olá ${customerName}! 👋

Seu pedido ${displayId} acabou de sair para entrega e está a caminho! 🍔

${deliveryAddress ? `📍 Endereço: ${deliveryAddress}\n` : ''}Em breve chegará até você!

Obrigado por escolher Tamboril Burguer! 🍔❤️`;
    
    return await enviarMensagem(formattedPhone, mensagem);
  } catch (error) {
    console.error('Erro ao enviar notificação de entrega:', error);
    return false;
  }
}

// Exportar função para uso externo (se necessário)
if (typeof module !== 'undefined' && module.exports) {
  module.exports.enviarNotificacaoEntrega = enviarNotificacaoEntrega;
}

/**
 * Enviar mensagem com botões interativos
 */
async function enviarMensagemComBotoes(remetente, texto, botoes) {
  try {
    // Formato de botões do Baileys
    const buttons = botoes.map((botao, index) => ({
      buttonId: `btn_${index}`,
      buttonText: { displayText: botao.texto },
      type: 1
    }));
    
    await sock.sendMessage(remetente, {
      text: texto,
      buttons: buttons,
      footer: 'Tamboril Burguer',
      headerType: 1
    });
  } catch (error) {
    console.error('Erro ao enviar mensagem com botões:', error);
    // Fallback: envia mensagem normal se botões falharem
    await enviarMensagem(remetente, texto);
  }
}

/**
 * Saudação inicial
 */
async function saudacaoInicial(remetente) {
  // Verificar se loja está aberta
  const lojaAberta = await lojaEstaAberta();
  
  if (!lojaAberta) {
    const mensagemFechada = getMensagemLojaFechada();
    await enviarMensagem(remetente, mensagemFechada);
    return;
  }
  
  const hora = new Date().getHours();
  const saudacao = hora >= 18 ? 'Boa noite' : hora >= 12 ? 'Boa tarde' : 'Bom dia';
  const conversa = getConversa(remetente);
  
  const texto = `🍔 *TAMBORIL BURGUER*

${saudacao}! 👋

Como podemos ajudar?

*Escolha uma opção:*
1️⃣ Ver cardápio e fazer pedido
2️⃣ Ver resumo do pedido atual
3️⃣ Falar com atendente

*Ou digite:*
• *1* ou *CARDÁPIO* para ver o cardápio
• *2* ou *RESUMO* para ver seu pedido
• *SAIR* para encerrar`;
  
  // Botões interativos (máximo 3 botões no WhatsApp)
  let botoes;
  if (conversa.pedido.itens.length > 0) {
    // Se tiver itens, mostra opção de resumo
    botoes = [
      { texto: '1️⃣ Ver Cardápio' },
      { texto: '2️⃣ Ver Resumo' },
      { texto: '3️⃣ Falar com Atendente' }
    ];
  } else {
    // Se não tiver itens, só mostra cardápio e atendente
    botoes = [
      { texto: '1️⃣ Ver Cardápio' },
      { texto: '2️⃣ Falar com Atendente' }
    ];
  }
  
  await enviarMensagemComBotoes(remetente, texto, botoes);
}

/**
 * Mostrar cardápio
 */
async function mostrarCardapio(remetente) {
  const conversa = getConversa(remetente);
  let texto = `🍔 *NOSSO CARDÁPIO*

*HAMBÚRGUERES:*

🍖 *Hambúrguer Bovino*
   1️⃣ Simples - R$ 18,00
   2️⃣ Duplo - R$ 28,00

🐷 *Hambúrguer Suíno*
   3️⃣ Simples - R$ 20,00
   4️⃣ Duplo - R$ 30,00

*BEBIDAS:*
   5️⃣ Refrigerante - R$ 5,00
   6️⃣ Suco - R$ 6,00
   7️⃣ Água - R$ 3,00

Digite o *NÚMERO* da opção desejada!`;

  // Se já tem itens no pedido, mostrar resumo e opção de voltar
  if (conversa.pedido.itens.length > 0) {
    const resumo = getResumoPedido(conversa);
    texto = `${resumo}\n\n${texto}\n\n⬅️ Digite *VOLTAR* para ver opções do pedido`;
  } else {
    texto += '\n\n⬅️ Digite *VOLTAR* para voltar ao início';
  }
  
  await enviarMensagem(remetente, texto);
}

/**
 * Processar mensagem natural (ex: "quero dois hamburguer suino e 1 coca cola, entrega delivery")
 */
function processarMensagemNatural(texto) {
  const textoLower = texto.toLowerCase();
  const itens = [];
  let tipoPedido = 'restaurante';
  let endereco = '';
  
  // Detectar tipo de pedido
  if (textoLower.includes('delivery') || textoLower.includes('entrega') || textoLower.includes('entregar')) {
    tipoPedido = 'delivery';
    // Tentar extrair endereço (texto após "delivery", "entrega", etc)
    const enderecoMatch = texto.match(/(?:delivery|entrega|entregar)[\s:]*([^,]+(?:,.*)?)/i);
    if (enderecoMatch && enderecoMatch[1]) {
      endereco = enderecoMatch[1].trim();
    }
  }
  
  // Padrões para detectar itens
  const padroes = [
    // Hambúrgueres
    { regex: /(\d+)\s*(?:x\s*)?(?:hamburguer|hambúrguer|hamburguers|hambúrguers)\s*(?:de\s*)?(bovino|boi|carne|suino|suíno|porco|porquinho)/gi, 
      mapeamento: {
        'bovino': 'hamburguer_bovino_simples',
        'boi': 'hamburguer_bovino_simples',
        'carne': 'hamburguer_bovino_simples',
        'suino': 'hamburguer_suino_simples',
        'suíno': 'hamburguer_suino_simples',
        'porco': 'hamburguer_suino_simples',
        'porquinho': 'hamburguer_suino_simples'
      }
    },
    { regex: /(\d+)\s*(?:x\s*)?(?:hamburguer|hambúrguer)\s*(?:bovino|boi|carne)\s*(?:simples|normal)/gi,
      mapeamento: { 'default': 'hamburguer_bovino_simples' }
    },
    { regex: /(\d+)\s*(?:x\s*)?(?:hamburguer|hambúrguer)\s*(?:bovino|boi|carne)\s*(?:duplo|duplos)/gi,
      mapeamento: { 'default': 'hamburguer_bovino_duplo' }
    },
    { regex: /(\d+)\s*(?:x\s*)?(?:hamburguer|hambúrguer)\s*(?:suino|suíno|porco)\s*(?:simples|normal)/gi,
      mapeamento: { 'default': 'hamburguer_suino_simples' }
    },
    { regex: /(\d+)\s*(?:x\s*)?(?:hamburguer|hambúrguer)\s*(?:suino|suíno|porco)\s*(?:duplo|duplos)/gi,
      mapeamento: { 'default': 'hamburguer_suino_duplo' }
    },
    // Refrigerantes
    { regex: /(\d+)\s*(?:x\s*)?(?:coca|cola|refrigerante\s*(?:coca|cola))/gi,
      mapeamento: { 'default': 'refrigerante_coca' }
    },
    { regex: /(\d+)\s*(?:x\s*)?(?:pepsi|refrigerante\s*pepsi)/gi,
      mapeamento: { 'default': 'refrigerante_pepsi' }
    },
    { regex: /(\d+)\s*(?:x\s*)?(?:guarana|refrigerante\s*guarana)/gi,
      mapeamento: { 'default': 'refrigerante_guarana' }
    },
    { regex: /(\d+)\s*(?:x\s*)?(?:fanta|refrigerante\s*fanta)/gi,
      mapeamento: { 'default': 'refrigerante_fanta' }
    },
    // Sucos
    { regex: /(\d+)\s*(?:x\s*)?(?:suco\s*(?:de\s*)?)?(?:laranja|laranjas)/gi,
      mapeamento: { 'default': 'suco_laranja' }
    },
    { regex: /(\d+)\s*(?:x\s*)?(?:suco\s*(?:de\s*)?)?(?:maracuja|maracujá)/gi,
      mapeamento: { 'default': 'suco_maracuja' }
    },
    { regex: /(\d+)\s*(?:x\s*)?(?:suco\s*(?:de\s*)?)?(?:limao|limão)/gi,
      mapeamento: { 'default': 'suco_limao' }
    },
    { regex: /(\d+)\s*(?:x\s*)?(?:suco\s*(?:de\s*)?)?(?:abacaxi)/gi,
      mapeamento: { 'default': 'suco_abacaxi' }
    },
    // Água
    { regex: /(\d+)\s*(?:x\s*)?(?:agua|água)/gi,
      mapeamento: { 'default': 'agua' }
    }
  ];
  
  // Processar cada padrão
  padroes.forEach(padrao => {
    const matches = [...texto.matchAll(padrao.regex)];
    matches.forEach(match => {
      const quantidade = parseInt(match[1]) || 1;
      let itemId = padrao.mapeamento['default'];
      
      // Se tiver mapeamento específico, usar
      if (match[2] && padrao.mapeamento[match[2].toLowerCase()]) {
        itemId = padrao.mapeamento[match[2].toLowerCase()];
      }
      
      if (itemId && itemDisponivel(itemId)) {
        const nome = getNomeItem(itemId);
        const preco = PRECOS[itemId];
        itens.push({ id: itemId, nome, quantidade, preco });
      }
    });
  });
  
  return { itens, tipoPedido, endereco, sucesso: itens.length > 0 };
}

/**
 * Obter nome do item pelo ID
 */
function getNomeItem(itemId) {
  const nomes = {
    'hamburguer_bovino_simples': 'Hambúrguer Bovino Simples',
    'hamburguer_bovino_duplo': 'Hambúrguer Bovino Duplo',
    'hamburguer_suino_simples': 'Hambúrguer Suíno Simples',
    'hamburguer_suino_duplo': 'Hambúrguer Suíno Duplo',
    'refrigerante_coca': 'Coca-Cola',
    'refrigerante_pepsi': 'Pepsi',
    'refrigerante_guarana': 'Guaraná',
    'refrigerante_fanta': 'Fanta',
    'suco_laranja': 'Suco de Laranja',
    'suco_maracuja': 'Suco de Maracujá',
    'suco_limao': 'Suco de Limão',
    'suco_abacaxi': 'Suco de Abacaxi',
    'agua': 'Água'
  };
  return nomes[itemId] || itemId;
}

/**
 * Processar escolha do cardápio
 */
function processarEscolhaCardapio(conversa, escolha) {
  const escolhaNum = parseInt(escolha.trim());
  
  switch (escolhaNum) {
    case 1:
      if (!itemDisponivel('hamburguer_bovino_simples')) {
        return { sucesso: false, esgotado: true, nome: 'Hambúrguer Bovino Simples' };
      }
      conversa.pedido.tipoSelecionado = 'hamburguer_bovino_simples';
      conversa.estado = ESTADO.QUANTIDADE_HAMBURGUER;
      return { sucesso: true, nome: 'Hambúrguer Bovino Simples', preco: PRECOS.hamburguer_bovino_simples };
    case 2:
      if (!itemDisponivel('hamburguer_bovino_duplo')) {
        return { sucesso: false, esgotado: true, nome: 'Hambúrguer Bovino Duplo' };
      }
      conversa.pedido.tipoSelecionado = 'hamburguer_bovino_duplo';
      conversa.estado = ESTADO.QUANTIDADE_HAMBURGUER;
      return { sucesso: true, nome: 'Hambúrguer Bovino Duplo', preco: PRECOS.hamburguer_bovino_duplo };
    case 3:
      if (!itemDisponivel('hamburguer_suino_simples')) {
        return { sucesso: false, esgotado: true, nome: 'Hambúrguer Suíno Simples' };
      }
      conversa.pedido.tipoSelecionado = 'hamburguer_suino_simples';
      conversa.estado = ESTADO.QUANTIDADE_HAMBURGUER;
      return { sucesso: true, nome: 'Hambúrguer Suíno Simples', preco: PRECOS.hamburguer_suino_simples };
    case 4:
      if (!itemDisponivel('hamburguer_suino_duplo')) {
        return { sucesso: false, esgotado: true, nome: 'Hambúrguer Suíno Duplo' };
      }
      conversa.pedido.tipoSelecionado = 'hamburguer_suino_duplo';
      conversa.estado = ESTADO.QUANTIDADE_HAMBURGUER;
      return { sucesso: true, nome: 'Hambúrguer Suíno Duplo', preco: PRECOS.hamburguer_suino_duplo };
    case 5:
      // Refrigerante - mostrar opções
      conversa.estado = ESTADO.TIPO_REFRIGERANTE;
      return { sucesso: true, bebida: true, tipo: 'refrigerante' };
    case 6:
      // Suco - mostrar opções
      conversa.estado = ESTADO.TIPO_SUCO;
      return { sucesso: true, bebida: true, tipo: 'suco' };
    case 7:
      if (!itemDisponivel('agua')) {
        return { sucesso: false, esgotado: true, nome: 'Água' };
      }
      conversa.pedido.bebidaSelecionada = 'agua';
      conversa.estado = ESTADO.QUANTIDADE_BEBIDA;
      return { sucesso: true, nome: 'Água', preco: PRECOS.agua, bebida: true };
    default:
      return { sucesso: false };
  }
}

/**
 * Processar quantidade
 */
function processarQuantidade(conversa, quantidade) {
  const qtd = parseInt(quantidade.trim());
  if (isNaN(qtd) || qtd < 1 || qtd > 10) {
    return { sucesso: false };
  }
  return { sucesso: true, quantidade: qtd };
}

/**
 * Processar método de pagamento
 */
function processarMetodoPagamento(escolha) {
  const escolhaLower = escolha.toLowerCase().trim();
  
  if (escolhaLower.includes('1') || escolhaLower.includes('dinheiro') || escolhaLower.includes('din')) {
    return 'Dinheiro';
  }
  if (escolhaLower.includes('2') || escolhaLower.includes('pix')) {
    return 'PIX';
  }
  if (escolhaLower.includes('3') || escolhaLower.includes('cartao') || escolhaLower.includes('card')) {
    return 'Cartão';
  }
  if (escolhaLower.includes('4') || escolhaLower.includes('voltar') || escolhaLower.includes('volta')) {
    return 'VOLTAR';
  }
  
  return null;
}

/**
 * Verificar se o usuário quer voltar
 */
function querVoltar(texto) {
  const textoLower = texto.toLowerCase().trim();
  return textoLower === 'voltar' || 
         textoLower === 'volta' || 
         textoLower === 'v' ||
         textoLower.includes('voltar') ||
         textoLower === '0';
}

/**
 * Mostrar resumo do pedido atual
 */
function getResumoPedido(conversa) {
  if (conversa.pedido.itens.length === 0) {
    return 'Nenhum item adicionado ainda.';
  }
  
  let resumo = '📋 *RESUMO DO PEDIDO:*\n\n';
  let total = 0;
  
  conversa.pedido.itens.forEach((item, index) => {
    const itemTotal = item.price * item.quantity;
    total += itemTotal;
    resumo += `${index + 1}. ${item.quantity}x ${item.name} - R$ ${itemTotal.toFixed(2).replace('.', ',')}\n`;
  });
  
  resumo += `\n💰 *Total: R$ ${total.toFixed(2).replace('.', ',')}*`;
  
  return resumo;
}

/**
 * Finalizar pedido e enviar para webhook
 */
async function finalizarPedido(remetente, conversa) {
  try {
    // Calcular total
    let total = 0;
    conversa.pedido.itens.forEach(item => {
      total += item.price * item.quantity;
    });
    
    // Adicionar telefone do remetente (extrair apenas números)
    // Formato do remetente: 5521997624873@s.whatsapp.net ou 5521997624873@c.us
    let telefone = remetente.split('@')[0]; // Remove @s.whatsapp.net ou @c.us
    telefone = telefone.replace(/^\+?55/, ''); // Remove código do país 55 se estiver no início
    telefone = telefone.replace(/\D/g, ''); // Remove qualquer caractere não numérico restante
    conversa.pedido.telefone = telefone;
    conversa.pedido.nome = conversa.pedido.nome || `Cliente ${telefone}`;
    conversa.pedido.total = total;
    
    // Adicionar método de pagamento como item especial ou metadata
    // Vou adicionar como último item com nome especial para impressão
    const itemsComPagamento = [...conversa.pedido.itens];
    
    // Enviar para webhook
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: conversa.pedido.nome,
        customer_phone: conversa.pedido.telefone,
        items: itemsComPagamento,
        total_price: total,
        payment_method: conversa.pedido.metodoPagamento,
        order_type: conversa.pedido.tipoPedido || 'restaurante',
        delivery_address: conversa.pedido.endereco || null
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Formatar ID do pedido: #001, #002, etc
      const orderIdDisplay = result.display_id || (result.daily_sequence ? `#${String(result.daily_sequence).padStart(3, '0')}` : `#${result.order_id.substring(0, 6).toUpperCase()}`);
      const sequenceInfo = result.daily_sequence ? `\n📍 *Posição na fila:* ${result.daily_sequence}º pedido do dia` : '';
      const customerOrdersInfo = result.customer_total_orders ? `\n🎉 *Este é seu ${result.customer_total_orders}º pedido!*` : '';
      
      // Tipo de pedido
      const tipoPedidoEmoji = conversa.pedido.tipoPedido === 'delivery' ? '🚴' : '🍽️';
      const tipoPedidoTexto = conversa.pedido.tipoPedido === 'delivery' ? 'Delivery' : 'Restaurante';
      
      // Tempo estimado baseado na fila (20 minutos por pedido)
      const tempoEstimado = result.estimated_time || (result.daily_sequence ? result.daily_sequence * 20 : 20);
      const tempoMin = tempoEstimado;
      const tempoMax = tempoEstimado + 10;
      
      const resumo = `✅ *PEDIDO CONFIRMADO!*

━━━━━━━━━━━━━━━━━━━━
🆔 *PEDIDO ${orderIdDisplay}*${sequenceInfo}${customerOrdersInfo}
━━━━━━━━━━━━━━━━━━━━

📋 *Resumo:*
${conversa.pedido.itens.map((item, i) => `${item.quantity}x ${item.name} - R$ ${(item.price * item.quantity).toFixed(2).replace('.', ',')}`).join('\n')}

💰 *Total: R$ ${total.toFixed(2).replace('.', ',')}*
${tipoPedidoEmoji} ${tipoPedidoTexto} | 💳 ${conversa.pedido.metodoPagamento}

⏰ *Tempo estimado: ${tempoMin}-${tempoMax} minutos*

🍔 Seu pedido está sendo preparado!

*Obrigado pela preferência!* 😊`;

      await enviarMensagem(remetente, resumo);
      
      console.log(`✅ Pedido criado: ${orderIdDisplay} (ID: ${result.order_id})`);
      
      // Limpar conversa
      conversas.delete(remetente);
      
      return true;
    } else {
      await enviarMensagem(remetente, '❌ Erro ao processar pedido. Tente novamente.');
      return false;
    }
  } catch (error) {
    console.error('Erro ao finalizar pedido:', error);
    await enviarMensagem(remetente, '❌ Erro ao processar pedido. Tente novamente.');
    return false;
  }
}

/**
 * Processar mensagem
 */
async function processarMensagem(remetente, texto) {
  const conversa = getConversa(remetente);
  const textoLower = texto.toLowerCase().trim();
  
  console.log(`💬 [${conversa.estado}] Mensagem de ${remetente}: ${texto}`);
  
  // Comandos gerais (funcionam em qualquer estado)
  if (textoLower === 'sair' || textoLower === 'encerrar') {
    conversas.delete(remetente);
    await enviarMensagem(remetente, '👋 Obrigado! Até logo!');
    return;
  }
  
  // Comando para ver resumo do pedido
  if (textoLower === 'resumo' || textoLower === 'pedido' || textoLower === 'ver pedido') {
    const resumo = getResumoPedido(conversa);
    await enviarMensagem(remetente, resumo);
    return;
  }
  
  // Processar por estado
  switch (conversa.estado) {
    case ESTADO.INICIO:
      // Processar botões interativos (vem como "btn_0", "btn_1", etc)
      if (textoLower.startsWith('btn_')) {
        const botaoIndex = parseInt(textoLower.replace('btn_', ''));
        if (botaoIndex === 0) {
          // Botão 1: Ver cardápio
          conversa.estado = ESTADO.CARDAPIO;
          await mostrarCardapio(remetente);
        } else if (botaoIndex === 1) {
          // Botão 2: Ver resumo (se tiver itens) ou Falar com atendente
          if (conversa.pedido.itens.length > 0) {
            const resumo = getResumoPedido(conversa);
            await enviarMensagem(remetente, resumo);
          } else {
            // Se não tiver itens, o botão 2 é "Falar com atendente"
            await enviarMensagem(remetente, 'Para falar com nosso atendente, envie uma mensagem ou ligue para nosso número. Em breve retornaremos! 📞');
          }
        } else if (botaoIndex === 2) {
          // Botão 3: Falar com atendente (só aparece se tiver itens)
          await enviarMensagem(remetente, 'Para falar com nosso atendente, envie uma mensagem ou ligue para nosso número. Em breve retornaremos! 📞');
        }
      }
      // Verificar se loja está aberta antes de processar pedidos
      const lojaAberta = await lojaEstaAberta();
      if (!lojaAberta) {
        const mensagemFechada = getMensagemLojaFechada();
        await enviarMensagem(remetente, mensagemFechada);
        break;
      }
      
      // Tentar processar mensagem natural primeiro (ex: "quero dois hamburguer suino e 1 coca cola, entrega delivery")
      const mensagemNatural = processarMensagemNatural(texto);
      if (mensagemNatural.sucesso && mensagemNatural.itens.length > 0) {
        // Adicionar itens ao pedido
        mensagemNatural.itens.forEach(item => {
          conversa.pedido.itens.push({
            id: item.id,
            name: item.nome,
            quantity: item.quantidade,
            price: item.preco
          });
        });
        
        // Definir tipo de pedido
        conversa.pedido.tipoPedido = mensagemNatural.tipoPedido;
        
        // Se for delivery e tiver endereço, salvar
        if (mensagemNatural.tipoPedido === 'delivery' && mensagemNatural.endereco) {
          conversa.pedido.endereco = mensagemNatural.endereco;
        }
        
        // Mostrar resumo e continuar fluxo
        const resumo = getResumoPedido(conversa);
        let mensagemResumo = `✅ *Itens adicionados ao pedido!*\n\n${resumo}\n\n`;
        
        if (mensagemNatural.tipoPedido === 'delivery' && !mensagemNatural.endereco) {
          mensagemResumo += '📦 *Tipo: DELIVERY*\n\nPor favor, informe o endereço de entrega:';
          conversa.estado = ESTADO.ENDERECO_DELIVERY;
        } else if (!conversa.pedido.nome) {
          mensagemResumo += 'Por favor, informe seu nome:';
          conversa.estado = ESTADO.NOME_CLIENTE;
        } else {
          mensagemResumo += 'Deseja adicionar mais itens?\n\n1️⃣ Sim\n2️⃣ Não, finalizar pedido';
          conversa.estado = ESTADO.ADICIONAR_MAIS;
        }
        
        await enviarMensagem(remetente, mensagemResumo);
      }
      // Se enviar "oi", "olá", etc, mostra a saudação inicial
      else if (textoLower === 'oi' || textoLower === 'olá' || textoLower === 'ola' || textoLower === 'hello' || textoLower === 'hi') {
        await saudacaoInicial(remetente);
      }
      // Suporte a números: 1 = cardápio, 2 = resumo
      else if (textoLower === '1' || textoLower === 'sim' || textoLower === 's' || textoLower === 'pedido' || textoLower === 'cardapio' || textoLower === 'cardápio') {
        // Verificar se loja está aberta
        const lojaAberta = await lojaEstaAberta();
        if (!lojaAberta) {
          const mensagemFechada = getMensagemLojaFechada();
          await enviarMensagem(remetente, mensagemFechada);
          break;
        }
        conversa.estado = ESTADO.CARDAPIO;
        await mostrarCardapio(remetente);
      } else if (textoLower === '2' || textoLower === 'resumo') {
        const resumo = getResumoPedido(conversa);
        if (conversa.pedido.itens.length > 0) {
          await enviarMensagem(remetente, resumo);
        } else {
          await enviarMensagem(remetente, 'Você ainda não tem itens no pedido. Digite *1* ou *SIM* para começar!');
        }
      } else if (textoLower === '3' || textoLower.includes('atendente') || textoLower.includes('falar')) {
        await enviarMensagem(remetente, 'Para falar com nosso atendente, envie uma mensagem ou ligue para nosso número. Em breve retornaremos! 📞');
      } else {
        // Se não reconhecer o comando, mostra a saudação inicial
        await saudacaoInicial(remetente);
      }
      break;
      
    case ESTADO.CARDAPIO:
      if (querVoltar(texto)) {
        if (conversa.pedido.itens.length > 0) {
          const resumo = getResumoPedido(conversa);
          await enviarMensagem(remetente, `${resumo}\n\nDeseja adicionar mais itens?\n\n1️⃣ Sim\n2️⃣ Não, finalizar pedido`);
          conversa.estado = ESTADO.ADICIONAR_MAIS;
        } else {
          conversa.estado = ESTADO.INICIO;
          await saudacaoInicial(remetente);
        }
      } else {
        const escolha = processarEscolhaCardapio(conversa, texto);
        if (escolha.sucesso) {
          if (escolha.esgotado) {
            await enviarMensagem(remetente, `❌ *${escolha.nome}* está esgotado no momento.\n\nPor favor, escolha outro item do cardápio.`);
            await mostrarCardapio(remetente);
          } else if (escolha.tipo === 'refrigerante') {
            // Mostrar opções de refrigerantes
            await enviarMensagem(remetente, `🥤 *REFRIGERANTES* - R$ 5,00 cada\n\n1️⃣ Coca-Cola\n2️⃣ Pepsi\n3️⃣ Guaraná\n4️⃣ Fanta\n\nDigite o número da opção:\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio`);
          } else if (escolha.tipo === 'suco') {
            // Mostrar opções de sucos
            await enviarMensagem(remetente, `🧃 *SUCOS* - R$ 6,00 cada\n\n1️⃣ Laranja\n2️⃣ Maracujá\n3️⃣ Limão\n4️⃣ Abacaxi\n\nDigite o número da opção:\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio`);
          } else if (escolha.bebida) {
            await enviarMensagem(remetente, `✅ ${escolha.nome} - R$ ${escolha.preco.toFixed(2).replace('.', ',')}\n\nQuantas unidades? (1 a 10)\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio`);
          } else {
            await enviarMensagem(remetente, `✅ ${escolha.nome} - R$ ${escolha.preco.toFixed(2).replace('.', ',')}\n\nQuantos hambúrgueres? (1 a 10)\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio`);
          }
        } else {
          await enviarMensagem(remetente, '❌ Opção inválida. Digite um número de 1 a 7.\n\n⬅️ Digite *VOLTAR* para voltar ao início');
          await mostrarCardapio(remetente);
        }
      }
      break;
      
    case ESTADO.QUANTIDADE_HAMBURGUER:
      if (querVoltar(texto)) {
        conversa.estado = ESTADO.CARDAPIO;
        delete conversa.pedido.tipoSelecionado;
        await mostrarCardapio(remetente);
      } else {
        const qtdHamb = processarQuantidade(conversa, texto);
        if (qtdHamb.sucesso) {
          const tipo = conversa.pedido.tipoSelecionado;
          const nome = tipo.replace('hamburguer_', '').replace(/_/g, ' ').split(' ').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
          const preco = PRECOS[tipo];
          
          conversa.pedido.itens.push({
            id: `hamburguer-${conversa.pedido.itens.length + 1}`,
            name: nome,
            quantity: qtdHamb.quantidade,
            price: preco
          });
          
          conversa.estado = ESTADO.ADICIONAR_MAIS;
          await enviarMensagem(remetente, `✅ ${qtdHamb.quantidade}x ${nome} adicionado!\n\nDeseja adicionar mais itens? (hambúrgueres ou bebidas)\n\n1️⃣ Sim\n2️⃣ Não, finalizar pedido`);
        } else {
          await enviarMensagem(remetente, '❌ Quantidade inválida. Digite um número de 1 a 10.\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio');
        }
      }
      break;
      
    case ESTADO.ADICIONAR_MAIS:
      if (querVoltar(texto)) {
        // Voltar para cardápio
        conversa.estado = ESTADO.CARDAPIO;
        await mostrarCardapio(remetente);
      } else if (textoLower === '1' || textoLower.includes('sim') || textoLower.includes('s')) {
        conversa.estado = ESTADO.CARDAPIO;
        await mostrarCardapio(remetente);
      } else if (textoLower === '2' || textoLower.includes('nao') || textoLower.includes('não') || textoLower.includes('finalizar')) {
        conversa.estado = ESTADO.TIPO_PEDIDO;
        await enviarMensagem(remetente, `*TIPO DE PEDIDO:*

1️⃣ 🍽️ Comer no restaurante
2️⃣ 🚴 Delivery (entrega)

Digite o número da opção:`);
      } else {
        await enviarMensagem(remetente, 'Digite *1* para adicionar mais itens, *2* para finalizar o pedido ou *VOLTAR* para voltar ao cardápio.');
      }
      break;
      
    case ESTADO.BEBIDA:
      // Este estado não é mais usado, mas mantido para compatibilidade
      if (textoLower === '1' || textoLower.includes('sim') || textoLower.includes('s')) {
        conversa.estado = ESTADO.CARDAPIO;
        await mostrarCardapio(remetente);
      } else if (textoLower === '2' || textoLower.includes('nao') || textoLower.includes('não')) {
        conversa.estado = ESTADO.TIPO_PEDIDO;
        await enviarMensagem(remetente, `*TIPO DE PEDIDO:*

1️⃣ 🍽️ Comer no restaurante
2️⃣ 🚴 Delivery (entrega)

Digite o número da opção:`);
      } else {
        await enviarMensagem(remetente, 'Digite *1* para Sim ou *2* para Não.');
      }
      break;
      
    case ESTADO.TIPO_REFRIGERANTE:
      if (querVoltar(texto)) {
        conversa.estado = ESTADO.CARDAPIO;
        await mostrarCardapio(remetente);
      } else {
        const escolhaNum = parseInt(texto.trim());
        let refrigeranteId = '';
        let nomeRefri = '';
        
        switch (escolhaNum) {
          case 1:
            if (!itemDisponivel('refrigerante_coca')) {
              await enviarMensagem(remetente, '❌ *Coca-Cola* está esgotada no momento.\n\nPor favor, escolha outro refrigerante.');
              await enviarMensagem(remetente, `🥤 *REFRIGERANTES* - R$ 5,00 cada\n\n1️⃣ Coca-Cola\n2️⃣ Pepsi\n3️⃣ Guaraná\n4️⃣ Fanta\n\nDigite o número da opção:\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio`);
              return;
            }
            refrigeranteId = 'refrigerante_coca';
            nomeRefri = 'Coca-Cola';
            break;
          case 2:
            if (!itemDisponivel('refrigerante_pepsi')) {
              await enviarMensagem(remetente, '❌ *Pepsi* está esgotada no momento.\n\nPor favor, escolha outro refrigerante.');
              await enviarMensagem(remetente, `🥤 *REFRIGERANTES* - R$ 5,00 cada\n\n1️⃣ Coca-Cola\n2️⃣ Pepsi\n3️⃣ Guaraná\n4️⃣ Fanta\n\nDigite o número da opção:\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio`);
              return;
            }
            refrigeranteId = 'refrigerante_pepsi';
            nomeRefri = 'Pepsi';
            break;
          case 3:
            if (!itemDisponivel('refrigerante_guarana')) {
              await enviarMensagem(remetente, '❌ *Guaraná* está esgotado no momento.\n\nPor favor, escolha outro refrigerante.');
              await enviarMensagem(remetente, `🥤 *REFRIGERANTES* - R$ 5,00 cada\n\n1️⃣ Coca-Cola\n2️⃣ Pepsi\n3️⃣ Guaraná\n4️⃣ Fanta\n\nDigite o número da opção:\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio`);
              return;
            }
            refrigeranteId = 'refrigerante_guarana';
            nomeRefri = 'Guaraná';
            break;
          case 4:
            if (!itemDisponivel('refrigerante_fanta')) {
              await enviarMensagem(remetente, '❌ *Fanta* está esgotada no momento.\n\nPor favor, escolha outro refrigerante.');
              await enviarMensagem(remetente, `🥤 *REFRIGERANTES* - R$ 5,00 cada\n\n1️⃣ Coca-Cola\n2️⃣ Pepsi\n3️⃣ Guaraná\n4️⃣ Fanta\n\nDigite o número da opção:\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio`);
              return;
            }
            refrigeranteId = 'refrigerante_fanta';
            nomeRefri = 'Fanta';
            break;
          default:
            await enviarMensagem(remetente, '❌ Opção inválida. Digite um número de 1 a 4.\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio');
            return;
        }
        
        conversa.pedido.bebidaSelecionada = refrigeranteId;
        conversa.estado = ESTADO.QUANTIDADE_REFRIGERANTE;
        await enviarMensagem(remetente, `✅ ${nomeRefri} - R$ 5,00\n\nQuantas unidades? (1 a 10)\n\n⬅️ Digite *VOLTAR* para voltar`);
      }
      break;
      
    case ESTADO.QUANTIDADE_REFRIGERANTE:
      if (querVoltar(texto)) {
        conversa.estado = ESTADO.TIPO_REFRIGERANTE;
        await enviarMensagem(remetente, `🥤 *REFRIGERANTES* - R$ 5,00 cada\n\n1️⃣ Coca-Cola\n2️⃣ Pepsi\n3️⃣ Guaraná\n4️⃣ Fanta\n\nDigite o número da opção:\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio`);
      } else {
        const qtd = processarQuantidade(conversa, texto);
        if (qtd.sucesso) {
          const refrigeranteId = conversa.pedido.bebidaSelecionada;
          const nomeRefri = refrigeranteId.replace('refrigerante_', '').split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
          const preco = PRECOS[refrigeranteId];
          
          conversa.pedido.itens.push({
            id: `refrigerante-${conversa.pedido.itens.length + 1}`,
            name: nomeRefri,
            quantity: qtd.quantidade,
            price: preco
          });
          
          delete conversa.pedido.bebidaSelecionada;
          conversa.estado = ESTADO.ADICIONAR_MAIS;
          await enviarMensagem(remetente, `✅ ${qtd.quantidade}x ${nomeRefri} adicionado!\n\nDeseja adicionar mais itens? (hambúrgueres ou bebidas)\n\n1️⃣ Sim\n2️⃣ Não, finalizar pedido`);
        } else {
          await enviarMensagem(remetente, '❌ Quantidade inválida. Digite um número de 1 a 10.\n\n⬅️ Digite *VOLTAR* para voltar');
        }
      }
      break;
      
    case ESTADO.TIPO_SUCO:
      if (querVoltar(texto)) {
        conversa.estado = ESTADO.CARDAPIO;
        await mostrarCardapio(remetente);
      } else {
        const escolhaNum = parseInt(texto.trim());
        let sucoId = '';
        let nomeSuco = '';
        
        switch (escolhaNum) {
          case 1:
            if (!itemDisponivel('suco_laranja')) {
              await enviarMensagem(remetente, '❌ *Suco de Laranja* está esgotado no momento.\n\nPor favor, escolha outro suco.');
              await enviarMensagem(remetente, `🧃 *SUCOS* - R$ 6,00 cada\n\n1️⃣ Laranja\n2️⃣ Maracujá\n3️⃣ Limão\n4️⃣ Abacaxi\n\nDigite o número da opção:\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio`);
              return;
            }
            sucoId = 'suco_laranja';
            nomeSuco = 'Suco de Laranja';
            break;
          case 2:
            if (!itemDisponivel('suco_maracuja')) {
              await enviarMensagem(remetente, '❌ *Suco de Maracujá* está esgotado no momento.\n\nPor favor, escolha outro suco.');
              await enviarMensagem(remetente, `🧃 *SUCOS* - R$ 6,00 cada\n\n1️⃣ Laranja\n2️⃣ Maracujá\n3️⃣ Limão\n4️⃣ Abacaxi\n\nDigite o número da opção:\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio`);
              return;
            }
            sucoId = 'suco_maracuja';
            nomeSuco = 'Suco de Maracujá';
            break;
          case 3:
            if (!itemDisponivel('suco_limao')) {
              await enviarMensagem(remetente, '❌ *Suco de Limão* está esgotado no momento.\n\nPor favor, escolha outro suco.');
              await enviarMensagem(remetente, `🧃 *SUCOS* - R$ 6,00 cada\n\n1️⃣ Laranja\n2️⃣ Maracujá\n3️⃣ Limão\n4️⃣ Abacaxi\n\nDigite o número da opção:\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio`);
              return;
            }
            sucoId = 'suco_limao';
            nomeSuco = 'Suco de Limão';
            break;
          case 4:
            if (!itemDisponivel('suco_abacaxi')) {
              await enviarMensagem(remetente, '❌ *Suco de Abacaxi* está esgotado no momento.\n\nPor favor, escolha outro suco.');
              await enviarMensagem(remetente, `🧃 *SUCOS* - R$ 6,00 cada\n\n1️⃣ Laranja\n2️⃣ Maracujá\n3️⃣ Limão\n4️⃣ Abacaxi\n\nDigite o número da opção:\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio`);
              return;
            }
            sucoId = 'suco_abacaxi';
            nomeSuco = 'Suco de Abacaxi';
            break;
          default:
            await enviarMensagem(remetente, '❌ Opção inválida. Digite um número de 1 a 4.\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio');
            return;
        }
        
        conversa.pedido.bebidaSelecionada = sucoId;
        conversa.estado = ESTADO.QUANTIDADE_SUCO;
        await enviarMensagem(remetente, `✅ ${nomeSuco} - R$ 6,00\n\nQuantas unidades? (1 a 10)\n\n⬅️ Digite *VOLTAR* para voltar`);
      }
      break;
      
    case ESTADO.QUANTIDADE_SUCO:
      if (querVoltar(texto)) {
        conversa.estado = ESTADO.TIPO_SUCO;
        await enviarMensagem(remetente, `🧃 *SUCOS* - R$ 6,00 cada\n\n1️⃣ Laranja\n2️⃣ Maracujá\n3️⃣ Limão\n4️⃣ Abacaxi\n\nDigite o número da opção:\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio`);
      } else {
        const qtd = processarQuantidade(conversa, texto);
        if (qtd.sucesso) {
          const sucoId = conversa.pedido.bebidaSelecionada;
          const nomeSuco = sucoId.replace('suco_', 'Suco de ').split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
          const preco = PRECOS[sucoId];
          
          conversa.pedido.itens.push({
            id: `suco-${conversa.pedido.itens.length + 1}`,
            name: nomeSuco,
            quantity: qtd.quantidade,
            price: preco
          });
          
          delete conversa.pedido.bebidaSelecionada;
          conversa.estado = ESTADO.ADICIONAR_MAIS;
          await enviarMensagem(remetente, `✅ ${qtd.quantidade}x ${nomeSuco} adicionado!\n\nDeseja adicionar mais itens? (hambúrgueres ou bebidas)\n\n1️⃣ Sim\n2️⃣ Não, finalizar pedido`);
        } else {
          await enviarMensagem(remetente, '❌ Quantidade inválida. Digite um número de 1 a 10.\n\n⬅️ Digite *VOLTAR* para voltar');
        }
      }
      break;
      
    case ESTADO.QUANTIDADE_BEBIDA:
      if (querVoltar(texto)) {
        conversa.estado = ESTADO.CARDAPIO;
        delete conversa.pedido.bebidaSelecionada;
        await mostrarCardapio(remetente);
      } else {
        const qtdBeb = processarQuantidade(conversa, texto);
        if (qtdBeb.sucesso) {
          const bebida = conversa.pedido.bebidaSelecionada;
          const nomeBebida = bebida.charAt(0).toUpperCase() + bebida.slice(1);
          const precoBebida = PRECOS[bebida];
          
          conversa.pedido.itens.push({
            id: `bebida-${conversa.pedido.itens.length + 1}`,
            name: nomeBebida,
            quantity: qtdBeb.quantidade,
            price: precoBebida
          });
          
          delete conversa.pedido.bebidaSelecionada;
          conversa.estado = ESTADO.ADICIONAR_MAIS;
          await enviarMensagem(remetente, `✅ ${qtdBeb.quantidade}x ${nomeBebida} adicionado!\n\nDeseja adicionar mais itens? (hambúrgueres ou bebidas)\n\n1️⃣ Sim\n2️⃣ Não, finalizar pedido`);
        } else {
          await enviarMensagem(remetente, '❌ Quantidade inválida. Digite um número de 1 a 10.\n\n⬅️ Digite *VOLTAR* para voltar ao cardápio');
        }
      }
      break;
      
    case ESTADO.TIPO_PEDIDO:
      if (querVoltar(texto)) {
        // Voltar para adicionar mais itens
        const resumo = getResumoPedido(conversa);
        await enviarMensagem(remetente, `${resumo}\n\nDeseja adicionar mais itens?\n\n1️⃣ Sim\n2️⃣ Não, finalizar pedido`);
        conversa.estado = ESTADO.ADICIONAR_MAIS;
      } else if (textoLower === '1' || textoLower.includes('restaurante') || textoLower.includes('comer')) {
        conversa.pedido.tipoPedido = 'restaurante';
        // Restaurante: pede nome primeiro, depois método de pagamento
        conversa.estado = ESTADO.NOME_CLIENTE;
        await enviarMensagem(remetente, `✅ Pedido para comer no restaurante!\n\nQual seu nome?\n\n⬅️ Digite *VOLTAR* para voltar`);
      } else if (textoLower === '2' || textoLower.includes('delivery') || textoLower.includes('entrega')) {
        conversa.pedido.tipoPedido = 'delivery';
        // Delivery: pede endereço primeiro
        conversa.estado = ESTADO.ENDERECO_DELIVERY;
        await enviarMensagem(remetente, `✅ Pedido para delivery!\n\nPor favor, informe seu *endereço completo* para entrega:\n\n(Rua, número, bairro, complemento)\n\n⬅️ Digite *VOLTAR* para voltar`);
      } else {
        await enviarMensagem(remetente, '❌ Opção inválida. Digite 1 para restaurante ou 2 para delivery.\n\n⬅️ Digite *VOLTAR* para voltar');
      }
      break;
      
    case ESTADO.ENDERECO_DELIVERY:
      if (querVoltar(texto)) {
        conversa.estado = ESTADO.TIPO_PEDIDO;
        await enviarMensagem(remetente, `*TIPO DE PEDIDO:*

1️⃣ 🍽️ Comer no restaurante
2️⃣ 🚴 Delivery (entrega)

Digite o número da opção:`);
      } else if (texto.trim().length > 10) {
        conversa.pedido.endereco = texto.trim();
        // Depois do endereço, pede nome
        conversa.estado = ESTADO.NOME_CLIENTE;
        await enviarMensagem(remetente, `✅ Endereço registrado: ${conversa.pedido.endereco}\n\nQual seu nome?\n\n⬅️ Digite *VOLTAR* para voltar`);
      } else {
        await enviarMensagem(remetente, '❌ Por favor, informe um endereço completo (rua, número, bairro).\n\n⬅️ Digite *VOLTAR* para voltar');
      }
      break;
      
    case ESTADO.NOME_CLIENTE:
      if (querVoltar(texto)) {
        if (conversa.pedido.tipoPedido === 'delivery') {
          conversa.estado = ESTADO.ENDERECO_DELIVERY;
          await enviarMensagem(remetente, `Por favor, informe seu *endereço completo* para entrega:\n\n(Rua, número, bairro, complemento)\n\n⬅️ Digite *VOLTAR* para voltar`);
        } else {
          conversa.estado = ESTADO.TIPO_PEDIDO;
          await enviarMensagem(remetente, `*TIPO DE PEDIDO:*

1️⃣ 🍽️ Comer no restaurante
2️⃣ 🚴 Delivery (entrega)

Digite o número da opção:`);
        }
      } else if (texto.trim().length > 0) {
        conversa.pedido.nome = texto.trim();
        // Depois do nome, pede método de pagamento
        conversa.estado = ESTADO.METODO_PAGAMENTO;
        await enviarMensagem(remetente, `✅ Nome: ${conversa.pedido.nome}\n\n*MÉTODO DE PAGAMENTO:*

1️⃣ Dinheiro
2️⃣ PIX
3️⃣ Cartão
4️⃣ Voltar ao pedido

Digite o número da opção:`);
      } else {
        await enviarMensagem(remetente, 'Por favor, digite seu nome.\n\n⬅️ Digite *VOLTAR* para voltar');
      }
      break;
      
    case ESTADO.METODO_PAGAMENTO:
      const metodo = processarMetodoPagamento(texto);
      if (metodo === 'VOLTAR') {
        // Voltar para nome (que vem antes do método de pagamento)
        conversa.estado = ESTADO.NOME_CLIENTE;
        if (conversa.pedido.tipoPedido === 'delivery') {
          await enviarMensagem(remetente, `Qual seu nome?\n\n⬅️ Digite *VOLTAR* para voltar ao endereço`);
        } else {
          await enviarMensagem(remetente, `Qual seu nome?\n\n⬅️ Digite *VOLTAR* para voltar`);
        }
      } else if (metodo) {
        conversa.pedido.metodoPagamento = metodo;
        
        // Após método de pagamento, finaliza o pedido
        await finalizarPedido(remetente, conversa);
        // Conversa será deletada no finalizarPedido
      } else {
        await enviarMensagem(remetente, '❌ Opção inválida. Digite 1, 2, 3 ou 4 (voltar).');
      }
      break;
      
  }
}

/**
 * Conecta ao WhatsApp
 */
async function conectarWhatsApp() {
  if (reconectando) return;
  
  try {
    console.log('🔄 Conectando ao WhatsApp...');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        console.log('\n📱 ESCANEIE O QR CODE COM SEU WHATSAPP:\n');
        QRCode.generate(qr, { small: true });
        console.log('\n⬅️ No WhatsApp: Configurações > Aparelhos conectados > Conectar um aparelho\n');
      }
      
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error instanceof Boom && 
                                lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut;
        
        if (shouldReconnect) {
          console.log('🔄 Reconectando em 5 segundos...');
          reconectando = true;
          setTimeout(() => {
            reconectando = false;
            conectarWhatsApp();
          }, 5000);
        } else {
          console.log('❌ Desconectado. Escaneie QR Code novamente.');
          reconectando = false;
        }
      } else if (connection === 'open') {
        console.log('✅ Conectado ao WhatsApp!');
        reconectando = false;
      }
    });
    
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (msg.key.fromMe) return;
      
      // Capturar texto de mensagem normal, texto estendido ou resposta de botão
      let texto = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.buttonsResponseMessage?.selectedButtonId ||
                  '';
      
      if (!texto) return;
      
      const remetente = msg.key.remoteJid;
      
      // Processar mensagem
      await processarMensagem(remetente, texto);
    });
    
  } catch (error) {
    console.error('❌ Erro:', error);
    reconectando = false;
    setTimeout(() => conectarWhatsApp(), 10000);
  }
}

console.log('🚀 Iniciando bot WhatsApp conversacional...');
conectarWhatsApp();

process.on('SIGINT', () => {
  console.log('\n👋 Encerrando...');
  if (sock) sock.end();
  process.exit(0);
});
