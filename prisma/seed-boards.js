const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const seedBoards = async () => {
  try {
    // Создаем базовые борды
    const boards = [
      {
        name: 'b',
        title: 'Random',
        description: 'Случайное обсуждение',
        isNsfw: true,
        maxFileSize: 5242880, // 5MB
        allowedFileTypes: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'webm', 'mp4'],
        postsPerPage: 15,
        threadsPerPage: 10,
        bumpLimit: 500,
        imageLimit: 150
      },
      {
        name: 'g',
        title: 'Technology',
        description: 'Технологии и программирование',
        isNsfw: false,
        maxFileSize: 5242880,
        allowedFileTypes: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        postsPerPage: 15,
        threadsPerPage: 10,
        bumpLimit: 500,
        imageLimit: 150
      },
      {
        name: 'v',
        title: 'Video Games',
        description: 'Видеоигры',
        isNsfw: false,
        maxFileSize: 10485760, // 10MB для видео
        allowedFileTypes: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'webm', 'mp4'],
        postsPerPage: 15,
        threadsPerPage: 10,
        bumpLimit: 500,
        imageLimit: 150
      },
      {
        name: 'a',
        title: 'Anime & Manga',
        description: 'Аниме и манга',
        isNsfw: false,
        maxFileSize: 5242880,
        allowedFileTypes: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        postsPerPage: 15,
        threadsPerPage: 10,
        bumpLimit: 500,
        imageLimit: 150
      },
      {
        name: 'pol',
        title: 'Politics',
        description: 'Политика (с осторожностью)',
        isNsfw: false,
        maxFileSize: 5242880,
        allowedFileTypes: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        postsPerPage: 15,
        threadsPerPage: 10,
        bumpLimit: 300, // Меньше лимит для политики
        imageLimit: 100
      }
    ];

    console.log('Creating boards...');
    
    for (const boardData of boards) {
      const existingBoard = await prisma.board.findUnique({
        where: { name: boardData.name }
      });

      if (!existingBoard) {
        const board = await prisma.board.create({
          data: boardData
        });
        console.log(`Created board: /${board.name}/ - ${board.title}`);
      } else {
        console.log(`Board /${boardData.name}/ already exists`);
      }
    }

    console.log('Boards seeding completed!');
  } catch (error) {
    console.error('Error seeding boards:', error);
  } finally {
    await prisma.$disconnect();
  }
};

// Запускаем только если файл вызван напрямую
if (require.main === module) {
  seedBoards();
}

module.exports = { seedBoards };
