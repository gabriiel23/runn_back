const jwt = require('jsonwebtoken')

const verificarToken = (req, res, next) => {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ mensaje: 'Token requerido' })
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        req.usuario = decoded
        next()
    } catch (error) {
        return res.status(401).json({ mensaje: 'Token inválido o expirado' })
    }
}

module.exports = verificarToken