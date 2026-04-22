const prisma = require('../prisma')
const { notificar } = require('./notificaciones.service')

const formatearTiempo = (segs) => {
    if (!segs) return '00:00:00'
    const h = Math.floor(segs / 3600)
    const m = Math.floor((segs % 3600) / 60)
    const s = segs % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Busca todas las disputas grupales que hayan caducado (pasó su fecha límite de 48h)
 * y determina si el grupo ganó o perdió el territorio.
 */
const procesarDisputasGrupalesPendientes = async () => {
    try {
        const ahora = new Date()

        const disputasExpiradas = await prisma.territorio_disputas_grupales.findMany({
            where: {
                estado: 'activa',
                expira_en: { lte: ahora }
            },
            include: {
                territorios: true,
                grupos: true
            }
        })

        for (const disputa of disputasExpiradas) {
            const territorio = disputa.territorios
            const grupo = disputa.grupos

            if (!territorio || !grupo) continue

            // 1. Contar miembros del grupo
            const totalMiembros = await prisma.miembros_grupo.count({
                where: { grupo_id: disputa.grupo_id }
            })

            if (totalMiembros === 0) {
                // Grupo sin miembros (muy raro pero posible), pierde automáticamente
                await prisma.territorio_disputas_grupales.update({
                    where: { id: disputa.id },
                    data: { estado: 'perdida' }
                })
                continue
            }

            // 2. Sumar tiempos de aportes
            const aportes = await prisma.territorio_aportes_grupales.findMany({
                where: { disputa_id: disputa.id }
            })

            // Si nadie aportó aparte quizá del iniciador, la suma sigue siendo válida,
            // (cada aporte suma el tiempo real, pero si alguien NO corrió, se le penaliza?
            // "el promedio se divide siempre para todos")
            // Pero, ¿qué tiempo le ponemos a los inactivos? ¿0?
            // Si le sumamos 0 y dividimos para el total, el promedio bajará (se hace MÁS RÁPIDO). ¡Eso es trampa!
            // Para penalizar inactividad:
            // Regla: A los inactivos se les asigna un tiempo gigante (ej. 24 horas), 
            // O directamente el grupo pierde si no aportan todos.
            // Según indicación: "el promedio se divide siempre para todos... castigando inactividad"
            // Mejor manera: Sumamos los tiempos aportados. Por CADA miembro que NO aportó, le sumamos un DNF de 5 horas (18000 segundos)
            // de esa forma el promedio se dispara hacia arriba (peor tiempo)
            
            const aportesPorUsuario = new Set(aportes.map(a => a.usuario_id))
            const inactivosCount = totalMiembros - aportesPorUsuario.size
            
            const PENALIZACION_SEGS = 18000 // 5 horas

            const sumaAportes = aportes.reduce((sum, a) => sum + a.tiempo_segs, 0)
            const sumaTotalConPenalizacion = sumaAportes + (inactivosCount * PENALIZACION_SEGS)

            const promedioSegs = Math.floor(sumaTotalConPenalizacion / totalMiembros)

            const tiempoRecord = territorio.tiempo_record_segs
            const esLibre = !territorio.grupo_propietario_id && !territorio.propietario_id
            
            // Un grupo gana si el territorio está libre (record null) 
            // O si superan activamente el récord (<).
            const gano = esLibre || promedioSegs < tiempoRecord

            if (gano) {
                // Registrar en historial como disputa ganada / conquista
                await prisma.territorios_historial.create({
                    data: {
                        territorio_id: territorio.id,
                        grupo_id: grupo.id,
                        tipo: esLibre ? 'conquista' : 'disputa',
                        resultado: 'ganado',
                        tiempo_segs: promedioSegs,
                        tiempo_anterior_segs: tiempoRecord,
                        modalidad: 'grupal'
                    }
                })

                // Quitar al dueño existente (notificándoles)
                const grupoAnteriorId = territorio.grupo_propietario_id
                if (grupoAnteriorId && grupoAnteriorId !== grupo.id) {
                    const miembrosAnt = await prisma.miembros_grupo.findMany({ where: { grupo_id: grupoAnteriorId }})
                    for (const m of miembrosAnt) {
                        await notificar(
                            m.usuario_id,
                            'territorio_grupo_perdido',
                            `Tu grupo perdió "${territorio.nombre}" ante el grupo "${grupo.nombre}". ¡Salgan a recuperarlo!`
                        )
                    }
                }

                // Actualizar Territorio
                await prisma.territorios.update({
                    where: { id: territorio.id },
                    data: {
                        grupo_propietario_id: grupo.id,
                        propietario_id: null,
                        conquistado_en: new Date(),
                        tiempo_record_segs: promedioSegs,
                        tiempo_record_grupo_id: grupo.id,
                        tiempo_record_usuario_id: null,
                        veces_disputado: { increment: esLibre ? 0 : 1 },
                        ultima_disputa_en: new Date()
                    }
                })

                // Cerrar disputa
                await prisma.territorio_disputas_grupales.update({
                    where: { id: disputa.id },
                    data: { estado: 'ganada' }
                })

                // Notificar a ganadores
                const miembrosActuales = await prisma.miembros_grupo.findMany({ where: { grupo_id: grupo.id }})
                for (const m of miembrosActuales) {
                    await notificar(
                        m.usuario_id,
                        'territorio_grupo_ganado',
                        `¡Felicidades! La disputa terminó y tu grupo conquistó "${territorio.nombre}" con un promedio de ${formatearTiempo(promedioSegs)}.`
                    )
                }

            } else {
                // PERDIDO
                await prisma.territorios_historial.create({
                    data: {
                        territorio_id: territorio.id,
                        grupo_id: grupo.id,
                        tipo: 'disputa',
                        resultado: 'perdido',
                        tiempo_segs: promedioSegs,
                        tiempo_anterior_segs: tiempoRecord,
                        modalidad: 'grupal'
                    }
                })

                await prisma.territorios.update({
                    where: { id: territorio.id },
                    data: {
                        veces_disputado: { increment: 1 },
                        total_defensas: { increment: 1 },
                        ultima_disputa_en: new Date()
                    }
                })

                await prisma.territorio_disputas_grupales.update({
                    where: { id: disputa.id },
                    data: { estado: 'perdida' }
                })

                // Notificar a los que intentaron
                const miembrosActuales = await prisma.miembros_grupo.findMany({ where: { grupo_id: grupo.id }})
                for (const m of miembrosActuales) {
                    await notificar(
                        m.usuario_id,
                        'territorio_grupo_perdido',
                        `El tiempo se acabó. El promedio grupal en "${territorio.nombre}" fue de ${formatearTiempo(promedioSegs)}, no alcanzó para superar el récord. ¡Inténtenlo otra vez!`
                    )
                }
            }
        }
    } catch (e) {
        console.error('Error procesando disputas grupales:', e)
    }
}

module.exports = {
    procesarDisputasGrupalesPendientes
}
