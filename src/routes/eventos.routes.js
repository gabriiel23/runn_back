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

// ─── CREAR EVENTO (solo admin) ────────────────────────────
router.post('/', verificarToken, verificarAdmin, upload.single('foto'), async (req, res) => {
  const { titulo, descripcion, fecha, hora, lugar, distancia_km, ruta_sugerida } = req.body

  if (!titulo || !fecha || !hora || !lugar) {
    return res.status(400).json({ mensaje: 'Título, fecha, hora y lugar son requeridos' })
  }

  try {
    let foto_url = null

    // Subir foto si viene
    if (req.file) {
      const nombreArchivo = `evento_${Date.now()}`
      const { error: uploadError } = await supabase.storage
        .from('eventos')
        .upload(nombreArchivo, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        })

      if (uploadError) {
        return res.status(500).json({ mensaje: 'Error al subir foto', error: uploadError.message })
      }

      const { data } = supabase.storage
        .from('eventos')
        .getPublicUrl(nombreArchivo)

      foto_url = data.publicUrl
    }

    const nuevoEvento = await prisma.eventos.create({
      data: {
        titulo,
        descripcion,
        fecha: new Date(fecha),
        hora: new Date(`1970-01-01T${hora}:00`),
        lugar,
        distancia_km: distancia_km ? parseFloat(distancia_km) : null,
        ruta_sugerida: ruta_sugerida || null,
        foto_url
      }
    })

    res.status(201).json({
      mensaje: 'Evento creado exitosamente ✅',
      evento: nuevoEvento
    })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al crear evento', error: error.message })
  }
})

// ─── LISTAR EVENTOS ───────────────────────────────────────
router.get('/', verificarToken, async (req, res) => {
  try {
    const eventos = await prisma.eventos.findMany({
      orderBy: { fecha: 'asc' },
      include: {
        _count: {
          select: { eventos_usuario: true }
        }
      }
    })

    const eventosConParticipantes = eventos.map(e => ({
      id: e.id,
      titulo: e.titulo,
      descripcion: e.descripcion,
      fecha: e.fecha,
      hora: e.hora,
      lugar: e.lugar,
      distancia_km: e.distancia_km,
      foto_url: e.foto_url,
      ruta_sugerida: e.ruta_sugerida,
      creado_en: e.creado_en,
      participantes: e._count.eventos_usuario
    }))

    res.json({ eventos: eventosConParticipantes })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener eventos', error: error.message })
  }
})

// ─── VER DETALLE DE EVENTO ────────────────────────────────
router.get('/:id', verificarToken, async (req, res) => {
  try {
    const evento = await prisma.eventos.findUnique({
      where: { id: req.params.id },
      include: {
        eventos_usuario: {
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
        }
      }
    })

    if (!evento) {
      return res.status(404).json({ mensaje: 'Evento no encontrado' })
    }

    // Verificar si el usuario logueado ya está inscrito
    const yaInscrito = evento.eventos_usuario.some(
      eu => eu.usuario_id === req.usuario.id
    )

    const participantes = evento.eventos_usuario.map(eu => eu.usuarios)

    res.json({
      evento: {
        id: evento.id,
        titulo: evento.titulo,
        descripcion: evento.descripcion,
        fecha: evento.fecha,
        hora: evento.hora,
        lugar: evento.lugar,
        distancia_km: evento.distancia_km,
        foto_url: evento.foto_url,
        ruta_sugerida: evento.ruta_sugerida,
        creado_en: evento.creado_en
      },
      participantes,
      total_participantes: participantes.length,
      ya_inscrito: yaInscrito
    })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener evento', error: error.message })
  }
})

// ─── UNIRSE A EVENTO ──────────────────────────────────────
router.post('/:id/unirse', verificarToken, async (req, res) => {
  try {
    const evento = await prisma.eventos.findUnique({
      where: { id: req.params.id }
    })

    if (!evento) {
      return res.status(404).json({ mensaje: 'Evento no encontrado' })
    }

    await prisma.eventos_usuario.create({
      data: {
        evento_id: req.params.id,
        usuario_id: req.usuario.id
      }
    })

    res.json({ mensaje: 'Te has inscrito al evento exitosamente ✅' })

  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ mensaje: 'Ya estás inscrito en este evento' })
    }
    res.status(500).json({ mensaje: 'Error al unirse al evento', error: error.message })
  }
})

