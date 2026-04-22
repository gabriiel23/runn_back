const prisma = require('./src/prisma');

async function main() {
  try {
    await prisma.$executeRaw`ALTER TABLE eventos ADD COLUMN IF NOT EXISTS cuentas_bancarias jsonb;`;
    await prisma.$executeRaw`ALTER TABLE eventos_lista_espera ADD COLUMN IF NOT EXISTS comprobante_url text;`;
    console.log("Columnas de pago añadidas con éxito.");
  } catch (error) {
    console.error("Error ejecutando alter script:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
