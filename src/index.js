const express = require('express')
const cors = require('cors')
const prisma = require('./prisma')
require('dotenv').config()

const authRoutes = require('./routes/auth.routes')
const usuariosRoutes = require('./routes/usuarios.routes')
const adminRoutes = require('./routes/admin.routes')
const eventosRoutes = require('./routes/eventos.routes')
const gruposRoutes = require('./routes/grupos.routes')
const novedadesRoutes = require('./routes/novedades.routes')

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

app.use('/auth', authRoutes)
app.use('/usuarios', usuariosRoutes)
app.use('/admin', adminRoutes)
app.use('/eventos', eventosRoutes)
app.use('/grupos', gruposRoutes)
app.use('/novedades', novedadesRoutes)

app.get('/', (req, res) => {
    res.json({ mensaje: 'RUNN API funcionando ✅' })
})

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`)
})
