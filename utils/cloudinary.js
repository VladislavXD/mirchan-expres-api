const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Проверим конфигурацию (только для отладки)
console.log('Cloudinary config:', {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME ? 'OK' : 'MISSING',
  api_key: process.env.CLOUDINARY_API_KEY ? 'OK' : 'MISSING',
  api_secret: process.env.CLOUDINARY_API_SECRET ? 'OK' : 'MISSING'
});


function getPublicIdFromUrl(url) {
  try {
    const parts = url.split('/');
    const fileWithExt = parts[parts.length - 1]; // Vladislav_1754133279143.png
    const folder = parts[parts.length - 2];      // mirchanAvatars
    const filename = fileWithExt.split('.')[0];  // Vladislav_1754133279143
    return `${folder}/${filename}`;              // mirchanAvatars/Vladislav_1754133279143
  } catch (e) {
    return null;
  }
}

// Функция для удаления файла из Cloudinary
async function deleteFromCloudinary(publicId) {
  if (!publicId) return false;
  
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    console.log('Cloudinary delete result:', result);
    return result.result === 'ok';
  } catch (error) {
    console.error('Error deleting from Cloudinary:', error);
    return false;
  }
}

module.exports = {
  cloudinary,
  getPublicIdFromUrl,
  deleteFromCloudinary
};