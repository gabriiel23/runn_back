const express = require('express')
const multer = require('multer')
const leoProfanity = require('leo-profanity')
const prisma = require('../prisma')
const supabase = require('../supabase')
const verificarToken = require('../middlewares/auth.middleware')
const verificarAdmin = require('../middlewares/admin.middleware')

const router = express.Router()

// Agregar diccionario en español
leoProfanity.loadDictionary('es')

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
})

// Helper para verificar si el usuario es admin del grupo
const esAdminDelGrupo = async (grupoId, usuarioId) => {
    const miembro = await prisma.miembros_grupo.findUnique({
        where: {
            grupo_id_usuario_id: {
                grupo_id: grupoId,
                usuario_id: usuarioId
            }
        }
    })
    return miembro && (miembro.rol === 'admin' || miembro.rol === 'creador')
}

// ─── CREAR GRUPO ──────────────────────────────────────────
router.post('/', verificarToken, upload.single('foto'), async (req, res) => {
    const { nombre, descripcion, modalidad, es_privado } = req.body

    if (!nombre) {
        return res.status(400).json({ mensaje: 'El nombre del grupo es requerido' })
    }

    // Filtro de malas palabras
    try {
        if (leoProfanity.check(nombre) || (descripcion && leoProfanity.check(descripcion))) {
            return res.status(400).json({ mensaje: 'El nombre o descripción contiene palabras inapropiadas' })
        }
    } catch {
        return res.status(400).json({ mensaje: 'El nombre o descripción contiene contenido inapropiado' })
    }

    try {
        let foto_url = null

        if (req.file) {
            const nombreArchivo = `grupo_${Date.now()}`
            const { error: uploadError } = await supabase.storage
                .from('grupos')
                .upload(nombreArchivo, req.file.buffer, {
                    contentType: req.file.mimetype,
                    upsert: false
                })

            if (uploadError) {
                return res.status(500).json({ mensaje: 'Error al subir foto', error: uploadError.message })
            }

            const { data } = supabase.storage.from('grupos').getPublicUrl(nombreArchivo)
            foto_url = data.publicUrl
        }

        // Obtener nombre del creador
        const creador = await prisma.usuarios.findUnique({
            where: { id: req.usuario.id },
            select: { nombre: true }
        })

        const nuevoGrupo = await prisma.grupos.create({
            data: {
                nombre,
                descripcion,
                modalidad: modalidad || 'social',
                es_privado: es_privado === 'true',
                foto_url,
                creado_por: req.usuario.id,
                creado_por_nombre: creador.nombre
            }
        })

        // Agregar al creador como miembro con rol 'creador'
        await prisma.miembros_grupo.create({
            data: {
                grupo_id: nuevoGrupo.id,
                usuario_id: req.usuario.id,
                rol: 'creador'
            }
        })

        res.status(201).json({
            mensaje: 'Grupo creado exitosamente ✅',
            grupo: nuevoGrupo
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al crear grupo', error: error.message })
    }
})

// ─── LISTAR GRUPOS ────────────────────────────────────────
router.get('/', verificarToken, async (req, res) => {
    const { buscar, modalidad, es_privado } = req.query

    try {
        const grupos = await prisma.grupos.findMany({
            where: {
                ...(buscar && {
                    nombre: { contains: buscar, mode: 'insensitive' }
                }),
                ...(modalidad && { modalidad }),
                ...(es_privado !== undefined && { es_privado: es_privado === 'true' })
            },
            include: {
                _count: {
                    select: { miembros_grupo: true }
                }
            },
            orderBy: { creado_en: 'desc' }
        })

        const gruposConInfo = grupos.map(g => ({
            id: g.id,
            nombre: g.nombre,
            descripcion: g.descripcion,
            foto_url: g.foto_url,
            modalidad: g.modalidad,
            es_privado: g.es_privado,
            creado_por_nombre: g.creado_por_nombre,
            creado_en: g.creado_en,
            total_miembros: g._count.miembros_grupo
        }))

        res.json({ grupos: gruposConInfo })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener grupos', error: error.message })
    }
})

// ─── MIS GRUPOS ───────────────────────────────────────────
router.get('/mis-grupos', verificarToken, async (req, res) => {
    try {
        const misGrupos = await prisma.miembros_grupo.findMany({
            where: { usuario_id: req.usuario.id },
            include: {
                grupos: {
                    include: {
                        _count: { select: { miembros_grupo: true } }
                    }
                }
            }
        })

        const lista = misGrupos.map(m => ({
            id: m.grupos.id,
            nombre: m.grupos.nombre,
            descripcion: m.grupos.descripcion,
            foto_url: m.grupos.foto_url,
            modalidad: m.grupos.modalidad,
            mi_rol: m.rol,
            total_miembros: m.grupos._count.miembros_grupo
        }))

        res.json({ grupos: lista })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener mis grupos', error: error.message })
    }
})

// ─── MIS INVITACIONES PENDIENTES ──────────────────────────
router.get('/mis-invitaciones', verificarToken, async (req, res) => {
    try {
        const invitaciones = await prisma.grupo_invitaciones.findMany({
            where: {
                usuario_id: req.usuario.id,
                estado: 'pendiente'
            },
            include: {
                grupos: {
                    select: {
                        id: true,
                        nombre: true,
                        foto_url: true,
                        descripcion: true,
                        modalidad: true,
                        _count: {
                            select: { miembros_grupo: true }
                        }
                    }
                },
                usuarios_invitado_por: {
                    select: {
                        id: true,
                        nombre: true,
                        avatar_url: true
                    }
                }
            },
            orderBy: { creado_en: 'desc' }
        })

        res.json({
            total: invitaciones.length,
            invitaciones
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener invitaciones', error: error.message })
    }
})

// ─── VER DETALLE DE GRUPO ─────────────────────────────────
router.get('/:id', verificarToken, async (req, res) => {
    try {
        const grupo = await prisma.grupos.findUnique({
            where: { id: req.params.id },
            include: {
                miembros_grupo: {
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
                },
                grupo_retos: {
                    include: {
                        _count: { select: { grupo_retos_usuario: true } }
                    },
                    orderBy: { creado_en: 'desc' }
                },
                grupo_actividades: {
                    include: {
                        _count: { select: { grupo_actividades_usuario: true } }
                    },
                    orderBy: { creado_en: 'desc' }
                },
                grupo_multimedia: {
                    orderBy: { creado_en: 'desc' }
                }
            }
        })

        if (!grupo) {
            return res.status(404).json({ mensaje: 'Grupo no encontrado' })
        }

        // Verificar si el usuario logueado es miembro
        const miMembresía = grupo.miembros_grupo.find(m => m.usuario_id === req.usuario.id)

        // Verificar si tiene solicitud pendiente
        let solicitudPendiente = false
        if (!miMembresía) {
            const solicitud = await prisma.grupo_invitaciones.findFirst({
                where: {
                    grupo_id: req.params.id,
                    usuario_id: req.usuario.id,
                    invitado_por: null,
                    estado: 'pendiente'
                }
            })
            solicitudPendiente = !!solicitud
        }

        const miembros = grupo.miembros_grupo.map(m => ({
            ...m.usuarios,
            rol: m.rol,
            unido_en: m.unido_en
        }))

        res.json({
            grupo: {
                id: grupo.id,
                nombre: grupo.nombre,
                descripcion: grupo.descripcion,
                foto_url: grupo.foto_url,
                modalidad: grupo.modalidad,
                es_privado: grupo.es_privado,
                creado_por_nombre: grupo.creado_por_nombre,
                creado_en: grupo.creado_en
            },
            miembros,
            total_miembros: miembros.length,
            soy_miembro: !!miMembresía,
            solicitud_pendiente: solicitudPendiente,
            mi_rol: miMembresía?.rol || null,
            retos: grupo.grupo_retos,
            actividades: grupo.grupo_actividades,
            multimedia: grupo.grupo_multimedia
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener grupo', error: error.message })
    }
})

// ─── EDITAR GRUPO (creador o admin del grupo) ─────────────
router.put('/:id', verificarToken, upload.single('foto'), async (req, res) => {
    const { nombre, descripcion, modalidad, es_privado } = req.body

    try {
        const esAdmin = await esAdminDelGrupo(req.params.id, req.usuario.id)
        if (!esAdmin) {
            return res.status(403).json({ mensaje: 'No tienes permiso para editar este grupo' })
        }

        if (nombre && (leoProfanity.check(nombre) || (descripcion && leoProfanity.check(descripcion)))) {
            return res.status(400).json({ mensaje: 'El nombre o descripción contiene palabras inapropiadas' })
        }

        let foto_url = undefined

        if (req.file) {
            const nombreArchivo = `grupo_${req.params.id}`
            const { error: uploadError } = await supabase.storage
                .from('grupos')
                .upload(nombreArchivo, req.file.buffer, {
                    contentType: req.file.mimetype,
                    upsert: true
                })

            if (uploadError) {
                return res.status(500).json({ mensaje: 'Error al subir foto', error: uploadError.message })
            }

            const { data } = supabase.storage.from('grupos').getPublicUrl(nombreArchivo)
            foto_url = data.publicUrl
        }

        const grupoActualizado = await prisma.grupos.update({
            where: { id: req.params.id },
            data: {
                ...(nombre && { nombre }),
                ...(descripcion && { descripcion }),
                ...(modalidad && { modalidad }),
                ...(es_privado !== undefined && { es_privado: es_privado === 'true' }),
                ...(foto_url && { foto_url })
            }
        })

        res.json({
            mensaje: 'Grupo actualizado exitosamente ✅',
            grupo: grupoActualizado
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar grupo', error: error.message })
    }
})

// ─── ELIMINAR GRUPO (creador del grupo o admin general) ───
router.delete('/:id', verificarToken, async (req, res) => {
    const { motivo } = req.body

    try {
        const grupo = await prisma.grupos.findUnique({
            where: { id: req.params.id },
            select: { creado_por: true, nombre: true }
        })

        if (!grupo) {
            return res.status(404).json({ mensaje: 'Grupo no encontrado' })
        }

        const esCreador = grupo.creado_por === req.usuario.id
        const esAdminGeneral = req.usuario.rol === 'admin'

        if (!esCreador && !esAdminGeneral) {
            return res.status(403).json({ mensaje: 'No tienes permiso para eliminar este grupo' })
        }

        // Si es admin general y hay motivo, notificar al creador del grupo
        if (esAdminGeneral && !esCreador && grupo.creado_por) {
            await prisma.notificaciones.create({
                data: {
                    usuario_id: grupo.creado_por,
                    tipo: 'grupo_eliminado',
                    mensaje: motivo
                        ? `Tu grupo "${grupo.nombre}" fue eliminado por un administrador. Motivo: ${motivo}`
                        : `Tu grupo "${grupo.nombre}" fue eliminado por un administrador.`
                }
            })
        }

        // Eliminar en orden para evitar errores de cascade
        await prisma.$transaction([
            // Eliminar multimedia del grupo
            prisma.grupo_multimedia.deleteMany({
                where: { grupo_id: req.params.id }
            }),
            // Eliminar participantes de retos
            prisma.grupo_retos_usuario.deleteMany({
                where: {
                    grupo_retos: { grupo_id: req.params.id }
                }
            }),
            // Eliminar retos del grupo
            prisma.grupo_retos.deleteMany({
                where: { grupo_id: req.params.id }
            }),
            // Eliminar participantes de actividades
            prisma.grupo_actividades_usuario.deleteMany({
                where: {
                    grupo_actividades: { grupo_id: req.params.id }
                }
            }),
            // Eliminar actividades del grupo
            prisma.grupo_actividades.deleteMany({
                where: { grupo_id: req.params.id }
            }),
            // Eliminar invitaciones del grupo
            prisma.grupo_invitaciones.deleteMany({
                where: { grupo_id: req.params.id }
            }),
            // Eliminar miembros del grupo
            prisma.miembros_grupo.deleteMany({
                where: { grupo_id: req.params.id }
            }),
            // Eliminar publicaciones del grupo
            prisma.publicaciones.deleteMany({
                where: { grupo_id: req.params.id }
            }),
            // Finalmente eliminar el grupo
            prisma.grupos.delete({
                where: { id: req.params.id }
            })
        ])

        res.json({ mensaje: 'Grupo eliminado exitosamente ✅' })

    } catch (error) {
        console.error('Error al eliminar grupo:', error)
        res.status(500).json({ mensaje: 'Error al eliminar grupo', error: error.message })
    }
})

// ─── SOLICITAR UNIÓN AL GRUPO ────────────────────────────
router.post('/:id/unirse', verificarToken, async (req, res) => {
    try {
        const grupo = await prisma.grupos.findUnique({
            where: { id: req.params.id }
        })

        if (!grupo) {
            return res.status(404).json({ mensaje: 'Grupo no encontrado' })
        }

        if (grupo.es_privado) {
            return res.status(403).json({
                mensaje: 'Este grupo es privado. Debes ser invitado para unirte.'
            })
        }

        // Verificar si ya es miembro
        const yaEsMiembro = await prisma.miembros_grupo.findUnique({
            where: { grupo_id_usuario_id: { grupo_id: req.params.id, usuario_id: req.usuario.id } }
        })
        if (yaEsMiembro) {
            return res.status(400).json({ mensaje: 'Ya eres miembro de este grupo' })
        }

        // Verificar si ya tiene solicitud pendiente
        const solicitudExistente = await prisma.grupo_invitaciones.findFirst({
            where: {
                grupo_id: req.params.id,
                usuario_id: req.usuario.id,
                invitado_por: null,
                estado: 'pendiente'
            }
        })
        if (solicitudExistente) {
            return res.status(400).json({ mensaje: 'Ya tienes una solicitud pendiente para este grupo' })
        }

        // Crear o actualizar la solicitud de unión (invitado_por = null indica que viene del usuario, no de un admin)
        const invitacion = await prisma.grupo_invitaciones.upsert({
            where: {
                grupo_id_usuario_id: {
                    grupo_id: req.params.id,
                    usuario_id: req.usuario.id
                }
            },
            update: {
                estado: 'pendiente',
                invitado_por: null
            },
            create: {
                grupo_id: req.params.id,
                usuario_id: req.usuario.id,
                invitado_por: null,
                estado: 'pendiente'
            }
        })

        // Notificar a los admins/creadores del grupo
        const solicitante = await prisma.usuarios.findUnique({
            where: { id: req.usuario.id },
            select: { nombre: true }
        })

        const nombreSolicitante = solicitante?.nombre || 'Un usuario'

        const admins = await prisma.miembros_grupo.findMany({
            where: { grupo_id: req.params.id, rol: { in: ['admin', 'creador'] } },
            select: { usuario_id: true }
        })

        const notificacionesData = admins.map(a => ({
            usuario_id: a.usuario_id,
            tipo: 'solicitud_union',
            mensaje: `${nombreSolicitante} quiere unirse al grupo "${grupo.nombre}". grupo_id:${req.params.id}`
        }))

        if (notificacionesData.length > 0) {
            await prisma.notificaciones.createMany({
                data: notificacionesData
            })
        }

        res.json({ mensaje: 'Solicitud de unión enviada. El admin del grupo debe aceptarla ✅', solicitudEnviada: true })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al solicitar unión al grupo', error: error.message })
    }
})

// ─── SALIRSE DEL GRUPO ────────────────────────────────────
router.delete('/:id/unirse', verificarToken, async (req, res) => {
    try {
        await prisma.miembros_grupo.deleteMany({
            where: {
                grupo_id: req.params.id,
                usuario_id: req.usuario.id
            }
        })

        res.json({ mensaje: 'Has salido del grupo ✅' })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al salirse del grupo', error: error.message })
    }
})

// ─── OBTENER SOLICITUDES DE UNIÓN (admin del grupo) ──────
router.get('/:id/solicitudes', verificarToken, async (req, res) => {
    try {
        const esAdmin = await esAdminDelGrupo(req.params.id, req.usuario.id)
        if (!esAdmin) {
            return res.status(403).json({ mensaje: 'No tienes permiso para ver las solicitudes' })
        }

        const solicitudes = await prisma.grupo_invitaciones.findMany({
            where: {
                grupo_id: req.params.id,
                invitado_por: null,
                estado: 'pendiente'
            },
            include: {
                usuarios_usuario: {
                    select: { id: true, nombre: true, avatar_url: true, ciudad: true, nivel: true }
                }
            },
            orderBy: { creado_en: 'asc' }
        })

        res.json({
            total: solicitudes.length,
            solicitudes: solicitudes.map(s => ({
                id: s.id,
                estado: s.estado,
                creado_en: s.creado_en,
                usuario: s.usuarios_usuario
            }))
        })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener solicitudes', error: error.message })
    }
})

// ─── ACEPTAR/RECHAZAR SOLICITUD DE UNIÓN (admin del grupo)
router.put('/:id/solicitudes/:solicitud_id', verificarToken, async (req, res) => {
    const { accion } = req.body
    if (!['aceptar', 'rechazar'].includes(accion)) {
        return res.status(400).json({ mensaje: 'Acción inválida. Usa: aceptar o rechazar' })
    }

    try {
        const esAdmin = await esAdminDelGrupo(req.params.id, req.usuario.id)
        if (!esAdmin) {
            return res.status(403).json({ mensaje: 'No tienes permiso para gestionar solicitudes' })
        }

        const solicitud = await prisma.grupo_invitaciones.findUnique({
            where: { id: req.params.solicitud_id }
        })

        if (!solicitud || solicitud.grupo_id !== req.params.id || solicitud.invitado_por !== null) {
            return res.status(404).json({ mensaje: 'Solicitud no encontrada' })
        }

        if (accion === 'aceptar') {
            await prisma.miembros_grupo.create({
                data: { grupo_id: req.params.id, usuario_id: solicitud.usuario_id, rol: 'miembro' }
            })
        }

        await prisma.grupo_invitaciones.update({
            where: { id: req.params.solicitud_id },
            data: { estado: accion === 'aceptar' ? 'aceptada' : 'rechazada' }
        })

        // Notificar al solicitante
        const grupoInfo = await prisma.grupos.findUnique({ where: { id: req.params.id }, select: { nombre: true } })
        await prisma.notificaciones.create({
            data: {
                usuario_id: solicitud.usuario_id,
                tipo: accion === 'aceptar' ? 'solicitud_aceptada' : 'solicitud_rechazada',
                mensaje: accion === 'aceptar'
                    ? `Tu solicitud para unirte al grupo "${grupoInfo.nombre}" fue aceptada. grupo_id:${req.params.id}`
                    : `Tu solicitud para unirte al grupo "${grupoInfo.nombre}" fue rechazada.`
            }
        })

        res.json({
            mensaje: accion === 'aceptar'
                ? 'Solicitud aceptada. El usuario en ahora miembro del grupo ✅'
                : 'Solicitud rechazada ✅'
        })
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ mensaje: 'El usuario ya es miembro del grupo' })
        }
        res.status(500).json({ mensaje: 'Error al procesar solicitud', error: error.message })
    }
})

// ─── PANEL DE INVITACIONES ENVIADAS (admin del grupo) ─────
router.get('/:id/invitaciones-panel', verificarToken, async (req, res) => {
    try {
        const esAdmin = await esAdminDelGrupo(req.params.id, req.usuario.id)
        if (!esAdmin) {
            return res.status(403).json({ mensaje: 'No tienes permiso para ver las invitaciones' })
        }

        const invitaciones = await prisma.grupo_invitaciones.findMany({
            where: {
                grupo_id: req.params.id,
                invitado_por: { not: null }
            },
            include: {
                usuarios_usuario: {
                    select: { id: true, nombre: true, avatar_url: true }
                },
                usuarios_invitado_por: {
                    select: { id: true, nombre: true }
                }
            },
            orderBy: { creado_en: 'desc' }
        })

        res.json({
            total: invitaciones.length,
            invitaciones: invitaciones.map(inv => ({
                id: inv.id,
                estado: inv.estado,
                creado_en: inv.creado_en,
                usuario: inv.usuarios_usuario,
                invitado_por: inv.usuarios_invitado_por
            }))
        })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener panel de invitaciones', error: error.message })
    }
})

// ─── BUSCAR USUARIOS PARA INVITAR (admin del grupo) ───────
router.get('/:id/buscar-usuarios', verificarToken, async (req, res) => {
    const { q } = req.query
    try {
        const esAdmin = await esAdminDelGrupo(req.params.id, req.usuario.id)
        if (!esAdmin) {
            return res.status(403).json({ mensaje: 'No tienes permiso para buscar usuarios' })
        }

        // Obtener IDs de miembros actuales del grupo
        const miembrosActuales = await prisma.miembros_grupo.findMany({
            where: { grupo_id: req.params.id },
            select: { usuario_id: true }
        })
        const idsExcluidos = miembrosActuales.map(m => m.usuario_id)

        const usuarios = await prisma.usuarios.findMany({
            where: {
                id: { notIn: idsExcluidos.length ? idsExcluidos : ['__none__'] },
                ...(q && q.length >= 2 && {
                    OR: [
                        { nombre: { contains: q, mode: 'insensitive' } },
                        { correo: { contains: q, mode: 'insensitive' } }
                    ]
                })
            },
            select: { id: true, nombre: true, correo: true, avatar_url: true, ciudad: true, nivel: true },
            take: 20
        })

        res.json({ usuarios })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al buscar usuarios', error: error.message })
    }
})

// ─── AGREGAR MIEMBRO (admin del grupo) ───────────────────
router.post('/:id/miembros', verificarToken, async (req, res) => {
    const { usuario_id } = req.body

    if (!usuario_id) {
        return res.status(400).json({ mensaje: 'usuario_id es requerido' })
    }

    try {
        const esAdmin = await esAdminDelGrupo(req.params.id, req.usuario.id)
        if (!esAdmin) {
            return res.status(403).json({ mensaje: 'No tienes permiso para agregar miembros' })
        }

        const usuario = await prisma.usuarios.findUnique({
            where: { id: usuario_id },
            select: { id: true, nombre: true }
        })

        if (!usuario) {
            return res.status(404).json({ mensaje: 'Usuario no encontrado' })
        }

        await prisma.miembros_grupo.create({
            data: {
                grupo_id: req.params.id,
                usuario_id,
                rol: 'miembro'
            }
        })

        res.json({ mensaje: `${usuario.nombre} agregado al grupo exitosamente ✅` })

    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ mensaje: 'El usuario ya es miembro del grupo' })
        }
        res.status(500).json({ mensaje: 'Error al agregar miembro', error: error.message })
    }
})

// ─── ELIMINAR MIEMBRO (admin del grupo) ──────────────────
router.delete('/:id/miembros/:usuario_id', verificarToken, async (req, res) => {
    try {
        const esAdmin = await esAdminDelGrupo(req.params.id, req.usuario.id)
        if (!esAdmin) {
            return res.status(403).json({ mensaje: 'No tienes permiso para eliminar miembros' })
        }

        await prisma.miembros_grupo.deleteMany({
            where: {
                grupo_id: req.params.id,
                usuario_id: req.params.usuario_id
            }
        })

        // Notificar al miembro eliminado
        const grupoInfo = await prisma.grupos.findUnique({
            where: { id: req.params.id },
            select: { nombre: true }
        })
        await prisma.notificaciones.create({
            data: {
                usuario_id: req.params.usuario_id,
                tipo: 'eliminado_grupo',
                mensaje: `Has sido eliminado del grupo "${grupoInfo.nombre}"`
            }
        })

        res.json({ mensaje: 'Miembro eliminado del grupo exitosamente ✅' })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al eliminar miembro', error: error.message })
    }
})

// ─── CAMBIAR ROL DE MIEMBRO (creador del grupo) ───────────
router.put('/:id/miembros/:usuario_id/rol', verificarToken, async (req, res) => {
    const { rol } = req.body
    const rolesPermitidos = ['miembro', 'admin']

    if (!rolesPermitidos.includes(rol)) {
        return res.status(400).json({ mensaje: 'Rol inválido. Usa: miembro o admin' })
    }

    try {
        const grupo = await prisma.grupos.findUnique({
            where: { id: req.params.id },
            select: { creado_por: true }
        })

        if (grupo.creado_por !== req.usuario.id) {
            return res.status(403).json({ mensaje: 'Solo el creador del grupo puede cambiar roles' })
        }

        await prisma.miembros_grupo.update({
            where: {
                grupo_id_usuario_id: {
                    grupo_id: req.params.id,
                    usuario_id: req.params.usuario_id
                }
            },
            data: { rol }
        })

        // Notificar al miembro si pasa a ser admin
        if (rol === 'admin') {
            const grupoInfo = await prisma.grupos.findUnique({
                where: { id: req.params.id },
                select: { nombre: true }
            })
            await prisma.notificaciones.create({
                data: {
                    usuario_id: req.params.usuario_id,
                    tipo: 'nuevo_admin',
                    mensaje: `¡Ahora eres administrador del grupo "${grupoInfo.nombre}"! Tienes nuevas responsabilidades. grupo_id:${req.params.id}`
                }
            })
        }

        res.json({ mensaje: `Rol actualizado a "${rol}" exitosamente ✅` })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al cambiar rol', error: error.message })
    }
})

// ─── INVITAR AL GRUPO ─────────────────────────────────────
router.post('/:id/invitar', verificarToken, async (req, res) => {
    const { usuario_id } = req.body

    if (!usuario_id) {
        return res.status(400).json({ mensaje: 'usuario_id es requerido' })
    }

    try {
        const esAdmin = await esAdminDelGrupo(req.params.id, req.usuario.id)
        if (!esAdmin) {
            return res.status(403).json({ mensaje: 'Solo los admins del grupo pueden invitar miembros' })
        }

        const usuario = await prisma.usuarios.findUnique({
            where: { id: usuario_id },
            select: { id: true, nombre: true }
        })

        if (!usuario) {
            return res.status(404).json({ mensaje: 'Usuario no encontrado' })
        }

        const grupo = await prisma.grupos.findUnique({
            where: { id: req.params.id },
            select: { nombre: true }
        })

        const invitacion = await prisma.grupo_invitaciones.upsert({
            where: {
                grupo_id_usuario_id: {
                    grupo_id: req.params.id,
                    usuario_id
                }
            },
            update: {
                estado: 'pendiente',
                invitado_por: req.usuario.id
            },
            create: {
                grupo_id: req.params.id,
                invitado_por: req.usuario.id,
                usuario_id,
                estado: 'pendiente'
            }
        })

        // Crear notificación para el invitado
        await prisma.notificaciones.create({
            data: {
                usuario_id,
                tipo: 'invitacion_grupo',
                mensaje: `Te han invitado a unirte al grupo "${grupo.nombre}". grupo_id:${req.params.id} invitacion_id:${invitacion.id}`
            }
        })

        res.json({ mensaje: `Invitación enviada a ${usuario.nombre} ✅` })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al invitar usuario', error: error.message })
    }
})

// ─── ACEPTAR/RECHAZAR INVITACIÓN ──────────────────────────
router.put('/invitaciones/:invitacion_id', verificarToken, async (req, res) => {
    const { accion } = req.body
    if (!['aceptar', 'rechazar'].includes(accion)) {
        return res.status(400).json({ mensaje: 'Acción inválida. Usa: aceptar o rechazar' })
    }
    try {
        const invitacion = await prisma.grupo_invitaciones.findUnique({
            where: { id: req.params.invitacion_id }
        })
        if (!invitacion) {
            return res.status(404).json({ mensaje: 'Invitación no encontrada' })
        }
        if (invitacion.usuario_id !== req.usuario.id) {
            return res.status(403).json({ mensaje: 'Esta invitación no es para ti' })
        }
        if (accion === 'aceptar') {
            await prisma.miembros_grupo.create({
                data: {
                    grupo_id: invitacion.grupo_id,
                    usuario_id: req.usuario.id,
                    rol: 'miembro'
                }
            })
            // Notificar a quien invitó
            if (invitacion.invitado_por) {
                const grupoInfo = await prisma.grupos.findUnique({
                    where: { id: invitacion.grupo_id },
                    select: { nombre: true }
                })
                const usuarioQueAcepto = await prisma.usuarios.findUnique({
                    where: { id: req.usuario.id },
                    select: { nombre: true }
                })
                await prisma.notificaciones.create({
                    data: {
                        usuario_id: invitacion.invitado_por,
                        tipo: 'invitacion_aceptada',
                        mensaje: `${usuarioQueAcepto.nombre} aceptó tu invitación al grupo "${grupoInfo.nombre}"`
                    }
                })
            }
        }
        await prisma.grupo_invitaciones.update({
            where: { id: req.params.invitacion_id },
            data: { estado: accion === 'aceptar' ? 'aceptada' : 'rechazada' }
        })
        // res.json siempre al final
        res.json({
            mensaje: accion === 'aceptar'
                ? 'Te has unido al grupo exitosamente ✅'
                : 'Invitación rechazada ✅'
        })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al procesar invitación', error: error.message })
    }
})

// ─── CREAR RETO DEL GRUPO (admin del grupo) ───────────────
router.post('/:id/retos', verificarToken, async (req, res) => {
    const { titulo, descripcion, distancia_km, fecha_inicio, fecha_fin } = req.body

    if (!titulo) {
        return res.status(400).json({ mensaje: 'El título del reto es requerido' })
    }

    try {
        const esAdmin = await esAdminDelGrupo(req.params.id, req.usuario.id)
        if (!esAdmin) {
            return res.status(403).json({ mensaje: 'Solo los admins del grupo pueden crear retos' })
        }

        const reto = await prisma.grupo_retos.create({
            data: {
                grupo_id: req.params.id,
                creado_por: req.usuario.id,
                titulo,
                descripcion,
                distancia_km: distancia_km ? parseFloat(distancia_km) : null,
                fecha_inicio: fecha_inicio ? new Date(fecha_inicio) : null,
                fecha_fin: fecha_fin ? new Date(fecha_fin) : null
            }
        })

        res.status(201).json({ mensaje: 'Reto creado exitosamente ✅', reto })

        // Notificar a todos los miembros del grupo (excepto al creador)
        const miembrosParaNotificar = await prisma.miembros_grupo.findMany({
            where: {
                grupo_id: req.params.id,
                usuario_id: { not: req.usuario.id }
            },
            select: { usuario_id: true }
        })
        const grupoInfo = await prisma.grupos.findUnique({
            where: { id: req.params.id },
            select: { nombre: true }
        })
        if (miembrosParaNotificar.length > 0) {
            await prisma.notificaciones.createMany({
                data: miembrosParaNotificar.map(m => ({
                    usuario_id: m.usuario_id,
                    tipo: 'nuevo_reto_grupo',
                    mensaje: `🏁 Nuevo reto en "${grupoInfo.nombre}": "${titulo}". ¡Anímate a participar! grupo_id:${req.params.id} reto_id:${reto.id}`
                }))
            })
        }

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al crear reto', error: error.message })
    }
})

// ─── PARTICIPAR EN RETO DEL GRUPO ────────────────────────
router.post('/:id/retos/:reto_id/participar', verificarToken, async (req, res) => {
    try {
        await prisma.grupo_retos_usuario.create({
            data: {
                grupo_reto_id: req.params.reto_id,
                usuario_id: req.usuario.id
            }
        })

        res.json({ mensaje: 'Te has unido al reto ✅' })

    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ mensaje: 'Ya estás participando en este reto' })
        }
        res.status(500).json({ mensaje: 'Error al participar en reto', error: error.message })
    }
})

