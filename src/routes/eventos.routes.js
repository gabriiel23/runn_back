const express = require('express')
const multer = require('multer')
const QRCode = require('qrcode')
const { nanoid } = require('nanoid')
const prisma = require('../prisma')
const supabase = require('../supabase')
const verificarToken = require('../middlewares/auth.middleware')
const verificarAdmin = require('../middlewares/admin.middleware')

const router = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
})

// Helper para generar código alfanumérico único
const generarCodigoUnico = async () => {
  let codigo
  let existe = true
  while (existe) {
    codigo = nanoid(8).toUpperCase()
    const found = await prisma.eventos_codigos.findUnique({
      where: { codigo_alfanumerico: codigo }
    })
    existe = !!found
  }
  return codigo
}

// Helper para generar QR como base64
const generarQR = async (contenido) => {
  return await QRCode.toDataURL(contenido, { width: 300, margin: 2 })
}

// Helper para notificar
const notificar = async (usuarioId, tipo, mensaje) => {
  await prisma.notificaciones.create({
    data: { usuario_id: usuarioId, tipo, mensaje }
  })
}

// ─── CREAR EVENTO (solo admin) ────────────────────────────
router.post('/', verificarToken, verificarAdmin, upload.single('foto'), async (req, res) => {
  const {
    titulo, descripcion, fecha, hora, lugar, distancia_km,
    es_pago, precio, limite_participantes, limite_lista_espera,
    waypoints, punto_inicio, punto_fin, indicaciones, cuentas_bancarias
  } = req.body

  if (!titulo || !fecha || !hora || !lugar) {
    return res.status(400).json({ mensaje: 'Título, fecha, hora y lugar son requeridos' })
  }

  try {
    let foto_url = null

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

      const { data } = supabase.storage.from('eventos').getPublicUrl(nombreArchivo)
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
        foto_url,
        es_pago: es_pago === 'true',
        precio: precio ? parseFloat(precio) : 0,
        limite_participantes: limite_participantes ? parseInt(limite_participantes) : null,
        limite_lista_espera: limite_lista_espera ? parseInt(limite_lista_espera) : null,
        waypoints: waypoints ? JSON.parse(waypoints) : null,
        punto_inicio: punto_inicio ? JSON.parse(punto_inicio) : null,
        punto_fin: punto_fin ? JSON.parse(punto_fin) : null,
        indicaciones: indicaciones ? JSON.parse(indicaciones) : null,
        cuentas_bancarias: cuentas_bancarias ? JSON.parse(cuentas_bancarias) : null
      }
    })

    // Notificar a todos los usuarios registrados
    const todosLosUsuarios = await prisma.usuarios.findMany({ select: { id: true } })
    await prisma.notificaciones.createMany({
      data: todosLosUsuarios.map(u => ({
        usuario_id: u.id,
        tipo: 'nuevo_evento',
        mensaje: `¡Hay un nuevo evento disponible! "${nuevoEvento.titulo}" — ¡únete ahora! evento_id:${nuevoEvento.id}`
      }))
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
          select: {
            eventos_usuario: true,
            eventos_lista_espera: true
          }
        }
      }
    })

    const eventosConInfo = eventos.map(e => ({
      id: e.id,
      titulo: e.titulo,
      descripcion: e.descripcion,
      fecha: e.fecha,
      hora: e.hora,
      lugar: e.lugar,
      distancia_km: e.distancia_km,
      foto_url: e.foto_url,
      es_pago: e.es_pago,
      precio: e.precio,
      limite_participantes: e.limite_participantes,
      limite_lista_espera: e.limite_lista_espera,
      waypoints: e.waypoints,
      punto_inicio: e.punto_inicio,
      punto_fin: e.punto_fin,
      indicaciones: e.indicaciones,
      cuentas_bancarias: e.cuentas_bancarias,
      finalizado: e.finalizado ?? false,
      creado_en: e.creado_en,
      participantes_confirmados: e._count.eventos_usuario,
      en_lista_espera: e._count.eventos_lista_espera,
      cupo_disponible: e.limite_participantes
        ? e.limite_participantes - e._count.eventos_usuario
        : null
    }))

    res.json({ eventos: eventosConInfo })

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
              select: { id: true, nombre: true, avatar_url: true, ciudad: true, nivel: true }
            }
          }
        },
        _count: {
          select: {
            eventos_usuario: true,
            eventos_lista_espera: true
          }
        }
      }
    })

    if (!evento) {
      return res.status(404).json({ mensaje: 'Evento no encontrado' })
    }

    // Estado del usuario actual
    const yaInscrito = evento.eventos_usuario.some(eu => eu.usuario_id === req.usuario.id)

    const enListaEspera = await prisma.eventos_lista_espera.findUnique({
      where: {
        evento_id_usuario_id: {
          evento_id: req.params.id,
          usuario_id: req.usuario.id
        }
      }
    })

    const miCodigo = yaInscrito
      ? await prisma.eventos_codigos.findUnique({
        where: {
          evento_id_usuario_id: {
            evento_id: req.params.id,
            usuario_id: req.usuario.id
          }
        }
      })
      : null

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
        es_pago: evento.es_pago,
        precio: evento.precio,
        limite_participantes: evento.limite_participantes,
        limite_lista_espera: evento.limite_lista_espera,
        waypoints: evento.waypoints,
        punto_inicio: evento.punto_inicio,
        punto_fin: evento.punto_fin,
        indicaciones: evento.indicaciones,
        cuentas_bancarias: evento.cuentas_bancarias,
        finalizado: evento.finalizado ?? false,
        participantes_confirmados: evento._count.eventos_usuario,
        creado_en: evento.creado_en
      },
      participantes,
      total_participantes: evento._count.eventos_usuario,
      total_lista_espera: evento._count.eventos_lista_espera,
      cupo_disponible: evento.limite_participantes
        ? evento.limite_participantes - evento._count.eventos_usuario
        : null,
      ya_inscrito: yaInscrito,
      en_lista_espera: enListaEspera ? enListaEspera.estado : null,
      mi_codigo: miCodigo ? {
        codigo_alfanumerico: miCodigo.codigo_alfanumerico,
        codigo_qr: miCodigo.codigo_qr,
        usado: miCodigo.usado
      } : null
    })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener evento', error: error.message })
  }
})

