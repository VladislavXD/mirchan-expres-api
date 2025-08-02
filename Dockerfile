# Импользуем образ линукс Alpine с версией node 14
FROM node:19.5.0-alpine

# Указываем нашу рабочую дерикторию 
WORKDIR /app

# Скопировать package json и package json lock внутрь контейнера
COPY package*.json ./

# Копируем Prisma schema до установки зависимостей
COPY prisma/ ./prisma/

# Устанавливаем зависимости
RUN npm install

# Копируем все остальное приложение
COPY . .

# Генерируем Prisma-client (теперь schema.prisma уже скопирован)
RUN npx prisma generate


# Открываем порт в нашем контейнере
EXPOSE 5000


# Запускаем сервер
CMD [ "npm", "start" ]

