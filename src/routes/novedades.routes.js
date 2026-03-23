const express = require('express')
const multer = require('multer')
const prisma = require('../prisma')
const supabase = require('../supabase')
const verificarToken = require('../middlewares/auth.middleware')
const verificarAdmin = require('../middlewares/admin.middleware')

const router = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
})

// ─── LISTAR NOVEDADES (todos) ─────────────────────────────
router.get('/', verificarToken, async (req, res) => {
  const { tipo } = req.query

  try {
    const novedades = await prisma.novedades.findMany({
      where: {
        activa: true,
        ...(tipo && { tipo })
      },
      orderBy: [
        { destacada: 'desc' },
        { publicado_en: 'desc' },
        { creado_en: 'desc' }
      ]
    })

    res.json({ novedades })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener novedades', error: error.message })
  }
})

// ─── LISTAR TODAS (admin) incluye inactivas ───────────────
router.get('/admin', verificarToken, verificarAdmin, async (req, res) => {
  try {
    const novedades = await prisma.novedades.findMany({
      orderBy: [
        { destacada: 'desc' },
        { creado_en: 'desc' }
      ]
    })

    res.json({ novedades })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener novedades', error: error.message })
  }
})

// ─── VER DETALLE ──────────────────────────────────────────
router.get('/:id', verificarToken, async (req, res) => {
  try {
    const novedad = await prisma.novedades.findUnique({
      where: { id: req.params.id }
    })

    if (!novedad) {
      return res.status(404).json({ mensaje: 'Novedad no encontrada' })
    }

    res.json({ novedad })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener novedad', error: error.message })
  }
})

// ─── CREAR NOVEDAD (solo admin) ───────────────────────────
router.post('/', verificarToken, verificarAdmin, upload.single('foto'), async (req, res) => {
  const { titulo, descripcion, tipo, url_externa, activa, destacada, publicado_en } = req.body

  if (!titulo) {
    return res.status(400).json({ mensaje: 'El título es requerido' })
  }

  try {
    let foto_url = null

    if (req.file) {
      const nombreArchivo = `novedad_${Date.now()}`
      const { error: uploadError } = await supabase.storage
        .from('novedades')
        .upload(nombreArchivo, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        })

      if (uploadError) {
        return res.status(500).json({ mensaje: 'Error al subir foto', error: uploadError.message })
      }

      const { data } = supabase.storage
        .from('novedades')
        .getPublicUrl(nombreArchivo)

      foto_url = data.publicUrl
    }

    const novedad = await prisma.novedades.create({
      data: {
        titulo,
        descripcion,
        foto_url,
        tipo: tipo || 'noticia',
        url_externa: url_externa || null,
        activa: activa !== undefined ? activa === 'true' : true,
        destacada: destacada === 'true',
        publicado_en: publicado_en ? new Date(publicado_en) : new Date()
      }
    })

    res.status(201).json({
      mensaje: 'Novedad creada exitosamente ✅',
      novedad
    })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al crear novedad', error: error.message })
  }
})

// ─── EDITAR NOVEDAD (solo admin) ──────────────────────────
router.put('/:id', verificarToken, verificarAdmin, upload.single('foto'), async (req, res) => {
  const { titulo, descripcion, tipo, url_externa, activa, destacada, publicado_en } = req.body

  try {
    let foto_url = undefined

    if (req.file) {
      const nombreArchivo = `novedad_${req.params.id}`
      const { error: uploadError } = await supabase.storage
        .from('novedades')
        .upload(nombreArchivo, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true
        })

      if (uploadError) {
        return res.status(500).json({ mensaje: 'Error al subir foto', error: uploadError.message })
      }

      const { data } = supabase.storage
        .from('novedades')
        .getPublicUrl(nombreArchivo)

      foto_url = data.publicUrl
    }

    const novedadActualizada = await prisma.novedades.update({
      where: { id: req.params.id },
      data: {
        ...(titulo && { titulo }),
        ...(descripcion !== undefined && { descripcion }),
        ...(tipo && { tipo }),
        ...(url_externa !== undefined && { url_externa }),
        ...(activa !== undefined && { activa: activa === 'true' }),
        ...(destacada !== undefined && { destacada: destacada === 'true' }),
        ...(publicado_en && { publicado_en: new Date(publicado_en) }),
        ...(foto_url && { foto_url })
      }
    })

    res.json({
      mensaje: 'Novedad actualizada exitosamente ✅',
      novedad: novedadActualizada
    })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al actualizar novedad', error: error.message })
  }
})

// ─── ACTIVAR / DESACTIVAR (solo admin) ────────────────────
router.patch('/:id/estado', verificarToken, verificarAdmin, async (req, res) => {
  const { activa } = req.body

  if (activa === undefined) {
    return res.status(400).json({ mensaje: 'El campo activa es requerido' })
  }

  try {
    const novedad = await prisma.novedades.update({
      where: { id: req.params.id },
      data: { activa }
    })

    res.json({
      mensaje: `Novedad ${activa ? 'activada' : 'desactivada'} exitosamente ✅`,
      novedad
    })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al cambiar estado', error: error.message })
  }
})

// ─── DESTACAR / QUITAR DESTACADO (solo admin) ─────────────
router.patch('/:id/destacar', verificarToken, verificarAdmin, async (req, res) => {
  const { destacada } = req.body

  if (destacada === undefined) {
    return res.status(400).json({ mensaje: 'El campo destacada es requerido' })
  }

  try {
    const novedad = await prisma.novedades.update({
      where: { id: req.params.id },
      data: { destacada }
    })

    res.json({
      mensaje: `Novedad ${destacada ? 'destacada' : 'quitada de destacados'} exitosamente ✅`,
      novedad
    })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al cambiar destacado', error: error.message })
  }
})

// ─── ELIMINAR NOVEDAD (solo admin) ────────────────────────
router.delete('/:id', verificarToken, verificarAdmin, async (req, res) => {
  try {
    await prisma.novedades.delete({
      where: { id: req.params.id }
    })

    res.json({ mensaje: 'Novedad eliminada exitosamente ✅' })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al eliminar novedad', error: error.message })
  }
})

module.exports = router