// ─── INSCRIBIRSE AL EVENTO ────────────────────────────────
router.post('/:id/unirse', verificarToken, async (req, res) => {
  try {
    const evento = await prisma.eventos.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: {
            eventos_usuario: true,
            eventos_lista_espera: true
          }
        }
      }
    })

    if (!evento) {
      return res.status(404).json({ mensaje: 'Evento no encontrado' })
    }

    // Verificar si ya está inscrito o en lista de espera
    const yaInscrito = await prisma.eventos_usuario.findUnique({
      where: {
        evento_id_usuario_id: {
          evento_id: req.params.id,
          usuario_id: req.usuario.id
        }
      }
    })

    if (yaInscrito) {
      return res.status(400).json({ mensaje: 'Ya estás inscrito en este evento' })
    }

    const enEspera = await prisma.eventos_lista_espera.findUnique({
      where: {
        evento_id_usuario_id: {
          evento_id: req.params.id,
          usuario_id: req.usuario.id
        }
      }
    })

    if (enEspera) {
      return res.status(400).json({ mensaje: 'Ya estás en la lista de espera de este evento' })
    }

    // Verificar cupo
    if (evento.limite_participantes) {
      const cupoLleno = evento._count.eventos_usuario >= evento.limite_participantes
      if (cupoLleno) {
        // Verificar cupo en lista de espera
        if (evento.limite_lista_espera) {
          const esperaLlena = evento._count.eventos_lista_espera >= evento.limite_lista_espera
          if (esperaLlena) {
            return res.status(400).json({ mensaje: 'El evento y la lista de espera están llenos' })
          }
        }

        // Agregar a lista de espera
        await prisma.eventos_lista_espera.create({
          data: {
            evento_id: req.params.id,
            usuario_id: req.usuario.id,
            estado: 'pendiente'
          }
        })

        await notificar(
          req.usuario.id,
          'lista_espera_evento',
          `Te has unido a la lista de espera del evento "${evento.titulo}". El admin revisará tu solicitud.`
        )

        return res.json({
          mensaje: 'Agregado a la lista de espera ✅',
          estado: 'lista_espera'
        })
      }
    }

    // Evento gratuito con cupo disponible — agregar a lista de espera para aprobación
    if (!evento.es_pago) {
      await prisma.eventos_lista_espera.create({
        data: {
          evento_id: req.params.id,
          usuario_id: req.usuario.id,
          estado: 'pendiente'
        }
      })

      await notificar(
        req.usuario.id,
        'lista_espera_evento',
        `Te has unido a la lista de espera del evento "${evento.titulo}". El admin revisará tu solicitud.`
      )

      return res.json({
        mensaje: 'Solicitud enviada. El admin revisará tu inscripción ✅',
        estado: 'pendiente'
      })
    }

    // Evento de pago — por ahora redirigir a pasarela (placeholder)
    return res.json({
      mensaje: 'Evento de pago',
      estado: 'pago_requerido',
      precio: evento.precio,
      evento_id: evento.id
    })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al inscribirse', error: error.message })
  }
})

