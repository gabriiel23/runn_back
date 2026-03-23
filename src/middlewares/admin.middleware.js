const prisma = require('../prisma')

const verificarAdmin = async (req, res, next) => {
    try {
        const usuario = await prisma.usuarios.findUnique({
            where: { id: req.usuario.id },
            select: { rol: true }
        })

        if (!usuario || usuario.rol !== 'admin') {
            return res.status(403).json({
                mensaje: 'Acceso denegado. Se requiere rol de administrador.'
            })
        }

        next()
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al verificar permisos', error: error.message })
    }
}

module.exports = verificarAdmin