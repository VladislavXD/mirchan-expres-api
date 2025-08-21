const multer = require('multer');
const path = require('path');

// Настройка Multer для загрузки файлов
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/') // Временное хранение перед загрузкой на Cloudinary
  },
  filename: function (req, file, cb) {
    // Генерируем уникальное имя файла
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Фильтр для проверки типа файла
const fileFilter = (req, file, cb) => {
  // Разрешенные типы изображений
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Недопустимый тип файла. Разрешены только изображения (JPEG, PNG, GIF, WebP)'), false);
  }
};

// Настройки Multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // Максимальный размер файла 5MB
  }
});

module.exports = {
  uploadSingle: upload.single('image'), // Для одного изображения
  uploadMultiple: upload.array('images', 5) // Для нескольких изображений (макс. 5)
};
