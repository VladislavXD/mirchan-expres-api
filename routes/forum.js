const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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
  getBoardInfo
} = require('../controllers/forum_controller');

// Настройка Multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = 'uploads/forum';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

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
    fileSize: 10 * 1024 * 1024 // 10MB максимум
  }
});

// Публичные роуты (без авторизации для анонимности)
router.get('/boards', getBoards);
router.get('/boards/:boardName', getBoardByName);
router.get('/boards/:boardName/threads', getThreads);
router.get('/boards/:boardName/full', getBoardThreads);
router.get('/boards/:boardName/info', getBoardInfo);
router.get('/boards/:boardName/threads/:threadId', getThread);

// Роуты для создания контента (тоже публичные для анонимности)
router.post('/boards/:boardName/threads', upload.single('image'), createThread);
router.post('/boards/:boardName/threads/:threadId/replies', upload.single('image'), createReply);

// Административные роуты (потребуют авторизацию)
// TODO: Добавить middleware для проверки прав администратора
router.post('/boards', createBoard);
router.put('/boards/:boardName', updateBoard);
router.delete('/boards/:boardName', deactivateBoard);

// Роуты модерации (потребуют авторизацию и права модератора)  
// TODO: Добавить middleware для проверки прав модератора
router.delete('/boards/:boardName/threads/:threadId', deleteThread);
router.delete('/boards/:boardName/replies/:replyId', deleteReply);

module.exports = router;
