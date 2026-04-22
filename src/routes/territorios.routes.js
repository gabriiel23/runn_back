const express = require('express')
const prisma = require('../prisma')
const verificarToken = require('../middlewares/auth.middleware')
const verificarAdmin = require('../middlewares/admin.middleware')
const { validarRutaPerimetral, verificarProximidad } = require('../services/territorio_validacion.service')

const router = express.Router()

// Helper para notificar
const notificar = async (usuarioId, tipo, mensaje) => {
    if (!usuarioId) return
    await prisma.notificaciones.create({
        data: { usuario_id: usuarioId, tipo, mensaje }
    })
}

const formatearTiempo = (segs) => {
    if (!segs) return '00:00:00'
    const h = Math.floor(segs / 3600)
    const m = Math.floor((segs % 3600) / 60)
    const s = segs % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const parsePoligono = (str) => {
    if (!str) return null;
    try {
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
}

// ─── LISTAR TODOS LOS TERRITORIOS ─────────────────────────
router.get('/', verificarToken, async (req, res) => {
    const { modalidad } = req.query

    try {
        const territorios = await prisma.territorios.findMany({
            where: {
                ...(modalidad && { modalidad })
            },
            include: {
                usuarios: {
                    select: { id: true, nombre: true, avatar_url: true }
                },
                grupos: {
                    select: { id: true, nombre: true, foto_url: true }
                }
            },
            orderBy: { creado_en: 'asc' }
        })

        const lista = territorios.map(t => {
            let poligonoObj = parsePoligono(t.poligono);
            return {
                id: t.id,
                nombre: t.nombre,
                descripcion: t.descripcion,
                poligono: poligonoObj,
                modalidad: t.modalidad,
                libre: !t.propietario_id && !t.grupo_propietario_id,
                propietario: t.usuarios ? {
                    id: t.usuarios.id,
                    nombre: t.usuarios.nombre,
                    avatar_url: t.usuarios.avatar_url
                } : null,
                grupo_propietario: t.grupos ? {
                    id: t.grupos.id,
                    nombre: t.grupos.nombre,
                    foto_url: t.grupos.foto_url
                } : null,
                tiempo_record_segs: t.tiempo_record_segs,
                tiempo_record_formateado: formatearTiempo(t.tiempo_record_segs),
                conquistado_en: t.conquistado_en,
                veces_disputado: t.veces_disputado,
                total_defensas: t.total_defensas
            };
        });

        res.json({ territorios: lista })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener territorios', error: error.message })
    }
})

// ─── VERIFICAR PROXIMIDAD AL TERRITORIO ────────────────
router.get('/:id/proximidad', verificarToken, async (req, res) => {
    const { lat, lng } = req.query
    if (!lat || !lng) {
        return res.status(400).json({ mensaje: 'lat y lng son requeridos' })
    }
    try {
        const territorio = await prisma.territorios.findUnique({ where: { id: req.params.id } })
        if (!territorio) return res.status(404).json({ mensaje: 'Territorio no encontrado' })

        const resultado = verificarProximidad(
            territorio.poligono,
            { lat: parseFloat(lat), lng: parseFloat(lng) },
            500 // radio máximo permitido en metros
        )

        res.json({
            cerca: resultado.cerca,
            distancia_m: resultado.distanciaM,
            mensaje: resultado.cerca
                ? 'Estás cerca del territorio. ¡Puedes iniciar la conquista!'
                : `Estás a ${resultado.distanciaM} metros del territorio (máximo permitido: 500m). Acuércate más para poder conquistarlo.`
        })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al verificar proximidad', error: error.message })
    }
})

// ─── CONQUISTAR O DISPUTAR TERRITORIO ─────────────────────
router.post('/:id/conquistar', verificarToken, async (req, res) => {
    const { actividad_id, tiempo_segs, modalidad, grupo_id } = req.body

    if (!tiempo_segs) {
        return res.status(400).json({ mensaje: 'tiempo_segs es requerido' })
    }

    if (!modalidad || !['individual', 'grupal'].includes(modalidad)) {
        return res.status(400).json({ mensaje: 'modalidad debe ser individual o grupal' })
    }

    if (modalidad === 'grupal' && !grupo_id) {
        return res.status(400).json({ mensaje: 'grupo_id es requerido para modalidad grupal' })
    }

    try {
        const territorio = await prisma.territorios.findUnique({
            where: { id: req.params.id },
            include: {
                usuarios: { select: { id: true, nombre: true } },
                grupos: { select: { id: true, nombre: true } }
            }
        })

        if (!territorio) {
            return res.status(404).json({ mensaje: 'Territorio no encontrado' })
        }

        // Verificar que la actividad pertenece al usuario y está completada
        let actividad = null
        if (actividad_id) {
            // Validar formato UUID antes de consultar Prisma (evita errores 500)
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            if (uuidRegex.test(actividad_id)) {
                actividad = await prisma.actividades.findUnique({ where: { id: actividad_id } })
                if (!actividad) {
                    return res.status(404).json({ mensaje: 'Actividad no encontrada' })
                }
                if (actividad.usuario_id !== req.usuario.id) {
                    return res.status(403).json({ mensaje: 'Esta actividad no te pertenece' })
                }
                if (!actividad.hora_fin) {
                    return res.status(400).json({ mensaje: 'La actividad debe estar finalizada' })
                }
            }
        }

        // Si no se proveyó actividad_id válida, buscar la última actividad completada del usuario
        if (!actividad) {
            actividad = await prisma.actividades.findFirst({
                where: { usuario_id: req.usuario.id, hora_fin: { not: null } },
                orderBy: { hora_fin: 'desc' }
            })
        }

        const tiempoSegs = parseInt(tiempo_segs)
        const esModalidadCorrecta = territorio.modalidad === modalidad

        if (!esModalidadCorrecta) {
            return res.status(400).json({
                mensaje: `Este territorio es de modalidad ${territorio.modalidad}`
            })
        }

        // Helper para procesar las disputas grupales que ya caducaron (lazy evaluation)
        const { procesarDisputasGrupalesPendientes } = require('../services/disputas.service')
        await procesarDisputasGrupalesPendientes()

        // ═════════════════════════════════════════════════════════════════════
        // LÓGICA GRUPAL
        // ═════════════════════════════════════════════════════════════════════
        if (modalidad === 'grupal') {
            if (territorio.grupo_propietario_id === grupo_id) {
                return res.status(400).json({ mensaje: 'Tu grupo ya es dueño de este territorio' })
            }

            const esMiembro = await prisma.miembros_grupo.findUnique({
                where: { grupo_id_usuario_id: { grupo_id, usuario_id: req.usuario.id } }
            })

            if (!esMiembro) {
                return res.status(403).json({ mensaje: 'No perteneces a ese grupo' })
            }

            // Buscar si ya hay una disputa activa
            let disputaActiva = await prisma.territorio_disputas_grupales.findFirst({
                where: { territorio_id: req.params.id, grupo_id, estado: 'activa' }
            })

            if (!disputaActiva) {
                // Iniciar nueva disputa de 48h
                const expira = new Date()
                expira.setHours(expira.getHours() + 48)

                disputaActiva = await prisma.territorio_disputas_grupales.create({
                    data: {
                        territorio_id: req.params.id,
                        grupo_id,
                        iniciado_por_usuario_id: req.usuario.id,
                        estado: 'activa',
                        expira_en: expira
                    }
                })

                // Notificar al grupo
                const miembrosGrupo = await prisma.miembros_grupo.findMany({ where: { grupo_id } })
                for (const m of miembrosGrupo) {
                    if (m.usuario_id !== req.usuario.id) {
                        await notificar(
                            m.usuario_id,
                            'disputa_iniciada',
                            `¡Tu grupo ha iniciado una disputa por "${territorio.nombre}"! Entra y registra tu tiempo en las próximas 48h.`
                        )
                    }
                }
            }

            // Registrar aporte del usuario actual
            // Ver si ya aportó a ESTA disputa para no duplicar (o simplemente actualizar)
            const aportePrevio = await prisma.territorio_aportes_grupales.findFirst({
                where: { disputa_id: disputaActiva.id, usuario_id: req.usuario.id }
            })

            if (aportePrevio) {
                // Mejora su tiempo si es menor (esto es a discreción, pero dejémoslo así o bloqueamos)
                if (tiempoSegs < aportePrevio.tiempo_segs) {
                    await prisma.territorio_aportes_grupales.update({
                        where: { id: aportePrevio.id },
                        data: { tiempo_segs: tiempoSegs, actividad_id }
                    })
                }
            } else {
                await prisma.territorio_aportes_grupales.create({
                    data: {
                        disputa_id: disputaActiva.id,
                        usuario_id: req.usuario.id,
                        actividad_id,
                        tiempo_segs: tiempoSegs
                    }
                })
            }

            // Sumar unos puntos base por participar
            await prisma.usuarios.update({
                where: { id: req.usuario.id },
                data: { puntos: { increment: 10 } }
            })

            return res.json({
                mensaje: `Tu tiempo se ha aportado a la disputa del grupo. ¡Esperen a que los demás participen en las próximas 48h!`,
                resultado: 'aporte_registrado',
                tiempo_aportado: formatearTiempo(tiempoSegs)
            })
        }

        // ═════════════════════════════════════════════════════════════════════
        // LÓGICA INDIVIDUAL
        // ═════════════════════════════════════════════════════════════════════
        if (territorio.propietario_id === req.usuario.id) {
            return res.status(400).json({ mensaje: 'Ya eres el dueño de este territorio' })
        }

        // ── Validación geoespacial del perímetro ──────────────────────────
        if (actividad.ruta) {
            const resultadoGeo = validarRutaPerimetral(territorio.poligono, actividad.ruta)
            if (!resultadoGeo.valido) {
                return res.status(422).json({
                    mensaje: resultadoGeo.mensaje,
                    cobertura_pct: resultadoGeo.cobertura,
                    resultado: 'ruta_invalida'
                })
            }
        }

        const esTeritorioLibre = !territorio.propietario_id

        if (esTeritorioLibre) {
            await prisma.territorios.update({
                where: { id: req.params.id },
                data: {
                    propietario_id: req.usuario.id,
                    conquistado_en: new Date(),
                    tiempo_record_segs: tiempoSegs,
                    tiempo_record_usuario_id: req.usuario.id
                }
            })

            await prisma.territorios_historial.create({
                data: {
                    territorio_id: req.params.id,
                    usuario_id: req.usuario.id,
                    actividad_id,
                    tipo: 'conquista',
                    resultado: 'ganado',
                    tiempo_segs: tiempoSegs,
                    modalidad: 'individual'
                }
            })

            await prisma.usuarios.update({
                where: { id: req.usuario.id },
                data: { puntos: { increment: 25 } }
            })

            return res.json({
                mensaje: `¡Territorio "${territorio.nombre}" conquistado! ✅`,
                resultado: 'conquistado',
                tiempo_formateado: formatearTiempo(tiempoSegs),
                puntos_ganados: 25
            })
        }

        const tiempoRecord = territorio.tiempo_record_segs
        const gano = tiempoSegs < tiempoRecord

        await prisma.territorios_historial.create({
            data: {
                territorio_id: req.params.id,
                usuario_id: req.usuario.id,
                actividad_id,
                tipo: 'disputa',
                resultado: gano ? 'ganado' : 'perdido',
                tiempo_segs: tiempoSegs,
                tiempo_anterior_segs: tiempoRecord,
                modalidad: 'individual'
            }
        })

        await prisma.territorios.update({
            where: { id: req.params.id },
            data: {
                veces_disputado: { increment: 1 },
                ultima_disputa_en: new Date(),
                ...(!gano && { total_defensas: { increment: 1 } })
            }
        })

        if (gano) {
            const duenioAnteriorId = territorio.propietario_id

            await prisma.territorios.update({
                where: { id: req.params.id },
                data: {
                    propietario_id: req.usuario.id,
                    conquistado_en: new Date(),
                    tiempo_record_segs: tiempoSegs,
                    tiempo_record_usuario_id: req.usuario.id
                }
            })

            await prisma.usuarios.update({
                where: { id: req.usuario.id },
                data: { puntos: { increment: 35 } }
            })

            if (duenioAnteriorId) {
                await notificar(
                    duenioAnteriorId,
                    'territorio_perdido',
                    `Te han arrebatado el territorio "${territorio.nombre}". ¡Sal a recuperarlo!`
                )
            }

            return res.json({
                mensaje: `¡Conquistaste el territorio "${territorio.nombre}"! ✅`,
                resultado: 'ganado',
                tiempo_formateado: formatearTiempo(tiempoSegs),
                tiempo_record_anterior: formatearTiempo(tiempoRecord),
                diferencia_segs: tiempoRecord - tiempoSegs,
                puntos_ganados: 35
            })
        }

        return res.json({
            mensaje: `No lograste conquistar "${territorio.nombre}". ¡Inténtalo de nuevo!`,
            resultado: 'perdido',
            tu_tiempo: formatearTiempo(tiempoSegs),
            tiempo_a_superar: formatearTiempo(tiempoRecord),
            diferencia_segs: tiempoSegs - tiempoRecord,
            puntos_ganados: 0
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al conquistar territorio', error: error.message })
    }
})

// ─── MIS TERRITORIOS ─────────────────────────────────────────────────────────
// IMPORTANTE: Esta ruta debe ir ANTES de /:id para que Express no capture
// 'usuario' como parámetro dinámico.
router.get('/usuario/mis-territorios', verificarToken, async (req, res) => {
    try {
        const territorios = await prisma.territorios.findMany({
            where: { propietario_id: req.usuario.id },
            include: {
                usuarios: { select: { id: true, nombre: true, avatar_url: true, ciudad: true } }
            },
            orderBy: { conquistado_en: 'desc' }
        })

        const lista = territorios.map(t => ({
            id: t.id,
            nombre: t.nombre,
            descripcion: t.descripcion,
            modalidad: t.modalidad,
            libre: false,
            propietario: t.usuarios ? {
                id: t.usuarios.id,
                nombre: t.usuarios.nombre,
                avatar_url: t.usuarios.avatar_url,
                ciudad: t.usuarios.ciudad
            } : null,
            grupo_propietario: null,
            poligono: parsePoligono(t.poligono),
            tiempo_record_segs: t.tiempo_record_segs,
            tiempo_record_formateado: formatearTiempo(t.tiempo_record_segs),
            conquistado_en: t.conquistado_en,
            veces_disputado: t.veces_disputado,
            total_defensas: t.total_defensas
        }))

        res.json({ total: lista.length, territorios: lista })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener territorios', error: error.message })
    }
})

// ─── TERRITORIOS DE UN GRUPO ──────────────────────────────────────────────────
router.get('/grupo/:grupo_id', verificarToken, async (req, res) => {
    try {
        const territorios = await prisma.territorios.findMany({
            where: { grupo_propietario_id: req.params.grupo_id },
            include: {
                grupos: { select: { id: true, nombre: true, foto_url: true } }
            },
            orderBy: { conquistado_en: 'desc' }
        })

        const lista = territorios.map(t => ({
            id: t.id,
            nombre: t.nombre,
            descripcion: t.descripcion,
            modalidad: t.modalidad,
            libre: false,
            propietario: null,
            grupo_propietario: t.grupos ? {
                id: t.grupos.id,
                nombre: t.grupos.nombre,
                foto_url: t.grupos.foto_url
            } : null,
            poligono: parsePoligono(t.poligono),
            tiempo_record_segs: t.tiempo_record_segs,
            tiempo_record_formateado: formatearTiempo(t.tiempo_record_segs),
            conquistado_en: t.conquistado_en,
            veces_disputado: t.veces_disputado,
            total_defensas: t.total_defensas
        }))

        res.json({ total: lista.length, territorios: lista })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener territorios del grupo', error: error.message })
    }
})

// ─── RANKING INDIVIDUAL ───────────────────────────────────────────────────────
router.get('/ranking/individual', verificarToken, async (req, res) => {
    try {
        const ranking = await prisma.usuarios.findMany({
            where: { territorios: { some: {} } },
            select: {
                id: true,
                nombre: true,
                avatar_url: true,
                ciudad: true,
                puntos: true,
                _count: { select: { territorios: true } }
            },
            orderBy: { territorios: { _count: 'desc' } },
            take: 20
        })

        const lista = ranking.map((u, index) => ({
            posicion: index + 1,
            id: u.id,
            nombre: u.nombre,
            avatar_url: u.avatar_url,
            ciudad: u.ciudad,
            puntos: u.puntos,
            total_territorios: u._count.territorios
        }))

        res.json({ ranking: lista })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener ranking', error: error.message })
    }
})

// ─── RANKING GRUPAL ───────────────────────────────────────────────────────────
router.get('/ranking/grupal', verificarToken, async (req, res) => {
    try {
        const ranking = await prisma.grupos.findMany({
            where: { territorios: { some: {} } },
            select: {
                id: true,
                nombre: true,
                foto_url: true,
                _count: { select: { territorios: true } }
            },
            orderBy: { territorios: { _count: 'desc' } },
            take: 20
        })

        const lista = ranking.map((g, index) => ({
            posicion: index + 1,
            id: g.id,
            nombre: g.nombre,
            foto_url: g.foto_url,
            total_territorios: g._count.territorios
        }))

        res.json({ ranking: lista })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener ranking grupal', error: error.message })
    }
})

// ─── CARGAR TERRITORIOS (solo admin) ──────────────────────
router.post('/admin/cargar', verificarToken, verificarAdmin, async (req, res) => {
    const { territorios } = req.body

    if (!territorios || !Array.isArray(territorios)) {
        return res.status(400).json({ mensaje: 'territorios debe ser un array de GeoJSON' })
    }

    try {
        const creados = []

        for (const t of territorios) {
            const nuevo = await prisma.territorios.create({
                data: {
                    nombre: t.nombre || t.properties?.name || 'Territorio sin nombre',
                    descripcion: t.descripcion || t.properties?.description || null,
                    poligono: JSON.stringify(t.geometry || t),
                    modalidad: t.modalidad || 'individual'
                }
            })
            creados.push(nuevo)
        }

        res.status(201).json({
            mensaje: `${creados.length} territorios cargados exitosamente ✅`,
            total: creados.length
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al cargar territorios', error: error.message })
    }
})

// ─── CREAR TERRITORIO (solo admin) ─────────────
router.post('/', verificarToken, verificarAdmin, async (req, res) => {
    const { nombre, descripcion, poligono, modalidad } = req.body

    if (!nombre || !poligono) {
        return res.status(400).json({ mensaje: 'nombre y poligono son requeridos' })
    }

    try {
        let poligonoString = typeof poligono === 'string' ? poligono : JSON.stringify(poligono)

        try {
            JSON.parse(poligonoString)
        } catch {
            return res.status(400).json({ mensaje: 'El polígono no es un GeoJSON válido' })
        }

        if (modalidad === 'ambas') {
            const tInd = await prisma.territorios.create({
                data: { nombre, descripcion, poligono: poligonoString, modalidad: 'individual' }
            })
            const tGrup = await prisma.territorios.create({
                data: { nombre, descripcion, poligono: poligonoString, modalidad: 'grupal' }
            })
            return res.status(201).json({ mensaje: 'Territorios (Individual y Grupal) creados ✅', territorios: [tInd, tGrup] })
        }

        const territorio = await prisma.territorios.create({
            data: {
                nombre,
                descripcion,
                poligono: poligonoString,
                modalidad: modalidad || 'individual'
            }
        })

        res.status(201).json({ mensaje: 'Territorio creado ✅', territorio })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al crear territorio', error: error.message })
    }
})

// ─── VER DETALLE DE TERRITORIO (al final para no capturar rutas específicas) ───────────────────────────────────
router.get('/:id', verificarToken, async (req, res) => {
    try {
        const territorio = await prisma.territorios.findUnique({
            where: { id: req.params.id },
            include: {
                usuarios: {
                    select: { id: true, nombre: true, avatar_url: true, ciudad: true, nivel: true }
                },
                grupos: {
                    select: { id: true, nombre: true, foto_url: true }
                },
                territorios_historial: {
                    include: {
                        usuarios: { select: { id: true, nombre: true, avatar_url: true } },
                        grupos: { select: { id: true, nombre: true } }
                    },
                    orderBy: { creado_en: 'desc' },
                    take: 10
                }
            }
        })

        if (!territorio) {
            return res.status(404).json({ mensaje: 'Territorio no encontrado' })
        }

        // Verificar si el usuario actual es dueño
        const esDueno = territorio.propietario_id === req.usuario.id

        res.json({
            territorio: {
                id: territorio.id,
                nombre: territorio.nombre,
                descripcion: territorio.descripcion,
                poligono: parsePoligono(territorio.poligono),
                modalidad: territorio.modalidad,
                libre: !territorio.propietario_id && !territorio.grupo_propietario_id,
                propietario: territorio.usuarios,
                grupo_propietario: territorio.grupos,
                tiempo_record_segs: territorio.tiempo_record_segs,
                tiempo_record_formateado: formatearTiempo(territorio.tiempo_record_segs),
                conquistado_en: territorio.conquistado_en,
                ultima_disputa_en: territorio.ultima_disputa_en,
                veces_disputado: territorio.veces_disputado,
                total_defensas: territorio.total_defensas
            },
            historial: territorio.territorios_historial.map(h => ({
                id: h.id,
                tipo: h.tipo,
                resultado: h.resultado,
                tiempo_segs: h.tiempo_segs,
                tiempo_formateado: formatearTiempo(h.tiempo_segs),
                tiempo_anterior_segs: h.tiempo_anterior_segs,
                modalidad: h.modalidad,
                usuario: h.usuarios,
                grupo: h.grupos,
                creado_en: h.creado_en
            })),
            es_dueno: esDueno
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener territorio', error: error.message })
    }
})

// ─── ACTUALIZAR TERRITORIO (solo admin) ───────────────────────────────────────
router.put('/:id', verificarToken, verificarAdmin, async (req, res) => {
    const { nombre, descripcion, poligono, modalidad } = req.body

    if (!nombre && !poligono) {
        return res.status(400).json({ mensaje: 'Debes enviar al menos nombre o poligono' })
    }

    try {
        // Validar GeoJSON si viene
        let poligonoString
        if (poligono !== undefined) {
            if (typeof poligono === 'string') {
                poligonoString = poligono
            } else {
                poligonoString = JSON.stringify(poligono)
            }
            try {
                JSON.parse(poligonoString)
            } catch {
                return res.status(400).json({ mensaje: 'El polígono no es un GeoJSON válido' })
            }
        }

        const territorio = await prisma.territorios.update({
            where: { id: req.params.id },
            data: {
                ...(nombre && { nombre }),
                ...(descripcion !== undefined && { descripcion }),
                ...(poligonoString && { poligono: poligonoString }),
                ...(modalidad && { modalidad }),
            }
        })

        res.json({ mensaje: 'Territorio actualizado ✅', territorio })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar territorio', error: error.message })
    }
})

// ─── ELIMINAR TERRITORIO (solo admin) ─────────────────────────────────────────
router.delete('/:id', verificarToken, verificarAdmin, async (req, res) => {
    try {
        await prisma.territorios.delete({ where: { id: req.params.id } })
        res.json({ mensaje: 'Territorio eliminado ✅' })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al eliminar territorio', error: error.message })
    }
})

module.exports = router