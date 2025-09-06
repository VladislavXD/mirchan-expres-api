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

// Получить треды борда
const getBoardThreads = async (req, res) => {
  try {
    const { boardName } = req.params;
    const page = parseInt(req.query.page) || 1;

    const board = await prisma.board.findUnique({
      where: { name: boardName }
    });

    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const skip = (page - 1) * board.threadsPerPage;

    const threads = await prisma.thread.findMany({
      where: { 
        boardId: board.id,
        isArchived: false 
      },
      include: {
        mediaFiles: true,
        _count: {
          select: { replies: true }
        },
        replies: {
          take: 5, // Последние 5 ответов для превью
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
          include: {
            mediaFiles: true
          }
        }
      },
      orderBy: [
        { isPinned: 'desc' },
        { lastBumpAt: 'desc' }
      ],
      skip,
      take: board.threadsPerPage
    });

    const totalThreads = await prisma.thread.count({
      where: { 
        boardId: board.id,
        isArchived: false 
      }
    });

    res.json({
      board,
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
    const { subject, content, authorName, authorTrip } = req.body;
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

    const thread = await prisma.thread.create({
      data: {
        boardId: board.id,
        shortId,
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

// Получить подробную информацию о борде
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
      ...board,
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

// Получить борд по имени
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

    // Добавляем count replies к результату
    const boardWithRepliesCount = {
      ...board,
      _count: {
        ...board._count,
        replies: totalReplies
      }
    };

    res.json(boardWithRepliesCount);
  } catch (error) {
    console.error('Get board by name error:', error);
    res.status(500).json({ error: 'Failed to fetch board' });
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

module.exports = {
  getBoards,
  getBoardByName,
  getThreads,
  getBoardThreads,
  createThread,
  getThread,
  createReply,
  deleteThread,
  deleteReply,
  createBoard,
  updateBoard,
  deactivateBoard,
  getBoardInfo
};
