const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

async function createAdmin() {
  try {
    const email = 'vladislavdev@gmail.com'
    const password = 'VLAD12345'
    const name = 'Администратор'

    // Проверяем, существует ли уже админ
    const existingAdmin = await prisma.user.findUnique({
      where: { email }
    })

    if (existingAdmin) {
      console.log('Админ уже существует:', existingAdmin.email)
      
      // Обновляем роль, если нужно
      if (existingAdmin.role !== 'admin') {
        const updatedAdmin = await prisma.user.update({
          where: { id: existingAdmin.id },
          data: { role: 'admin' }
        })
        console.log('Роль обновлена на admin:', updatedAdmin.email)
      }
      return
    }

    // Хешируем пароль
    const hashedPassword = await bcrypt.hash(password, 10)

    // Создаем админа
    const admin = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'admin',
        isActive: true,
        provider: 'local',
        lastSeen: new Date()
      }
    })

    console.log('Админ создан успешно!')
    console.log('Email:', admin.email)
    console.log('Password:', password)
    console.log('Role:', admin.role)
    console.log('')
    console.log('Теперь вы можете войти в админ панель по адресу: /admin')
    
  } catch (error) {
    console.error('Ошибка создания админа:', error)
  } finally {
    await prisma.$disconnect()
  }
}

createAdmin()
