const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const fs = require('fs')
const indexRouter = require('./routes/index');
const cors = require('cors')
require('dotenv').config()

const app = express();

// view engine setup
// app.set('views', path.join(__dirname, 'views'));

// Настройка CORS для работы с фронтендом
const corsOptions = {
  origin: function (origin, callback) {
    // Разрешаем запросы без origin (мобильные приложения, Postman)
    if (!origin) return callback(null, true);
    
    // Список разрешенных доменов
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'https://mirchan.netlify.app',
      'https://mirchan-expres-api.onrender.com'

    ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
  preflightContinue: false,
  optionsSuccessStatus: 200 // для поддержки старых браузеров
};

// Применяем CORS ко всем маршрутам
app.use(cors());

// Явная обработка preflight OPTIONS запросов
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS,PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.header('Access-Control-Allow-Credentials', true);
  res.sendStatus(200);
});

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
// app.use(express.static(path.join(__dirname, 'public')));
// Не используем view engine, так как это API сервер
// app.set('view engine', 'pug');
// Статические файлы теперь хранятся в Cloudinary
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

app.use('/api', indexRouter);

// Простой тестовый маршрут для проверки работы на Vercel
app.get('/', (req, res) => {
  res.json({ message: 'API работает на Vercel!', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Health check passed' });
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  // Возвращаем JSON ответ для 404 ошибок
  res.status(404).json({
    error: {
      message: 'Not Found',
      status: 404,
      path: req.originalUrl
    }
  });
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // return JSON error response instead of rendering a view
  res.status(err.status || 500);
  res.json({
    error: req.app.get('env') === 'development' ? {
      message: err.message,
      stack: err.stack
    } : {
      message: 'Internal server error'
    }
  });
});

module.exports = app
