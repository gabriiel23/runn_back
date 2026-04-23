const express = require('express')
const prisma = require('../prisma')
const verificarToken = require('../middlewares/auth.middleware')
const verificarAdmin = require('../middlewares/admin.middleware')
const { generarFraseMotivacional } = require('../services/ia.service')

const router = express.Router()

// ─── OBTENER FRASES ACTIVAS (para el carrusel del home) ───────────────────
router.get('/', verificarToken, async (req, res) => {
    try {
        const hoy = new Date()
        hoy.setHours(0, 0, 0, 0)

        let frases = await prisma.frases_motivacionales.findMany({
            where: {
                activa: true,
                OR: [
                    { vigente_desde: null },
                    { vigente_desde: { lte: hoy } }
                ],
                AND: [
                    {
                        OR: [
                            { vigente_hasta: null },
                            { vigente_hasta: { gte: hoy } }
                        ]
                    }
                ]
            },
            orderBy: { creado_en: 'desc' },
            take: 4
        })

        // Si no hay frases, generar una automáticamente con IA
        if (frases.length === 0) {
            const datos = await generarFraseMotivacional()
            const nueva = await prisma.frases_motivacionales.create({
                data: {
                    frase: datos.frase,
                    autor: datos.autor,
                    generado_por_ia: true,
                    activa: true
                }
            })
            frases = [nueva]
        }

        res.json({ frases })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener frases', error: error.message })
    }
})

// ─── LISTAR TODAS (admin: activas + inactivas) ────────────────────────────
router.get('/admin/todas', verificarToken, verificarAdmin, async (req, res) => {
    try {
        const frases = await prisma.frases_motivacionales.findMany({
            orderBy: { creado_en: 'desc' }
        })
        res.json({ frases })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al listar frases', error: error.message })
    }
})

// ─── GENERAR FRASE CON IA (admin) ─────────────────────────────────────────
router.post('/generar', verificarToken, verificarAdmin, async (req, res) => {
    try {
        const datos = await generarFraseMotivacional()
        const frase = await prisma.frases_motivacionales.create({
            data: {
                frase: datos.frase,
                autor: datos.autor,
                generado_por_ia: true,
                activa: true
            }
        })
        res.status(201).json({ mensaje: 'Frase generada con IA ✅', frase })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al generar frase', error: error.message })
    }
})

// ─── CREAR FRASE MANUAL (admin) ───────────────────────────────────────────
router.post('/manual', verificarToken, verificarAdmin, async (req, res) => {
    const { frase, autor, vigente_desde, vigente_hasta } = req.body

    if (!frase || !autor) {
        return res.status(400).json({ mensaje: 'frase y autor son requeridos' })
    }

    try {
        const nueva = await prisma.frases_motivacionales.create({
            data: {
                frase,
                autor,
                generado_por_ia: false,
                activa: true,
                vigente_desde: vigente_desde ? new Date(vigente_desde) : null,
                vigente_hasta: vigente_hasta ? new Date(vigente_hasta) : null
            }
        })
        res.status(201).json({ mensaje: 'Frase creada manualmente ✅', frase: nueva })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al crear frase', error: error.message })
    }
})

// ─── EDITAR FRASE (admin) ─────────────────────────────────────────────────
router.put('/:id', verificarToken, verificarAdmin, async (req, res) => {
    const { frase, autor, activa, vigente_desde, vigente_hasta } = req.body

    try {
        const actualizada = await prisma.frases_motivacionales.update({
            where: { id: req.params.id },
            data: {
                ...(frase && { frase }),
                ...(autor && { autor }),
                ...(activa !== undefined && { activa }),
                ...(vigente_desde !== undefined && { vigente_desde: vigente_desde ? new Date(vigente_desde) : null }),
                ...(vigente_hasta !== undefined && { vigente_hasta: vigente_hasta ? new Date(vigente_hasta) : null })
            }
        })
        res.json({ mensaje: 'Frase actualizada ✅', frase: actualizada })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar frase', error: error.message })
    }
})

// ─── ELIMINAR FRASE (admin) ───────────────────────────────────────────────
router.delete('/:id', verificarToken, verificarAdmin, async (req, res) => {
    try {
        await prisma.frases_motivacionales.delete({ where: { id: req.params.id } })
        res.json({ mensaje: 'Frase eliminada ✅' })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al eliminar frase', error: error.message })
    }
})

// ─── REGENERAR FRASE ESPECÍFICA CON IA (admin) ────────────────────────────
router.post('/:id/regenerar', verificarToken, verificarAdmin, async (req, res) => {
    try {
        const datos = await generarFraseMotivacional()
        const actualizada = await prisma.frases_motivacionales.update({
            where: { id: req.params.id },
            data: {
                frase: datos.frase,
                autor: datos.autor,
                generado_por_ia: true
            }
        })
        res.json({ mensaje: 'Frase regenerada con IA ✅', frase: actualizada })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al regenerar frase', error: error.message })
    }
})

module.exports = router
