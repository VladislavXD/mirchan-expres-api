/**
 * Генерирует короткий уникальный ID для постов
 * Возвращает строку из 6 символов (буквы и цифры)
 */
function generateShortId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

module.exports = {
  generateShortId
}
