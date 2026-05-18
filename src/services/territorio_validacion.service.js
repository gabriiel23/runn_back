/**
 * territorio_validacion.service.js
 * 
 * Servicio de validación geoespacial para conquistas de territorios.
 * Verifica que la ruta del corredor recorra el PERÍMETRO del polígono,
 * no que esté dentro de él.
 *
 * Algoritmo "Checkpoints Perimetrales":
 *  1. Toma el borde del polígono y genera puntos de control cada N metros.
 *  2. Para cada checkpoint, verifica si la ruta del corredor pasó cerca
 *     (dentro del radio de tolerancia en metros).
 *  3. Si el % de checkpoints cubiertos >= umbral de cobertura, la ruta es válida.
 */

const turf = require('@turf/turf')

// ── Constantes configurables ──────────────────────────────────────────────────

/** Distancia en metros entre cada checkpoint perimetral generado */
const CHECKPOINT_INTERVALO_M = 30

/** Radio en metros dentro del cual se considera que el corredor pasó por un checkpoint */
const RADIO_TOLERANCIA_M = 30

/** Porcentaje mínimo de checkpoints que la ruta debe cubrir para ser válida (0–100) */
const UMBRAL_COBERTURA = 85

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parsea un WKT LINESTRING al formato GeoJSON LineString que entiende Turf.
 * Ejemplo entrada: "LINESTRING(-78.52 -0.22, -78.51 -0.23)"
 */
function wktLineStringAGeoJson(wkt) {
    if (!wkt || typeof wkt !== 'string') return null
    const match = wkt.match(/LINESTRING\((.+)\)/)
    if (!match) return null
    const coords = match[1].split(',').map(pair => {
        const [lng, lat] = pair.trim().split(' ').map(Number)
        return [lng, lat]
    })
    if (coords.length < 2) return null
    return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords }
    }
}

/**
 * Parsea el polígono guardado en la BD (JSON string o objeto) al formato
 * GeoJSON Feature que entiende Turf.
 */
function parsePoligonoAFeature(poligonoRaw) {
    try {
        const geom = typeof poligonoRaw === 'string' ? JSON.parse(poligonoRaw) : poligonoRaw
        if (!geom) return null
        return turf.feature(geom)
    } catch {
        return null
    }
}

// ── Función principal ─────────────────────────────────────────────────────────

/**
 * Valida si la ruta del corredor recorrió el perímetro del territorio.
 *
 * @param {string|object} poligonoRaw  - Polígono del territorio (JSON string o GeoJSON)
 * @param {string}        rutaWkt      - Ruta del corredor en formato WKT LINESTRING
 * @returns {{ valido: boolean, cobertura: number, mensaje: string }}
 */
function validarRutaPerimetral(poligonoRaw, rutaWkt) {
    // 1. Parsear el polígono
    const poligonoFeature = parsePoligonoAFeature(poligonoRaw)
    if (!poligonoFeature) {
        return { valido: false, cobertura: 0, mensaje: 'El territorio no tiene un polígono válido.' }
    }

    // 2. Parsear la ruta del corredor
    const rutaFeature = wktLineStringAGeoJson(rutaWkt)
    if (!rutaFeature) {
        return { valido: false, cobertura: 0, mensaje: 'La ruta de la actividad no es válida.' }
    }

    // 3. Extraer el borde (perimeter line) del polígono
    const perimetro = turf.polygonToLine(poligonoFeature)

    // 4. Calcular la longitud total del perímetro para saber cuántos checkpoints generar
    const longitudM = turf.length(perimetro, { units: 'meters' })
    if (longitudM < 10) {
        return { valido: false, cobertura: 0, mensaje: 'El polígono del territorio es demasiado pequeño.' }
    }

    // 5. Generar checkpoints a lo largo del perímetro
    const numCheckpoints = Math.max(4, Math.floor(longitudM / CHECKPOINT_INTERVALO_M))
    const checkpoints = []
    for (let i = 0; i <= numCheckpoints; i++) {
        const distancia = (longitudM * i) / numCheckpoints
        const pt = turf.along(perimetro, distancia / 1000, { units: 'kilometers' })
        checkpoints.push(pt)
    }

    // 6. Para cada checkpoint, buscar si la ruta pasó cerca (dentro del radio de tolerancia)
    const radioKm = RADIO_TOLERANCIA_M / 1000
    let cubiertos = 0

    for (const cp of checkpoints) {
        const puntoCercano = turf.nearestPointOnLine(rutaFeature, cp)
        const distAl = turf.distance(cp, puntoCercano, { units: 'kilometers' })
        if (distAl <= radioKm) {
            cubiertos++
        }
    }

    // 7. Calcular cobertura y decidir
    const cobertura = Math.round((cubiertos / checkpoints.length) * 100)
    const valido = cobertura >= UMBRAL_COBERTURA

    const mensaje = valido
        ? `¡Ruta válida! Cubriste el ${cobertura}% del perímetro del territorio.`
        : `Tu ruta solo cubrió el ${cobertura}% del perímetro (se requiere ${UMBRAL_COBERTURA}%). Asegúrate de rodear completamente el territorio.`

    return { valido, cobertura, mensaje }
}

// ── Verificación de proximidad (para el endpoint de "¿estoy cerca?") ──────────

/**
 * Verifica si una coordenada está cerca del polígono.
 * Usa una distancia máxima en metros al centroide o al borde.
 *
 * @param {string|object} poligonoRaw
 * @param {{ lat: number, lng: number }} coordenada
 * @param {number} radioMetros  - Radio máximo permitido (default: 500m)
 */
function verificarProximidad(poligonoRaw, coordenada, radioMetros = 500) {
    const poligonoFeature = parsePoligonoAFeature(poligonoRaw)
    if (!poligonoFeature) return { cerca: false, distanciaM: null }

    const punto = turf.point([coordenada.lng, coordenada.lat])

    // Primero verificar si ya está dentro del polígono
    const dentro = turf.booleanPointInPolygon(punto, poligonoFeature)
    if (dentro) return { cerca: true, distanciaM: 0 }

    // Si no está dentro, medir distancia al borde
    const perimetro = turf.polygonToLine(poligonoFeature)
    const puntoCercano = turf.nearestPointOnLine(perimetro, punto)
    const distanciaM = turf.distance(punto, puntoCercano, { units: 'meters' })

    return {
        cerca: distanciaM <= radioMetros,
        distanciaM: Math.round(distanciaM)
    }
}

module.exports = { validarRutaPerimetral, verificarProximidad, UMBRAL_COBERTURA, RADIO_TOLERANCIA_M }
