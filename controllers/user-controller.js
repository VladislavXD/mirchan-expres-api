const { prisma } = require("../prisma/prisma-client");
const bcrypt = require("bcryptjs");
const Jdenticon = require("jdenticon");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const { error } = require("console");
const { cloudinary, getPublicIdFromUrl, deleteFromCloudinary } = require("../utils/cloudinary");
const streamifier = require("streamifier");

async function uploadBufferToCloudinary(
  buffer,
  filename,
  folder = "mirchanAvatars"
) {
  const { cloudinary } = require("../utils/cloudinary");
  
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder, // папка, куда сохраняется файл
        public_id: filename,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

const UserController = {
  register: async (req, res) => {
    const { name, password, email } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ erro: "Заполните все поля" });
    }

    try {
      const userExists = await prisma.user.findUnique({ where: { email } });

      if (userExists) {
        return res
          .status(400)
          .json({ error: "Данный пользователь существует" });
      }

      const passHash = await bcrypt.hash(password, 10);

      const avatarName = `${name}_${Date.now()}`;
      const png = Jdenticon.toPng(avatarName, 200);

      const uploadResult = await uploadBufferToCloudinary(png, avatarName);

      const user = await prisma.user.create({
        data: {
          email,
          password: passHash,
          name,
          avatarUrl: uploadResult.secure_url, // URL загруженного изображения
        },
      });

      res.json(user);
    } catch (err) {
      console.log("Something went Errror in register ", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },

  login: async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ error: "Заполните все поля" });
    }

    try {
      // проверка почты
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return res.status(400).json({ error: "Неверный логин или пароль" });
      }

      // проверка пароля
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(400).json({ error: "Неверный логин или пароль" });
      }

      // jwt token
      const token = jwt.sign({ userId: user.id }, process.env.SECRET_KEY);

      res.json({ token });
    } catch (err) {
      console.log("Login Error", err);

      res.status(500).json({ error: "Internal server error" });
    }
  },
  getUserById: async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    try {
      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          post: true,
          followers: {
            include: {
              follower: true,
            },
          },
          following: {
            include: {
              following: true,
            },
          },
        },
      });

      if (!user) {
        return res.status(400).json({ error: "Пользователь не найден" });
      }

      const isFolow = await prisma.follows.findFirst({
        where: {
          AND: [{ followerId: userId }, { followingId: id }],
        },
      });

      res.json({ ...user, isFolow: Boolean(isFolow) });
    } catch (err) {
      console.log("Get current error ", err);

      res.status(500).json({ error: "Internal server error" });
    }
  },
  updateUser: async (req, res) => {
    const { id } = req.params;
    const { email, name, dateOfBirth, bio, location } = req.body;

    if (id !== req.user.userId) {
      return res.status(403).json({ error: "Нет доступа" });
    }
    
    try {
      const existingUser = await prisma.user.findUnique({ where: { id } });

      if (!existingUser) {
        return res.status(404).json({ error: "Пользователь не найден" });
      }

      if (email) {
        const emailUser = await prisma.user.findFirst({ where: { email } });
        if (emailUser && emailUser.id !== id) {
          return res.status(400).json({ error: "Почта уже используется" });
        }
      }

      let newAvatarUrl = existingUser.avatarUrl; // Сохраняем текущий URL по умолчанию

      // Загрузка нового аватара, если есть файл
      if (req.file) {
        if (!req.file.buffer) {
          console.error('File buffer is missing! Check multer configuration.');
          return res.status(400).json({ error: "Ошибка загрузки файла" });
        }
        
        try {
          // 1. Удаляем старый аватар из Cloudinary (если он есть)
          if (existingUser.avatarUrl) {
            const publicId = getPublicIdFromUrl(existingUser.avatarUrl);
            console.log('Old avatar public_id:', publicId);
            
            if (publicId) {
              const deleteResult = await deleteFromCloudinary(publicId);
              console.log('Delete old avatar result:', deleteResult);
            }
          }

          // 2. Загружаем новый аватар
          const avatarName = `${name || existingUser.name}_${Date.now()}`;

          
          const uploadResult = await uploadBufferToCloudinary(
            req.file.buffer, 
            avatarName,
            "mirchanAvatars"
          );

          newAvatarUrl = uploadResult.secure_url;
          
        } catch (uploadError) {
          console.error('Error uploading new avatar:', uploadError);
          return res.status(500).json({ error: "Ошибка загрузки аватара" });
        }
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: {
          ...(email && { email }),
          ...(name && { name }),
          ...(newAvatarUrl !== existingUser.avatarUrl && { avatarUrl: newAvatarUrl }),
          ...(dateOfBirth && { dateOfBirth }),
          ...(bio && { bio }),
          ...(location && { location }),
        },
      });

      console.log('User updated successfully:', updatedUser.id);
      res.json(updatedUser);
    } catch (err) {
      console.error("error user update ", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },

  currentUser: async (req, res) => {
    try {
      const user = await prisma.user.findUnique({
        where: {
          id: req.user.userId,
        },
        include: {
          followers: {
            include: {
              follower: true,
            },
          },
          following: {
            include: {
              following: true,
            },
          },
        },
      });

      if (!user) {
        return res.status(400).json({ error: "Не удалось найти пользователя" });
      }
      res.json(user);
    } catch (err) {
      console.log("get cuttent error", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
};

module.exports = UserController;