// ─── INSCRIBIRSE A EVENTO DE PAGO CON COMPROBANTE ──────────
router.post('/:id/unirse-pago', verificarToken, upload.single('comprobante'), async (req, res) => {
  try {
    const evento = await prisma.eventos.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: { eventos_usuario: true, eventos_lista_espera: true }
        }
      }
    });

    if (!evento) return res.status(404).json({ mensaje: 'Evento no encontrado' });
    if (!evento.es_pago) return res.status(400).json({ mensaje: 'Este evento no es de pago. Usa la inscripción normal.' });
    if (!req.file) return res.status(400).json({ mensaje: 'El comprobante de pago es requerido' });

    // Verificar si ya está inscrito
    const yaInscrito = await prisma.eventos_usuario.findUnique({
      where: { evento_id_usuario_id: { evento_id: req.params.id, usuario_id: req.usuario.id } }
    });
    if (yaInscrito) return res.status(400).json({ mensaje: 'Ya estás inscrito en este evento' });

    // Si ya está en espera, actualizar el comprobante si fue rechazado antes, o simplemente actualizar.
    const enEspera = await prisma.eventos_lista_espera.findUnique({
      where: { evento_id_usuario_id: { evento_id: req.params.id, usuario_id: req.usuario.id } }
    });

    if (enEspera && enEspera.estado !== 'rechazado') {
        return res.status(400).json({ mensaje: 'Ya estás en la lista de espera (Estado: ' + enEspera.estado + ')' });
    }

    // Verificar cupo del evento
    if (evento.limite_participantes && evento._count.eventos_usuario >= evento.limite_participantes) {
      if (evento.limite_lista_espera && evento._count.eventos_lista_espera >= evento.limite_lista_espera) {
        return res.status(400).json({ mensaje: 'El evento y la lista de espera están llenos' });
      }
    }

    // Subir comprobante a Supabase
    const nombreArchivo = `comprobante_${req.params.id}_${req.usuario.id}_${Date.now()}`;
    const { error: uploadError } = await supabase.storage
      .from('eventos')
      .upload(nombreArchivo, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (uploadError) {
      return res.status(500).json({ mensaje: 'Error al subir comprobante', error: uploadError.message });
    }

    const { data } = supabase.storage.from('eventos').getPublicUrl(nombreArchivo);
    const comprobante_url = data.publicUrl;

    if (enEspera) {
      // Re-enviar comprobante por rechazo anterior
      await prisma.eventos_lista_espera.update({
        where: { id: enEspera.id },
        data: { estado: 'pendiente', comprobante_url, motivo_rechazo: null }
      });
      await notificar(req.usuario.id, 'lista_espera_evento', `Tu comprobante para "${evento.titulo}" se re-envió correctamente.`);
    } else {
      // Crear nueva solicitud
      await prisma.eventos_lista_espera.create({
        data: {
          evento_id: req.params.id,
          usuario_id: req.usuario.id,
          estado: 'pendiente',
          comprobante_url
        }
      });
      await notificar(req.usuario.id, 'lista_espera_evento', `Comprobante de pago enviado para "${evento.titulo}". El admin lo validará pronto.`);
    }

    return res.json({
      mensaje: 'Comprobante recibido ✅. En espera de validación.',
      estado: 'pendiente'
    });

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al enviar comprobante', error: error.message });
  }
})


