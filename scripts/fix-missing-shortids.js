const { PrismaClient } = require('@prisma/client');
const { generateShortId } = require('../utils/shortId');

const prisma = new PrismaClient();

async function fixMissingShortIds() {
  console.log('Исправляем оставшиеся записи без shortId...');

  try {
    const repliesWithoutShortId = await prisma.reply.findMany({
      where: { shortId: null },
      select: { id: true, content: true }
    });

    console.log(`Найдено ${repliesWithoutShortId.length} ответов без shortId:`);
    
    for (const reply of repliesWithoutShortId) {
      console.log(`Reply ID: ${reply.id}, Content: ${reply.content?.substring(0, 50)}...`);
      
      let shortId;
      let isUnique = false;
      
      while (!isUnique) {
        shortId = generateShortId();
        const existingThread = await prisma.thread.findFirst({
          where: { shortId }
        });
        const existing = await prisma.reply.findFirst({
          where: { shortId }
        });
        if (!existingThread && !existing) {
          isUnique = true;
        }
      }

      await prisma.reply.update({
        where: { id: reply.id },
        data: { shortId }
      });
      
      console.log(`Исправлен reply ${reply.id} -> ${shortId}`);
    }

    console.log('Все записи исправлены!');

  } catch (error) {
    console.error('Ошибка при исправлении:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

fixMissingShortIds();
