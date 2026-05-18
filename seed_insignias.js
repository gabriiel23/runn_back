const prisma = require('./src/prisma')

// Insignias que quieren existir (las que faltan se insertan, las que ya existen se ignoran)
const insigniasDeseadas = [
  { km: 1,    nombre: 'Primera carrera',    descripcion: 'Acumulaste 1 km corriendo',         nivel: 'normal' },
  { km: 10,   nombre: 'Diez kilómetros',    descripcion: 'Acumulaste 10 km corriendo',        nivel: 'normal' },
  { km: 25,   nombre: 'Medio camino',       descripcion: 'Acumulaste 25 km corriendo',        nivel: 'normal' },
  { km: 50,   nombre: 'Corredor iniciante', descripcion: 'Acumulaste 50 km corriendo',        nivel: 'normal' },
  { km: 100,  nombre: 'Centurión',          descripcion: 'Acumulaste 100 km corriendo',       nivel: 'plata'  },
  { km: 200,  nombre: 'Corredor intermedio',descripcion: 'Acumulaste 200 km corriendo',       nivel: 'plata'  },
  { km: 500,  nombre: 'Corredor avanzado',  descripcion: 'Acumulaste 500 km corriendo',       nivel: 'oro'    },
  { km: 1000, nombre: 'Maratonista',        descripcion: 'Acumulaste 1,000 km corriendo',     nivel: 'oro'    },
  { km: 2500, nombre: 'Ultramaratonista',   descripcion: 'Acumulaste 2,500 km corriendo',     nivel: 'oro'    },
  { km: 5000, nombre: 'Leyenda',            descripcion: 'Acumulaste 5,000 km corriendo',     nivel: 'diamante' },
]

async function main() {
  // Leer las existentes
  const existentes = await prisma.insignias_distancia.findMany()
  const kmExistentes = new Set(existentes.map(i => parseFloat(i.km_requeridos)))

  let insertadas = 0
  let omitidas = 0

  for (const ins of insigniasDeseadas) {
    if (kmExistentes.has(ins.km)) {
      console.log(`⏭  Ya existe: ${ins.nombre} (${ins.km} km)`)
      omitidas++
    } else {
      await prisma.insignias_distancia.create({
        data: {
          nombre: ins.nombre,
          descripcion: ins.descripcion,
          km_requeridos: ins.km,
          nivel: ins.nivel,
        }
      })
      console.log(`✅ Insertada: ${ins.nombre} (${ins.km} km)`)
      insertadas++
    }
  }

  console.log(`\n🏅 Resumen: ${insertadas} insertadas, ${omitidas} ya existían.`)
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e.message); process.exit(1) })
