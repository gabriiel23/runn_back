const express = require('express')
const prisma = require('../prisma')
const verificarToken = require('../middlewares/auth.middleware')

const router = express.Router()

// ─── MIS NOTIFICACIONES ───────────────────────────────────
router.get('/', verificarToken, async (req, res) => {
  try {
    const notificaciones = await prisma.notificaciones.findMany({
      where: { usuario_id: req.usuario.id },
      orderBy: { creado_en: 'desc' },
      take: 50 // últimas 50
    })

    const noLeidas = notificaciones.filter(n => !n.leida).length

    res.json({
      total: notificaciones.length,
      no_leidas: noLeidas,
      notificaciones
    })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener notificaciones', error: error.message })
  }
})

// ─── MARCAR UNA COMO LEÍDA ────────────────────────────────
router.patch('/:id/leer', verificarToken, async (req, res) => {
  try {
    const notificacion = await prisma.notificaciones.findUnique({
      where: { id: req.params.id }
    })

    if (!notificacion) {
      return res.status(404).json({ mensaje: 'Notificación no encontrada' })
    }

    if (notificacion.usuario_id !== req.usuario.id) {
      return res.status(403).json({ mensaje: 'No tienes permiso para marcar esta notificación' })
    }

    await prisma.notificaciones.update({
      where: { id: req.params.id },
      data: { leida: true }
    })

    res.json({ mensaje: 'Notificación marcada como leída ✅' })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al marcar notificación', error: error.message })
  }
})

// ─── MARCAR TODAS COMO LEÍDAS ─────────────────────────────
router.patch('/leer-todas', verificarToken, async (req, res) => {
  try {
    await prisma.notificaciones.updateMany({
      where: {
        usuario_id: req.usuario.id,
        leida: false
      },
      data: { leida: true }
    })

    res.json({ mensaje: 'Todas las notificaciones marcadas como leídas ✅' })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al marcar notificaciones', error: error.message })
  }
})

// ─── ELIMINAR UNA NOTIFICACIÓN ────────────────────────────
router.delete('/:id', verificarToken, async (req, res) => {
  try {
    const notificacion = await prisma.notificaciones.findUnique({
      where: { id: req.params.id }
    })

    if (!notificacion) {
      return res.status(404).json({ mensaje: 'Notificación no encontrada' })
    }

    if (notificacion.usuario_id !== req.usuario.id) {
      return res.status(403).json({ mensaje: 'No tienes permiso para eliminar esta notificación' })
    }

    await prisma.notificaciones.delete({
      where: { id: req.params.id }
    })

    res.json({ mensaje: 'Notificación eliminada ✅' })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al eliminar notificación', error: error.message })
  }
})

// ─── ELIMINAR TODAS LAS NOTIFICACIONES ────────────────────
router.delete('/', verificarToken, async (req, res) => {
  try {
    await prisma.notificaciones.deleteMany({
      where: { usuario_id: req.usuario.id }
    })

    res.json({ mensaje: 'Todas las notificaciones eliminadas ✅' })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al eliminar notificaciones', error: error.message })
  }
})

module.exports = router