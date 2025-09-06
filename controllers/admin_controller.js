const { PrismaClient } = require('@prisma/client')
const { deleteForumMedia, deleteMultipleForumMedia } = require('../utils/forumCloudinary')
const prisma = new PrismaClient()

// Получение общей статистики
const getStats = async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      adminUsers,
      moderatorUsers,
      totalBoards,
      activeBoards,
      totalThreads,
      threadsToday,
      totalReplies,
      repliesToday,
      totalMedia,
      mediaSize
    ] = await Promise.all([
      // Пользователи
      prisma.user.count(),
      prisma.user.count({
        where: {
          isActive: true
        }
      }),
      prisma.user.count({
        where: {
          role: 'admin'
        }
      }),
      prisma.user.count({
        where: {
          role: 'moderator'
        }
      }),
      
      // Борды
      prisma.board.count(),
      prisma.board.count({
        where: {
          isActive: true
        }
      }),
      
      // Треды
      prisma.thread.count(),
      prisma.thread.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),
      
      // Ответы
      prisma.reply.count(),
      prisma.reply.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),
      
      // Медиафайлы
      prisma.mediaFile.count(),
      prisma.mediaFile.aggregate({
        _sum: {
          size: true
        }
      })
    ])

    res.json({
      users: {
        total: totalUsers,
        active: activeUsers,
        admins: adminUsers,
        moderators: moderatorUsers
      },
      boards: {
        total: totalBoards,
        active: activeBoards
      },
      threads: {
        total: totalThreads,
        today: threadsToday
      },
      replies: {
        total: totalReplies,
        today: repliesToday
      },
      media: {
        total: totalMedia,
        totalSize: mediaSize._sum.size || 0
      }
    })
  } catch (error) {
    console.error('Get stats error:', error)
    res.status(500).json({ error: 'Failed to get statistics' })
  }
}

// Получение всех пользователей с пагинацией
const getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const search = req.query.search || ''
    const role = req.query.role || ''
    const sortBy = req.query.sortBy || 'createdAt'
    const sortOrder = req.query.sortOrder || 'desc'

    const where = {}
    
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } }
      ]
    }
    
    if (role && role !== 'all') {
      where.role = role
    }

    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          lastSeen: true,
          provider: true,
          _count: {
            select: {
              post: true,
              comments: true,
              likes: true
            }
          }
        }
      }),
      prisma.user.count({ where })
    ])

    res.json({
      users,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    })
  } catch (error) {
    console.error('Get users error:', error)
    res.status(500).json({ error: 'Failed to get users' })
  }
}

// Обновление роли пользователя
const updateUserRole = async (req, res) => {
  try {
    const { userId } = req.params
    const { role } = req.body

    if (!['user', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' })
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true
      }
    })

    res.json(user)
  } catch (error) {
    console.error('Update user role error:', error)
    res.status(500).json({ error: 'Failed to update user role' })
  }
}

// Активация/деактивация пользователя
const toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true }
    })

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { isActive: !user.isActive },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true
      }
    })

    res.json(updatedUser)
  } catch (error) {
    console.error('Toggle user status error:', error)
    res.status(500).json({ error: 'Failed to update user status' })
  }
}

