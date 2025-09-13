const { PrismaClient } = require('@prisma/client');
const { uploadForumMedia, uploadMultipleForumMedia, deleteForumMedia, deleteMultipleForumMedia, getFileTypeInfo } = require('../utils/forumCloudinary');
const { generateShortId } = require('../utils/shortId');
const crypto = require('crypto');
const prisma = new PrismaClient();

// Генерация хеша IP для анонимности
const generatePosterHash = (ip, boardName) => {
  return crypto.createHash('sha256').update(`${ip}-${boardName}-${Date.now().toString().slice(0, -6)}`).digest('hex').slice(0, 8);
};

// Получить все борды
const getBoards = async (req, res) => {
  try {
    const boards = await prisma.board.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        title: true,
        description: true,
        isNsfw: true,
        threadsPerPage: true,
        _count: {
          select: { threads: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.json(boards);
  } catch (error) {
    console.error('Get boards error:', error);
    res.status(500).json({ error: 'Failed to fetch boards' });
  }
};

// Обновленная версия: получение тредов борда с фильтрацией по тегу тредов
const getBoardThreads = async (req, res) => {
  try {
    const { boardName } = req.params;
    const page = parseInt(req.query.page) || 1;
    const tagSlug = req.query.tag || null;

    const board = await prisma.board.findUnique({
      where: { name: boardName }
    });

    if (!board || !board.isActive) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const skip = (page - 1) * board.threadsPerPage;

    const where = {
      boardId: board.id,
      isArchived: false,
      ...(tagSlug ? { threadTags: { some: { tag: { slug: tagSlug } } } } : {})
    };

    const [threads, totalThreads] = await Promise.all([
      prisma.thread.findMany({
        where,
        include: {
          mediaFiles: true,
          threadTags: { include: { tag: true } },
          _count: { select: { replies: true } },
          replies: {
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              shortId: true,
              content: true,
              authorName: true,
              postNumber: true,
              imageUrl: true,
              thumbnailUrl: true,
              imageCount: true,
              createdAt: true
            },
            include: { mediaFiles: true }
          }
        },
        orderBy: [
          { isPinned: 'desc' },
          { lastBumpAt: 'desc' }
        ],
        skip,
        take: board.threadsPerPage
      }),
      prisma.thread.count({ where })
    ]);

    res.json({
      board: {
        id: board.id,
        name: board.name,
        title: board.title,
        description: board.description,
        isNsfw: board.isNsfw
      },
      threads,
      pagination: {
        page,
        totalPages: Math.ceil(totalThreads / board.threadsPerPage),
        totalThreads
      }
    });
  } catch (error) {
    console.error('Get board threads error:', error);
    res.status(500).json({ error: 'Failed to fetch threads' });
  }
};

// Создать новый тред
const createThread = async (req, res) => {
  try {
  const { boardName } = req.params;
  const { subject, content, authorName, authorTrip, categorySlug, slug } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const board = await prisma.board.findUnique({
      where: { name: boardName }
    });

    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }

    let mediaData = {};
    let mediaFiles = [];
    
    // Обработка загруженных файлов (множественные)
    if (req.files && req.files.length > 0) {
      // Проверка количества файлов
      if (req.files.length > 5) {
        return res.status(400).json({ error: 'Too many files. Maximum 5 files allowed' });
      }

      // Проверка каждого файла
      for (const file of req.files) {
        // Проверка размера файла
        if (file.size > board.maxFileSize) {
          return res.status(400).json({ 
            error: `File ${file.originalname} too large. Max size: ${Math.round(board.maxFileSize / 1024 / 1024)}MB` 
          });
        }

        // Проверка типа файла
        const fileExtension = file.originalname.split('.').pop().toLowerCase();
        if (!board.allowedFileTypes.includes(fileExtension)) {
          return res.status(400).json({ 
            error: `File type ${fileExtension} not allowed. Allowed: ${board.allowedFileTypes.join(', ')}` 
          });
        }
      }

      // Загрузка файлов в Cloudinary
      const uploadResults = await uploadMultipleForumMedia(req.files, boardName);
      
      if (!uploadResults || uploadResults.length === 0) {
        return res.status(500).json({ error: 'Failed to upload media files' });
      }

      mediaFiles = uploadResults;

      // Для обратной совместимости, используем первый файл как основной
      if (uploadResults.length > 0) {
        const firstFile = uploadResults[0];
        mediaData = {
          imageUrl: firstFile.url,
          imagePublicId: firstFile.publicId,
          imageName: firstFile.name,
          imageSize: firstFile.size,
          thumbnailUrl: firstFile.thumbnailUrl
        };
      }
    }

    const posterHash = generatePosterHash(clientIp, boardName);

    // Генерируем уникальный shortId
    let shortId;
    let isUnique = false;
    while (!isUnique) {
      shortId = generateShortId();
      const existingThread = await prisma.thread.findUnique({
        where: { shortId }
      });
      if (!existingThread) {
        isUnique = true;
      }
    }

    // Опционально определяем категорию по slug
    let categoryId = null;
    if (categorySlug) {
      const cat = await prisma.categories.findUnique({ where: { slug: categorySlug } });
      if (cat) categoryId = cat.id;
    }

    // Проверка slug (необязательно). Если указан, то проверяем уникальность в пределах категории.
    if (slug) {
      if (!categoryId) {
        return res.status(400).json({ error: 'categorySlug is required when slug is provided' });
      }
      const slugExists = await prisma.thread.findFirst({ where: { slug, categoryId } });
      if (slugExists) {
        return res.status(409).json({ error: 'Thread slug already exists in this category' });
      }
    }

    const thread = await prisma.thread.create({
      data: {
        boardId: board.id,
        categoryId,
        shortId,
        slug: slug || null,
        subject: subject || null,
        content,
        authorName: authorName || null,
        authorTrip: authorTrip || null,
        posterHash,
        imageCount: mediaFiles.length,
        ...mediaData,
        mediaFiles: {
          create: mediaFiles.map(file => ({
            url: file.url,
            publicId: file.publicId,
            name: file.name,
            size: file.size,
            type: file.type,
            mimeType: file.mimeType,
            thumbnailUrl: file.thumbnailUrl,
            width: file.width,
            height: file.height,
            duration: file.duration
          }))
        }
      },
      include: {
        board: true,
        mediaFiles: true,
        _count: {
          select: { replies: true }
        }
      }
    });

    res.status(201).json(thread);
  } catch (error) {
    console.error('Create thread error:', error);
    res.status(500).json({ error: 'Failed to create thread' });
  }
};

