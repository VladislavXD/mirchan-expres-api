const { PrismaClient } = require('@prisma/client');
const { generateShortId } = require('../utils/shortId');

const prisma = new PrismaClient();

async function migrateExistingPosts() {
  console.log('Starting migration of existing posts...');

  try {
    // Сначала обновляем схему обратно к Int[] для replyTo
    console.log('Step 1: Updating schema for compatibility...');
    
    // Обновляем все треды без shortId
    const threads = await prisma.thread.findMany({
      select: { id: true, shortId: true }
    });

    const threadsWithoutShortId = threads.filter(t => !t.shortId);
    console.log(`Found ${threadsWithoutShortId.length} threads without shortId`);

    for (const thread of threadsWithoutShortId) {
      let shortId;
      let isUnique = false;
      
      // Генерируем уникальный shortId
      while (!isUnique) {
        shortId = generateShortId();
        const existingThread = await prisma.thread.findFirst({
          where: { shortId }
        });
        const existingReply = await prisma.reply.findFirst({
          where: { shortId }
        });
        if (!existingThread && !existingReply) {
          isUnique = true;
        }
      }

      await prisma.thread.update({
        where: { id: thread.id },
        data: { shortId }
      });
      
      console.log(`Updated thread ${thread.id} with shortId: ${shortId}`);
    }

    // Обновляем реплаи: сначала только shortId, потом обработаем replyTo отдельно
    const replies = await prisma.reply.findMany({
      select: { id: true, shortId: true }
    });

    const repliesWithoutShortId = replies.filter(r => !r.shortId);
    console.log(`Found ${repliesWithoutShortId.length} replies without shortId`);

    for (const reply of repliesWithoutShortId) {
      let shortId;
      let isUnique = false;
      
      // Генерируем уникальный shortId
      while (!isUnique) {
        shortId = generateShortId();
        const existingThread = await prisma.thread.findFirst({
          where: { shortId }
        });
        const existingReply = await prisma.reply.findFirst({
          where: { shortId }
        });
        if (!existingThread && !existingReply) {
          isUnique = true;
        }
      }

      // Обновляем только shortId, не трогая replyTo
      await prisma.$executeRaw`
        UPDATE Reply 
        SET shortId = ${shortId}
        WHERE _id = ObjectId(${reply.id})
      `;
      
      console.log(`Updated reply ${reply.id} with shortId: ${shortId}`);
    }

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

migrateExistingPosts();