// ─── SALIRSE DE EVENTO ────────────────────────────────────
router.delete('/:id/unirse', verificarToken, async (req, res) => {
  try {
    await prisma.eventos_usuario.deleteMany({
      where: {
        evento_id: req.params.id,
        usuario_id: req.usuario.id
      }
    })

    res.json({ mensaje: 'Te has desinscrito del evento ✅' })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al salirse del evento', error: error.message })
  }
})

// ─── EDITAR EVENTO (solo admin) ───────────────────────────
router.put('/:id', verificarToken, verificarAdmin, upload.single('foto'), async (req, res) => {
  const { titulo, descripcion, fecha, hora, lugar, distancia_km, ruta_sugerida } = req.body

  try {
    let foto_url = undefined

    if (req.file) {
      const nombreArchivo = `evento_${req.params.id}`
      const { error: uploadError } = await supabase.storage
        .from('eventos')
        .upload(nombreArchivo, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true
        })

      if (uploadError) {
        return res.status(500).json({ mensaje: 'Error al subir foto', error: uploadError.message })
      }

      const { data } = supabase.storage
        .from('eventos')
        .getPublicUrl(nombreArchivo)

      foto_url = data.publicUrl
    }

    const eventoActualizado = await prisma.eventos.update({
      where: { id: req.params.id },
      data: {
        ...(titulo && { titulo }),
        ...(descripcion && { descripcion }),
        ...(fecha && { fecha: new Date(fecha) }),
        ...(hora && { hora: new Date(`1970-01-01T${hora}:00`) }),
        ...(lugar && { lugar }),
        ...(distancia_km && { distancia_km: parseFloat(distancia_km) }),
        ...(ruta_sugerida && { ruta_sugerida }),
        ...(foto_url && { foto_url })
      }
    })

    res.json({
      mensaje: 'Evento actualizado exitosamente ✅',
      evento: eventoActualizado
    })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al actualizar evento', error: error.message })
  }
})

// ─── ELIMINAR EVENTO (solo admin) ─────────────────────────
router.delete('/:id', verificarToken, verificarAdmin, async (req, res) => {
  try {
    await prisma.eventos.delete({
      where: { id: req.params.id }
    })

    res.json({ mensaje: 'Evento eliminado exitosamente ✅' })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al eliminar evento', error: error.message })
  }
})

// ─── AGREGAR PARTICIPANTE (solo admin) ────────────────────
router.post('/:id/participantes', verificarToken, verificarAdmin, async (req, res) => {
  const { usuario_id } = req.body

  if (!usuario_id) {
    return res.status(400).json({ mensaje: 'usuario_id es requerido' })
  }

  try {
    // Verificar que el evento existe
    const evento = await prisma.eventos.findUnique({
      where: { id: req.params.id }
    })

    if (!evento) {
      return res.status(404).json({ mensaje: 'Evento no encontrado' })
    }

    // Verificar que el usuario existe
    const usuario = await prisma.usuarios.findUnique({
      where: { id: usuario_id },
      select: { id: true, nombre: true }
    })

    if (!usuario) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' })
    }

    await prisma.eventos_usuario.create({
      data: {
        evento_id: req.params.id,
        usuario_id
      }
    })

    res.status(201).json({
      mensaje: `${usuario.nombre} agregado al evento exitosamente ✅`
    })

  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ mensaje: 'El usuario ya está inscrito en este evento' })
    }
    res.status(500).json({ mensaje: 'Error al agregar participante', error: error.message })
  }
})

// ─── ELIMINAR PARTICIPANTE (solo admin) ───────────────────
router.delete('/:id/participantes/:usuario_id', verificarToken, verificarAdmin, async (req, res) => {
  try {
    const evento = await prisma.eventos.findUnique({
      where: { id: req.params.id }
    })

    if (!evento) {
      return res.status(404).json({ mensaje: 'Evento no encontrado' })
    }

    const inscripcion = await prisma.eventos_usuario.findUnique({
      where: {
        evento_id_usuario_id: {
          evento_id: req.params.id,
          usuario_id: req.params.usuario_id
        }
      }
    })

    if (!inscripcion) {
      return res.status(404).json({ mensaje: 'El usuario no está inscrito en este evento' })
    }

    await prisma.eventos_usuario.delete({
      where: {
        evento_id_usuario_id: {
          evento_id: req.params.id,
          usuario_id: req.params.usuario_id
        }
      }
    })

    res.json({ mensaje: 'Participante eliminado del evento exitosamente ✅' })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al eliminar participante', error: error.message })
  }
})

module.exports = router