// ─── ADMITIR O RECHAZAR DE LISTA DE ESPERA (admin) ────────
router.put('/:id/lista-espera/:usuario_id', verificarToken, verificarAdmin, async (req, res) => {
  const { accion, motivo } = req.body

  if (!['admitir', 'rechazar'].includes(accion)) {
    return res.status(400).json({ mensaje: 'Acción inválida. Usa: admitir o rechazar' })
  }

  try {
    const evento = await prisma.eventos.findUnique({
      where: { id: req.params.id },
      select: { titulo: true, limite_participantes: true }
    })

    if (!evento) {
      return res.status(404).json({ mensaje: 'Evento no encontrado' })
    }

    const solicitud = await prisma.eventos_lista_espera.findUnique({
      where: {
        evento_id_usuario_id: {
          evento_id: req.params.id,
          usuario_id: req.params.usuario_id
        }
      }
    })

    if (!solicitud) {
      return res.status(404).json({ mensaje: 'Solicitud no encontrada' })
    }

    if (solicitud.estado !== 'pendiente') {
      return res.status(400).json({ mensaje: 'Esta solicitud ya fue procesada' })
    }

    if (accion === 'rechazar') {
      await prisma.eventos_lista_espera.update({
        where: {
          evento_id_usuario_id: {
            evento_id: req.params.id,
            usuario_id: req.params.usuario_id
          }
        },
        data: {
          estado: 'rechazado',
          motivo_rechazo: motivo || null
        }
      })

      const mensajeRechazo = motivo
        ? `Tu solicitud para el evento "${evento.titulo}" fue rechazada. Motivo: ${motivo}`
        : `Tu solicitud para el evento "${evento.titulo}" fue rechazada.`

      await notificar(req.params.usuario_id, 'inscripcion_rechazada', mensajeRechazo)

      return res.json({ mensaje: 'Solicitud rechazada ✅' })
    }

    // Admitir — verificar cupo nuevamente
    if (evento.limite_participantes) {
      const totalInscritos = await prisma.eventos_usuario.count({
        where: { evento_id: req.params.id }
      })

      if (totalInscritos >= evento.limite_participantes) {
        return res.status(400).json({ mensaje: 'El evento ya no tiene cupo disponible' })
      }
    }

    // Inscribir al usuario
    await prisma.eventos_usuario.create({
      data: {
        evento_id: req.params.id,
        usuario_id: req.params.usuario_id
      }
    })

    // Actualizar estado en lista de espera
    await prisma.eventos_lista_espera.update({
      where: {
        evento_id_usuario_id: {
          evento_id: req.params.id,
          usuario_id: req.params.usuario_id
        }
      },
      data: { estado: 'admitido' }
    })

    // Generar código único y QR
    const codigoAlfanumerico = await generarCodigoUnico()
    const contenidoQR = `RUNN-EVENTO:${req.params.id}:USUARIO:${req.params.usuario_id}:CODIGO:${codigoAlfanumerico}`
    const codigoQR = await generarQR(contenidoQR)

    await prisma.eventos_codigos.create({
      data: {
        evento_id: req.params.id,
        usuario_id: req.params.usuario_id,
        codigo_alfanumerico: codigoAlfanumerico,
        codigo_qr: codigoQR
      }
    })

    // Notificar al usuario con su código
    await notificar(
      req.params.usuario_id,
      'inscripcion_admitida',
      `¡Has sido admitido al evento "${evento.titulo}"! Tu código de acceso es: ${codigoAlfanumerico} evento_id:${req.params.id}`
    )

    res.json({
      mensaje: 'Usuario admitido exitosamente ✅',
      codigo_alfanumerico: codigoAlfanumerico
    })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al procesar solicitud', error: error.message })
  }
})

// ─── VER LISTA DE ESPERA (admin) ──────────────────────────
router.get('/:id/lista-espera', verificarToken, verificarAdmin, async (req, res) => {
  try {
    const lista = await prisma.eventos_lista_espera.findMany({
      where: { evento_id: req.params.id },
      include: {
        usuarios: {
          select: { id: true, nombre: true, avatar_url: true, ciudad: true, nivel: true }
        }
      },
      orderBy: { creado_en: 'asc' }
    })

    const pendientes = lista.filter(l => l.estado === 'pendiente')
    const admitidos = lista.filter(l => l.estado === 'admitido')
    const rechazados = lista.filter(l => l.estado === 'rechazado')

    res.json({
      total: lista.length,
      pendientes: pendientes.length,
      admitidos: admitidos.length,
      rechazados: rechazados.length,
      lista
    })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener lista de espera', error: error.message })
  }
})