// ─── COMPLETAR RETO DEL GRUPO ─────────────────────────────
router.put('/:id/retos/:reto_id/completar', verificarToken, async (req, res) => {
    try {
        await prisma.grupo_retos_usuario.update({
            where: {
                grupo_reto_id_usuario_id: {
                    grupo_reto_id: req.params.reto_id,
                    usuario_id: req.usuario.id
                }
            },
            data: {
                completado: true,
                completado_en: new Date()
            }
        })

        res.json({ mensaje: '¡Reto completado! ✅' })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al completar reto', error: error.message })
    }
})

// ─── RANKING DE RETOS DEL GRUPO ───────────────────────────
router.get('/:id/retos/ranking', verificarToken, async (req, res) => {
    try {
        const miembros = await prisma.miembros_grupo.findMany({
            where: { grupo_id: req.params.id },
            include: {
                usuarios: {
                    select: {
                        id: true,
                        nombre: true,
                        avatar_url: true
                    }
                }
            }
        })

        const ranking = await Promise.all(
            miembros.map(async (m) => {
                const completados = await prisma.grupo_retos_usuario.count({
                    where: {
                        usuario_id: m.usuario_id,
                        completado: true,
                        grupo_retos: { grupo_id: req.params.id }
                    }
                })

                return {
                    usuario: m.usuarios,
                    retos_completados: completados
                }
            })
        )

        ranking.sort((a, b) => b.retos_completados - a.retos_completados)

        res.json({ ranking })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener ranking', error: error.message })
    }
})

