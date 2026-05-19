/**
 * Middlewares de autorización por roles para RUNN.
 *
 * La columna `rol` en la tabla `usuarios` almacena los roles
 * como una cadena separada por comas, por ejemplo:
 *   "usuario"                         → usuario normal
 *   "admin_eventos"                   → puede crear/editar eventos
 *   "admin_noticias"                  → puede crear/editar noticias y frases
 *   "admin_eventos,admin_noticias"    → ambos permisos especiales
 *   "superadmin"                      → acceso total + gestión de roles
 *   "admin"                           → rol heredado, tratado como superadmin
 */

const prisma = require('../prisma')

// ─── HELPER ───────────────────────────────────────────────────────────────────

/**
 * Verifica si el string de rol del usuario contiene el rol requerido.
 * Soporta roles compuestos separados por comas (e.g. "admin_eventos,admin_noticias").
 * También permite roles heredados "admin" y "superadmin" para todo.
 *
 * @param {string|null} rolString - El valor del campo `rol` del usuario en BD.
 * @param {string} rolRequerido   - El rol específico que se requiere tener.
 * @returns {boolean}
 */
function tieneRol(rolString, rolRequerido) {
  if (!rolString) return false
  const roles = rolString.split(',').map(r => r.trim().toLowerCase())
  // superadmin y el heredado "admin" tienen acceso a todo
  if (roles.includes('superadmin') || roles.includes('admin')) return true
  return roles.includes(rolRequerido.toLowerCase())
}

// ─── VERIFICAR SUPER ADMIN ────────────────────────────────────────────────────

/**
 * Permite acceso solo a `superadmin` (o rol heredado `admin`).
 * Se usa en rutas de gestión de roles de usuarios.
 */
const verificarSuperAdmin = async (req, res, next) => {
  try {
    const usuario = await prisma.usuarios.findUnique({
      where: { id: req.usuario.id },
      select: { rol: true }
    })

    const rol = usuario?.rol ?? ''
    const roles = rol.split(',').map(r => r.trim().toLowerCase())

    if (!usuario || (!roles.includes('superadmin') && !roles.includes('admin'))) {
      return res.status(403).json({
        mensaje: 'Acceso denegado. Se requiere rol de superadmin.'
      })
    }

    next()
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al verificar permisos', error: error.message })
  }
}

// ─── VERIFICAR ADMIN (HEREDADO / RETROCOMPATIBILIDAD) ─────────────────────────

/**
 * Mantiene retrocompatibilidad con el middleware anterior.
 * Permite acceso a `superadmin`, `admin` (heredado), `admin_eventos`,
 * y `admin_noticias`. Se usa en rutas de territorios y retos que eran
 * de admin general.
 */
const verificarAdmin = async (req, res, next) => {
  try {
    const usuario = await prisma.usuarios.findUnique({
      where: { id: req.usuario.id },
      select: { rol: true }
    })

    const rol = usuario?.rol ?? ''
    const roles = rol.split(',').map(r => r.trim().toLowerCase())
    const esAdmin = roles.some(r =>
      ['superadmin', 'admin', 'admin_eventos', 'admin_noticias'].includes(r)
    )

    if (!usuario || !esAdmin) {
      return res.status(403).json({
        mensaje: 'Acceso denegado. Se requiere rol de administrador.'
      })
    }

    next()
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al verificar permisos', error: error.message })
  }
}

// ─── VERIFICAR ADMIN EVENTOS ──────────────────────────────────────────────────

/**
 * Permite acceso a `admin_eventos`, `superadmin` y `admin` (heredado).
 * Se usa en todas las rutas de creación/edición/finalización de eventos.
 */
const verificarAdminEventos = async (req, res, next) => {
  try {
    const usuario = await prisma.usuarios.findUnique({
      where: { id: req.usuario.id },
      select: { rol: true }
    })

    if (!usuario || !tieneRol(usuario.rol, 'admin_eventos')) {
      return res.status(403).json({
        mensaje: 'Acceso denegado. Se requiere rol de admin_eventos o superadmin.'
      })
    }

    next()
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al verificar permisos', error: error.message })
  }
}

// ─── VERIFICAR ADMIN NOTICIAS ─────────────────────────────────────────────────

/**
 * Permite acceso a `admin_noticias`, `superadmin` y `admin` (heredado).
 * Se usa en todas las rutas de creación/edición de novedades y frases motivacionales.
 */
const verificarAdminNoticias = async (req, res, next) => {
  try {
    const usuario = await prisma.usuarios.findUnique({
      where: { id: req.usuario.id },
      select: { rol: true }
    })

    if (!usuario || !tieneRol(usuario.rol, 'admin_noticias')) {
      return res.status(403).json({
        mensaje: 'Acceso denegado. Se requiere rol de admin_noticias o superadmin.'
      })
    }

    next()
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al verificar permisos', error: error.message })
  }
}

module.exports = {
  tieneRol,              // helper para comprobaciones inline en rutas
  verificarAdmin,        // retrocompatibilidad (territorios, retos, etc.)
  verificarSuperAdmin,   // solo gestión de roles
  verificarAdminEventos, // crear/editar eventos
  verificarAdminNoticias // crear/editar noticias y frases
}