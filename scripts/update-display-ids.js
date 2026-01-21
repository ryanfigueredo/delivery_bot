/**
 * Script para atualizar display_id de pedidos antigos que não têm esse campo
 * Executa: node scripts/update-display-ids.js
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function updateDisplayIds() {
  try {
    console.log('🔄 Atualizando display_id de pedidos antigos...')
    
    // Buscar todos os pedidos sem display_id
    const ordersWithoutDisplayId = await prisma.order.findMany({
      where: {
        OR: [
          { display_id: null },
          { display_id: '' }
        ]
      },
      orderBy: {
        created_at: 'asc'
      }
    })
    
    console.log(`📦 Encontrados ${ordersWithoutDisplayId.length} pedidos sem display_id`)
    
    let updated = 0
    
    for (const order of ordersWithoutDisplayId) {
      // Se tiver daily_sequence, usar ele para gerar display_id
      if (order.daily_sequence) {
        const displayId = `#${String(order.daily_sequence).padStart(3, '0')}`
        
        await prisma.order.update({
          where: { id: order.id },
          data: { display_id: displayId }
        })
        
        console.log(`✅ Pedido ${order.id} atualizado: ${displayId}`)
        updated++
      } else {
        // Se não tiver daily_sequence, calcular baseado na data
        const orderDate = new Date(order.created_at)
        const startOfDay = new Date(orderDate)
        startOfDay.setHours(0, 0, 0, 0)
        const endOfDay = new Date(orderDate)
        endOfDay.setHours(23, 59, 59, 999)
        
        // Contar quantos pedidos foram criados no mesmo dia antes deste
        const dailySequence = await prisma.order.count({
          where: {
            created_at: {
              gte: startOfDay,
              lte: endOfDay
            },
            id: {
              lte: order.id // Assumindo que IDs são ordenados por criação
            }
          }
        })
        
        const displayId = `#${String(dailySequence).padStart(3, '0')}`
        
        await prisma.order.update({
          where: { id: order.id },
          data: { 
            display_id: displayId,
            daily_sequence: dailySequence
          }
        })
        
        console.log(`✅ Pedido ${order.id} atualizado: ${displayId} (daily_sequence: ${dailySequence})`)
        updated++
      }
    }
    
    console.log(`\n✨ Concluído! ${updated} pedidos atualizados.`)
  } catch (error) {
    console.error('❌ Erro ao atualizar display_ids:', error)
  } finally {
    await prisma.$disconnect()
  }
}

updateDisplayIds()
