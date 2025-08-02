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
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://mirchan.netlify.app',
    'https://your-frontend-domain.com' // добавьте другие домены если нужно
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// Обработка preflight запросов
app.options('*', cors(corsOptions));

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
// app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'pug');
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
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app
