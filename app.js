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
app.use(cors())
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

// Создаем папку uploads только если она не существует (для локальной разработки)
try {
  if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'))
  }
} catch (error) {
  console.warn('Cannot create uploads directory on serverless environment')
}

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
