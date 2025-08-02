const { prisma } = require('../prisma/prisma-client');
const socketManager = require('../socket');

// Получить список чатов пользователя
const getUserChats = async (req, res) => {
  try {
    const userId = req.user.userId;

    const chats = await prisma.chat.findMany({
      where: {
        participants: {
          has: userId
        }
      },
      include: {
        messages: {
          take: 1,
          orderBy: {
            createdAt: 'desc'
          }
        }
      },
      orderBy: {
        lastMessageAt: 'desc'
      }
    });

    // Получаем информацию о собеседниках
    const chatsWithParticipants = await Promise.all(
      chats.map(async (chat) => {
        // Находим собеседника (не текущего пользователя)
        const otherParticipantId = chat.participants.find(id => id !== userId);
        
        let otherParticipant = null;
        if (otherParticipantId) {
          otherParticipant = await prisma.user.findUnique({
            where: { id: otherParticipantId },
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
              bio: true,
              lastSeen: true
            }
          });
        }

        // Подсчитываем непрочитанные сообщения
        const unreadCount = await prisma.message.count({
          where: {
            chatId: chat.id,
            senderId: { not: userId },
            isRead: false
          }
        });

        return {
          ...chat,
          otherParticipant,
          unreadCount,
          isOnline: otherParticipant ? socketManager.isUserOnline(otherParticipant.id) : false
        };
      })
    );

    res.json(chatsWithParticipants);
  } catch (error) {
    console.error('Error getting user chats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Получить или создать чат с пользователем
const getOrCreateChat = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { otherUserId } = req.params;

    if (userId === otherUserId) {
      return res.status(400).json({ error: 'Cannot create chat with yourself' });
    }

    // Проверяем, существует ли пользователь
    const otherUser = await prisma.user.findUnique({
      where: { id: otherUserId },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        bio: true,
        lastSeen: true
      }
    });

    if (!otherUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Ищем существующий чат между пользователями
    let chat = await prisma.chat.findFirst({
      where: {
        AND: [
          { participants: { has: userId } },
          { participants: { has: otherUserId } }
        ]
      },
      include: {
        messages: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 50 // Последние 50 сообщений
        }
      }
    });

    // Если чат не существует, создаем новый
    if (!chat) {
      chat = await prisma.chat.create({
        data: {
          participants: [userId, otherUserId]
        },
        include: {
          messages: true
        }
      });
    }

    // Подсчитываем непрочитанные сообщения
    const unreadCount = await prisma.message.count({
      where: {
        chatId: chat.id,
        senderId: { not: userId },
        isRead: false
      }
    });

    // Получаем информацию об отправителях сообщений
    const messagesWithSenders = await Promise.all(
      chat.messages.map(async (message) => {
        const sender = await prisma.user.findUnique({
          where: { id: message.senderId },
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            bio: true
          }
        });
        return {
          ...message,
          sender
        };
      })
    );

    const chatWithDetails = {
      ...chat,
      messages: messagesWithSenders.reverse(), // Сортируем по возрастанию (старые сначала)
      otherParticipant: otherUser,
      unreadCount,
      isOnline: socketManager.isUserOnline(otherUser.id)
    };

    res.json(chatWithDetails);
  } catch (error) {
    console.error('Error getting or creating chat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Получить сообщения чата с пагинацией
const getChatMessages = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { chatId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Проверяем, что пользователь участник чата
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        participants: {
          has: userId
        }
      }
    });

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found or access denied' });
    }

    // Получаем сообщения с пагинацией
    const messages = await prisma.message.findMany({
      where: {
        chatId
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip,
      take: parseInt(limit)
    });

    // Получаем информацию об отправителях
    const messagesWithSenders = await Promise.all(
      messages.map(async (message) => {
        const sender = await prisma.user.findUnique({
          where: { id: message.senderId },
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            bio: true
          }
        });
        return {
          ...message,
          sender
        };
      })
    );

    // Возвращаем в правильном порядке (старые сначала)
    res.json({
      messages: messagesWithSenders.reverse(),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: messages.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error getting chat messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Отметить сообщения как прочитанные
const markMessagesAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { chatId } = req.params;

    // Проверяем, что пользователь участник чата
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        participants: {
          has: userId
        }
      }
    });

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found or access denied' });
    }

    // Отмечаем все непрочитанные сообщения как прочитанные
    const updatedMessages = await prisma.message.updateMany({
      where: {
        chatId,
        senderId: { not: userId },
        isRead: false
      },
      data: {
        isRead: true
      }
    });

    res.json({ 
      message: 'Messages marked as read',
      count: updatedMessages.count 
    });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Удалить чат
const deleteChat = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { chatId } = req.params;

    // Проверяем, что пользователь участник чата
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        participants: {
          has: userId
        }
      }
    });

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found or access denied' });
    }

    // Удаляем чат (сообщения удалятся автоматически благодаря onDelete: Cascade)
    await prisma.chat.delete({
      where: { id: chatId }
    });

    res.json({ message: 'Chat deleted successfully' });
  } catch (error) {
    console.error('Error deleting chat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getUserChats,
  getOrCreateChat,
  getChatMessages,
  markMessagesAsRead,
  deleteChat
};