// Получить тред с ответами
const getThread = async (req, res) => {
  try {
    const { boardName, threadId } = req.params;

    const board = await prisma.board.findUnique({
      where: { name: boardName }
    });

    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const thread = await prisma.thread.findFirst({
      where: { 
        id: threadId,
        boardId: board.id 
      },
      include: {
        board: true,
        mediaFiles: true,
        replies: {
          orderBy: { postNumber: 'asc' },
          where: { isDeleted: false },
          include: {
            mediaFiles: true
          }
        }
      }
    });

    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    res.json(thread);
  } catch (error) {
    console.error('Get thread error:', error);
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
};

// Получить треды категории с фильтрацией по тегу и пагинацией
const getCategoryThreads = async (req, res) => {
  try {
    const slug = req.params.slug || req.params.categorySlug;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const tagSlug = req.query.tag || null;

    const category = await prisma.categories.findUnique({ where: { slug } });
    if (!category) return res.status(404).json({ error: 'Category not found' });

    const where = {
      categoryId: category.id,
      isArchived: false,
      ...(tagSlug ? { threadTags: { some: { tag: { slug: tagSlug } } } } : {})
    };

    const [threads, total] = await Promise.all([
      prisma.thread.findMany({
        where,
        include: {
          mediaFiles: true,
          threadTags: { include: { tag: true } },
          _count: { select: { replies: true } }
        },
        orderBy: [
          { isPinned: 'desc' },
          { lastBumpAt: 'desc' }
        ],
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.thread.count({ where })
    ]);

    res.json({
      category: { id: category.id, name: category.name, slug: category.slug, color: category.color },
      threads,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get category threads error:', error);
    res.status(500).json({ error: 'Failed to fetch category threads' });
  }
};

// Получить тред по паре categorySlug + threadSlug (красивая ссылка)
const getThreadByCategoryAndSlug = async (req, res) => {
  try {
    const { categorySlug, threadSlug } = req.params;

    const category = await prisma.categories.findUnique({ where: { slug: categorySlug } });
    if (!category) return res.status(404).json({ error: 'Category not found' });

    const thread = await prisma.thread.findFirst({
      where: { categoryId: category.id, slug: threadSlug },
      include: {
        board: true,
        mediaFiles: true,
        replies: {
          orderBy: { postNumber: 'asc' },
          where: { isDeleted: false },
          include: { mediaFiles: true }
        },
        threadTags: { include: { tag: true } }
      }
    });

    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    res.json(thread);
  } catch (error) {
    console.error('Get thread by category+slug error:', error);
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
};

// Получить информацию о категории по slug (с детьми и счетчиком тредов)
const getCategoryBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const category = await prisma.categories.findUnique({
      where: { slug },
      include: {
        parent: true,
        children: true,

        _count: { select: { threads: true } }
      }
    });
    if (!category) return res.status(404).json({ error: 'Category not found' });

    // Добавим счетчики на детей
    const childrenWithCounts = await Promise.all((category.children || []).map(async (child) => {
      const count = await prisma.thread.count({ where: { categoryId: child.id, isArchived: false } });
      return { ...child, _count: { threads: count } };
    }));

    res.json({ ...category, children: childrenWithCounts });
  } catch (error) {
    console.error('Get category by slug error:', error);
    res.status(500).json({ error: 'Failed to fetch category' });
  }
};

// Создать тред внутри категории (с выбором борда для правил вложений)
const createThreadInCategory = async (req, res) => {
  try {
    const { slug } = req.params; // category slug
    const { subject, content, authorName, authorTrip, threadSlug, boardName } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const category = await prisma.categories.findUnique({ where: { slug } });
    if (!category) return res.status(404).json({ error: 'Category not found' });

    // Определяем борд (для лимитов и типов файлов). Либо по переданному имени, либо первый активный.
    let board = null;
    if (boardName) {
      board = await prisma.board.findUnique({ where: { name: boardName } });
    }
    if (!board) {
      board = await prisma.board.findFirst({ where: { isActive: true }, orderBy: { name: 'asc' } });
    }
    if (!board) return res.status(400).json({ error: 'No active boards available to host the thread' });

    // Проверка slug внутри категории, если задан
    if (threadSlug) {
      const slugExists = await prisma.thread.findFirst({ where: { slug: threadSlug, categoryId: category.id } });
      if (slugExists) return res.status(409).json({ error: 'Thread slug already exists in this category' });
    }

    let mediaData = {};
    let mediaFiles = [];

    if (req.files && req.files.length > 0) {
      if (req.files.length > 5) {
        return res.status(400).json({ error: 'Too many files. Maximum 5 files allowed' });
      }

      for (const file of req.files) {
        if (file.size > board.maxFileSize) {
          return res.status(400).json({ 
            error: `File ${file.originalname} too large. Max size: ${Math.round(board.maxFileSize / 1024 / 1024)}MB` 
          });
        }
        const fileExtension = file.originalname.split('.').pop().toLowerCase();
        if (!board.allowedFileTypes.includes(fileExtension)) {
          return res.status(400).json({ 
            error: `File type ${fileExtension} not allowed. Allowed: ${board.allowedFileTypes.join(', ')}` 
          });
        }
      }

      const uploadResults = await uploadMultipleForumMedia(req.files, board.name);
      if (!uploadResults || uploadResults.length === 0) {
        return res.status(500).json({ error: 'Failed to upload media files' });
      }
      mediaFiles = uploadResults;
      const firstFile = uploadResults[0];
      if (firstFile) {
        mediaData = {
          imageUrl: firstFile.url,
          imagePublicId: firstFile.publicId,
          imageName: firstFile.name,
          imageSize: firstFile.size,
          thumbnailUrl: firstFile.thumbnailUrl
        };
      }
    }

    const posterHash = generatePosterHash(clientIp, board.name);

    // Генерируем уникальный shortId
    let shortId;
    for (;;) {
      shortId = generateShortId();
      const existing = await prisma.thread.findUnique({ where: { shortId } });
      if (!existing) break;
    }

    const thread = await prisma.thread.create({
      data: {
        boardId: board.id,
        categoryId: category.id,
        shortId,
        slug: threadSlug || null,
        subject: subject || null,
        content,
        authorName: authorName || null,
        authorTrip: authorTrip || null,
        posterHash,
        imageCount: mediaFiles.length,
        ...mediaData,
        mediaFiles: {
          create: mediaFiles.map(file => ({
            url: file.url,
            publicId: file.publicId,
            name: file.name,
            size: file.size,
            type: file.type,
            mimeType: file.mimeType,
            thumbnailUrl: file.thumbnailUrl,
            width: file.width,
            height: file.height,
            duration: file.duration
          }))
        }
      },
      include: {
        mediaFiles: true,
        _count: { select: { replies: true } }
      }
    });

    res.status(201).json(thread);
  } catch (error) {
    console.error('Create thread in category error:', error);
    res.status(500).json({ error: 'Failed to create thread in category' });
  }
};

// Создать ответ в треде категории (альтернативный маршрут без boardName)
const createReplyInCategory = async (req, res) => {
  try {
    const { categorySlug, threadId } = req.params;
    const { content, authorName, authorTrip, sage, replyToId } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const category = await prisma.categories.findUnique({ where: { slug: categorySlug } });
    if (!category) return res.status(404).json({ error: 'Category not found' });

    const thread = await prisma.thread.findFirst({
      where: { id: threadId, categoryId: category.id },
      include: { _count: { select: { replies: true } }, board: true }
    });
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (thread.isLocked || thread.isClosed) return res.status(403).json({ error: 'Thread is locked or closed' });

    const board = thread.board;

    let mediaData = {};
    let mediaFiles = [];
    if (req.files && req.files.length > 0) {
      if (req.files.length > 5) {
        return res.status(400).json({ error: 'Too many files. Maximum 5 files allowed.' });
      }
      for (const file of req.files) {
        const fileExtension = file.originalname.split('.').pop().toLowerCase();
        if (file.size > board.maxFileSize) {
          return res.status(400).json({ 
            error: `File too large. Max size: ${Math.round(board.maxFileSize / 1024 / 1024)}MB` 
          });
        }
        if (!board.allowedFileTypes.includes(fileExtension)) {
          return res.status(400).json({ 
            error: `File type not allowed. Allowed: ${board.allowedFileTypes.join(', ')}` 
          });
        }
      }

      const uploadResults = await uploadMultipleForumMedia(req.files, board.name);
      if (!uploadResults || uploadResults.length === 0) {
        return res.status(500).json({ error: 'Failed to upload media files' });
      }
      mediaFiles = uploadResults;
      const firstFile = mediaFiles[0];
      if (firstFile) {
        mediaData = {
          imageUrl: firstFile.url,
          imagePublicId: firstFile.publicId,
          imageName: firstFile.name,
          imageSize: firstFile.size,
          thumbnailUrl: firstFile.thumbnailUrl
        };
      }
    }

    const posterHash = generatePosterHash(clientIp, board.name);
    const postNumber = thread._count.replies + 2;

    // shortId для ответа
    let shortId;
    for (;;) {
      shortId = generateShortId();
      const exists = await prisma.reply.findUnique({ where: { shortId } });
      if (!exists) break;
    }

    // Парсинг цитат >>shortId
    const replyToMatches = content.match(/>>([a-z0-9]{6})/g);
    let replyTo = replyToMatches ? replyToMatches.map(m => m.slice(2)) : [];
    if (replyToId) {
      try {
        if (replyToId === threadId) {
          const referenced = await prisma.thread.findUnique({ where: { id: threadId }, select: { shortId: true } });
          if (referenced && !replyTo.includes(referenced.shortId)) replyTo.push(referenced.shortId);
        } else {
          const referenced = await prisma.reply.findUnique({ where: { id: replyToId }, select: { shortId: true, threadId: true } });
          if (referenced && referenced.threadId === threadId && !replyTo.includes(referenced.shortId)) replyTo.push(referenced.shortId);
        }
      } catch (e) {
        console.error('Error finding referenced post:', e);
      }
    }

    const reply = await prisma.reply.create({
      data: {
        threadId,
        shortId,
        content,
        authorName: authorName || null,
        authorTrip: authorTrip || null,
        posterHash,
        postNumber,
        replyTo,
        imageCount: mediaFiles.length,
        ...mediaData,
        mediaFiles: {
          create: mediaFiles.map(file => ({
            url: file.url,
            publicId: file.publicId,
            name: file.name,
            size: file.size,
            type: file.type,
            mimeType: file.mimeType,
            thumbnailUrl: file.thumbnailUrl,
            width: file.width,
            height: file.height,
            duration: file.duration
          }))
        }
      },
      include: { mediaFiles: true }
    });

    const updateData = { replyCount: { increment: 1 } };
    if (!sage) updateData.lastBumpAt = new Date();
    if (mediaFiles.length > 0) updateData.imageCount = { increment: mediaFiles.length };
    await prisma.thread.update({ where: { id: threadId }, data: updateData });

    res.status(201).json(reply);
  } catch (error) {
    console.error('Create reply in category error:', error);
    res.status(500).json({ error: 'Failed to create reply in category' });
  }
};

// Создать ответ в треде
const createReply = async (req, res) => {
  try {
    const { boardName, threadId } = req.params;
    const { content, authorName, authorTrip, sage, replyToId } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const board = await prisma.board.findUnique({
      where: { name: boardName }
    });

    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const thread = await prisma.thread.findFirst({
      where: { 
        id: threadId,
        boardId: board.id 
      },
      include: {
        _count: {
          select: { replies: true }
        }
      }
    });

    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    if (thread.isLocked || thread.isClosed) {
      return res.status(403).json({ error: 'Thread is locked or closed' });
    }

    // Проверка лимита постов
    if (thread._count.replies >= board.bumpLimit) {
      return res.status(403).json({ error: 'Thread has reached bump limit' });
    }

    let mediaData = {};
    let mediaFiles = [];
    
    // Обработка загруженных файлов (множественные файлы)
    if (req.files && req.files.length > 0) {
      // Проверка количества файлов
      if (req.files.length > 5) {
        return res.status(400).json({ error: 'Too many files. Maximum 5 files allowed.' });
      }

      // Валидация каждого файла
      for (const file of req.files) {
        const fileType = getFileTypeInfo(file.mimetype);
        
        if (file.size > board.maxFileSize) {
          return res.status(400).json({ 
            error: `File too large. Max size: ${Math.round(board.maxFileSize / 1024 / 1024)}MB` 
          });
        }

        const fileExtension = file.originalname.split('.').pop().toLowerCase();
        if (!board.allowedFileTypes.includes(fileExtension)) {
          return res.status(400).json({ 
            error: `File type not allowed. Allowed: ${board.allowedFileTypes.join(', ')}` 
          });
        }
      }

      // Загрузка всех файлов в Cloudinary
      const uploadResults = await uploadMultipleForumMedia(req.files, boardName);

      if (!uploadResults || uploadResults.length === 0) {
        return res.status(500).json({ error: 'Failed to upload media files' });
      }

      mediaFiles = uploadResults;

      // Устанавливаем данные для обратной совместимости (первый файл)
      if (mediaFiles.length > 0) {
        const firstFile = mediaFiles[0];
        mediaData = {
          imageUrl: firstFile.url,
          imagePublicId: firstFile.publicId,
          imageName: firstFile.name,
          imageSize: firstFile.size,
          thumbnailUrl: firstFile.thumbnailUrl
        };
      }
    }

    const posterHash = generatePosterHash(clientIp, boardName);
    const postNumber = thread._count.replies + 2; // +1 за OP пост, +1 за новый

    // Генерируем уникальный shortId для reply
    let shortId;
    let isUnique = false;
    while (!isUnique) {
      shortId = generateShortId();
      const existingReply = await prisma.reply.findUnique({
        where: { shortId }
      });
      if (!existingReply) {
        isUnique = true;
      }
    }

    // Парсинг цитат >>shortId
    const replyToMatches = content.match(/>>([a-z0-9]{6})/g);
    let replyTo = replyToMatches ? replyToMatches.map(match => match.slice(2)) : [];

    // Если указан явный replyToId, добавляем shortId поста в replyTo
    if (replyToId) {
      try {
        // Находим пост по ID для получения его shortId
        let referencedPost;
        
        // Проверяем, является ли это тредом (OP пост)
        if (replyToId === threadId) {
          referencedPost = await prisma.thread.findUnique({
            where: { id: threadId },
            select: { shortId: true }
          });
          
          if (referencedPost && !replyTo.includes(referencedPost.shortId)) {
            replyTo.push(referencedPost.shortId);
          }
        } else {
          // Ищем среди реплаев
          referencedPost = await prisma.reply.findUnique({
            where: { id: replyToId },
            select: { shortId: true, threadId: true }
          });
          
          if (referencedPost && referencedPost.threadId === threadId && !replyTo.includes(referencedPost.shortId)) {
            replyTo.push(referencedPost.shortId);
          }
        }
      } catch (error) {
        console.error('Error finding referenced post:', error);
      }
    }

    const reply = await prisma.reply.create({
      data: {
        threadId,
        shortId,
        content,
        authorName: authorName || null,
        authorTrip: authorTrip || null,
        posterHash,
        postNumber,
        replyTo,
        imageCount: mediaFiles.length,
        ...mediaData,
        mediaFiles: {
          create: mediaFiles.map(file => ({
            url: file.url,
            publicId: file.publicId,
            name: file.name,
            size: file.size,
            type: file.type,
            mimeType: file.mimeType,
            thumbnailUrl: file.thumbnailUrl,
            width: file.width,
            height: file.height,
            duration: file.duration
          }))
        }
      },
      include: {
        mediaFiles: true
      }
    });

    // Обновляем счетчики треда
    const updateData = {
      replyCount: { increment: 1 }
    };

    // Бамп треда (если не sage)
    if (!sage) {
      updateData.lastBumpAt = new Date();
    }

    // Увеличиваем счетчик изображений
    if (mediaFiles.length > 0) {
      updateData.imageCount = { increment: mediaFiles.length };
    }

    await prisma.thread.update({
      where: { id: threadId },
      data: updateData
    });

    res.status(201).json(reply);
  } catch (error) {
    console.error('Create reply error:', error);
    res.status(500).json({ error: 'Failed to create reply' });
  }
};

// Удалить тред (с медиа из Cloudinary)
const deleteThread = async (req, res) => {
  try {
    const { boardName, threadId } = req.params;
    // TODO: Добавить проверку прав модератора

    const board = await prisma.board.findUnique({
      where: { name: boardName }
    });

    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const thread = await prisma.thread.findFirst({
      where: { 
        id: threadId,
        boardId: board.id 
      },
      include: {
        replies: {
          select: {
            id: true,
            imagePublicId: true
          }
        }
      }
    });

    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    // Собираем все Public ID для удаления из Cloudinary
    const publicIdsToDelete = [];
    
    if (thread.imagePublicId) {
      publicIdsToDelete.push(thread.imagePublicId);
    }

    thread.replies.forEach(reply => {
      if (reply.imagePublicId) {
        publicIdsToDelete.push(reply.imagePublicId);
      }
    });

    // Удаляем медиа из Cloudinary
    if (publicIdsToDelete.length > 0) {
      const deleteResult = await deleteMultipleForumMedia(publicIdsToDelete);
      if (!deleteResult.success) {
        console.error('Failed to delete media from Cloudinary:', deleteResult.error);
      }
    }

    // Удаляем тред из БД (каскадное удаление ответов)
    await prisma.thread.delete({
      where: { id: threadId }
    });

    res.json({ 
      message: 'Thread deleted successfully',
      deletedMediaCount: publicIdsToDelete.length 
    });
  } catch (error) {
    console.error('Delete thread error:', error);
    res.status(500).json({ error: 'Failed to delete thread' });
  }
};

// Удалить ответ (с медиа из Cloudinary)
const deleteReply = async (req, res) => {
  try {
    const { boardName, replyId } = req.params;
    // TODO: Добавить проверку прав модератора

    const reply = await prisma.reply.findUnique({
      where: { id: replyId },
      include: {
        thread: {
          include: {
            board: true
          }
        }
      }
    });

    if (!reply || reply.thread.board.name !== boardName) {
      return res.status(404).json({ error: 'Reply not found' });
    }

    // Удаляем медиа из Cloudinary
    if (reply.imagePublicId) {
      const deleteResult = await deleteForumMedia(reply.imagePublicId);
      if (!deleteResult.success) {
        console.error('Failed to delete media from Cloudinary:', deleteResult.error);
      }
    }

    // Помечаем как удаленный вместо полного удаления
    await prisma.reply.update({
      where: { id: replyId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        content: '[Deleted]',
        imageUrl: null,
        imagePublicId: null,
        imageName: null,
        imageSize: null,
        thumbnailUrl: null
      }
    });

    // Уменьшаем счетчики треда
    const updateData = {
      replyCount: { decrement: 1 }
    };

    if (reply.imageUrl) {
      updateData.imageCount = { decrement: 1 };
    }

    await prisma.thread.update({
      where: { id: reply.threadId },
      data: updateData
    });

    res.json({ message: 'Reply deleted successfully' });
  } catch (error) {
    console.error('Delete reply error:', error);
    res.status(500).json({ error: 'Failed to delete reply' });
  }
};

// Создать новый борд
const createBoard = async (req, res) => {
  try {
    const {
      name,
      title,
      description,
      isNsfw = false,
      maxFileSize = 5242880, // 5MB по умолчанию
      allowedFileTypes = ['jpg', 'jpeg', 'png', 'gif', 'webp'],
      postsPerPage = 15,
      threadsPerPage = 10,
      bumpLimit = 500,
      imageLimit = 150
    } = req.body;

    // Валидация обязательных полей
    if (!name || !title) {
      return res.status(400).json({ error: 'Name and title are required' });
    }

    // Валидация имени борда (только буквы и цифры, 1-10 символов)
    const nameRegex = /^[a-zA-Z0-9]{1,10}$/;
    if (!nameRegex.test(name)) {
      return res.status(400).json({ 
        error: 'Board name must be 1-10 characters, letters and numbers only' 
      });
    }

    // Проверка на существование борда с таким именем
    const existingBoard = await prisma.board.findUnique({
      where: { name: name.toLowerCase() }
    });

    if (existingBoard) {
      return res.status(409).json({ error: 'Board with this name already exists' });
    }

    // Валидация типов файлов
    const validFileTypes = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'webm', 'mp4', 'mov'];
    const invalidTypes = allowedFileTypes.filter(type => !validFileTypes.includes(type));
    if (invalidTypes.length > 0) {
      return res.status(400).json({ 
        error: `Invalid file types: ${invalidTypes.join(', ')}. Valid types: ${validFileTypes.join(', ')}` 
      });
    }

    // Валидация размеров и лимитов
    if (maxFileSize < 1024 * 1024 || maxFileSize > 50 * 1024 * 1024) {
      return res.status(400).json({ 
        error: 'Max file size must be between 1MB and 50MB' 
      });
    }

    if (postsPerPage < 5 || postsPerPage > 50) {
      return res.status(400).json({ 
        error: 'Posts per page must be between 5 and 50' 
      });
    }

    if (threadsPerPage < 5 || threadsPerPage > 25) {
      return res.status(400).json({ 
        error: 'Threads per page must be between 5 and 25' 
      });
    }

    if (bumpLimit < 50 || bumpLimit > 1000) {
      return res.status(400).json({ 
        error: 'Bump limit must be between 50 and 1000' 
      });
    }

    if (imageLimit < 10 || imageLimit > 500) {
      return res.status(400).json({ 
        error: 'Image limit must be between 10 and 500' 
      });
    }

    // Создаем новый борд
    const board = await prisma.board.create({
      data: {
        name: name.toLowerCase(),
        title,
        description: description || null,
        isNsfw: Boolean(isNsfw),
        maxFileSize: parseInt(maxFileSize),
        allowedFileTypes,
        postsPerPage: parseInt(postsPerPage),
        threadsPerPage: parseInt(threadsPerPage),
        bumpLimit: parseInt(bumpLimit),
        imageLimit: parseInt(imageLimit),
        isActive: true
      }
    });

    res.status(201).json({
      message: 'Board created successfully',
      board
    });
  } catch (error) {
    console.error('Create board error:', error);
    res.status(500).json({ error: 'Failed to create board' });
  }
};

// Обновить настройки борда
const updateBoard = async (req, res) => {
  try {
    const { boardName } = req.params;
    const updateData = req.body;

    // Проверяем, что борд существует
    const existingBoard = await prisma.board.findUnique({
      where: { name: boardName }
    });

    if (!existingBoard) {
      return res.status(404).json({ error: 'Board not found' });
    }

    // Фильтруем разрешенные для обновления поля
    const allowedFields = [
      'title', 'description', 'isNsfw', 'maxFileSize', 
      'allowedFileTypes', 'postsPerPage', 'threadsPerPage', 
      'bumpLimit', 'imageLimit', 'isActive'
    ];

    const filteredData = {};
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        filteredData[field] = updateData[field];
      }
    }

    if (Object.keys(filteredData).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Применяем те же валидации, что и при создании
    if (filteredData.maxFileSize && (filteredData.maxFileSize < 1024 * 1024 || filteredData.maxFileSize > 50 * 1024 * 1024)) {
      return res.status(400).json({ error: 'Max file size must be between 1MB and 50MB' });
    }

    if (filteredData.allowedFileTypes) {
      const validFileTypes = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'webm', 'mp4', 'mov'];
      const invalidTypes = filteredData.allowedFileTypes.filter(type => !validFileTypes.includes(type));
      if (invalidTypes.length > 0) {
        return res.status(400).json({ 
          error: `Invalid file types: ${invalidTypes.join(', ')}` 
        });
      }
    }

    // Обновляем борд
    const updatedBoard = await prisma.board.update({
      where: { name: boardName },
      data: filteredData
    });

    res.json({
      message: 'Board updated successfully',
      board: updatedBoard
    });
  } catch (error) {
    console.error('Update board error:', error);
    res.status(500).json({ error: 'Failed to update board' });
  }
};

// Деактивировать борд (мягкое удаление)
const deactivateBoard = async (req, res) => {
  try {
    const { boardName } = req.params;

    const board = await prisma.board.findUnique({
      where: { name: boardName }
    });

    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }

    // Деактивируем борд вместо удаления
    const updatedBoard = await prisma.board.update({
      where: { name: boardName },
      data: { isActive: false }
    });

    res.json({
      message: 'Board deactivated successfully',
      board: updatedBoard
    });
  } catch (error) {
    console.error('Deactivate board error:', error);
    res.status(500).json({ error: 'Failed to deactivate board' });
  }
};

