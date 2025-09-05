const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function migrateReplyToWithMongo() {
  console.log('Миграция replyTo полей через прямые MongoDB операции...');

  try {
    // Сначала получаем все треды для создания карты номер -> shortId
    const allThreads = await prisma.thread.findMany({
      select: { id: true, shortId: true }
    });

    const allReplies = await prisma.reply.findMany({
      select: { id: true, shortId: true, threadId: true, postNumber: true }
    });

    // Создаем карту номер -> shortId для каждого треда
    const threadMaps = {};
    for (const thread of allThreads) {
      const threadReplies = allReplies.filter(r => r.threadId === thread.id);
      const numberToShortId = {};
      
      // OP пост (номер 1) -> shortId треда
      numberToShortId[1] = thread.shortId;
      
      // Ответы -> их shortId
      threadReplies.forEach(reply => {
        numberToShortId[reply.postNumber] = reply.shortId;
      });
      
      threadMaps[thread.id] = numberToShortId;
    }

    console.log(`Создано карт для ${Object.keys(threadMaps).length} тредов`);

    // Получаем все Reply документы с replyTo данными напрямую через MongoDB
    const db = prisma.$transaction(async (prisma) => {
      return await prisma.$runCommandRaw({
        find: 'Reply',
        filter: { replyTo: { $exists: true, $ne: [] } }
      });
    });

    const repliesWithReplyTo = await db;
    console.log(`Найдено ${repliesWithReplyTo.cursor.firstBatch.length} ответов с replyTo данными`);

    // Обновляем каждый документ
    for (const doc of repliesWithReplyTo.cursor.firstBatch) {
      const replyId = doc._id.$oid;
      const threadId = doc.threadId.$oid;
      const oldReplyTo = doc.replyTo;

      if (!oldReplyTo || oldReplyTo.length === 0) continue;

      const threadMap = threadMaps[threadId];
      if (!threadMap) {
        console.log(`Не найдена карта для треда ${threadId}`);
        continue;
      }

      // Преобразуем номера в shortId
      const newReplyTo = [];
      for (const num of oldReplyTo) {
        const shortId = threadMap[num];
        if (shortId) {
          newReplyTo.push(shortId);
        } else {
          console.log(`Не найден shortId для номера ${num} в треде ${threadId}`);
        }
      }

      if (newReplyTo.length > 0) {
        // Обновляем напрямую через MongoDB
        await prisma.$runCommandRaw({
          update: 'Reply',
          updates: [{
            q: { _id: { $oid: replyId } },
            u: { $set: { replyTo: newReplyTo } }
          }]
        });

        console.log(`Обновлен reply ${replyId}: ${oldReplyTo} -> ${newReplyTo}`);
      }
    }

    console.log('Миграция завершена!');

  } catch (error) {
    console.error('Ошибка при миграции:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

migrateReplyToWithMongo();
