const prisma = require('../prisma')
const { generarRetoDiario, generarRetoSemanal } = require('./ia.service')

// Niveles de racha semanal
const NIVELES_RACHA = [
  { nivel: 'bronce', semanas: 2 },
  { nivel: 'plata', semanas: 8 },
  { nivel: 'oro', semanas: 16 },
  { nivel: 'diamante', semanas: 32 }
]

// Insignias de distancia
const verificarInsigniasDistancia = async (usuarioId) => {
  const stats = await prisma.actividades.aggregate({
    where: { usuario_id: usuarioId, hora_fin: { not: null } },
    _sum: { distancia_km: true }
  })

  const kmTotales = parseFloat(stats._sum.distancia_km || 0)

  const insignias = await prisma.insignias_distancia.findMany({
    where: { km_requeridos: { lte: kmTotales } }
  })

  const nuevasInsignias = []

  for (const insignia of insignias) {
    try {
      await prisma.usuario_insignias_distancia.create({
        data: { usuario_id: usuarioId, insignia_id: insignia.id }
      })
      nuevasInsignias.push(insignia)
    } catch {
      // Ya tiene esa insignia, ignorar
    }
  }

  return nuevasInsignias
}

// Verificar y actualizar progreso en retos diarios
const verificarRetosDiarios = async (usuarioId, actividad) => {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  const retoHoy = await prisma.retos_diarios.findFirst({
    where: { fecha: hoy }
  })

  if (!retoHoy) return null

  // Inscribir al usuario si no está
  let participacion = await prisma.retos_diarios_usuario.findUnique({
    where: { usuario_id_reto_id: { usuario_id: usuarioId, reto_id: retoHoy.id } }
  })

  if (!participacion) {
    participacion = await prisma.retos_diarios_usuario.create({
      data: { usuario_id: usuarioId, reto_id: retoHoy.id, progreso_actual: 0 }
    })
  }

  if (participacion.completado) return null

  // Calcular progreso según tipo
  let valorActividad = 0
  switch (retoHoy.tipo) {
    case 'distancia': valorActividad = parseFloat(actividad.distancia_km || 0); break
    case 'tiempo': valorActividad = (actividad.duracion_segs || 0) / 60; break
    case 'velocidad': valorActividad = parseFloat(actividad.velocidad_promedio || 0); break
    case 'calorias': valorActividad = actividad.calorias || 0; break
  }

  const nuevoProgreso = parseFloat(participacion.progreso_actual) + valorActividad
  const completado = nuevoProgreso >= parseFloat(retoHoy.valor_objetivo)

  await prisma.retos_diarios_usuario.update({
    where: { usuario_id_reto_id: { usuario_id: usuarioId, reto_id: retoHoy.id } },
    data: {
      progreso_actual: nuevoProgreso,
      completado,
      completado_en: completado ? new Date() : null
    }
  })

  if (completado) {
    await prisma.usuarios.update({
      where: { id: usuarioId },
      data: { puntos: { increment: retoHoy.puntos_recompensa } }
    })
  }

  return { reto: retoHoy, completado, progreso: nuevoProgreso }
}

// Verificar y actualizar progreso en reto semanal
const verificarRetoSemanal = async (usuarioId, actividad) => {
  const hoy = new Date()
  const lunes = new Date(hoy)
  lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7))
  lunes.setHours(0, 0, 0, 0)
  const domingo = new Date(lunes)
  domingo.setDate(lunes.getDate() + 6)

  const retoSemanal = await prisma.retos_semanales.findFirst({
    where: {
      semana_inicio: { lte: hoy },
      semana_fin: { gte: hoy }
    }
  })

  if (!retoSemanal) return null

  let participacion = await prisma.retos_semanales_usuario.findUnique({
    where: { usuario_id_reto_id: { usuario_id: usuarioId, reto_id: retoSemanal.id } }
  })

  if (!participacion) {
    participacion = await prisma.retos_semanales_usuario.create({
      data: { usuario_id: usuarioId, reto_id: retoSemanal.id, progreso_actual: 0 }
    })
  }

  if (participacion.completado) return null

  let valorActividad = 0
  switch (retoSemanal.tipo) {
    case 'distancia': valorActividad = parseFloat(actividad.distancia_km || 0); break
    case 'tiempo': valorActividad = (actividad.duracion_segs || 0) / 60; break
    case 'velocidad': valorActividad = parseFloat(actividad.velocidad_promedio || 0); break
    case 'calorias': valorActividad = actividad.calorias || 0; break
  }

  const nuevoProgreso = parseFloat(participacion.progreso_actual) + valorActividad
  const completado = nuevoProgreso >= parseFloat(retoSemanal.valor_objetivo)

  await prisma.retos_semanales_usuario.update({
    where: { usuario_id_reto_id: { usuario_id: usuarioId, reto_id: retoSemanal.id } },
    data: {
      progreso_actual: nuevoProgreso,
      completado,
      completado_en: completado ? new Date() : null
    }
  })

  if (completado) {
    await prisma.usuarios.update({
      where: { id: usuarioId },
      data: { puntos: { increment: retoSemanal.puntos_recompensa } }
    })
    await actualizarRacha(usuarioId, lunes)
  }

  return { reto: retoSemanal, completado, progreso: nuevoProgreso }
}