// Получить борд по имени (без полей cover/icon в ответе)
const getBoardByName = async (req, res) => {
  try {
    const { boardName } = req.params;

    const board = await prisma.board.findUnique({
      where: { 
        name: boardName,
        isActive: true 
      },
      include: {
        _count: {
          select: { 
            threads: true
          }
        }
      }
    });

    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }

    // Считаем replies отдельно через threads
    const totalReplies = await prisma.reply.count({
      where: {
        thread: {
          boardId: board.id,
          isArchived: false
        },
        isDeleted: false
      }
    });

    // Формируем ответ без coverImageUrl и icon
    const boardResp = {
      id: board.id,
      name: board.name,
      title: board.title,
      description: board.description,
      isNsfw: board.isNsfw,
      postsPerPage: board.postsPerPage,
      threadsPerPage: board.threadsPerPage,
      bumpLimit: board.bumpLimit,
      imageLimit: board.imageLimit,
      isActive: board.isActive,
      createdAt: board.createdAt,
      _count: {
        threads: board._count.threads,
        replies: totalReplies
      }
    };

    res.json(boardResp);
  } catch (error) {
    console.error('Get board by name error:', error);
    res.status(500).json({ error: 'Failed to fetch board' });
  }
};

// Получить подробную информацию о борде (без cover/icon в ответе)
const getBoardInfo = async (req, res) => {
  try {
    const { boardName } = req.params;

    const board = await prisma.board.findUnique({
      where: { name: boardName },
      include: {
        _count: {
          select: { 
            threads: {
              where: { isArchived: false }
            }
          }
        }
      }
    });

    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }

    // Статистика борда
    const totalReplies = await prisma.reply.count({
      where: {
        thread: {
          boardId: board.id,
          isArchived: false
        },
        isDeleted: false
      }
    });

    const totalImages = await prisma.thread.aggregate({
      where: {
        boardId: board.id,
        isArchived: false
      },
      _sum: {
        imageCount: true
      }
    });

    // Последняя активность
    const lastActivity = await prisma.thread.findFirst({
      where: {
        boardId: board.id,
        isArchived: false
      },
      orderBy: { lastBumpAt: 'desc' },
      select: { lastBumpAt: true }
    });

    res.json({
      id: board.id,
      name: board.name,
      title: board.title,
      description: board.description,
      isNsfw: board.isNsfw,
      // coverImageUrl и icon намеренно опущены
      stats: {
        totalThreads: board._count.threads,
        totalReplies,
        totalImages: totalImages._sum.imageCount || 0,
        lastActivity: lastActivity?.lastBumpAt || null
      }
    });
  } catch (error) {
    console.error('Get board info error:', error);
    res.status(500).json({ error: 'Failed to fetch board info' });
  }
};

