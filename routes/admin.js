const express = require('express')
const router = express.Router()
const { authenticateToken, requireAdmin, requireModerator } = require('../middleware/auth')
const {
  getStats,
  getUsers,
  updateUserRole,
  toggleUserStatus,
  updateUser,
  deleteUser,
  getBoards,
  createBoard,
  updateBoard,
  deleteBoard,
  getThreads,
  deleteThread,
  getReplies,
  deleteReply,
  getMediaFiles
} = require('../controllers/admin_controller')

// Применяем аутентификацию ко всем роутам
router.use(authenticateToken)

// Статистика (доступна модераторам и админам)
router.get('/stats', requireModerator, getStats)

// Управление пользователями (только админы)
router.get('/users', requireAdmin, getUsers)
router.put('/users/:userId', requireAdmin, updateUser)
router.delete('/users/:userId', requireAdmin, deleteUser)
router.put('/users/:userId/role', requireAdmin, updateUserRole)
router.patch('/users/:userId/status', requireAdmin, toggleUserStatus)

// Управление бордами (только админы)
router.get('/boards', requireAdmin, getBoards)
router.post('/boards', requireAdmin, createBoard)
router.put('/boards/:boardId', requireAdmin, updateBoard)
router.delete('/boards/:boardId', requireAdmin, deleteBoard)

// Управление тредами (модераторы и админы)
router.get('/threads', requireModerator, getThreads)
router.delete('/threads/:threadId', requireModerator, deleteThread)

// Управление ответами (модераторы и админы)
router.get('/replies', requireModerator, getReplies)
router.delete('/replies/:replyId', requireModerator, deleteReply)

// Управление медиафайлами (модераторы и админы)
router.get('/media', requireModerator, getMediaFiles)

module.exports = router
