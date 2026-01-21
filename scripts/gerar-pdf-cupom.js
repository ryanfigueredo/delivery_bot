/**
 * Script para gerar PDF de cupom térmico a partir de um pedido
 * 
 * Uso: node gerar-pdf-cupom.js <order_id>
 * Exemplo: node gerar-pdf-cupom.js 7e1ea4a3-2345-4fdd-bb2f-eddb317b1e71
 */

const { PrismaClient } = require('@prisma/client')
const PDFDocument = require('pdfkit')
const fs = require('fs')
const path = require('path')

const prisma = new PrismaClient()

// Configurações do cupom térmico 58mm
const LINE_WIDTH = 32 // Caracteres por linha em 58mm
const PAPER_WIDTH_MM = 58
const PAPER_WIDTH_POINTS = PAPER_WIDTH_MM * 2.83465 // Converter mm para points (1mm = 2.83465 points)
const FONT_SIZE = 10 // Aumentado para melhor legibilidade
const FONT_SIZE_BOLD = 11 // Fonte maior para títulos
const LINE_HEIGHT = 12

/**
 * Centraliza texto
 */
function centerText(text, maxWidth) {
  const padding = Math.floor((maxWidth - text.length) / 2)
  return padding > 0 ? ' '.repeat(padding) + text : text
}

/**
 * Alinha texto à direita
 */
function alignRight(text, maxWidth) {
  const padding = maxWidth - text.length
  return padding > 0 ? ' '.repeat(padding) + text : text
}

/**
 * Formata data e hora
 */
