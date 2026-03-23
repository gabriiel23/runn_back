const express = require('express')
const prisma = require('../prisma')
const verificarToken = require('../middlewares/auth.middleware')
const verificarAdmin = require('../middlewares/admin.middleware')

const router = express.Router()

// Todos los endpoints de admin requieren token + ser admin
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

// ─── CAMBIAR ROL DE USUARIO ───────────────────────────────
router.put('/usuarios/:id/rol', async (req, res) => {
  const { rol } = req.body

  const rolesPermitidos = ['usuario', 'admin']
  if (!rolesPermitidos.includes(rol)) {
    return res.status(400).json({ 
      mensaje: `Rol inválido. Roles permitidos: ${rolesPermitidos.join(', ')}` 
    })
  }

  try {
    const usuarioActualizado = await prisma.usuarios.update({
      where: { id: req.params.id },
      data: { rol },
      select: {
        id: true,
        nombre: true,
        correo: true,
        rol: true
      }
    })

    res.json({
      mensaje: `Rol actualizado a "${rol}" exitosamente ✅`,
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