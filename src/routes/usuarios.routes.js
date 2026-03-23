const express = require('express')
const multer = require('multer')
const prisma = require('../prisma')
const supabase = require('../supabase')
const verificarToken = require('../middlewares/auth.middleware')

const router = express.Router()

// Multer configurado en memoria para pasar el archivo a Supabase
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // máximo 5MB
})

// ─── EDITAR PERFIL ────────────────────────────────────────
router.put('/perfil', verificarToken, async (req, res) => {
    const { nombre, biografia, peso_kg, altura_cm, ciudad, pais, nivel, genero } = req.body

    try {
        const usuarioActualizado = await prisma.usuarios.update({
            where: { id: req.usuario.id },
            data: {
                ...(nombre && { nombre }),
                ...(biografia && { biografia }),
                ...(peso_kg && { peso_kg: parseFloat(peso_kg) }),
                ...(altura_cm && { altura_cm: parseFloat(altura_cm) }),
                ...(ciudad && { ciudad }),
                ...(pais && { pais }),
                ...(nivel && { nivel }),
                ...(genero && { genero })
            },
            select: {
                id: true,
                nombre: true,
                correo: true,
                biografia: true,
                avatar_url: true,
                peso_kg: true,
                altura_cm: true,
                ciudad: true,
                pais: true,
                nivel: true,
                genero: true,
                puntos: true
            }
        })

        res.json({
            mensaje: 'Perfil actualizado exitosamente ✅',
            usuario: usuarioActualizado
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar perfil', error: error.message })
    }
})

// ─── SUBIR AVATAR ─────────────────────────────────────────
router.post('/avatar', verificarToken, upload.single('avatar'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ mensaje: 'No se envió ninguna imagen' })
    }

    try {
        // Siempre el mismo nombre sin extensión — siempre sobreescribe
        const nombreArchivo = `${req.usuario.id}`

        const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(nombreArchivo, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: true
            })

        if (uploadError) {
            return res.status(500).json({ mensaje: 'Error al subir imagen', error: uploadError.message })
        }

        const { data } = supabase.storage
            .from('avatars')
            .getPublicUrl(nombreArchivo)

        await prisma.usuarios.update({
            where: { id: req.usuario.id },
            data: { avatar_url: data.publicUrl }
        })

        res.json({
            mensaje: 'Avatar actualizado exitosamente ✅',
            avatar_url: data.publicUrl
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al subir avatar', error: error.message })
    }
})

// ─── SUBIR FOTO MULTIMEDIA ────────────────────────────────
router.post('/media', verificarToken, upload.single('foto'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ mensaje: 'No se envió ninguna imagen' })
    }

    try {
        const extension = req.file.mimetype.split('/')[1]
        const nombreArchivo = `${req.usuario.id}_${Date.now()}.${extension}`

        const { error: uploadError } = await supabase.storage
            .from('media')
            .upload(nombreArchivo, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            })

        if (uploadError) {
            return res.status(500).json({ mensaje: 'Error al subir foto', error: uploadError.message })
        }

        const { data } = supabase.storage
            .from('media')
            .getPublicUrl(nombreArchivo)

        // Guardar URL vinculada al usuario en la base de datos
        await prisma.multimedia.create({
            data: {
                usuario_id: req.usuario.id,
                url: data.publicUrl
            }
        })

        res.json({
            mensaje: 'Foto subida exitosamente ✅',
            url: data.publicUrl
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al subir foto', error: error.message })
    }
})

