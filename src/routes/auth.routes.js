const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const prisma = require('../prisma')
const verificarToken = require('../middlewares/auth.middleware')
const router = express.Router()

// ─── REGISTRO ───────────────────────────────────────────
router.post('/registro', async (req, res) => {
    const { nombre, correo, contrasena, confirmar_contrasena } = req.body
    if (!nombre || !correo || !contrasena || !confirmar_contrasena) {
        return res.status(400).json({ mensaje: 'Todos los campos son requeridos' })
    }
    if (contrasena !== confirmar_contrasena) {
        return res.status(400).json({ mensaje: 'Las contraseñas no coinciden' })
    }
    try {
        const usuarioExistente = await prisma.usuarios.findUnique({
            where: { correo }
        })
        if (usuarioExistente) {
            return res.status(400).json({ mensaje: 'El correo ya está registrado' })
        }
        const salt = await bcrypt.genSalt(10)
        const contrasenaHash = await bcrypt.hash(contrasena, salt)
        const nuevoUsuario = await prisma.usuarios.create({
            data: {
                nombre,
                correo,
                contrasena_hash: contrasenaHash
            }
        })
        const token = jwt.sign(
            { id: nuevoUsuario.id, correo: nuevoUsuario.correo, rol: nuevoUsuario.rol }, // 👈 AGREGADO rol
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        )
        res.status(201).json({
            mensaje: 'Cuenta creada exitosamente ✅',
            token,
            usuario: {
                id: nuevoUsuario.id,
                nombre: nuevoUsuario.nombre,
                correo: nuevoUsuario.correo,
                rol: nuevoUsuario.rol // 👈 AGREGADO
            }
        })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al registrar usuario', error: error.message })
    }
})

// ─── COMPLETAR MÉTRICAS FÍSICAS ──────────────────────────
router.put('/metricas', verificarToken, async (req, res) => {
    const { genero, fecha_nacimiento, pais, ciudad, altura_cm, peso_kg, nivel } = req.body
    if (!genero || !fecha_nacimiento || !pais || !ciudad || !altura_cm || !peso_kg || !nivel) {
        return res.status(400).json({ mensaje: 'Todos los campos de métricas son requeridos' })
    }
    try {
        const usuarioActualizado = await prisma.usuarios.update({
            where: { id: req.usuario.id },
            data: {
                genero,
                fecha_nacimiento: new Date(fecha_nacimiento),
                pais,
                ciudad,
                altura_cm: parseFloat(altura_cm),
                peso_kg: parseFloat(peso_kg),
                nivel
            },
            select: {
                id: true,
                nombre: true,
                correo: true,
                genero: true,
                fecha_nacimiento: true,
                pais: true,
                ciudad: true,
                altura_cm: true,
                peso_kg: true,
                nivel: true
            }
        })
        res.json({
            mensaje: 'Métricas guardadas exitosamente ✅',
            usuario: usuarioActualizado
        })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al guardar métricas', error: error.message })
    }
})

// ─── LOGIN ───────────────────────────────────────────────
router.post('/login', async (req, res) => {
    const { correo, contrasena } = req.body
    if (!correo || !contrasena) {
        return res.status(400).json({ mensaje: 'Correo y contraseña son requeridos' })
    }
    try {
        const usuario = await prisma.usuarios.findUnique({
            where: { correo }
        })
        if (!usuario) {
            return res.status(401).json({ mensaje: 'Correo o contraseña incorrectos' })
        }
        const contrasenaValida = await bcrypt.compare(contrasena, usuario.contrasena_hash)
        if (!contrasenaValida) {
            return res.status(401).json({ mensaje: 'Correo o contraseña incorrectos' })
        }
        const token = jwt.sign(
            { id: usuario.id, correo: usuario.correo, rol: usuario.rol }, // 👈 AGREGADO rol
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        )
        res.json({
            mensaje: 'Login exitoso ✅',
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre,
                correo: usuario.correo,
                rol: usuario.rol,        // 👈 AGREGADO
                puntos: usuario.puntos,
                nivel: usuario.nivel
            }
        })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al iniciar sesión', error: error.message })
    }
})

// ─── PERFIL ───────────────────────────────────────────────
router.get('/perfil', verificarToken, async (req, res) => {
    try {
        const usuario = await prisma.usuarios.findUnique({
            where: { id: req.usuario.id },
            select: {
                id: true,
                nombre: true,
                correo: true,
                avatar_url: true,
                biografia: true,
                genero: true,
                fecha_nacimiento: true,
                pais: true,
                ciudad: true,
                peso_kg: true,
                altura_cm: true,
                nivel: true,
                objetivo: true,
                puntos: true,
                rol: true,       // 👈 AGREGADO
                creado_en: true
            }
        })
        if (!usuario) {
            return res.status(404).json({ mensaje: 'Usuario no encontrado' })
        }
        res.json({ usuario })
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener perfil', error: error.message })
    }
})

module.exports = router