// ─── VERIFICAR CÓDIGO EN EL EVENTO (admin) ────────────────
router.post('/:id/verificar-codigo', verificarToken, verificarAdmin, async (req, res) => {
  const { codigo } = req.body

  if (!codigo) {
    return res.status(400).json({ mensaje: 'El código es requerido' })
  }

  try {
    const registro = await prisma.eventos_codigos.findFirst({
      where: {
        evento_id: req.params.id,
        codigo_alfanumerico: codigo.toUpperCase()
      },
      include: {
        usuarios: {
          select: { id: true, nombre: true, avatar_url: true }
        }
      }
    })

    if (!registro) {
      return res.status(404).json({
        status: 'invalido',
        valido: false,
        mensaje: 'Código no válido para este evento'
      })
    }

    if (registro.usado) {
      return res.status(200).json({
        status: 'usado',
        valido: false,
        mensaje: 'Este código ya fue utilizado',
        verificado_en: registro.usado_en,
        usuario: registro.usuarios
      })
    }

    // Marcar como usado
    await prisma.eventos_codigos.update({
      where: { id: registro.id },
      data: { usado: true, usado_en: new Date() }
    })

    res.json({
      status: 'valido',
      valido: true,
      mensaje: '✅ Acceso permitido',
      usuario: registro.usuarios,
      codigo: registro.codigo_alfanumerico
    })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al verificar código', error: error.message })
  }
})

// ─── VER LISTA DE ESCANEADOS (admin) ──────────────────────
router.get('/:id/escaneados', verificarToken, verificarAdmin, async (req, res) => {
  try {
    const escaneados = await prisma.eventos_codigos.findMany({
      where: { evento_id: req.params.id, usado: true },
      include: {
        usuarios: {
          select: { id: true, nombre: true, avatar_url: true, ciudad: true, nivel: true }
        }
      },
      orderBy: { usado_en: 'asc' }
    })

    res.json({
      total: escaneados.length,
      escaneados: escaneados.map(e => ({
        codigo_alfanumerico: e.codigo_alfanumerico,
        usado_en: e.usado_en,
        usuario: e.usuarios
      }))
    })
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener escaneados', error: error.message })
  }
})

// ─── FINALIZAR EVENTO (admin) ──────────────────────────────
router.put('/:id/finalizar', verificarToken, verificarAdmin, async (req, res) => {
  try {
    const eventoInfo = await prisma.eventos.findUnique({
      where: { id: req.params.id },
      select: { titulo: true }
    })

    await prisma.eventos.update({
      where: { id: req.params.id },
      data: { finalizado: true }
    })

    // Notificar a todos los participantes del evento
    if (eventoInfo) {
      const participantes = await prisma.eventos_usuario.findMany({
        where: { evento_id: req.params.id },
        select: { usuario_id: true }
      })

      if (participantes.length > 0) {
        await prisma.notificaciones.createMany({
          data: participantes.map(p => ({
            usuario_id: p.usuario_id,
            tipo: 'evento_finalizado',
            mensaje: `El evento "${eventoInfo.titulo}" ha finalizado. ¡Gracias por participar! evento_id:${req.params.id}`
          }))
        })
      }
    }

    res.json({ mensaje: 'Evento finalizado exitosamente ✅' })
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al finalizar evento', error: error.message })
  }
})

// ─── SALIRSE DE EVENTO ────────────────────────────────────
router.delete('/:id/unirse', verificarToken, async (req, res) => {
  try {
    await prisma.eventos_usuario.deleteMany({
      where: { evento_id: req.params.id, usuario_id: req.usuario.id }
    })

    await prisma.eventos_lista_espera.deleteMany({
      where: { evento_id: req.params.id, usuario_id: req.usuario.id }
    })

    await prisma.eventos_codigos.deleteMany({
      where: { evento_id: req.params.id, usuario_id: req.usuario.id }
    })

    res.json({ mensaje: 'Te has desinscrito del evento ✅' })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al salirse del evento', error: error.message })
  }
})

