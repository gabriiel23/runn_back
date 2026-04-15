const express = require('express')
const prisma = require('../prisma')
const verificarToken = require('../middlewares/auth.middleware')
const verificarAdmin = require('../middlewares/admin.middleware')
const { crearRetoDiarioIA, crearRetoSemanalIA } = require('../services/retos.service')

const router = express.Router()

// ─── RETO DIARIO DE HOY ───────────────────────────────────
router.get('/diario/hoy', verificarToken, async (req, res) => {
    try {
        const hoy = new Date()
        hoy.setHours(0, 0, 0, 0)

        let reto = await prisma.retos_diarios.findFirst({
            where: { fecha: hoy }
        })

        // Si no existe, generarlo con IA
        if (!reto) {
            reto = await crearRetoDiarioIA()
        }

        // Ver progreso del usuario en este reto
        const participacion = await prisma.retos_diarios_usuario.findUnique({
            where: {
                usuario_id_reto_id: {
                    usuario_id: req.usuario.id,
                    reto_id: reto.id
                }
            }
        })

        res.json({
            reto,
            participacion: participacion || {
                completado: false,
                progreso_actual: 0
            }
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener reto diario', error: error.message })
    }
})

// ─── RETO SEMANAL ACTUAL ──────────────────────────────────
router.get('/semanal/actual', verificarToken, async (req, res) => {
    try {
        const hoy = new Date()

        let reto = await prisma.retos_semanales.findFirst({
            where: {
                semana_inicio: { lte: hoy },
                semana_fin: { gte: hoy }
            }
        })

        if (!reto) {
            reto = await crearRetoSemanalIA()
        }

        const participacion = await prisma.retos_semanales_usuario.findUnique({
            where: {
                usuario_id_reto_id: {
                    usuario_id: req.usuario.id,
                    reto_id: reto.id
                }
            }
        })

        res.json({
            reto,
            participacion: participacion || {
                completado: false,
                progreso_actual: 0
            }
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener reto semanal', error: error.message })
    }
})

// ─── MIS INSIGNIAS DE DISTANCIA ───────────────────────────
router.get('/insignias/distancia', verificarToken, async (req, res) => {
    try {
        // Todas las insignias disponibles
        const todasInsignias = await prisma.insignias_distancia.findMany({
            orderBy: { km_requeridos: 'asc' }
        })

        // Las que ya tiene el usuario
        const misInsignias = await prisma.usuario_insignias_distancia.findMany({
            where: { usuario_id: req.usuario.id }
        })

        const insigniasIds = misInsignias.map(i => i.insignia_id)

        // Km totales del usuario
        const stats = await prisma.actividades.aggregate({
            where: { usuario_id: req.usuario.id, hora_fin: { not: null } },
            _sum: { distancia_km: true }
        })
        const kmTotales = parseFloat(stats._sum.distancia_km || 0)

        const insigniasConEstado = todasInsignias.map(insignia => ({
            ...insignia,
            desbloqueada: insigniasIds.includes(insignia.id),
            ganado_en: misInsignias.find(i => i.insignia_id === insignia.id)?.ganado_en || null,
            progreso: Math.min((kmTotales / parseFloat(insignia.km_requeridos)) * 100, 100)
        }))

        res.json({
            km_totales: kmTotales,
            insignias: insigniasConEstado
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener insignias', error: error.message })
    }
})

// ─── MI RACHA SEMANAL ─────────────────────────────────────
router.get('/racha', verificarToken, async (req, res) => {
    try {
        let racha = await prisma.usuario_racha.findUnique({
            where: { usuario_id: req.usuario.id }
        })

        if (!racha) {
            racha = {
                racha_actual: 0,
                racha_maxima: 0,
                nivel_actual: 'sin_nivel',
                semanas_acumuladas: 0,
                ultima_semana_completada: null
            }
        }

        // Próximo nivel
        const NIVELES = [
            { nivel: 'bronce', semanas: 2 },
            { nivel: 'plata', semanas: 8 },
            { nivel: 'oro', semanas: 16 },
            { nivel: 'diamante', semanas: 32 }
        ]

        const proximoNivel = NIVELES.find(n => n.semanas > (racha.semanas_acumuladas || 0))

        res.json({
            racha_actual: racha.racha_actual,
            racha_maxima: racha.racha_maxima,
            nivel_actual: racha.nivel_actual,
            semanas_acumuladas: racha.semanas_acumuladas,
            ultima_semana_completada: racha.ultima_semana_completada,
            proximo_nivel: proximoNivel ? {
                nivel: proximoNivel.nivel,
                semanas_necesarias: proximoNivel.semanas,
                semanas_restantes: proximoNivel.semanas - (racha.semanas_acumuladas || 0)
            } : null
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener racha', error: error.message })
    }
})

// ─── HISTORIAL RETOS DIARIOS ──────────────────────────────
router.get('/diario/historial', verificarToken, async (req, res) => {
    try {
        const historial = await prisma.retos_diarios_usuario.findMany({
            where: { usuario_id: req.usuario.id },
            include: { retos_diarios: true },
            orderBy: { creado_en: 'desc' },
            take: 30
        })

        res.json({ historial })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener historial', error: error.message })
    }
})

// ─── HISTORIAL RETOS SEMANALES ────────────────────────────
router.get('/semanal/historial', verificarToken, async (req, res) => {
    try {
        const historial = await prisma.retos_semanales_usuario.findMany({
            where: { usuario_id: req.usuario.id },
            include: { retos_semanales: true },
            orderBy: { creado_en: 'desc' },
            take: 20
        })

        res.json({ historial })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener historial', error: error.message })
    }
})

// ─── CONSULTAS DE RETOS FUTUROS (admin) ─────────────────
router.get('/admin/diario/manana', verificarToken, verificarAdmin, async (req, res) => {
    try {
        const manana = new Date()
        manana.setDate(manana.getDate() + 1)
        manana.setHours(0, 0, 0, 0)

        const reto = await prisma.retos_diarios.findFirst({ where: { fecha: manana } })
        res.json({ reto })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error', error: error.message })
    }
})

router.get('/admin/semanal/proxima', verificarToken, verificarAdmin, async (req, res) => {
    try {
        const hoy = new Date()
        const proximoLunes = new Date(hoy)
        proximoLunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7) + 7)
        proximoLunes.setHours(0, 0, 0, 0)

        const reto = await prisma.retos_semanales.findFirst({ where: { semana_inicio: proximoLunes } })
        res.json({ reto })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error', error: error.message })
    }
})

// ─── GENERAR RETOS MANUALMENTE (admin) ───────────────────
router.post('/generar/diario', verificarToken, verificarAdmin, async (req, res) => {
    try {
        const { fecha_objetivo } = req.body
        let fecha = new Date()
        if (fecha_objetivo === 'manana') {
            fecha.setDate(fecha.getDate() + 1)
        }
        const reto = await crearRetoDiarioIA(fecha)
        res.json({ mensaje: 'Reto diario generado ✅', reto })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al generar reto', error: error.message })
    }
})

router.post('/generar/semanal', verificarToken, verificarAdmin, async (req, res) => {
    try {
        const { fecha_objetivo } = req.body
        let fecha = new Date()
        if (fecha_objetivo === 'proxima') {
            fecha.setDate(fecha.getDate() + 7)
        }
        const reto = await crearRetoSemanalIA(fecha)
        res.json({ mensaje: 'Reto semanal generado ✅', reto })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al generar reto', error: error.message })
    }
})

// ─── CREAR RETO DIARIO MANUAL (admin) ─────────────────────
router.post('/diario/manual', verificarToken, verificarAdmin, async (req, res) => {
    const { titulo, descripcion, tipo, valor_objetivo, unidad, puntos_recompensa, fecha } = req.body

    if (!titulo || !tipo || !valor_objetivo || !unidad) {
        return res.status(400).json({ mensaje: 'titulo, tipo, valor_objetivo y unidad son requeridos' })
    }

    const tiposValidos = ['distancia', 'tiempo', 'velocidad', 'calorias']
    if (!tiposValidos.includes(tipo)) {
        return res.status(400).json({ mensaje: `Tipo inválido. Usa: ${tiposValidos.join(', ')}` })
    }

    try {
        const fechaReto = fecha ? new Date(fecha) : new Date()
        fechaReto.setHours(0, 0, 0, 0)

        const existe = await prisma.retos_diarios.findFirst({
            where: { fecha: fechaReto }
        })

        if (existe) {
            return res.status(400).json({ mensaje: 'Ya existe un reto diario para esa fecha' })
        }

        const reto = await prisma.retos_diarios.create({
            data: {
                titulo,
                descripcion,
                tipo,
                valor_objetivo: parseFloat(valor_objetivo),
                unidad,
                puntos_recompensa: puntos_recompensa ? parseInt(puntos_recompensa) : 10,
                fecha: fechaReto,
                generado_por_ia: false
            }
        })

        res.status(201).json({ mensaje: 'Reto diario creado manualmente ✅', reto })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al crear reto diario', error: error.message })
    }
})

// ─── CREAR RETO SEMANAL MANUAL (admin) ────────────────────
router.post('/semanal/manual', verificarToken, verificarAdmin, async (req, res) => {
    const { titulo, descripcion, tipo, valor_objetivo, unidad, puntos_recompensa, semana_inicio } = req.body

    if (!titulo || !tipo || !valor_objetivo || !unidad) {
        return res.status(400).json({ mensaje: 'titulo, tipo, valor_objetivo y unidad son requeridos' })
    }

    const tiposValidos = ['distancia', 'tiempo', 'velocidad', 'calorias']
    if (!tiposValidos.includes(tipo)) {
        return res.status(400).json({ mensaje: `Tipo inválido. Usa: ${tiposValidos.join(', ')}` })
    }

    try {
        const lunes = semana_inicio ? new Date(semana_inicio) : new Date()
        if (!semana_inicio) {
            lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7))
        }
        lunes.setHours(0, 0, 0, 0)

        const domingo = new Date(lunes)
        domingo.setDate(lunes.getDate() + 6)

        const existe = await prisma.retos_semanales.findFirst({
            where: { semana_inicio: lunes }
        })

        if (existe) {
            return res.status(400).json({ mensaje: 'Ya existe un reto semanal para esa semana' })
        }

        const reto = await prisma.retos_semanales.create({
            data: {
                titulo,
                descripcion,
                tipo,
                valor_objetivo: parseFloat(valor_objetivo),
                unidad,
                puntos_recompensa: puntos_recompensa ? parseInt(puntos_recompensa) : 50,
                semana_inicio: lunes,
                semana_fin: domingo,
                generado_por_ia: false
            }
        })

        res.status(201).json({ mensaje: 'Reto semanal creado manualmente ✅', reto })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al crear reto semanal', error: error.message })
    }
})

// ─── EDITAR RETO DIARIO (admin) ───────────────────────────
router.put('/diario/:id', verificarToken, verificarAdmin, async (req, res) => {
    const { titulo, descripcion, tipo, valor_objetivo, unidad, puntos_recompensa } = req.body

    try {
        const reto = await prisma.retos_diarios.update({
            where: { id: req.params.id },
            data: {
                ...(titulo && { titulo }),
                ...(descripcion !== undefined && { descripcion }),
                ...(tipo && { tipo }),
                ...(valor_objetivo && { valor_objetivo: parseFloat(valor_objetivo) }),
                ...(unidad && { unidad }),
                ...(puntos_recompensa && { puntos_recompensa: parseInt(puntos_recompensa) })
            }
        })

        res.json({ mensaje: 'Reto diario actualizado ✅', reto })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar reto diario', error: error.message })
    }
})

// ─── EDITAR RETO SEMANAL (admin) ──────────────────────────
router.put('/semanal/:id', verificarToken, verificarAdmin, async (req, res) => {
    const { titulo, descripcion, tipo, valor_objetivo, unidad, puntos_recompensa } = req.body

    try {
        const reto = await prisma.retos_semanales.update({
            where: { id: req.params.id },
            data: {
                ...(titulo && { titulo }),
                ...(descripcion !== undefined && { descripcion }),
                ...(tipo && { tipo }),
                ...(valor_objetivo && { valor_objetivo: parseFloat(valor_objetivo) }),
                ...(unidad && { unidad }),
                ...(puntos_recompensa && { puntos_recompensa: parseInt(puntos_recompensa) })
            }
        })

        res.json({ mensaje: 'Reto semanal actualizado ✅', reto })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar reto semanal', error: error.message })
    }
})

// ─── ELIMINAR RETO DIARIO (admin) ─────────────────────────
router.delete('/diario/:id', verificarToken, verificarAdmin, async (req, res) => {
    try {
        await prisma.retos_diarios.delete({ where: { id: req.params.id } })
        res.json({ mensaje: 'Reto diario eliminado ✅' })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al eliminar reto diario', error: error.message })
    }
})

// ─── ELIMINAR RETO SEMANAL (admin) ────────────────────────
router.delete('/semanal/:id', verificarToken, verificarAdmin, async (req, res) => {
    try {
        await prisma.retos_semanales.delete({ where: { id: req.params.id } })
        res.json({ mensaje: 'Reto semanal eliminado ✅' })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al eliminar reto semanal', error: error.message })
    }
})

module.exports = router 
