// import UserController from '../controllers';
const UserController = require('../controllers/user-controller.js')
const express = require('express');
const router = express.Router();
const multer = require('multer');
const authenticateTokent = require('../middleware/auth.js');
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

// user route
router.post('/register', UserController.register)
router.post('/login', UserController.login)
router.get('/current', authenticateTokent, UserController.getCurrentUser)
router.get('/user/search', authenticateTokent, UserController.searchUsers)
router.get('/user/:id', authenticateTokent, UserController.getUserById)
router.put('/user/:id', authenticateTokent, uploads.single('avatar'), UserController.updateUser)


//post route
router.post('/posts', authenticateTokent, uploads.single('image'), PostController.createPost)
router.get('/posts', authenticateTokent, PostController.GetAllPosts)
router.get('/posts/:id', authenticateTokent, PostController.getPostById)
router.delete('/posts/:id', authenticateTokent, PostController.deletePost)
router.put('/posts/:id/view', authenticateTokent, PostController.addView)
router.get('/posts/:id/views', authenticateTokent, PostController.getViews)
router.post('/posts/views/batch', authenticateTokent, PostController.addViewsBatch)


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

// News routes
router.get('/news/headlines', NewsController.getHeadlines)
router.get('/news/search', NewsController.searchNews)

module.exports = router