// Получение всех бордов
const getBoards = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, isActive } = req.query
    const offset = (page - 1) * limit

    // Строим условия фильтрации
    const where = {}
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ]
    }
    
    if (isActive !== undefined && isActive !== '') {
      where.isActive = isActive === 'true'
    }

    // Получаем борды с пагинацией
    const [boards, total] = await Promise.all([
      prisma.board.findMany({
        where,
        include: {
          _count: {
            select: {
              threads: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: offset
      }),
      prisma.board.count({ where })
    ])

    // Преобразуем данные в формат, который ожидает фронтенд
    const transformedBoards = boards.map(board => ({
      id: board.id,
      name: board.title, // title как name (полное название)
      title: board.title,
      description: board.description,
      shortName: board.name, // name как shortName (короткое имя /b/, /g/)
      isActive: board.isActive,
      createdAt: board.createdAt,
      updatedAt: board.createdAt, // используем createdAt, так как updatedAt нет в схеме
      _count: {
        threads: board._count.threads
      }
    }))

    res.json({
      boards: transformedBoards,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    })
  } catch (error) {
    console.error('Get boards error:', error)
    res.status(500).json({ error: 'Failed to get boards' })
  }
}

// Создание нового борда
const createBoard = async (req, res) => {
  console.log('Creating board with data:', req.body);
  
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

    // Создаем новый борд (используем ту же логику что и в forum контроллере)
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

    // Возвращаем результат в том же формате что и forum API
    res.status(201).json({
      message: 'Board created successfully',
      board: {      id: board.id,
      name: board.name, // короткое имя (/b/, /g/)
      title: board.title,
      description: board.description,
      shortName: board.name, // для совместимости с фронтендом
      isActive: board.isActive,
      createdAt: board.createdAt.toISOString(),
      updatedAt: board.createdAt.toISOString(), // используем createdAt, так как updatedAt нет в схеме
      _count: {
        threads: 0
      }
      }
    });
  } catch (error) {
    console.error('Create board error:', error);
    console.error('Error details:', {
      code: error.code,
      message: error.message,
      meta: error.meta
    });
    
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Board with this name already exists' });
    }
    res.status(500).json({ error: 'Failed to create board' })
  }
}

// Обновление борда
const updateBoard = async (req, res) => {
  try {
    const { boardId } = req.params
    const {
      title,
      description,
      category,
      allowedFileTypes,
      maxFileSize,
      bumpLimit,
      threadLimit,
      isActive
    } = req.body

    const board = await prisma.board.update({
      where: { id: boardId },
      data: {
        title,
        description,
        category,
        allowedFileTypes,
        maxFileSize: parseInt(maxFileSize),
        bumpLimit: parseInt(bumpLimit),
        threadLimit: parseInt(threadLimit),
        isActive: Boolean(isActive)
      }
    })

    res.json(board)
  } catch (error) {
    console.error('Update board error:', error)
    res.status(500).json({ error: 'Failed to update board' })
  }
}

// Удаление борда
const deleteBoard = async (req, res) => {
  try {
    const { boardId } = req.params

    // Получаем все треды борда для удаления медиафайлов
    const threads = await prisma.thread.findMany({
      where: { boardId },
      include: {
        mediaFiles: true,
        replies: {
          include: {
            mediaFiles: true
          }
        }
      }
    })

    // Собираем все публичные ID медиафайлов для удаления из Cloudinary
    const publicIds = []
    threads.forEach(thread => {
      // Медиафайлы треда
      thread.mediaFiles.forEach(file => {
        if (file.publicId) publicIds.push(file.publicId)
      })
      
      // Медиафайлы ответов
      thread.replies.forEach(reply => {
        reply.mediaFiles.forEach(file => {
          if (file.publicId) publicIds.push(file.publicId)
        })
      })

      // Старые поля для обратной совместимости
      if (thread.imagePublicId) publicIds.push(thread.imagePublicId)
      thread.replies.forEach(reply => {
        if (reply.imagePublicId) publicIds.push(reply.imagePublicId)
      })
    })

    // Удаляем медиафайлы из Cloudinary
    if (publicIds.length > 0) {
      await deleteMultipleForumMedia(publicIds)
    }

    // Удаляем борд (каскадно удалятся все связанные данные)
    await prisma.board.delete({
      where: { id: boardId }
    })

    res.json({ message: 'Board deleted successfully' })
  } catch (error) {
    console.error('Delete board error:', error)
    res.status(500).json({ error: 'Failed to delete board' })
  }
}

