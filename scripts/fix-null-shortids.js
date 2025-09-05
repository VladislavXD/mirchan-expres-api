const { PrismaClient } = require('@prisma/client');
const { generateShortId } = require('../utils/shortId');

const prisma = new PrismaClient();

async function fixNullShortIds() {
  console.log('Исправляем null shortId...');

  try {
    // Проверяем записи с null shortId более точно
    const allReplies = await prisma.reply.findMany({
      select: { id: true, shortId: true, content: true }
    });

    const nullShortIdReplies = allReplies.filter(r => r.shortId === null);
    console.log(`Найдено ${nullShortIdReplies.length} ответов с null shortId:`);

    for (const reply of nullShortIdReplies) {
      console.log(`Исправляем Reply ID: ${reply.id}`);
      
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

    console.log('Исправление завершено!');

  } catch (error) {
    console.error('Ошибка при исправлении:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

fixNullShortIds();
