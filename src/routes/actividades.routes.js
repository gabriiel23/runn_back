const express = require('express')
const prisma = require('../prisma')
const verificarToken = require('../middlewares/auth.middleware')

const router = express.Router()

const multer = require('multer')
const supabase = require('../supabase')

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
})

// ─── INICIAR CARRERA ──────────────────────────────────────
router.post('/iniciar', verificarToken, async (req, res) => {
    const { tipo, modalidad } = req.body

    if (!tipo) {
        return res.status(400).json({ mensaje: 'El tipo de actividad es requerido (correr o senderismo)' })
    }

    try {
        const actividad = await prisma.actividades.create({
            data: {
                usuario_id: req.usuario.id,
                tipo,
                modalidad: modalidad || 'individual',
                hora_inicio: new Date()
            }
        })

        res.status(201).json({
            mensaje: 'Carrera iniciada ✅',
            actividad_id: actividad.id,
            hora_inicio: actividad.hora_inicio
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al iniciar carrera', error: error.message })
    }
})

// ─── FINALIZAR CARRERA ────────────────────────────────────
router.put('/:id/finalizar', verificarToken, async (req, res) => {
    const {
        distancia_km,
        duracion_segs,
        velocidad_promedio,
        velocidad_max,
        ritmo_promedio,
        calorias,
        ruta,
        elevacion_ganada_m,
        pasos,
        frecuencia_cardiaca_promedio
    } = req.body

    if (!distancia_km || !duracion_segs) {
        return res.status(400).json({ mensaje: 'distancia_km y duracion_segs son requeridos' })
    }

    try {
        // Verificar que la actividad pertenece al usuario
        const actividadExistente = await prisma.actividades.findUnique({
            where: { id: req.params.id }
        })

        if (!actividadExistente) {
            return res.status(404).json({ mensaje: 'Actividad no encontrada' })
        }

        if (actividadExistente.usuario_id !== req.usuario.id) {
            return res.status(403).json({ mensaje: 'No tienes permiso para finalizar esta actividad' })
        }

        if (actividadExistente.hora_fin) {
            return res.status(400).json({ mensaje: 'Esta actividad ya fue finalizada' })
        }

        // Calcular puntos según distancia
        const distancia = parseFloat(distancia_km)
        let puntos_ganados = 0
        if (distancia >= 1) puntos_ganados += 10   // base por completar
        if (distancia >= 5) puntos_ganados += 15   // bonus 5km
        if (distancia >= 10) puntos_ganados += 25  // bonus 10km
        if (distancia >= 21) puntos_ganados += 50  // bonus media maratón
        if (distancia >= 42) puntos_ganados += 100 // bonus maratón completa

        const horaFin = new Date()

        let rutaParaDb = null
        if (ruta) {
            try {
                const parsed = JSON.parse(ruta)
                if (parsed.type === 'LineString' && Array.isArray(parsed.coordinates) && parsed.coordinates.length > 0) {
                    const wktCoords = parsed.coordinates.map(c => `${c[0]} ${c[1]}`).join(', ')
                    rutaParaDb = `LINESTRING(${wktCoords})`
                }
            } catch (err) {
                console.error('Error parseando JSON de ruta:', err)
            }
        }

        const actividad = await prisma.actividades.update({
            where: { id: req.params.id },
            data: {
                hora_fin: horaFin,
                distancia_km: distancia,
                duracion_segs: parseInt(duracion_segs),
                velocidad_promedio: velocidad_promedio ? parseFloat(velocidad_promedio) : null,
                velocidad_max: velocidad_max ? parseFloat(velocidad_max) : null,
                ritmo_promedio: ritmo_promedio ? parseFloat(ritmo_promedio) : null,
                calorias: calorias ? parseInt(calorias) : null,
                ruta: rutaParaDb,
                elevacion_ganada_m: elevacion_ganada_m ? parseFloat(elevacion_ganada_m) : null,
                pasos: pasos ? parseInt(pasos) : null,
                frecuencia_cardiaca_promedio: frecuencia_cardiaca_promedio ? parseInt(frecuencia_cardiaca_promedio) : null,
                puntos_ganados
            }
        })

        // Sumar puntos al usuario
        await prisma.usuarios.update({
            where: { id: req.usuario.id },
            data: {
                puntos: { increment: puntos_ganados }
            }
        })

        const { verificarInsigniasDistancia, verificarRetosDiarios, verificarRetoSemanal } = require('../services/retos.service')

        // Dentro del endpoint finalizar, antes del res.json:
        const [nuevasInsignias, retoDiario, retoSemanal] = await Promise.all([
            verificarInsigniasDistancia(req.usuario.id),
            verificarRetosDiarios(req.usuario.id, actividad),
            verificarRetoSemanal(req.usuario.id, actividad)
        ])

        res.json({
            mensaje: 'Carrera finalizada exitosamente ✅',
            actividad,
            puntos_ganados,
            resumen: {
                distancia_km: distancia,
                duracion_segs: parseInt(duracion_segs),
                duracion_formateada: formatearDuracion(parseInt(duracion_segs)),
                velocidad_promedio: velocidad_promedio ? parseFloat(velocidad_promedio) : null,
                velocidad_max: velocidad_max ? parseFloat(velocidad_max) : null,
                ritmo_promedio: ritmo_promedio ? parseFloat(ritmo_promedio) : null,
                calorias: calorias ? parseInt(calorias) : null,
                puntos_ganados
            },
            logros: {
                nuevas_insignias: nuevasInsignias,
                reto_diario: retoDiario,
                reto_semanal: retoSemanal
            }
        })

    } catch (error) {
        console.error('Error finalizando carrera:', error)
        res.status(500).json({ mensaje: 'Error BD: ' + error.message, error: error.message })
    }
})

// ─── COMPARTIR ACTIVIDAD ──────────────────────────────────
router.patch('/:id/compartir', verificarToken, async (req, res) => {
    try {
        const actividad = await prisma.actividades.findUnique({
            where: { id: req.params.id }
        })

        if (!actividad) {
            return res.status(404).json({ mensaje: 'Actividad no encontrada' })
        }

        if (actividad.usuario_id !== req.usuario.id) {
            return res.status(403).json({ mensaje: 'No tienes permiso para compartir esta actividad' })
        }

        if (!actividad.hora_fin) {
            return res.status(400).json({ mensaje: 'No puedes compartir una actividad que no ha finalizado' })
        }

        await prisma.actividades.update({
            where: { id: req.params.id },
            data: { compartida: true }
        })

        res.json({ mensaje: 'Actividad compartida exitosamente ✅' })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al compartir actividad', error: error.message })
    }
})

// ─── MIS ACTIVIDADES ──────────────────────────────────────
router.get('/mis-actividades', verificarToken, async (req, res) => {
    const { limite = 20, pagina = 1 } = req.query

    try {
        const skip = (parseInt(pagina) - 1) * parseInt(limite)

        const actividades = await prisma.actividades.findMany({
            where: {
                usuario_id: req.usuario.id,
                hora_fin: { not: null } // solo actividades completadas
            },
            orderBy: { hora_inicio: 'desc' },
            take: parseInt(limite),
            skip
        })

        const total = await prisma.actividades.count({
            where: {
                usuario_id: req.usuario.id,
                hora_fin: { not: null }
            }
        })

        const actividadesFormateadas = actividades.map(a => ({
            ...a,
            duracion_formateada: formatearDuracion(a.duracion_segs)
        }))

        res.json({
            total,
            pagina: parseInt(pagina),
            actividades: actividadesFormateadas
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener actividades', error: error.message })
    }
})


// ─── MIS ESTADÍSTICAS ─────────────────────────────────────
router.get('/mis-actividades/estadisticas', verificarToken, async (req, res) => {
    try {
        const actividades = await prisma.actividades.findMany({
            where: {
                usuario_id: req.usuario.id,
                hora_fin: { not: null }
            }
        })

        if (actividades.length === 0) {
            return res.json({
                total_carreras: 0,
                distancia_total_km: 0,
                tiempo_total_segs: 0,
                velocidad_promedio_general: 0,
                ritmo_promedio_general: 0,
                calorias_totales: 0,
                mejor_carrera: null,
                por_tipo: { correr: 0, senderismo: 0 }
            })
        }

        const distanciaTotal = actividades.reduce((sum, a) => sum + (parseFloat(a.distancia_km) || 0), 0)
        const tiempoTotal = actividades.reduce((sum, a) => sum + (a.duracion_segs || 0), 0)
        const caloriasTotal = actividades.reduce((sum, a) => sum + (a.calorias || 0), 0)

        const velocidades = actividades.filter(a => a.velocidad_promedio).map(a => parseFloat(a.velocidad_promedio))
        const velocidadPromedio = velocidades.length > 0
            ? velocidades.reduce((s, v) => s + v, 0) / velocidades.length
            : 0

        const ritmos = actividades.filter(a => a.ritmo_promedio).map(a => parseFloat(a.ritmo_promedio))
        const ritmoPromedio = ritmos.length > 0
            ? ritmos.reduce((s, r) => s + r, 0) / ritmos.length
            : 0

        const mejorCarrera = actividades.reduce((mejor, actual) => {
            if (!mejor) return actual
            return parseFloat(actual.distancia_km) > parseFloat(mejor.distancia_km) ? actual : mejor
        }, null)

        const porTipo = {
            correr: actividades.filter(a => a.tipo === 'correr').length,
            senderismo: actividades.filter(a => a.tipo === 'senderismo').length
        }

        res.json({
            total_carreras: actividades.length,
            distancia_total_km: Math.round(distanciaTotal * 100) / 100,
            tiempo_total_segs: tiempoTotal,
            tiempo_total_formateado: formatearDuracion(tiempoTotal),
            velocidad_promedio_general: Math.round(velocidadPromedio * 100) / 100,
            ritmo_promedio_general: Math.round(ritmoPromedio * 100) / 100,
            calorias_totales: caloriasTotal,
            mejor_carrera: mejorCarrera ? {
                id: mejorCarrera.id,
                distancia_km: mejorCarrera.distancia_km,
                fecha: mejorCarrera.hora_inicio,
                duracion_formateada: formatearDuracion(mejorCarrera.duracion_segs)
            } : null,
            por_tipo: porTipo
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener estadísticas', error: error.message })
    }
})

// ─── RESUMEN HOME ─────────────────────────────────────────
router.get('/mis-actividades/resumen-home', verificarToken, async (req, res) => {
    try {
        const actividades = await prisma.actividades.findMany({
            where: {
                usuario_id: req.usuario.id,
                hora_fin: { not: null }
            }
        })

        let distancia_total_km = 0
        let tiempo_total_segs = 0
        let sumaFrecuencia = 0
        let countFrecuencia = 0

        const ahora = new Date()
        const diaSemana = ahora.getDay() // 0 dom, 1 lun, ..., 6 sab
        const diffLunes = diaSemana === 0 ? -6 : 1 - diaSemana
        const lunesSemanaActual = new Date(ahora)
        lunesSemanaActual.setDate(ahora.getDate() + diffLunes)
        lunesSemanaActual.setHours(0, 0, 0, 0) // Inicio del lunes

        const barras_dias = [0, 0, 0, 0, 0, 0, 0] // Lun, Mar, Mie, Jue, Vie, Sab, Dom
        let distancia_semana_km = 0

        actividades.forEach(a => {
            const dist = parseFloat(a.distancia_km) || 0
            const segs = a.duracion_segs || 0
            distancia_total_km += dist
            tiempo_total_segs += segs

            if (a.frecuencia_cardiaca_promedio) {
                sumaFrecuencia += a.frecuencia_cardiaca_promedio
                countFrecuencia++
            }

            // Datos de la semana actual
            if (a.hora_inicio >= lunesSemanaActual) {
                distancia_semana_km += dist
                let d = a.hora_inicio.getDay() // 0 dom, 1 lun
                let idx = d === 0 ? 6 : d - 1 // 0=Lun, ..., 6=Dom
                barras_dias[idx] += dist
            }
        })

        // Redondear las barras a 2 decimales
        for (let i = 0; i < 7; i++) {
            barras_dias[i] = Math.round(barras_dias[i] * 100) / 100
        }

        const tiempo_total_horas = Math.round((tiempo_total_segs / 3600) * 100) / 100
        distancia_total_km = Math.round(distancia_total_km * 100) / 100
        distancia_semana_km = Math.round(distancia_semana_km * 100) / 100
        const ritmo_cardiaco_promedio = countFrecuencia > 0 ? Math.round(sumaFrecuencia / countFrecuencia) : 0

        res.json({
            distancia_total_km,
            tiempo_total_horas,
            ritmo_cardiaco_promedio,
            territorios_nuevos: 0,
            barras_dias,
            distancia_semana_km,
            tendencias: {
                distancia: "Actividad constante",
                tiempo: "Buen esfuerzo",
                territorios: "0 nuevos",
                ritmo: "Promedio"
            }
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener resumen home', error: error.message })
    }
})

// ─── ACTIVIDADES DE OTRO USUARIO (perfil público) ─────────
router.get('/usuario/:usuario_id', verificarToken, async (req, res) => {
    try {
        const actividades = await prisma.actividades.findMany({
            where: {
                usuario_id: req.params.usuario_id,
                hora_fin: { not: null },
                compartida: true // solo las compartidas son visibles
            },
            orderBy: { hora_inicio: 'desc' },
            take: 10
        })

        const actividadesFormateadas = actividades.map(a => ({
            id: a.id,
            tipo: a.tipo,
            distancia_km: a.distancia_km,
            duracion_segs: a.duracion_segs,
            duracion_formateada: formatearDuracion(a.duracion_segs),
            velocidad_promedio: a.velocidad_promedio,
            ritmo_promedio: a.ritmo_promedio,
            hora_inicio: a.hora_inicio,
            puntos_ganados: a.puntos_ganados
        }))

        res.json({ actividades: actividadesFormateadas })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener actividades', error: error.message })
    }
})

// ─── HELPER: FORMATEAR DURACIÓN ───────────────────────────
const formatearDuracion = (segs) => {
    if (!segs) return '00:00:00'
    const horas = Math.floor(segs / 3600)
    const minutos = Math.floor((segs % 3600) / 60)
    const segundos = segs % 60
    return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`
}

// ─── AGREGAR FOTO A ACTIVIDAD ─────────────────────────────
router.post('/:id/foto', verificarToken, upload.single('foto'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ mensaje: 'No se envió ninguna imagen' })
    }

    try {
        const actividad = await prisma.actividades.findUnique({
            where: { id: req.params.id }
        })

        if (!actividad) {
            return res.status(404).json({ mensaje: 'Actividad no encontrada' })
        }

        if (actividad.usuario_id !== req.usuario.id) {
            return res.status(403).json({ mensaje: 'No tienes permiso para modificar esta actividad' })
        }

        if (!actividad.hora_fin) {
            return res.status(400).json({ mensaje: 'No puedes agregar foto a una actividad en curso' })
        }

        const extension = req.file.mimetype.split('/')[1]
        const nombreArchivo = `actividad_${req.params.id}.${extension}`

        const { error: uploadError } = await supabase.storage
            .from('actividades')
            .upload(nombreArchivo, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: true
            })

        if (uploadError) {
            return res.status(500).json({ mensaje: 'Error al subir foto', error: uploadError.message })
        }

        const { data } = supabase.storage
            .from('actividades')
            .getPublicUrl(nombreArchivo)

        await prisma.actividades.update({
            where: { id: req.params.id },
            data: { foto_url: data.publicUrl }
        })

        res.json({
            mensaje: 'Foto agregada exitosamente ✅',
            foto_url: data.publicUrl
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al agregar foto', error: error.message })
    }
})

// ─── HISTORIAL DE CARRERAS (con foto y stats completas) ───
router.get('/mis-actividades/historial', verificarToken, async (req, res) => {
    const { limite = 20, pagina = 1, tipo } = req.query

    try {
        const skip = (parseInt(pagina) - 1) * parseInt(limite)

        const actividades = await prisma.actividades.findMany({
            where: {
                usuario_id: req.usuario.id,
                hora_fin: { not: null },
                ...(tipo && { tipo })
            },
            orderBy: { hora_inicio: 'desc' },
            take: parseInt(limite),
            skip
        })

        const total = await prisma.actividades.count({
            where: {
                usuario_id: req.usuario.id,
                hora_fin: { not: null },
                ...(tipo && { tipo })
            }
        })

        const historial = actividades.map(a => ({
            id: a.id,
            tipo: a.tipo,
            modalidad: a.modalidad,
            fecha: a.hora_inicio,
            hora_inicio: a.hora_inicio,
            hora_fin: a.hora_fin,
            distancia_km: a.distancia_km,
            duracion_segs: a.duracion_segs,
            duracion_formateada: formatearDuracion(a.duracion_segs),
            velocidad_promedio: a.velocidad_promedio,
            velocidad_max: a.velocidad_max,
            ritmo_promedio: a.ritmo_promedio,
            calorias: a.calorias,
            elevacion_ganada_m: a.elevacion_ganada_m,
            pasos: a.pasos,
            frecuencia_cardiaca_promedio: a.frecuencia_cardiaca_promedio,
            puntos_ganados: a.puntos_ganados,
            foto_url: a.foto_url,
            compartida: a.compartida
        }))

        res.json({
            total,
            pagina: parseInt(pagina),
            total_paginas: Math.ceil(total / parseInt(limite)),
            historial
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener historial', error: error.message })
    }
})

// ─── VER DETALLE DE ACTIVIDAD (debe ir AL FINAL — después de todas las rutas específicas) ─
router.get('/:id', verificarToken, async (req, res) => {
    try {
        const actividad = await prisma.actividades.findUnique({
            where: { id: req.params.id },
            include: {
                usuarios: {
                    select: {
                        id: true,
                        nombre: true,
                        avatar_url: true,
                        ciudad: true,
                        nivel: true
                    }
                }
            }
        })

        if (!actividad) {
            return res.status(404).json({ mensaje: 'Actividad no encontrada' })
        }

        res.json({
            actividad: {
                ...actividad,
                duracion_formateada: formatearDuracion(actividad.duracion_segs)
            }
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener actividad', error: error.message })
    }
})

module.exports = router
