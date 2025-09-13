const express = require('express');
const multer = require('multer');
const router = express.Router();

const {
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
  getBoardInfo,
  // оставляем только нужные обработчики
  createCategory,
  createTag,
  uploadCategoryImage,
  assignTagToThread,
  getCategories,
  getTags,
  getCategoryThreads,
  getThreadByCategoryAndSlug,
  getCategoryBySlug,
  createThreadInCategory,
  createReplyInCategory,
  getLatestPosts,
  getForumStats
} = require('../controllers/forum_controller');

// Настройка Multer для загрузки файлов в память (для прямой передачи в Cloudinary)
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/mov'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed'), false);
  }
};

const upload = multer({ 
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB максимум для одного файла
    files: 5 // Максимум 5 файлов за раз
  }
});

// Публичные роуты (без авторизации для анонимности)
router.get('/boards', getBoards);
router.get('/boards/:boardName', getBoardByName);
router.get('/boards/:boardName/threads', getThreads);
router.get('/boards/:boardName/full', getBoardThreads);
router.get('/boards/:boardName/info', getBoardInfo);
router.get('/boards/:boardName/threads/:threadId', getThread);

// Категории и теги
router.get('/categories', getCategories);
router.get('/categories/:slug', getCategoryBySlug);
router.get('/categories/:slug/threads', getCategoryThreads);
router.get('/categories/:categorySlug/threads/:threadSlug', getThreadByCategoryAndSlug);
router.get('/tags', getTags);

// Фид последних постов (только OP тредов)
router.get('/posts/latest', getLatestPosts);

// Сводная статистика форума
router.get('/stats', getForumStats);

// Роуты для создания контента (тоже публичные для анонимности)
router.post('/boards/:boardName/threads', upload.array('images', 5), createThread);
router.post('/boards/:boardName/threads/:threadId/replies', upload.array('images', 5), createReply);
// Создание/ответы в рамках категорий
router.post('/categories/:slug/threads', upload.array('images', 5), createThreadInCategory);
router.post('/categories/:categorySlug/threads/:threadId/replies', upload.array('images', 5), createReplyInCategory);

// Административные роуты (потребуют авторизацию)
// TODO: Добавить middleware для проверки прав администратора
router.post('/boards', createBoard);
router.put('/boards/:boardName', updateBoard);
router.delete('/boards/:boardName', deactivateBoard);

// Загрузка изображений категорий
router.put('/categories/:slug/image', upload.single('image'), uploadCategoryImage);

// Управление категориями и тегами
router.post('/categories', upload.single('image'), createCategory);
router.post('/tags', upload.single('icon'), createTag);

// Назначение тегов (только у тредов)
router.post('/threads/:threadId/tags/:tagSlug', assignTagToThread);

// Роуты модерации (потребуют авторизацию и права модератора)  
// TODO: Добавить middleware для проверки прав модератора
router.delete('/boards/:boardName/threads/:threadId', deleteThread);
router.delete('/boards/:boardName/replies/:replyId', deleteReply);

module.exports = router;