// Получить только треды борда (упрощённая версия)
const getThreads = async (req, res) => {
  try {
    const { boardName } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const board = await prisma.board.findUnique({
      where: { 
        name: boardName,
        isActive: true 
      }
    });

    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const threads = await prisma.thread.findMany({
      where: { 
        boardId: board.id,
        isArchived: false 
      },
      include: {
        _count: {
          select: { replies: true }
        }
      },
      orderBy: [
        { isPinned: 'desc' },
        { lastBumpAt: 'desc' }
      ],
      skip: (page - 1) * limit,
      take: limit
    });

    // Добавляем lastReply для каждого треда
    const threadsWithLastReply = await Promise.all(
      threads.map(async (thread) => {
        const lastReply = await prisma.reply.findFirst({
          where: { threadId: thread.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true }
        });

        return {
          ...thread,
          lastReply: lastReply?.createdAt || thread.createdAt
        };
      })
    );

    res.json(threadsWithLastReply);
  } catch (error) {
    console.error('Get threads error:', error);
    res.status(500).json({ error: 'Failed to fetch threads' });
  }
};

// Создание категории с изображением (multipart/form-data, field: image)
const createCategory = async (req, res) => {
  try {
    const { name, slug, description, color, parentId } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ error: 'Name and slug are required' });
    }

    const exists = await prisma.categories.findUnique({ where: { slug } });
    if (exists) {
      return res.status(409).json({ error: 'Category with this slug already exists' });
    }

    let imageUrl = null;
    if (req.file && req.file.buffer) {
      const upload = await uploadForumMedia(req.file.buffer, 'categories', { isImage: true });
      if (upload && upload.url) imageUrl = upload.url;
    }

    const category = await prisma.categories.create({
      data: {
        name,
        slug,
        description: description || null,
        color: color || null,
        imageUrl,
        parentId: parentId || null,
        group: 'default' // это нужно будет расширить логику групп
      },
      include: { parent: true, children: true }
    });

    res.status(201).json(category);
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
};

