const jwt = require('jsonwebtoken')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    const token = authHeader && authHeader.split(' ')[1];

    if (!token){
        return res.status(401).json({error: 'Unauthorized'})
    }

    jwt.verify(token, process.env.SECRET_KEY, (err, user)=> {
        if (err){
            return res.status(403).json({error: 'Invalid token'})
        }

        req.user = user

      next();  
    })
}

// Middleware для проверки роли админа
const requireAdmin = async (req, res, next) => {
    try {
        if (!req.user || !req.user.userId) {
            return res.status(401).json({ error: 'Unauthorized' })
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user.userId }
        })

        if (!user || (user.role !== 'ADMIN' && user.role !== 'MODERATOR')) {
            return res.status(403).json({ error: 'Admin access required' })
        }

        req.adminUser = user
        next()
    } catch (error) {
        console.error('Admin check error:', error)
        res.status(500).json({ error: 'Server error' })
    }
}

// Middleware для проверки роли модератора или админа
const requireModerator = async (req, res, next) => {
    try {
        if (!req.user || !req.user.userId) {
            return res.status(401).json({ error: 'Unauthorized' })
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user.userId }
        })

        if (!user || (user.role !== 'ADMIN' && user.role !== 'MODERATOR')) {
            return res.status(403).json({ error: 'Moderator access required' })
        }

        req.modUser = user
        next()
    } catch (error) {
        console.error('Moderator check error:', error)
        res.status(500).json({ error: 'Server error' })
    }
}

module.exports = { 
    authenticateToken, 
    requireAdmin, 
    requireModerator 
}