// ─── CREAR ACTIVIDAD DEL GRUPO (admin del grupo) ──────────
router.post('/:id/actividades', verificarToken, async (req, res) => {
    const { titulo, descripcion, tipo, lugar, fecha, hora } = req.body

    if (!titulo) {
        return res.status(400).json({ mensaje: 'El título de la actividad es requerido' })
    }

    try {
        const esAdmin = await esAdminDelGrupo(req.params.id, req.usuario.id)
        if (!esAdmin) {
            return res.status(403).json({ mensaje: 'Solo los admins del grupo pueden crear actividades' })
        }

        const actividad = await prisma.grupo_actividades.create({
            data: {
                grupo_id: req.params.id,
                creado_por: req.usuario.id,
                titulo,
                descripcion,
                tipo: tipo || 'senderismo',
                lugar,
                fecha: fecha ? new Date(fecha) : null,
                hora: hora ? new Date(`1970-01-01T${hora}:00`) : null
            }
        })

        res.status(201).json({ mensaje: 'Actividad creada exitosamente ✅', actividad })

        // Notificar a todos los miembros del grupo (excepto al creador)
        const miembrosParaNotificar = await prisma.miembros_grupo.findMany({
            where: {
                grupo_id: req.params.id,
                usuario_id: { not: req.usuario.id }
            },
            select: { usuario_id: true }
        })
        const grupoInfoAct = await prisma.grupos.findUnique({
            where: { id: req.params.id },
            select: { nombre: true }
        })
        if (miembrosParaNotificar.length > 0) {
            await prisma.notificaciones.createMany({
                data: miembrosParaNotificar.map(m => ({
                    usuario_id: m.usuario_id,
                    tipo: 'nueva_actividad_grupo',
                    mensaje: `🏃 Nueva actividad en "${grupoInfoAct.nombre}": "${titulo}". ¡No te la pierdas! grupo_id:${req.params.id} actividad_id:${actividad.id}`
                }))
            })
        }

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al crear actividad', error: error.message })
    }
})

