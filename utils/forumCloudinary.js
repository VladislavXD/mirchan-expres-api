const cloudinary = require('cloudinary').v2;

// Конфигурация Cloudinary уже есть в cloudinary.js
// Используем существующую конфигурацию

/**
 * Загружает файл в Cloudinary в папку форума
 * @param {string|Buffer} fileSource - путь к файлу или buffer
 * @param {string} folder - подпапка (board name)
 * @param {object} options - дополнительные опции
 * @returns {Promise<object>} результат загрузки
 */
const uploadForumMedia = async (fileSource, folder = 'general', options = {}) => {
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

    // Если передан buffer, используем upload_stream, иначе обычный upload
    let result;
    if (Buffer.isBuffer(fileSource)) {
      result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }).end(fileSource);
      });
    } else {
      result = await cloudinary.uploader.upload(fileSource, uploadOptions);
    }
    
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
 * Загружает множественные файлы в Cloudinary в папку форума
 * @param {Array<{buffer: Buffer, originalname: string, mimetype: string, size: number}>} files - массив файлов
 * @param {string} folder - подпапка (board name)
 * @returns {Promise<Array<object>>} результаты загрузки файлов
 */
const uploadMultipleForumMedia = async (files, folder = 'general') => {
  try {
    if (!files || !Array.isArray(files) || files.length === 0) {
      console.log('No files provided for upload');
      return [];
    }

    console.log(`Uploading ${files.length} files to folder: ${folder}`);

    const uploadPromises = files.map(async (file, index) => {
      try {
        const isImage = file.mimetype.startsWith('image/');
        const isVideo = file.mimetype.startsWith('video/');
        
        if (!isImage && !isVideo) {
          throw new Error(`Unsupported file type: ${file.mimetype}`);
        }

        console.log(`Processing file ${index + 1}: ${file.originalname} (${file.mimetype})`);

        const uploadOptions = {
          folder: `mirchanForumMedia/${folder}`,
          resource_type: isVideo ? 'video' : 'image',
          public_id: undefined,
          overwrite: false,
          transformation: [
            { quality: 'auto:good' },
            { fetch_format: 'auto' }
          ]
        };

        // Для изображений создаем превью
        if (isImage) {
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

        // Для видео создаем превью-картинку
        if (isVideo) {
          uploadOptions.eager = [
            { 
              width: 250, 
              height: 250, 
              crop: 'limit',
              quality: 'auto:low',
              resource_type: 'image' // превью как картинка
            }
          ];
        }

        const result = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
            if (error) {
              console.error(`Upload error for file ${file.originalname}:`, error);
              reject(error);
            } else {
              console.log(`Successfully uploaded: ${file.originalname}`);
              resolve(result);
            }
          }).end(file.buffer);
        });

        return {
          url: result.secure_url,
          publicId: result.public_id,
          name: file.originalname,
          size: file.size,
          type: isVideo ? 'video' : 'image',
          mimeType: file.mimetype,
          thumbnailUrl: result.eager && result.eager[0] ? result.eager[0].secure_url : null,
          width: result.width,
          height: result.height,
          duration: result.duration || null
        };
      } catch (fileError) {
        console.error(`Error processing file ${file.originalname}:`, fileError);
        throw fileError;
      }
    });

    const results = await Promise.all(uploadPromises);
    console.log(`Successfully uploaded ${results.length} files`);
    return results;
  } catch (error) {
    console.error('Error uploading multiple files to Cloudinary:', error);
    throw error;
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
  uploadMultipleForumMedia,
  deleteForumMedia,
  deleteMultipleForumMedia,
  deleteForumFolder,
  getFileTypeInfo
};
