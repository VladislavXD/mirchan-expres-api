const cloudinary = require('cloudinary').v2;

// Конфигурация Cloudinary уже есть в cloudinary.js
// Используем существующую конфигурацию

/**
 * Загружает файл в Cloudinary в папку форума
 * @param {string} filePath - путь к файлу
 * @param {string} folder - подпапка (board name)
 * @param {object} options - дополнительные опции
 * @returns {Promise<object>} результат загрузки
 */
const uploadForumMedia = async (filePath, folder = 'general', options = {}) => {
  try {
    const uploadOptions = {
      folder: `mirchanForumMedia/${folder}`,
      resource_type: 'auto', // автоопределение типа файла
      public_id: undefined, // генерируется автоматически
      overwrite: false,
      transformation: [
        { quality: 'auto:good' }, // автооптимизация качества
        { fetch_format: 'auto' }  // автоматический формат
      ],
      ...options
    };

    // Если это изображение, создаем превью
    if (options.isImage) {
      uploadOptions.eager = [
        { 
          width: 250, 
          height: 250, 
          crop: 'limit',
          quality: 'auto:low',
          fetch_format: 'auto'
        }
      ];
    }

    const result = await cloudinary.uploader.upload(filePath, uploadOptions);
    
    return {
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
      thumbnailUrl: result.eager && result.eager[0] ? result.eager[0].secure_url : null,
      size: result.bytes,
      format: result.format,
      width: result.width,
      height: result.height
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Удаляет файл из Cloudinary
 * @param {string} publicId - public ID файла в Cloudinary
 * @param {string} resourceType - тип ресурса (image, video, raw)
 * @returns {Promise<object>} результат удаления
 */
const deleteForumMedia = async (publicId, resourceType = 'image') => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType
    });
    
    return {
      success: result.result === 'ok',
      result: result.result
    };
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Удаляет несколько файлов из Cloudinary
 * @param {string[]} publicIds - массив public ID файлов
 * @param {string} resourceType - тип ресурса
 * @returns {Promise<object>} результат удаления
 */
const deleteMultipleForumMedia = async (publicIds, resourceType = 'image') => {
  try {
    const result = await cloudinary.api.delete_resources(publicIds, {
      resource_type: resourceType
    });
    
    return {
      success: true,
      deleted: result.deleted,
      deletedCounts: result.deleted_counts
    };
  } catch (error) {
    console.error('Cloudinary bulk delete error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Удаляет всю папку форума из Cloudinary
 * @param {string} folderPath - путь к папке (например, mirchanForumMedia/b)
 * @returns {Promise<object>} результат удаления
 */
const deleteForumFolder = async (folderPath) => {
  try {
    // Получаем все файлы в папке
    const resources = await cloudinary.api.resources({
      type: 'upload',
      prefix: folderPath,
      max_results: 500
    });

    if (resources.resources.length === 0) {
      return { success: true, message: 'Folder is empty' };
    }

    // Удаляем все файлы
    const publicIds = resources.resources.map(resource => resource.public_id);
    const deleteResult = await deleteMultipleForumMedia(publicIds);

    // Удаляем саму папку
    await cloudinary.api.delete_folder(folderPath);

    return {
      success: true,
      deletedCount: publicIds.length,
      deleteResult
    };
  } catch (error) {
    console.error('Cloudinary folder delete error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Определяет тип файла по MIME type
 * @param {string} mimeType - MIME тип файла
 * @returns {object} информация о типе файла
 */
const getFileTypeInfo = (mimeType) => {
  const imageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  const videoTypes = ['video/mp4', 'video/webm', 'video/mov', 'video/avi'];
  
  if (imageTypes.includes(mimeType)) {
    return { type: 'image', isImage: true, resourceType: 'image' };
  } else if (videoTypes.includes(mimeType)) {
    return { type: 'video', isImage: false, resourceType: 'video' };
  } else {
    return { type: 'raw', isImage: false, resourceType: 'raw' };
  }
};

module.exports = {
  uploadForumMedia,
  deleteForumMedia,
  deleteMultipleForumMedia,
  deleteForumFolder,
  getFileTypeInfo
};
