const prisma = require('./src/prisma');

async function main() {
  try {
    // Ampliar VARCHAR(20) → VARCHAR(100) para soportar múltiples roles separados por comas
    await prisma.$executeRaw`ALTER TABLE usuarios ALTER COLUMN rol TYPE VARCHAR(100);`;
    console.log("Columna 'rol' ampliada a VARCHAR(100) exitosamente.");
  } catch (error) {
    console.error("Error ejecutando alter_roles:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