// Получение тредов с фильтрацией
const getThreads = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const boardId = req.query.boardId || ''
    const search = req.query.search || ''
    const sortBy = req.query.sortBy || 'createdAt'
    const sortOrder = req.query.sortOrder || 'desc'

    const where = {}
    
    if (boardId) {
      where.boardId = boardId
    }
    
    if (search) {
      where.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
        { authorName: { contains: search, mode: 'insensitive' } }
      ]
    }

    const [threads, totalCount] = await Promise.all([
      prisma.thread.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          board: {
            select: { name: true, title: true }
          },
          _count: {
            select: { replies: true, mediaFiles: true }
          }
        }
      }),
      prisma.thread.count({ where })
    ])

    res.json({
      threads,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    })
  } catch (error) {
    console.error('Get threads error:', error)
    res.status(500).json({ error: 'Failed to get threads' })
  }
}

// Удаление треда
const deleteThread = async (req, res) => {
  try {
    const { threadId } = req.params

    // Получаем тред с медиафайлами
    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
      include: {
        mediaFiles: true,
        replies: {
          include: {
            mediaFiles: true
          }
        }
      }
    })

    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' })
    }

    // Собираем публичные ID для удаления из Cloudinary
    const publicIds = []
    
    // Медиафайлы треда
    thread.mediaFiles.forEach(file => {
      if (file.publicId) publicIds.push(file.publicId)
    })
    
    // Медиафайлы ответов
    thread.replies.forEach(reply => {
      reply.mediaFiles.forEach(file => {
        if (file.publicId) publicIds.push(file.publicId)
      })
    })

    // Старые поля для обратной совместимости
    if (thread.imagePublicId) publicIds.push(thread.imagePublicId)
    thread.replies.forEach(reply => {
      if (reply.imagePublicId) publicIds.push(reply.imagePublicId)
    })

    // Удаляем медиафайлы из Cloudinary
    if (publicIds.length > 0) {
      await deleteMultipleForumMedia(publicIds)
    }

    // Удаляем тред
    await prisma.thread.delete({
      where: { id: threadId }
    })

    res.json({ message: 'Thread deleted successfully' })
  } catch (error) {
    console.error('Delete thread error:', error)
    res.status(500).json({ error: 'Failed to delete thread' })
  }
}

// Получение ответов с фильтрацией
const getReplies = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 50
    const threadId = req.query.threadId || ''
    const search = req.query.search || ''
    const sortBy = req.query.sortBy || 'createdAt'
    const sortOrder = req.query.sortOrder || 'desc'

    const where = {}
    
    if (threadId) {
      where.threadId = threadId
    }
    
    if (search) {
      where.OR = [
        { content: { contains: search, mode: 'insensitive' } },
        { authorName: { contains: search, mode: 'insensitive' } }
      ]
    }

    const [replies, totalCount] = await Promise.all([
      prisma.reply.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          thread: {
            select: { 
              id: true, 
              shortId: true, 
              subject: true,
              board: {
                select: { name: true, title: true }
              }
            }
          },
          _count: {
            select: { mediaFiles: true }
          }
        }
      }),
      prisma.reply.count({ where })
    ])

    res.json({
      replies,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    })
  } catch (error) {
    console.error('Get replies error:', error)
    res.status(500).json({ error: 'Failed to get replies' })
  }
}

// Удаление ответа
const deleteReply = async (req, res) => {
  try {
    const { replyId } = req.params

    // Получаем ответ с медиафайлами
    const reply = await prisma.reply.findUnique({
      where: { id: replyId },
      include: {
        mediaFiles: true
      }
    })

    if (!reply) {
      return res.status(404).json({ error: 'Reply not found' })
    }

    // Собираем публичные ID для удаления из Cloudinary
    const publicIds = []
    
    reply.mediaFiles.forEach(file => {
      if (file.publicId) publicIds.push(file.publicId)
    })

    // Старые поля для обратной совместимости
    if (reply.imagePublicId) publicIds.push(reply.imagePublicId)

    // Удаляем медиафайлы из Cloudinary
    if (publicIds.length > 0) {
      await deleteMultipleForumMedia(publicIds)
    }

    // Удаляем ответ
    await prisma.reply.delete({
      where: { id: replyId }
    })

    res.json({ message: 'Reply deleted successfully' })
  } catch (error) {
    console.error('Delete reply error:', error)
    res.status(500).json({ error: 'Failed to delete reply' })
  }
}

