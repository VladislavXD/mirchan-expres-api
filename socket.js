const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { prisma } = require('./prisma/prisma-client');

class SocketManager {
  constructor() {
    this.io = null;
    this.userSockets = new Map(); // userId -> socketId
    this.socketUsers = new Map(); // socketId -> userId
  }

  init(server) {
    this.io = new Server(server, {
      cors: {
        origin: [
          'http://localhost:3000',
          'http://localhost:5173',
          'https://mirchan.netlify.app',
					'https://mirchan-express-api.vercel.app'
        ],
        credentials: true,
        methods: ['GET', 'POST']
      }
    });

    // Middleware для аутентификации
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication error'));
        }

        const decoded = jwt.verify(token, process.env.SECRET_KEY);
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, name: true, email: true, avatarUrl: true }
        });

        if (!user) {
          return next(new Error('User not found'));
        }

        socket.userId = user.id;
        socket.user = user;
        next();
      } catch (error) {
        console.error('Socket authentication error:', error);
        next(new Error('Authentication error'));
      }
    });

    this.io.on('connection', (socket) => {
      console.log(`User ${socket.user.name} connected:`, socket.id);
      
      // Обновляем время последней активности
      this.updateUserLastSeen(socket.userId);
      
      // Сохраняем соединение пользователя
      this.userSockets.set(socket.userId, socket.id);
      this.socketUsers.set(socket.id, socket.userId);

      // Присоединение к комнатам пользователя (его чаты)
      this.joinUserChats(socket);

      // Уведомляем всех участников чатов о том, что пользователь онлайн
      this.notifyUserStatusChange(socket.userId, true);

      // Обработчики событий
      socket.on('join_chat', (data) => this.handleJoinChat(socket, data));
      socket.on('send_message', (data) => this.handleSendMessage(socket, data));
      socket.on('mark_as_read', (data) => this.handleMarkAsRead(socket, data));
      socket.on('typing_start', (data) => this.handleTypingStart(socket, data));
      socket.on('typing_stop', (data) => this.handleTypingStop(socket, data));

      socket.on('disconnect', () => {
        console.log(`User ${socket.user.name} disconnected:`, socket.id);
        
        // Обновляем время последней активности при отключении
        this.updateUserLastSeen(socket.userId);
        
        // Уведомляем всех участников чатов о том, что пользователь офлайн
        this.notifyUserStatusChange(socket.userId, false);
        
        this.userSockets.delete(socket.userId);
        this.socketUsers.delete(socket.id);
      });
    });

    return this.io;
  }

  async joinUserChats(socket) {
    try {
      // Находим все чаты пользователя
      const userChats = await prisma.chat.findMany({
        where: {
          participants: {
            has: socket.userId
          }
        },
        select: { id: true }
      });

      // Присоединяем к комнатам чатов
      userChats.forEach(chat => {
        socket.join(`chat_${chat.id}`);
      });

      console.log(`User ${socket.user.name} joined ${userChats.length} chats`);
    } catch (error) {
      console.error('Error joining user chats:', error);
    }
  }

  async handleJoinChat(socket, data) {
    try {
      const { chatId } = data;
      
      // Проверяем, что пользователь участник чата
      const chat = await prisma.chat.findFirst({
        where: {
          id: chatId,
          participants: {
            has: socket.userId
          }
        }
      });

      if (!chat) {
        socket.emit('error', { message: 'Chat not found or access denied' });
        return;
      }

      socket.join(`chat_${chatId}`);
      socket.emit('joined_chat', { chatId });
      
      console.log(`User ${socket.user.name} joined chat ${chatId}`);
    } catch (error) {
      console.error('Error joining chat:', error);
      socket.emit('error', { message: 'Failed to join chat' });
    }
  }

  async handleSendMessage(socket, data) {
    try {
      const { chatId, content } = data;

      // Асинхронно обновляем время последней активности пользователя
      this.updateUserLastSeen(socket.userId);

      // Проверяем доступ к чату и создаем сообщение параллельно
      const chatPromise = prisma.chat.findFirst({
        where: {
          id: chatId,
          participants: {
            has: socket.userId
          }
        }
      });

      const messagePromise = prisma.message.create({
        data: {
          content,
          senderId: socket.userId,
          chatId
        }
      });

      const [chat, message] = await Promise.all([chatPromise, messagePromise]);

      if (!chat) {
        socket.emit('error', { message: 'Chat not found or access denied' });
        return;
      }

      // Создаем сообщение для отправки
      const messageWithSender = {
        ...message,
        createdAt: message.createdAt.toISOString(),
        sender: socket.user
      };

      // Сразу отправляем сообщение всем участникам чата
      this.io.to(`chat_${chatId}`).emit('new_message', messageWithSender);

      // Асинхронно обновляем последнее сообщение в чате (не ждем завершения)
      prisma.chat.update({
        where: { id: chatId },
        data: {
          lastMessage: content,
          lastMessageAt: new Date()
        }
      }).catch(error => console.error('Error updating chat last message:', error));

      console.log(`Message sent in chat ${chatId} by ${socket.user.name}`);
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  }

  async handleMarkAsRead(socket, data) {
    try {
      const { messageIds } = data;

      await prisma.message.updateMany({
        where: {
          id: { in: messageIds },
          senderId: { not: socket.userId } // Не отмечаем свои сообщения как прочитанные
        },
        data: {
          isRead: true
        }
      });

      // Уведомляем отправителей о прочтении
      for (const messageId of messageIds) {
        const message = await prisma.message.findUnique({
          where: { id: messageId },
          select: { senderId: true, chatId: true }
        });

        if (message && message.senderId !== socket.userId) {
          const senderSocketId = this.userSockets.get(message.senderId);
          if (senderSocketId) {
            this.io.to(senderSocketId).emit('message_read', {
              messageId,
              readBy: socket.userId,
              chatId: message.chatId
            });
          }
        }
      }

      console.log(`Messages marked as read by ${socket.user.name}`);
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  }

  handleTypingStart(socket, data) {
    const { chatId } = data;
    socket.to(`chat_${chatId}`).emit('user_typing_start', {
      userId: socket.userId,
      userName: socket.user.name,
      chatId
    });
  }

  handleTypingStop(socket, data) {
    const { chatId } = data;
    socket.to(`chat_${chatId}`).emit('user_typing_stop', {
      userId: socket.userId,
      chatId
    });
  }

  // Метод для отправки сообщения конкретному пользователю
  sendToUser(userId, event, data) {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
      return true;
    }
    return false;
  }

  // Метод для получения онлайн пользователей
  getOnlineUsers() {
    return Array.from(this.userSockets.keys());
  }

  // Метод для проверки, онлайн ли пользователь
  isUserOnline(userId) {
    return this.userSockets.has(userId);
  }

  // Уведомление об изменении онлайн статуса пользователя
  async notifyUserStatusChange(userId, isOnline) {
    try {
      // Находим все чаты пользователя
      const userChats = await prisma.chat.findMany({
        where: {
          participants: {
            has: userId
          }
        },
        select: { id: true, participants: true }
      });

      // Уведомляем всех участников этих чатов об изменении статуса
      userChats.forEach(chat => {
        chat.participants.forEach(participantId => {
          if (participantId !== userId) {
            const participantSocketId = this.userSockets.get(participantId);
            if (participantSocketId) {
              this.io.to(participantSocketId).emit('user_status_change', {
                userId,
                isOnline,
                chatId: chat.id
              });
            }
          }
        });
      });
    } catch (error) {
      console.error('Error notifying user status change:', error);
    }
  }

  // Обновление времени последней активности пользователя
  async updateUserLastSeen(userId) {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { lastSeen: new Date() }
      });
    } catch (error) {
      console.error('Error updating user last seen:', error);
    }
  }
}

module.exports = new SocketManager();
