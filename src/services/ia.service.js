const { GoogleGenerativeAI } = require('@google/generative-ai')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

const generarRetoDiario = async () => {
    const hoy = new Date().toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' })

    const prompt = `Eres un entrenador de running. Genera UN reto de running para hoy ${hoy}.
El reto debe ser de uno de estos tipos: distancia, tiempo, velocidad o calorias.
Responde SOLO con este JSON sin texto adicional ni backticks ni markdown:
{
  "titulo": "título corto y motivador",
  "descripcion": "descripción breve de máximo 2 oraciones",
  "tipo": "distancia|tiempo|velocidad|calorias",
  "valor_objetivo": número,
  "unidad": "km|minutos|km/h|cal",
  "puntos_recompensa": número entre 10 y 30
}
Ejemplos de retos variados: corre 5km, corre durante 30 minutos, mantén velocidad mayor a 8km/h, quema 300 calorías.`

    const result = await model.generateContent(prompt)
    const texto = result.response.text().trim()
    return JSON.parse(texto)
}

const generarRetoSemanal = async () => {
    const prompt = `Eres un entrenador de running. Genera UN reto semanal de running desafiante pero alcanzable.
El reto debe ser de uno de estos tipos: distancia, tiempo, velocidad o calorias.
Responde SOLO con este JSON sin texto adicional ni backticks ni markdown:
{
  "titulo": "título corto y motivador",
  "descripcion": "descripción breve de máximo 2 oraciones",
  "tipo": "distancia|tiempo|velocidad|calorias",
  "valor_objetivo": número,
  "unidad": "km|minutos|km/h|cal",
  "puntos_recompensa": número entre 50 y 100
}
Ejemplos: corre 20km esta semana, acumula 3 horas corriendo, completa carreras quemando 1500 calorías en total.`

    const result = await model.generateContent(prompt)
    const texto = result.response.text().trim()
    return JSON.parse(texto)
}

const generarFraseMotivacional = async () => {
    const prompt = `Eres un coach de running y bienestar. Genera UNA frase motivacional inspiradora para corredores.
La frase debe ser poderosa, corta (máximo 15 palabras) y su autor debe ser real o puede ser "RUNN" si es original.
Responde SOLO con este JSON sin texto adicional ni backticks ni markdown:
{
  "frase": "texto de la frase motivacional",
  "autor": "Nombre del autor o RUNN"
}
Ejemplos de frases: "El dolor que sientes hoy será la fuerza que sientas mañana.", "Cada kilómetro te acerca a tu mejor versión."`

    const result = await model.generateContent(prompt)
    const texto = result.response.text().trim()
    return JSON.parse(texto)
}

module.exports = { generarRetoDiario, generarRetoSemanal, generarFraseMotivacional }