# Развертывание API на Vercel

## Подготовка к развертыванию

1. **Установка Vercel CLI** (если еще не установлена):
   ```bash
   npm i -g vercel
   ```

2. **Логин в Vercel**:
   ```bash
   vercel login
   ```

## Настройка переменных окружения

В Vercel Dashboard или через CLI нужно добавить следующие переменные окружения:

### Через Vercel Dashboard:
1. Зайдите на https://vercel.com/dashboard
2. Выберите ваш проект
3. Перейдите в Settings → Environment Variables
4. Добавьте переменные:
   - `DATABASE_URL` = `mongodb+srv://netify:netify12345@cluster1.26eym4o.mongodb.net/netify?retryWrites=true&w=majority&appName=CLUSTER1`
   - `SECRET_KEY` = `musiya`

### Через CLI:
```bash
vercel env add DATABASE_URL
# Введите значение: mongodb+srv://netify:netify12345@cluster1.26eym4o.mongodb.net/netify?retryWrites=true&w=majority&appName=CLUSTER1

vercel env add SECRET_KEY
# Введите значение: musiya
```

## Развертывание

1. **Убедитесь, что находитесь в папке express-api**:
   ```bash
   cd express-api
   ```

2. **Первое развертывание**:
   ```bash
   vercel
   ```
   
   Vercel задаст несколько вопросов:
   - Set up and deploy? → Y
   - Which scope? → выберите ваш аккаунт
   - Link to existing project? → N (для нового проекта)
   - What's your project's name? → введите имя (например, mirchan-api)
   - In which directory is your code located? → ./

3. **Последующие развертывания**:
   ```bash
   vercel --prod
   ```

## Важные замечания

### 1. Загрузка файлов
⚠️ **Vercel не поддерживает постоянное хранение файлов!**

Для изображений рекомендуется использовать:
- **Cloudinary** (рекомендуется)
- **AWS S3**
- **Vercel Blob**
- **Google Cloud Storage**

### 2. Socket.io
⚠️ Socket.io может работать нестабильно на Vercel из-за serverless архитектуры.

Альтернативы:
- Использовать **Vercel Edge Functions**
- Вынести Socket.io на отдельный сервер (например, Railway, Render)
- Использовать **Pusher** или **Ably** для real-time функций

### 3. База данных
✅ MongoDB Atlas отлично работает с Vercel.

## Структура проекта для Vercel

```
express-api/
├── index.js              # Точка входа для Vercel
├── app.js                # Основное Express приложение
├── vercel.json           # Конфигурация Vercel
├── .vercelignore         # Исключения из сборки
├── package.json          # Зависимости и скрипты
├── routes/               # Маршруты API
├── controllers/          # Контроллеры
├── middleware/           # Middleware
├── prisma/               # Схема базы данных
└── uploads/              # Локальная папка для файлов (не работает на Vercel)
```

## После развертывания

Ваш API будет доступен по адресу:
```
https://your-project-name.vercel.app/api/
```

Все маршруты будут работать с префиксом `/api/`:
- `POST /api/register`
- `POST /api/login`
- `GET /api/posts`
- и т.д.

## Отладка

1. **Просмотр логов**:
   ```bash
   vercel logs
   ```

2. **Локальная разработка с Vercel**:
   ```bash
   vercel dev
   ```

## Альтернативные платформы

Если возникают проблемы с Vercel, рассмотрите:
- **Railway** - хорошо подходит для Node.js приложений
- **Render** - поддерживает Socket.io и файловое хранилище
- **Heroku** - классический вариант для Express приложений
