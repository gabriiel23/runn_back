const prisma = require('./src/prisma');

async function main() {
  try {
    await prisma.$executeRaw`ALTER TABLE eventos ADD COLUMN IF NOT EXISTS indicaciones jsonb;`;
    await prisma.$executeRaw`ALTER TABLE eventos ADD COLUMN IF NOT EXISTS finalizado boolean DEFAULT false;`;
    console.log("Columnas 'indicaciones' y 'finalizado' añadidas con exito.");
  } catch (error) {
    console.error("Error ejecutando alter sequence:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
