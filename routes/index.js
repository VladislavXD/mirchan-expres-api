// import UserController from '../controllers';
const UserController = require ('../controllers/user-controller.js')
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth.js');
const PostController = require('../controllers/post_controller.js');
const CommentController = require('../controllers/commetn_controller.js');
const LikeController = require('../controllers/like_controller.js');
const FollowController = require('../controllers/follow_controller.js');
const ChatController = require('../controllers/chat_controller.js');
const NewsController = require('../controllers/news_controller.js');

// Конфигурация multer для сохранения файлов в память (для Cloudinary)
const storage = multer.memoryStorage();

const uploads = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB лимит
  },
  fileFilter: (req, file, cb) => {
    // Разрешаем только изображения
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Только изображения разрешены!'), false);
    }
  }
});

// Middleware для обработки ошибок multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Файл слишком большой (максимум 5MB)' });
    }
  }
  if (err.message === 'Только изображения разрешены!') {
    return res.status(400).json({ error: 'Разрешены только изображения' });
  }
  next(err);
};

/* GET user route. */
router.post('/register', UserController.register)
router.post('/login', UserController.login)
router.post('/auth/google-sync', UserController.googleSync) // Добавляем Google синхронизацию
router.get('/user/search', authenticateToken, UserController.searchUsers)
router.get('/user/:id', authenticateToken, UserController.getUserById)
router.get('/current', authenticateToken, UserController.currentUser)
router.put('/user/:id', authenticateToken, uploads.single('avatar'), handleMulterError, UserController.updateUser)


// route posts
router.post('/posts', authenticateToken, uploads.single('image'), handleMulterError, PostController.createPost)
router.get('/posts', authenticateToken, PostController.GetAllPosts)
router.get('/posts/:id', authenticateToken, PostController.GetPostById)
router.put('/posts/:id', authenticateToken, uploads.single('image'), handleMulterError, PostController.UpdatePost)
router.delete('/posts/:id', authenticateToken, PostController.DeletePost)
router.get('/posts/user/:userId', authenticateToken, PostController.GetPostByUserId)
router.post('/posts/view', authenticateToken, PostController.addView)
router.post('/posts/views/batch', authenticateToken, PostController.addViewsBatch)


// comment route
router.post('/comments', authenticateToken, CommentController.createComment)
router.delete('/comments/:id', authenticateToken, CommentController.deleteComment)




// like route
router.post('/likes', authenticateToken, LikeController.likePost)
router.delete('/likes/:id', authenticateToken, LikeController.unLikePost)


// follows route
router.post('/follow', authenticateToken, FollowController.followUser)
router.delete('/follow/:id', authenticateToken, FollowController.unfollowUser)

// Chat routes
router.get('/chats', authenticateToken, ChatController.getUserChats)
router.get('/chats/:otherUserId', authenticateToken, ChatController.getOrCreateChat)
router.get('/chats/:chatId/messages', authenticateToken, ChatController.getChatMessages)
router.put('/chats/:chatId/read', authenticateToken, ChatController.markMessagesAsRead)
router.delete('/chats/:chatId', authenticateToken, ChatController.deleteChat)

// News routes (без аутентификации для тестирования)
router.get('/news/headlines', NewsController.getHeadlines)
router.get('/news/search', NewsController.searchNews)

// Forum routes
const forumRoutes = require('./forum');
router.use('/forum', forumRoutes);

// Admin routes
const adminRoutes = require('./admin');
router.use('/admin', adminRoutes);

module.exports = router