// ─── EDITAR EVENTO (solo admin) ───────────────────────────
router.put('/:id', verificarToken, verificarAdmin, upload.single('foto'), async (req, res) => {
  const {
    titulo, descripcion, fecha, hora, lugar, distancia_km,
    es_pago, precio, limite_participantes, limite_lista_espera,
    waypoints, punto_inicio, punto_fin, indicaciones, cuentas_bancarias
  } = req.body

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

      const { data } = supabase.storage.from('eventos').getPublicUrl(nombreArchivo)
      foto_url = data.publicUrl
    }

    const eventoActualizado = await prisma.eventos.update({
      where: { id: req.params.id },
      data: {
        ...(titulo && { titulo }),
        ...(descripcion !== undefined && { descripcion }),
        ...(fecha && { fecha: new Date(fecha) }),
        ...(hora && { hora: new Date(`1970-01-01T${hora}:00`) }),
        ...(lugar && { lugar }),
        ...(distancia_km && { distancia_km: parseFloat(distancia_km) }),
        ...(es_pago !== undefined && { es_pago: es_pago === 'true' }),
        ...(precio !== undefined && { precio: parseFloat(precio) }),
        ...(limite_participantes !== undefined && { limite_participantes: parseInt(limite_participantes) }),
        ...(limite_lista_espera !== undefined && { limite_lista_espera: parseInt(limite_lista_espera) }),
        ...(waypoints !== undefined && { waypoints: JSON.parse(waypoints) }),
        ...(punto_inicio !== undefined && { punto_inicio: JSON.parse(punto_inicio) }),
        ...(punto_fin !== undefined && { punto_fin: JSON.parse(punto_fin) }),
        ...(indicaciones !== undefined && { indicaciones: JSON.parse(indicaciones) }),
        ...(cuentas_bancarias !== undefined && { cuentas_bancarias: JSON.parse(cuentas_bancarias) }),
        ...(foto_url && { foto_url })
      }
    })

    res.json({ mensaje: 'Evento actualizado exitosamente ✅', evento: eventoActualizado })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al actualizar evento', error: error.message })
  }
})

// ─── AGREGAR PARTICIPANTE (solo admin) ────────────────────
router.post('/:id/participantes', verificarToken, verificarAdmin, async (req, res) => {
  const { usuario_id } = req.body

  if (!usuario_id) {
    return res.status(400).json({ mensaje: 'usuario_id es requerido' })
  }

  try {
    const evento = await prisma.eventos.findUnique({
      where: { id: req.params.id },
      select: { titulo: true }
    })

    if (!evento) {
      return res.status(404).json({ mensaje: 'Evento no encontrado' })
    }

    const usuario = await prisma.usuarios.findUnique({
      where: { id: usuario_id },
      select: { id: true, nombre: true }
    })

    if (!usuario) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' })
    }

    await prisma.eventos_usuario.create({
      data: { evento_id: req.params.id, usuario_id }
    })

    // Generar código
    const codigoAlfanumerico = await generarCodigoUnico()
    const contenidoQR = `RUNN-EVENTO:${req.params.id}:USUARIO:${usuario_id}:CODIGO:${codigoAlfanumerico}`
    const codigoQR = await generarQR(contenidoQR)

    await prisma.eventos_codigos.create({
      data: {
        evento_id: req.params.id,
        usuario_id,
        codigo_alfanumerico: codigoAlfanumerico,
        codigo_qr: codigoQR
      }
    })

    await notificar(
      usuario_id,
      'inscripcion_admitida',
      `¡Has sido inscrito al evento "${evento.titulo}"! Tu código de acceso es: ${codigoAlfanumerico}`
    )

    res.status(201).json({
      mensaje: `${usuario.nombre} agregado al evento exitosamente ✅`,
      codigo_alfanumerico: codigoAlfanumerico
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
      where: { id: req.params.id },
      select: { titulo: true }
    })

    if (!evento) {
      return res.status(404).json({ mensaje: 'Evento no encontrado' })
    }

    await prisma.eventos_usuario.deleteMany({
      where: { evento_id: req.params.id, usuario_id: req.params.usuario_id }
    })

    await prisma.eventos_codigos.deleteMany({
      where: { evento_id: req.params.id, usuario_id: req.params.usuario_id }
    })

    await notificar(
      req.params.usuario_id,
      'eliminado_evento',
      `Has sido eliminado del evento "${evento.titulo}".`
    )

    res.json({ mensaje: 'Participante eliminado del evento exitosamente ✅' })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al eliminar participante', error: error.message })
  }
})

// ─── ELIMINAR EVENTO (solo admin) ─────────────────────────
router.delete('/:id', verificarToken, verificarAdmin, async (req, res) => {
  try {
    await prisma.eventos.delete({ where: { id: req.params.id } })
    res.json({ mensaje: 'Evento eliminado exitosamente ✅' })
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al eliminar evento', error: error.message })
  }
})

module.exports = router