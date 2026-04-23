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
const notificacionesRoutes = require('./routes/notificaciones.routes')
const actividadesRoutes = require('./routes/actividades.routes')
const retosRoutes = require('./routes/retos.routes')
const territoriosRoutes = require('./routes/territorios.routes')
const frasesRoutes = require('./routes/frases.routes')

const { iniciarCron } = require('./services/cron.service')

const app = express()
const PORT = process.env.PORT || 8005

app.use(cors())
app.use(express.json())

app.use('/auth', authRoutes)
app.use('/usuarios', usuariosRoutes)
app.use('/admin', adminRoutes)
app.use('/eventos', eventosRoutes)
app.use('/grupos', gruposRoutes)
app.use('/novedades', novedadesRoutes)
app.use('/notificaciones', notificacionesRoutes)
app.use('/actividades', actividadesRoutes)
app.use('/retos', retosRoutes)
app.use('/territorios', territoriosRoutes)
app.use('/frases', frasesRoutes)

// Iniciar cron jobs
iniciarCron()

app.get('/', (req, res) => {
    res.json({ mensaje: 'RUNN API funcionando ✅' })
})

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`)
})