// ─── PARTICIPAR EN ACTIVIDAD DEL GRUPO ───────────────────
router.post('/:id/actividades/:actividad_id/participar', verificarToken, async (req, res) => {
    try {
        await prisma.grupo_actividades_usuario.create({
            data: {
                grupo_actividad_id: req.params.actividad_id,
                usuario_id: req.usuario.id
            }
        })

        res.json({ mensaje: 'Te has unido a la actividad ✅' })

    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ mensaje: 'Ya estás participando en esta actividad' })
        }
        res.status(500).json({ mensaje: 'Error al participar en actividad', error: error.message })
    }
})

// ─── COMPLETAR ACTIVIDAD DEL GRUPO ────────────────────────
router.put('/:id/actividades/:actividad_id/completar', verificarToken, async (req, res) => {
    try {
        await prisma.grupo_actividades_usuario.update({
            where: {
                grupo_actividad_id_usuario_id: {
                    grupo_actividad_id: req.params.actividad_id,
                    usuario_id: req.usuario.id
                }
            },
            data: {
                completado: true,
                completado_en: new Date()
            }
        })

        res.json({ mensaje: '¡Actividad completada! ✅' })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al completar actividad', error: error.message })
    }
})

// ─── RANKING DE ACTIVIDADES DEL GRUPO ────────────────────
router.get('/:id/actividades/ranking', verificarToken, async (req, res) => {
    try {
        const miembros = await prisma.miembros_grupo.findMany({
            where: { grupo_id: req.params.id },
            include: {
                usuarios: {
                    select: {
                        id: true,
                        nombre: true,
                        avatar_url: true
                    }
                }
            }
        })

        const ranking = await Promise.all(
            miembros.map(async (m) => {
                const completadas = await prisma.grupo_actividades_usuario.count({
                    where: {
                        usuario_id: m.usuario_id,
                        completado: true,
                        grupo_actividades: { grupo_id: req.params.id }
                    }
                })

                return {
                    usuario: m.usuarios,
                    actividades_completadas: completadas
                }
            })
        )

        ranking.sort((a, b) => b.actividades_completadas - a.actividades_completadas)

        res.json({ ranking })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener ranking', error: error.message })
    }
})