// Создание тега с иконкой (multipart/form-data, field: icon)
const createTag = async (req, res) => {
  try {
    const { name, slug, description, color } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ error: 'Name and slug are required' });
    }

    const exists = await prisma.tag.findUnique({ where: { slug } });
    if (exists) {
      return res.status(409).json({ error: 'Tag with this slug already exists' });
    }

    let icon = null;
    if (req.file && req.file.buffer) {
      // Сохраняем иконки тегов в папке categories по требованию ТЗ
      const upload = await uploadForumMedia(req.file.buffer, 'categories', { isImage: true });
      if (upload && upload.url) icon = upload.url;
    }

    const tag = await prisma.tag.create({
      data: { name, slug, description: description || null, color: color || null, icon }
    });

    res.status(201).json(tag);
  } catch (error) {
    console.error('Create tag error:', error);
    res.status(500).json({ error: 'Failed to create tag' });
  }
};

// Загрузка/обновление изображения категории (multipart/form-data, field: image)
const uploadCategoryImage = async (req, res) => {
  try {
    const { slug } = req.params;

    const category = await prisma.categories.findUnique({ where: { slug } });
    if (!category) return res.status(404).json({ error: 'Category not found' });
    if (!(req.file && req.file.buffer)) return res.status(400).json({ error: 'Image is required' });

    const upload = await uploadForumMedia(req.file.buffer, 'categories', { isImage: true });
    if (!upload || !upload.url) return res.status(500).json({ error: 'Failed to upload image' });

    const updated = await prisma.categories.update({
      where: { slug },
      data: { imageUrl: upload.url }
    });

    res.json({ message: 'Category image updated', category: updated });
  } catch (error) {
    console.error('Upload category image error:', error);
    res.status(500).json({ error: 'Failed to upload category image' });
  }
};