// Actualizar racha semanal y nivel
const actualizarRacha = async (usuarioId, semanaCompletada) => {
  let racha = await prisma.usuario_racha.findUnique({
    where: { usuario_id: usuarioId }
  })

  if (!racha) {
    racha = await prisma.usuario_racha.create({
      data: { usuario_id: usuarioId }
    })
  }

  // Verificar si la semana anterior fue completada para mantener racha
  const semanaAnterior = new Date(semanaCompletada)
  semanaAnterior.setDate(semanaAnterior.getDate() - 7)

  const esSemanaConsecutiva =
    racha.ultima_semana_completada &&
    new Date(racha.ultima_semana_completada).getTime() === semanaAnterior.getTime()

  const nuevaRacha = esSemanaConsecutiva ? racha.racha_actual + 1 : 1
  const nuevaRachaMaxima = Math.max(nuevaRacha, racha.racha_maxima || 0)
  const nuevasSemanas = (racha.semanas_acumuladas || 0) + 1

  // Determinar nivel según semanas acumuladas
  let nivelActual = 'sin_nivel'
  for (const { nivel, semanas } of NIVELES_RACHA) {
    if (nuevasSemanas >= semanas) nivelActual = nivel
  }

  await prisma.usuario_racha.update({
    where: { usuario_id: usuarioId },
    data: {
      racha_actual: nuevaRacha,
      racha_maxima: nuevaRachaMaxima,
      nivel_actual: nivelActual,
      semanas_acumuladas: nuevasSemanas,
      ultima_semana_completada: semanaCompletada,
      actualizado_en: new Date()
    }
  })

  return { racha: nuevaRacha, nivel: nivelActual, semanas: nuevasSemanas }
}

// Generar reto diario con IA y guardarlo
const crearRetoDiarioIA = async (fechaObjetivo = null) => {
  const hoy = fechaObjetivo ? new Date(fechaObjetivo) : new Date()
  hoy.setHours(0, 0, 0, 0)

  const existe = await prisma.retos_diarios.findFirst({ where: { fecha: hoy } })
  if (existe) return existe

  const datos = await generarRetoDiario()

  return await prisma.retos_diarios.create({
    data: { ...datos, fecha: hoy }
  })
}

// Generar reto semanal con IA y guardarlo
const crearRetoSemanalIA = async (targetDate = null) => {
  const base = targetDate ? new Date(targetDate) : new Date()
  const lunes = new Date(base)
  lunes.setDate(base.getDate() - ((base.getDay() + 6) % 7))
  lunes.setHours(0, 0, 0, 0)

  const domingo = new Date(lunes)
  domingo.setDate(lunes.getDate() + 6)

  const existe = await prisma.retos_semanales.findFirst({
    where: { semana_inicio: lunes }
  })
  if (existe) return existe

  const datos = await generarRetoSemanal()

  return await prisma.retos_semanales.create({
    data: { ...datos, semana_inicio: lunes, semana_fin: domingo }
  })
}

module.exports = {
  verificarInsigniasDistancia,
  verificarRetosDiarios,
  verificarRetoSemanal,
  crearRetoDiarioIA,
  crearRetoSemanalIA,
  actualizarRacha
}