function formatDateTime(dateString) {
  try {
    const date = new Date(dateString)
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch (e) {
    return dateString
  }
}

/**
 * Formata o pedido para impressão
 */
function formatOrder(order) {
  const lines = []
  
  // Cabeçalho alinhado à esquerda
  lines.push({ text: 'TAMBORIL BURGUER', bold: true })
  lines.push({ text: 'Sistema desenvolvido por' })
  lines.push({ text: 'dmtn.com.br' })
  lines.push({ text: '--------------------------------' })
  
  // Número do pedido destacado - prioriza display_id, depois daily_sequence formatado, por último UUID curto
  const orderId = order.display_id || (order.daily_sequence ? `#${String(order.daily_sequence).padStart(3, '0')}` : `#${order.id.substring(0, 6).toUpperCase()}`)
  lines.push({ text: '' })
  lines.push({ text: `PEDIDO ${orderId}`, bold: true })
  
  // Posição na fila destacada
  if (order.daily_sequence) {
    lines.push({ text: `${order.daily_sequence}º NA FILA`, bold: true })
  }
  lines.push({ text: '--------------------------------' })
  
  // Data e hora
  const formattedDate = formatDateTime(order.created_at)
  lines.push({ text: `Data: ${formattedDate}` })
  
  // Cliente
  lines.push({ text: `Cliente: ${order.customer_name}` })
  // Limpar telefone de caracteres estranhos (remover @, letras, etc)
  const telefoneLimpo = order.customer_phone.replace(/[^0-9]/g, '')
  lines.push({ text: `Tel: ${telefoneLimpo}` })
  
  // Tipo de pedido
  if (order.order_type) {
    const tipoTexto = order.order_type === 'delivery' ? 'Tipo: DELIVERY' : 'Tipo: RESTAURANTE'
    lines.push({ text: tipoTexto })
    
    // Se for delivery, mostrar endereço
    if (order.order_type === 'delivery' && order.delivery_address) {
      lines.push({ text: `Endereco: ${order.delivery_address}` })
    }
  }
  
  lines.push({ text: '--------------------------------' })
  
  // Itens do pedido (compacto - item e preço na mesma linha)
  const items = Array.isArray(order.items) ? order.items : JSON.parse(order.items)
  items.forEach(item => {
    const itemTotal = item.price * item.quantity
    const priceLine = `R$ ${itemTotal.toFixed(2).replace('.', ',')}`
    const itemLine = `${item.quantity}x ${item.name}`
    // Formato: "2x Hambúrguer        R$ 36,00"
    const padding = LINE_WIDTH - itemLine.length - priceLine.length
    lines.push({ text: itemLine + ' '.repeat(padding > 0 ? padding : 1) + priceLine })
  })
  
  lines.push({ text: '--------------------------------' })
  
  // Total (destacado)
  const totalPrice = typeof order.total_price === 'string' 
    ? parseFloat(order.total_price) 
    : parseFloat(order.total_price.toString())
  const totalLine = `TOTAL: R$ ${totalPrice.toFixed(2).replace('.', ',')}`
  lines.push({ text: totalLine.toUpperCase(), bold: true })
  lines.push({ text: '' })
  
  // Método de pagamento e tempo
  if (order.payment_method) {
    lines.push({ text: `Pagamento: ${order.payment_method}` })
  }
  
  // Tempo estimado
  if (order.estimated_time && order.estimated_time > 0) {
    const tempoMin = order.estimated_time
    const tempoMax = order.estimated_time + 10
    lines.push({ text: `Tempo: ${tempoMin}-${tempoMax} min` })
  }
  
  lines.push({ text: '--------------------------------' })
  
  // Rodapé
  lines.push({ text: 'Obrigado pela preferência!' })
  lines.push({ text: 'Volte sempre!' })
  lines.push({ text: '' })
  lines.push({ text: '75 999660606' })
  lines.push({ text: '' }) // Espaço para cortar
  
  return lines
}

/**
 * Gera PDF do cupom
 */
async function generatePDF(orderIdentifier) {
  try {
    // Buscar pedido do banco - aceita UUID, display_id (#007) ou daily_sequence (7)
    let order
    
    // Se começa com #, é display_id
    if (orderIdentifier.startsWith('#')) {
      order = await prisma.order.findFirst({
        where: { display_id: orderIdentifier }
      })
    } 
    // Se é um número, pode ser daily_sequence
    else if (/^\d+$/.test(orderIdentifier)) {
      const sequence = parseInt(orderIdentifier)
      order = await prisma.order.findFirst({
        where: { daily_sequence: sequence }
      })
    } 
    // Caso contrário, assume que é UUID
    else {
      order = await prisma.order.findUnique({
        where: { id: orderIdentifier }
      })
    }
    
    if (!order) {
      console.error(`❌ Pedido não encontrado: ${orderIdentifier}`)
      console.error(`   Tente usar: UUID, display_id (#007) ou daily_sequence (7)`)
      process.exit(1)
    }
    
    console.log(`✅ Pedido encontrado: ${order.display_id || order.id}`)
    console.log(`   Cliente: ${order.customer_name}`)
    console.log(`   Total: R$ ${order.total_price}`)
    
    // Criar documento PDF
    const doc = new PDFDocument({
      size: [PAPER_WIDTH_POINTS, 1000], // Largura fixa de 58mm, altura automática
      margins: { top: 15, bottom: 15, left: 8, right: 8 },
      autoFirstPage: true
    })
    
    // Nome do arquivo
    const fileName = `cupom-${order.display_id || order.id.substring(0, 8)}.pdf`
    const filePath = path.join(process.cwd(), fileName)
    
    // Pipe para arquivo
    doc.pipe(fs.createWriteStream(filePath))
    
    // Formatar e adicionar linhas
    const lines = formatOrder(order)
    
    let yPosition = 15
    
    lines.forEach(line => {
      if (line.text === '') {
        yPosition += LINE_HEIGHT / 2
        return
      }
      
      // Verificar se precisa de nova página
      if (yPosition > 950) {
        doc.addPage()
        yPosition = 15
      }
      
      doc.fontSize(line.bold ? FONT_SIZE_BOLD : FONT_SIZE)
      
      if (line.bold) {
        doc.font('Helvetica-Bold')
      } else {
        doc.font('Helvetica')
      }
      
      // Usar o método text com alinhamento
      doc.text(line.text, 8, yPosition, {
        width: PAPER_WIDTH_POINTS - 16,
        align: line.align || 'left',
        lineGap: 2
      })
      
      // Calcular altura da linha baseado no texto
      const textHeight = doc.heightOfString(line.text, {
        width: PAPER_WIDTH_POINTS - 16
      })
      yPosition += textHeight + 2
    })
    
    // Finalizar PDF
    doc.end()
    
    // Aguardar finalização
    await new Promise((resolve, reject) => {
      doc.on('end', () => {
        console.log(`\n✅ PDF gerado com sucesso!`)
        console.log(`   Arquivo: ${filePath}`)
        console.log(`\n   Abra o arquivo para visualizar o cupom.`)
        resolve()
      })
      doc.on('error', reject)
    })
    
  } catch (error) {
    console.error('❌ Erro ao gerar PDF:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Executar script
const orderIdentifier = process.argv[2]

if (!orderIdentifier) {
  console.error('❌ Por favor, forneça o ID do pedido')
  console.error('   Uso: node gerar-pdf-cupom.js <order_id>')
  console.error('   Exemplos:')
  console.error('     node gerar-pdf-cupom.js #007')
  console.error('     node gerar-pdf-cupom.js 7')
  console.error('     node gerar-pdf-cupom.js 7e1ea4a3-2345-4fdd-bb2f-eddb317b1e71')
  process.exit(1)
}

generatePDF(orderIdentifier)
