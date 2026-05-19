const express = require('express')
const prisma = require('../prisma')
const verificarToken = require('../middlewares/auth.middleware')
const { verificarAdmin, verificarSuperAdmin } = require('../middlewares/admin.middleware')

const router = express.Router()

// Todos los endpoints de admin requieren token + ser admin (cualquier rol administrativo)
router.use(verificarToken, verificarAdmin)

// ─── LISTAR TODOS LOS USUARIOS ────────────────────────────
router.get('/usuarios', async (req, res) => {
  try {
    const usuarios = await prisma.usuarios.findMany({
      select: {
        id: true,
        nombre: true,
        correo: true,
        rol: true,
        nivel: true,
        ciudad: true,
        puntos: true,
        creado_en: true
      },
      orderBy: { creado_en: 'desc' }
    })

    res.json({ total: usuarios.length, usuarios })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener usuarios', error: error.message })
  }
})

// ─── CAMBIAR ROL DE USUARIO (solo superadmin) ───────────────
router.put('/usuarios/:id/rol', verificarSuperAdmin, async (req, res) => {
  const { rol } = req.body

  // Roles atómicos permitidos (se pueden combinar con comas)
  const rolesAtomicos = ['usuario', 'superadmin', 'admin_eventos', 'admin_noticias']

  if (!rol || typeof rol !== 'string') {
    return res.status(400).json({ mensaje: 'El campo rol es requerido.' })
  }

  // Validar que cada rol en la combinación sea válido
  const rolesRecibidos = rol.split(',').map(r => r.trim().toLowerCase())
  const rolesInvalidos = rolesRecibidos.filter(r => !rolesAtomicos.includes(r))

  if (rolesInvalidos.length > 0) {
    return res.status(400).json({ 
      mensaje: `Roles inválidos: ${rolesInvalidos.join(', ')}. Roles permitidos: ${rolesAtomicos.join(', ')}` 
    })
  }

  // Normalizar: si solo hay 'usuario', dejar limpio; sino eliminar 'usuario' de combinaciones
  let rolFinal = rolesRecibidos
  if (rolFinal.length > 1) {
    rolFinal = rolFinal.filter(r => r !== 'usuario')
  }
  const rolString = rolFinal.join(',')

  // Protección: no se puede degradar a uno mismo si es superadmin
  if (req.params.id === req.usuario.id && !rolFinal.includes('superadmin')) {
    return res.status(400).json({ 
      mensaje: 'No puedes quitarte el rol de superadmin a ti mismo.' 
    })
  }

  try {
    const usuarioActualizado = await prisma.usuarios.update({
      where: { id: req.params.id },
      data: { rol: rolString },
      select: {
        id: true,
        nombre: true,
        correo: true,
        rol: true
      }
    })

    // Crear notificación para el usuario
    let mensajeNotif = ''
    if (rolString.includes('admin_eventos') && rolString.includes('admin_noticias')) {
      mensajeNotif = 'El admin te ha dado rol de "Creador de Eventos y Noticias".'
    } else if (rolString.includes('admin_eventos')) {
      mensajeNotif = 'El admin te ha dado rol de "Creador de Eventos".'
    } else if (rolString.includes('admin_noticias')) {
      mensajeNotif = 'El admin te ha dado rol de "Creador de Noticias".'
    } else if (rolString.includes('superadmin')) {
      mensajeNotif = 'El admin te ha dado rol de "Super Administrador".'
    } else {
      mensajeNotif = 'Tus permisos administrativos han sido actualizados a usuario regular.'
    }

    // Agregar un "embebido" para que el frontend pueda enrutar según el rol
    const rolesLimpio = rolString.replace(/\s+/g, '')

    await prisma.notificaciones.create({
      data: {
        usuario_id: req.params.id,
        tipo: 'rol_actualizado',
        mensaje: `${mensajeNotif} roles_embebidos:${rolesLimpio}`
      }
    })

    res.json({
      mensaje: `Rol actualizado exitosamente ✅`,
      usuario: usuarioActualizado
    })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al actualizar rol', error: error.message })
  }
})

// ─── ELIMINAR USUARIO ─────────────────────────────────────
router.delete('/usuarios/:id', async (req, res) => {
  if (req.params.id === req.usuario.id) {
    return res.status(400).json({ mensaje: 'No puedes eliminarte a ti mismo' })
  }

  try {
    await prisma.usuarios.delete({
      where: { id: req.params.id }
    })

    res.json({ mensaje: 'Usuario eliminado exitosamente ✅' })

  } catch (error) {
    res.status(500).json({ mensaje: 'Error al eliminar usuario', error: error.message })
  }
})

module.exports = router