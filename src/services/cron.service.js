const cron = require('node-cron')
const { crearRetoDiarioIA, crearRetoSemanalIA } = require('./retos.service')

const { generarFraseMotivacional } = require('./ia.service')
const prisma = require('../prisma')

const _rotarFrases = async () => {
  try {
    const datos = await generarFraseMotivacional()
    await prisma.frases_motivacionales.create({
      data: {
        frase: datos.frase,
        autor: datos.autor,
        generado_por_ia: true,
        activa: true
      }
    })

    const activas = await prisma.frases_motivacionales.findMany({
      where: { activa: true },
      orderBy: { creado_en: 'desc' },
      select: { id: true }
    })

    if (activas.length > 4) {
      const idsParaDesactivar = activas.slice(4).map(f => f.id)
      await prisma.frases_motivacionales.updateMany({
        where: { id: { in: idsParaDesactivar } },
        data: { activa: false }
      })
    }
    console.log(`Frase generada con IA (Max 4 respetado).`)
  } catch (error) {
    console.error('Error rotando frases diarias:', error.message)
  }
}

const iniciarCron = () => {
  // Generar reto diario y frase cada día a medianoche
  cron.schedule('0 0 * * *', async () => {
    console.log('Generando reto diario y frase con IA...')
    try {
      const reto = await crearRetoDiarioIA()
      console.log(`Reto diario creado: ${reto.titulo}`)
    } catch (error) {
      console.error('Error generando reto diario:', error.message)
    }
    await _rotarFrases()
  }, { timezone: 'America/Guayaquil' })

  // Generar reto semanal cada lunes a medianoche
  cron.schedule('0 0 * * 1', async () => {
    console.log('Generando reto semanal con IA...')
    try {
      const reto = await crearRetoSemanalIA()
      console.log(`Reto semanal creado: ${reto.titulo}`)
    } catch (error) {
      console.error('Error generando reto semanal:', error.message)
    }
  }, { timezone: 'America/Guayaquil' })

  console.log('Cron jobs iniciados ✅')
}

module.exports = { iniciarCron }
