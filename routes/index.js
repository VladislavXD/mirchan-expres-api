// import UserController from '../controllers';
const UserController = require ('../controllers/user-controller.js')
const express = require('express');
const router = express.Router();
const multer = require('multer');
const authenticateTokent = require('../middleware/auth.js');
const PostController = require('../controllers/post_controller.js');
const CommentController = require('../controllers/commetn_controller.js');
const LikeController = require('../controllers/like_controller.js');
const FollowController = require('../controllers/follow_controller.js');
const ChatController = require('../controllers/chat_controller.js');

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
router.get('/user/:id', authenticateTokent, UserController.getUserById)
router.get('/current', authenticateTokent, UserController.currentUser)
router.put('/user/:id', authenticateTokent, uploads.single('avatar'), handleMulterError, UserController.updateUser)


// route posts
router.post('/posts', authenticateTokent, PostController.createPost)
router.get('/posts', authenticateTokent, PostController.GetAllPosts)
router.get('/posts/:id', authenticateTokent, PostController.GetPostById)
router.delete('/posts/:id', authenticateTokent, PostController.DeletePost)
router.delete('/posts/:id', authenticateTokent, PostController.GetPostByUserId)



// comment route
router.post('/comments', authenticateTokent, CommentController.createComment)
router.delete('/comments/:id', authenticateTokent, CommentController.deleteComment)




// like route
router.post('/likes', authenticateTokent, LikeController.likePost)
router.delete('/likes/:id', authenticateTokent, LikeController.unLikePost)


// follows route
router.post('/follow', authenticateTokent, FollowController.followUser)
router.delete('/follow/:id', authenticateTokent, FollowController.unfollowUser)

// Chat routes
router.get('/chats', authenticateTokent, ChatController.getUserChats)
router.get('/chats/:otherUserId', authenticateTokent, ChatController.getOrCreateChat)
router.get('/chats/:chatId/messages', authenticateTokent, ChatController.getChatMessages)
router.put('/chats/:chatId/read', authenticateTokent, ChatController.markMessagesAsRead)
router.delete('/chats/:chatId', authenticateTokent, ChatController.deleteChat)

module.exports = router