// Получение медиафайлов
const getMediaFiles = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 30
    const type = req.query.type || ''
    const sortBy = req.query.sortBy || 'createdAt'
    const sortOrder = req.query.sortOrder || 'desc'

    const where = {}
    
    if (type && type !== 'all') {
      where.type = type
    }

    const [mediaFiles, totalCount] = await Promise.all([
      prisma.mediaFile.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          thread: {
            select: { 
              id: true, 
              shortId: true, 
              subject: true,
              board: {
                select: { name: true, title: true }
              }
            }
          }
        }
      }),
      prisma.mediaFile.count({ where })
    ])

    res.json({
      mediaFiles,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    })
  } catch (error) {
    console.error('Get media files error:', error)
    res.status(500).json({ error: 'Failed to get media files' })
  }
}

// Обновление пользователя (полное)
const updateUser = async (req, res) => {
  try {
    const { userId } = req.params
    const { username, email, role, isActive, password } = req.body

    // Подготавливаем данные для обновления
    const updateData = {}
    
    if (username !== undefined) updateData.name = username
    if (email !== undefined) updateData.email = email
    if (role !== undefined) {
      if (!['user', 'moderator', 'admin'].includes(role.toLowerCase())) {
        return res.status(400).json({ error: 'Invalid role' })
      }
      updateData.role = role.toLowerCase()
    }
    if (isActive !== undefined) updateData.isActive = isActive
    
    // Если передан пароль, хешируем его
    if (password && password.trim() !== '') {
      const bcrypt = require('bcryptjs')
      updateData.password = await bcrypt.hash(password, 10)
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            post: true,
            comments: true
          }
        }
      }
    })

    // Преобразуем данные в формат, который ожидает фронтенд
    const responseUser = {
      id: user.id,
      username: user.name,
      email: user.email,
      role: user.role.toUpperCase(),
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      _count: {
        posts: user._count.post,
        replies: user._count.comments
      }
    }

    res.json(responseUser)
  } catch (error) {
    console.error('Update user error:', error)
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Email or username already exists' })
    }
    res.status(500).json({ error: 'Failed to update user' })
  }
}

// Удаление пользователя
const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params

    // Проверяем, что пользователь не удаляет себя
    if (req.user.userId === userId) {
      return res.status(400).json({ error: 'Cannot delete yourself' })
    }

    // Удаляем связанные данные сначала
    await prisma.$transaction(async (tx) => {
      // Удаляем посты пользователя
      await tx.post.deleteMany({
        where: { userId }
      })
      
      // Удаляем комментарии пользователя
      await tx.comment.deleteMany({
        where: { userId }
      })
      
      // Удаляем лайки пользователя
      await tx.like.deleteMany({
        where: { userId }
      })
      
      // Удаляем подписки пользователя
      await tx.follows.deleteMany({
        where: { 
          OR: [
            { followerId: userId },
            { followingId: userId }
          ]
        }
      })
      
      // Удаляем самого пользователя
      await tx.user.delete({
        where: { id: userId }
      })
    })

    res.json({ message: 'User deleted successfully' })
  } catch (error) {
    console.error('Delete user error:', error)
    res.status(500).json({ error: 'Failed to delete user' })
  }
}

module.exports = {
  getStats,
  getUsers,
  updateUserRole,
  toggleUserStatus,
  getBoards,
  createBoard,
  updateBoard,
  deleteBoard,
  getThreads,
  deleteThread,
  getReplies,
  deleteReply,
  getMediaFiles,
  updateUser,
  deleteUser
}
