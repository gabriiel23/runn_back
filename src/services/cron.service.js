const cron = require('node-cron')
const { crearRetoDiarioIA, crearRetoSemanalIA } = require('./retos.service')

const iniciarCron = () => {
  // Generar reto diario cada día a medianoche
  cron.schedule('0 0 * * *', async () => {
    console.log('Generando reto diario con IA...')
    try {
      const reto = await crearRetoDiarioIA()
      console.log(`Reto diario creado: ${reto.titulo}`)
    } catch (error) {
      console.error('Error generando reto diario:', error.message)
    }
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