// Привязка тега к треду
const assignTagToThread = async (req, res) => {
  try {
    const { threadId, tagSlug } = req.params;

    const [thread, tag] = await Promise.all([
      prisma.thread.findUnique({ where: { id: threadId } }),
      prisma.tag.findUnique({ where: { slug: tagSlug } })
    ]);

    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (!tag) return res.status(404).json({ error: 'Tag not found' });

    const exists = await prisma.threadTag.findUnique({
      where: { threadId_tagId: { threadId: thread.id, tagId: tag.id } }
    });
    if (exists) return res.status(409).json({ error: 'Tag already assigned' });

    const link = await prisma.threadTag.create({ data: { threadId: thread.id, tagId: tag.id } });
    res.status(201).json(link);
  } catch (error) {
    console.error('Assign tag to thread error:', error);
    res.status(500).json({ error: 'Failed to assign tag to thread' });
  }
};

// Получение дерева категорий (без бордов). На каждой категории считаем кол-во тредов.
const getCategories = async (req, res) => {
  try {
    const root = await prisma.categories.findMany({
      where: { parentId: null },
      include: {
        children: true,
        _count: { select: { threads: true } }
      },
      orderBy: { name: 'asc' }
    });

    // Для детей добираем count threads
    const withCounts = await Promise.all(root.map(async (cat) => {
      const childrenWithCounts = await Promise.all((cat.children || []).map(async (child) => {
        const count = await prisma.thread.count({ where: { categoryId: child.id, isArchived: false } });
        return { ...child, _count: { threads: count } };
      }));

      return { ...cat, children: childrenWithCounts };
    }));

    res.json(withCounts);
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
};

// Получение всех тегов с количеством привязок
const getTags = async (req, res) => {
  try {
    const tags = await prisma.tag.findMany({
        include: {
          _count: { select: { threadTags: true } }
        },
        orderBy: { name: 'asc' }
      });

    res.json(tags);
  } catch (error) {
    console.error('Get tags error:', error);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
};

// Сводная статистика форума
const getForumStats = async (req, res) => {
  try {
    const [boards, threads, replies, mediaAll, images, videos, categories, tags, lastThread, lastReply] = await Promise.all([
      prisma.board.count({ where: { isActive: true } }),
      prisma.thread.count({ where: { isArchived: false } }),
      prisma.reply.count({ where: { isDeleted: false } }),
      prisma.mediaFile.count({}),
      prisma.mediaFile.count({ where: { type: 'image' } }),
      prisma.mediaFile.count({ where: { type: 'video' } }),
      prisma.categories.count({}),
      prisma.tag.count({}),
      prisma.thread.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      prisma.reply.findFirst({ where: { isDeleted: false }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
    ])

    const lastActivity = [lastThread?.createdAt, lastReply?.createdAt].filter(Boolean).sort((a, b) => (a > b ? -1 : 1))[0] || null

    res.json({
      boards,
      threads,
      replies,
      media: mediaAll,
      images,
      videos,
      categories,
      tags,
      lastActivity
    })
  } catch (error) {
    console.error('Get forum stats error:', error)
    res.status(500).json({ error: 'Failed to fetch forum stats' })
  }
}

// Последние обновлённые треды по последним ответам (без дублей по тредам)
const getLatestPosts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const boardName = req.query.board || undefined;
    const categorySlug = req.query.category || undefined;
    const tagSlug = req.query.tag || undefined;
    const nsfw = req.query.nsfw; // '0' чтобы исключать NSFW борды

    // Фильтруем по ответам, но условия накладываем на связанный тред
    const whereReply = {
      isDeleted: false,
      thread: {
        isArchived: false,
        ...(boardName || nsfw === '0'
          ? {
              board: {
                ...(boardName ? { name: boardName } : {}),
                ...(nsfw === '0' ? { isNsfw: false } : {})
              }
            }
          : {}),
        ...(categorySlug ? { category: { slug: categorySlug } } : {}),
        ...(tagSlug ? { threadTags: { some: { tag: { slug: tagSlug } } } } : {})
      }
    };

    // Берём больше, чтобы потом отфильтровать дубли по треду
    const replies = await prisma.reply.findMany({
      where: whereReply,
      orderBy: { createdAt: 'desc' },
      take: limit * 3,
      include: {
        thread: {
          include: {
            mediaFiles: true,
            _count: { select: { replies: true } },
            board: { select: { name: true, title: true, isNsfw: true } },
            category: { select: { id: true, name: true, slug: true } },
            threadTags: { include: { tag: true } }
          }
        }
      }
    });

    const seenThreadIds = new Set();
    const items = [];
    for (const r of replies) {
      const t = r.thread;
      if (!t || seenThreadIds.has(t.id)) continue;
      seenThreadIds.add(t.id);
      items.push({
        id: t.id,
        type: 'thread',
        createdAt: t.createdAt,
        shortId: t.shortId,
        slug: t.slug || null,
        subject: t.subject || null,
        content: t.content || null,
        imageUrl: t.imageUrl || null,
        thumbnailUrl: t.thumbnailUrl || null,
        mediaFiles: t.mediaFiles || [],
        replyCount: t._count?.replies || 0,
        board: t.board || null,
        category: t.category || null,
        tags: (t.threadTags || []).map((tt) => tt.tag),
        lastReplyAuthorName: r.authorName || null,
        lastReplyAuthorTrip: r.authorTrip || null,
        lastReplyAt: r.createdAt
      });
      if (items.length >= limit) break;
    }

    // Для пагинации по страницам оцениваем общее количество уникальных тредов,
    // удовлетворяющих условию «имеется хотя бы один подходящий ответ». Это дорогая операция,
    // поэтому упрощённо считаем по количеству distinct threadId среди последних N ответов.
    const totalUnique = new Set(replies.map((r) => r.threadId)).size;

    return res.json({
      items,
      pagination: {
        page,
        limit,
        total: totalUnique,
        totalPages: Math.max(1, Math.ceil(totalUnique / limit))
      }
    });
  } catch (error) {
    console.error('Get latest posts error:', error);
    res.status(500).json({ error: 'Failed to fetch latest posts' });
  }
};

module.exports = {
  getBoards,
  getBoardByName,
  getThreads,
  getBoardThreads,
  createThread,
  getThread,
  getThreadByCategoryAndSlug,
  createReply,
  deleteThread,
  deleteReply,
  createBoard,
  updateBoard,
  deactivateBoard,
  getBoardInfo,
  // категории/теги
  createCategory,
  createTag,
  uploadCategoryImage,
  assignTagToThread,
  getCategories,
  getTags,
  getCategoryThreads,
  getCategoryBySlug,
  createThreadInCategory,
  createReplyInCategory,
  getLatestPosts
  ,getForumStats
};
