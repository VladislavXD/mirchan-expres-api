const { PrismaClient } = require('@prisma/client');
const { generateShortId } = require('../utils/shortId');

const prisma = new PrismaClient();

async function checkAndFixShortIds() {
  console.log('Проверка состояния shortId в базе данных...');

  try {
    // Проверяем статистику по Thread
    const threadsTotal = await prisma.thread.count();
    const threadsWithShortId = await prisma.thread.count({
      where: { shortId: { not: null } }
    });
    const threadsWithoutShortId = await prisma.thread.count({
      where: { shortId: null }
    });

    console.log(`\nThreads статистика:`);
    console.log(`Всего тредов: ${threadsTotal}`);
    console.log(`С shortId: ${threadsWithShortId}`);
    console.log(`Без shortId: ${threadsWithoutShortId}`);

    // Проверяем статистику по Reply
    const repliesTotal = await prisma.reply.count();
    const repliesWithShortId = await prisma.reply.count({
      where: { shortId: { not: null } }
    });
    const repliesWithoutShortId = await prisma.reply.count({
      where: { shortId: null }
    });

    console.log(`\nReplies статистика:`);
    console.log(`Всего ответов: ${repliesTotal}`);
    console.log(`С shortId: ${repliesWithShortId}`);
    console.log(`Без shortId: ${repliesWithoutShortId}`);

    // Исправляем записи без shortId
    if (threadsWithoutShortId > 0) {
      console.log(`\nИсправляем ${threadsWithoutShortId} тредов без shortId...`);
      
      const threadsToFix = await prisma.thread.findMany({
        where: { shortId: null },
        select: { id: true }
      });

      for (const thread of threadsToFix) {
        let shortId;
        let isUnique = false;
        
        while (!isUnique) {
          shortId = generateShortId();
          const existing = await prisma.thread.findFirst({
            where: { shortId }
          });
          const existingReply = await prisma.reply.findFirst({
            where: { shortId }
          });
          if (!existing && !existingReply) {
            isUnique = true;
          }
        }

        await prisma.thread.update({
          where: { id: thread.id },
          data: { shortId }
        });
        
        console.log(`Исправлен thread ${thread.id} -> ${shortId}`);
      }
    }

    if (repliesWithoutShortId > 0) {
      console.log(`\nИсправляем ${repliesWithoutShortId} ответов без shortId...`);
      
      const repliesToFix = await prisma.reply.findMany({
        where: { shortId: null },
        select: { id: true }
      });

      for (const reply of repliesToFix) {
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
    }

    // Проверяем дубликаты shortId
    console.log('\nПроверка дубликатов shortId...');
    
    const threadShortIds = await prisma.thread.findMany({
      where: { shortId: { not: null } },
      select: { shortId: true }
    });
    
    const replyShortIds = await prisma.reply.findMany({
      where: { shortId: { not: null } },
      select: { shortId: true }
    });

    const allShortIds = [
      ...threadShortIds.map(t => t.shortId),
      ...replyShortIds.map(r => r.shortId)
    ];

    const shortIdCounts = {};
    allShortIds.forEach(id => {
      shortIdCounts[id] = (shortIdCounts[id] || 0) + 1;
    });

    const duplicates = Object.entries(shortIdCounts).filter(([id, count]) => count > 1);
    
    if (duplicates.length > 0) {
      console.log(`Найдено ${duplicates.length} дубликатов shortId:`);
      duplicates.forEach(([id, count]) => {
        console.log(`  ${id}: ${count} раз`);
      });
    } else {
      console.log('Дубликатов shortId не найдено ✓');
    }

    console.log('\nПроверка завершена успешно!');

  } catch (error) {
    console.error('Ошибка при проверке:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  checkAndFixShortIds();
}

module.exports = { checkAndFixShortIds };