// ─── OBTENER MULTIMEDIA DEL USUARIO ──────────────────────
router.get('/media', verificarToken, async (req, res) => {
    try {
        const fotos = await prisma.multimedia.findMany({
            where: { usuario_id: req.usuario.id },
            orderBy: { creado_en: 'desc' }
        })

        res.json({
            total: fotos.length,
            fotos
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener fotos', error: error.message })
    }
})

// ─── OBTENER MULTIMEDIA DE OTRO USUARIO (PÚBLICA) ───────
router.get('/:id/media', verificarToken, async (req, res) => {
    try {
        const fotos = await prisma.multimedia.findMany({
            where: { usuario_id: req.params.id },
            orderBy: { creado_en: 'desc' }
        })

        res.json({
            total: fotos.length,
            fotos
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener fotos públicas', error: error.message })
    }
})

// ─── ELIMINAR FOTO MULTIMEDIA ─────────────────────────────
router.delete('/media/:id', verificarToken, async (req, res) => {
    try {
        const foto = await prisma.multimedia.findUnique({
            where: { id: req.params.id }
        })

        if (!foto) {
            return res.status(404).json({ mensaje: 'Foto no encontrada' })
        }

        if (foto.usuario_id !== req.usuario.id) {
            return res.status(403).json({ mensaje: 'No tienes permiso para eliminar esta foto' })
        }

        // Extraer nombre del archivo de la URL para eliminarlo de Storage
        const nombreArchivo = foto.url.split('/media/')[1]

        await supabase.storage
            .from('media')
            .remove([nombreArchivo])

        await prisma.multimedia.delete({
            where: { id: req.params.id }
        })

        res.json({ mensaje: 'Foto eliminada exitosamente ✅' })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al eliminar foto', error: error.message })
    }
})

// ─── LISTAR USUARIOS (Comunidad) ──────────────────────────
router.get('/', verificarToken, async (req, res) => {
    const { buscar, nivel, ciudad } = req.query

    try {
        const usuarios = await prisma.usuarios.findMany({
            where: {
                // Excluir al usuario logueado
                NOT: { id: req.usuario.id },
                // Si viene un término de búsqueda, filtrar por nombre
                ...(buscar && {
                    nombre: {
                        contains: buscar,
                        mode: 'insensitive'
                    }
                }),
                ...(nivel && { nivel }),
                ...(ciudad && {
                    ciudad: {
                        contains: ciudad,
                        mode: 'insensitive'
                    }
                })
            },
            select: {
                id: true,
                nombre: true,
                avatar_url: true,
                biografia: true,
                ciudad: true,
                nivel: true,
                puntos: true
            },
            orderBy: { puntos: 'desc' }
        })

        res.json({ usuarios })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener usuarios', error: error.message })
    }
})

// ─── OBTENER ESTADÍSTICAS (Comunidad) ─────────────────────
// GET /usuarios/stats
router.get('/stats', verificarToken, async (req, res) => {
    try {
        const [grupos, runners, eventos] = await Promise.all([
            prisma.grupos.count(),
            prisma.usuarios.count(),
            prisma.eventos.count() // Si solo cuentan eventos de usuario: prisma.eventos.count() (o excluir expirados si se desea)
        ])

        res.json({ grupos, runners, eventos })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener estadísticas', error: error.message })
    }
})

// ─── VER PERFIL DE OTRO USUARIO ───────────────────────────
router.get('/:id', verificarToken, async (req, res) => {
    try {
        const usuario = await prisma.usuarios.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                nombre: true,
                avatar_url: true,
                biografia: true,
                ciudad: true,
                nivel: true,
                puntos: true,
                creado_en: true
            }
        })

        if (!usuario) {
            return res.status(404).json({ mensaje: 'Usuario no encontrado' })
        }

        // Contar seguidores y seguidos
        const seguidores = await prisma.seguimientos.count({
            where: { seguido_id: req.params.id }
        })

        const seguidos = await prisma.seguimientos.count({
            where: { seguidor_id: req.params.id }
        })

        // Verificar si el usuario logueado ya sigue a este usuario
        const yaSigue = await prisma.seguimientos.findUnique({
            where: {
                seguidor_id_seguido_id: {
                    seguidor_id: req.usuario.id,
                    seguido_id: req.params.id
                }
            }
        })

        res.json({
            usuario,
            seguidores,
            seguidos,
            yo_lo_sigo: !!yaSigue
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener usuario', error: error.message })
    }
})

// ─── SEGUIR USUARIO ───────────────────────────────────────
router.post('/:id/seguir', verificarToken, async (req, res) => {
    if (req.usuario.id === req.params.id) {
        return res.status(400).json({ mensaje: 'No puedes seguirte a ti mismo' })
    }

    try {
        await prisma.seguimientos.create({
            data: {
                seguidor_id: req.usuario.id,
                seguido_id: req.params.id
            }
        })

        res.json({ mensaje: 'Ahora sigues a este usuario ✅' })

    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ mensaje: 'Ya sigues a este usuario' })
        }
        res.status(500).json({ mensaje: 'Error al seguir usuario', error: error.message })
    }
})

// ─── DEJAR DE SEGUIR ──────────────────────────────────────
router.delete('/:id/seguir', verificarToken, async (req, res) => {
    try {
        await prisma.seguimientos.deleteMany({
            where: {
                seguidor_id: req.usuario.id,
                seguido_id: req.params.id
            }
        })

        res.json({ mensaje: 'Dejaste de seguir a este usuario ✅' })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al dejar de seguir', error: error.message })
    }
})

// ─── MIS SEGUIDORES ───────────────────────────────────────
router.get('/yo/seguidores', verificarToken, async (req, res) => {
    try {
        const seguidores = await prisma.seguimientos.findMany({
            where: { seguido_id: req.usuario.id },
            include: {
                usuarios_seguimientos_seguidor_idTousuarios: {
                    select: {
                        id: true,
                        nombre: true,
                        avatar_url: true,
                        ciudad: true,
                        nivel: true,
                        puntos: true
                    }
                }
            }
        })

        const lista = seguidores.map(s => s.usuarios_seguimientos_seguidor_idTousuarios)

        res.json({
            total: lista.length,
            seguidores: lista
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener seguidores', error: error.message })
    }
})

// ─── A QUIÉNES SIGO ───────────────────────────────────────
router.get('/yo/siguiendo', verificarToken, async (req, res) => {
    try {
        const siguiendo = await prisma.seguimientos.findMany({
            where: { seguidor_id: req.usuario.id },
            include: {
                usuarios_seguimientos_seguido_idTousuarios: {
                    select: {
                        id: true,
                        nombre: true,
                        avatar_url: true,
                        ciudad: true,
                        nivel: true,
                        puntos: true
                    }
                }
            }
        })

        const lista = siguiendo.map(s => s.usuarios_seguimientos_seguido_idTousuarios)

        res.json({
            total: lista.length,
            siguiendo: lista
        })

    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener siguiendo', error: error.message })
    }
})

module.exports = router
