const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function migrateReplyToShortIds() {
  console.log('Миграция replyTo полей с номеров на shortId...');

  try {
    // Сначала получаем все треды и ответы для создания карты номер -> shortId
    const allThreads = await prisma.thread.findMany({
      select: { id: true, shortId: true }
    });

    const allReplies = await prisma.reply.findMany({
      select: { id: true, shortId: true, threadId: true, postNumber: true, replyTo: true }
    });

    // Группируем ответы по тредам
    const repliesByThread = {};
    allReplies.forEach(reply => {
      if (!repliesByThread[reply.threadId]) {
        repliesByThread[reply.threadId] = [];
      }
      repliesByThread[reply.threadId].push(reply);
    });

    // Создаем карту номер -> shortId для каждого треда
    const threadMaps = {};
    for (const thread of allThreads) {
      const threadReplies = repliesByThread[thread.id] || [];
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

    // Теперь обновляем replyTo поля
    let updatedCount = 0;
    
    for (const reply of allReplies) {
      if (reply.replyTo && reply.replyTo.length > 0) {
        const threadMap = threadMaps[reply.threadId];
        if (!threadMap) {
          console.log(`Не найдена карта для треда ${reply.threadId}`);
          continue;
        }

        // Преобразуем номера в shortId
        const newReplyTo = [];
        for (const num of reply.replyTo) {
          const shortId = threadMap[num];
          if (shortId) {
            newReplyTo.push(shortId);
          } else {
            console.log(`Не найден shortId для номера ${num} в треде ${reply.threadId}`);
          }
        }

        if (newReplyTo.length > 0) {
          await prisma.reply.update({
            where: { id: reply.id },
            data: { replyTo: newReplyTo }
          });

          console.log(`Обновлен reply ${reply.shortId}: ${reply.replyTo} -> ${newReplyTo}`);
          updatedCount++;
        }
      }
    }

    console.log(`Миграция завершена! Обновлено ${updatedCount} записей.`);

  } catch (error) {
    console.error('Ошибка при миграции:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

migrateReplyToShortIds();