// ─── SUBIR MULTIMEDIA AL GRUPO ────────────────────────────
router.post('/:id/multimedia', verificarToken, upload.single('foto'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ mensaje: 'No se envió ninguna imagen' })
    }

    try {
        const esMiembro = await prisma.miembros_grupo.findUnique({
            where: {
                grupo_id_usuario_id: {
                    grupo_id: req.params.id,
                    usuario_id: req.usuario.id
                }
            }
        })

        if (!esMiembro) {
            return res.status(403).json({ mensaje: 'Debes ser miembro del grupo para subir fotos' })
        }

        const extension = req.file.mimetype.split('/')[1]
        const nombreArchivo = `grupo_${req.params.id}_${Date.now()}.${extension}`

        const { error: uploadError } = await supabase.storage
            .from('grupos')
            .upload(nombreArchivo, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            })

        if (uploadError) {
            return res.status(500).json({ mensaje: 'Error al subir foto', error: uploadError.message })
        }

        const { data } = supabase.storage.from('grupos').getPublicUrl(nombreArchivo)

        await prisma.grupo_multimedia.create({
            data: {
                grupo_id: req.params.id,
                usuario_id: req.usuario.id,
                url: data.publicUrl
            }
        })

        // Notificar a todos los miembros del grupo (excepto quien subió la foto)
        const miembrosParaNotificar = await prisma.miembros_grupo.findMany({
            where: {
                grupo_id: req.params.id,
                usuario_id: { not: req.usuario.id }
            },
            select: { usuario_id: true }
        })
        const subioPor = await prisma.usuarios.findUnique({
            where: { id: req.usuario.id },
            select: { nombre: true }
        })
        const grupoInfoFoto = await prisma.grupos.findUnique({
            where: { id: req.params.id },
            select: { nombre: true }
        })
        if (miembrosParaNotificar.length > 0) {
            await prisma.notificaciones.createMany({
                data: miembrosParaNotificar.map(m => ({
                    usuario_id: m.usuario_id,
                    tipo: 'nueva_foto_grupo',
                    mensaje: `🖼️ ${subioPor.nombre} añadió una foto a la galería de "${grupoInfoFoto.nombre}". ¡Échale un vistazo! grupo_id:${req.params.id}`
                }))
            })
        }

        res.json({ mensaje: 'Foto subida exitosamente ✅', url: data.publicUrl })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al subir multimedia', error: error.message })
    }
})

module.exports = router