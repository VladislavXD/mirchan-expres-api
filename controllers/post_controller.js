const {prisma} = require('../prisma/prisma-client.js')
const { cloudinary } = require('../utils/cloudinary.js')


const PostController = {
    createPost: async (req, res) => {
        const {content, emojiUrls} = req.body;
        const authorId = req.user.userId;

        if(!content){
            return res.status(400).json({error: 'Все поля обязательны'})
        }

        try{
            let imageUrl = null;
            
            // Загружаем изображение на Cloudinary, если оно есть
            if (req.file) {
                try {
                    // Используем streamifier для загрузки из буфера
                    const streamifier = require('streamifier');
                    
                    const uploadResult = await new Promise((resolve, reject) => {
                        const stream = cloudinary.uploader.upload_stream(
                            {
                                folder: 'mirchanPost',
                                transformation: [
                                    { width: 800, height: 600, crop: 'limit' },
                                    { quality: 'auto:good' }
                                ]
                            },
                            (error, result) => {
                                if (error) reject(error);
                                else resolve(result);
                            }
                        );
                        streamifier.createReadStream(req.file.buffer).pipe(stream);
                    });
                    
                    imageUrl = uploadResult.secure_url;
                } catch (uploadError) {
                    console.error('Cloudinary upload error:', uploadError);
                    return res.status(500).json({error: 'Ошибка загрузки изображения'});
                }
            }

            // Парсим emojiUrls если пришли как строка
            let parsedEmojiUrls = [];
            if (emojiUrls) {
                try {
                    parsedEmojiUrls = typeof emojiUrls === 'string' ? JSON.parse(emojiUrls) : emojiUrls;
                } catch (error) {
                    console.error('Error parsing emojiUrls:', error);
                    parsedEmojiUrls = [];
                }
            }

            const post = await prisma.post.create({
                data: {
                    content, 
                    authorId,
                    imageUrl,
                    emojiUrls: parsedEmojiUrls
                },
                include: {
                    author: {
                        include: {
                            followers: true,
                            following: true
                        }
                    },
                    likes: true,
                    comments: true
                }
            })

            res.json(post)
        }catch(err){
            console.log("Create post error", err);
            res.status(500).json({error: 'Internal server error'})

        }
    },
    GetAllPosts: async (req, res) => {
        const userId = req.user.userId;

        try{
            const posts = await prisma.post.findMany({
                include: {
                    likes: true,
                    author: {
                        include: {
                            followers: true,
                            following: true
                        }
                    },
                    comments: true
                },
                orderBy: {
                    createdAt: 'desc'
                }
            })
            const postWithLikeInfo = posts.map(post => ({
                ...post,
                likeByUser: post.likes.some(like => like.userId === userId)
            }))

            res.json(postWithLikeInfo);

        }catch(err){
            console.log('getallPosts error', err);
            res.status(500).json({error: "Internal server error"})
        }
    },
    GetPostById: async (req, res) => {
        const {id} = req.params;
        const userId = req.user.userId;

        try{
            const post = await prisma.post.findUnique({
                where: {id},
                include: {
                    comments: {
                        include: {
                            user: true
                        },
                    },
                    likes: true,
                    author: {
                        include: {
                            followers: true,
                            following: true
                        }
                    }
                }
                
            })
            if (!post){
                return res.status(404).json({error: "Пост не найден"})
            }

            const postWithLikeInfo = {
                ...post,
                likeByUser: post.likes.some(like => like.userId === userId)
            }
            res.json(postWithLikeInfo)
        }
        catch(err){
            console.log('get post by id error', err);
            res.status(500).json({error: "Internal server error"})
        }
    },
    GetPostByUserId: async (req, res) => {
        const { userId } = req.params;
    
        try {
          const posts = await prisma.post.findMany({
            where: {
              authorId: userId,
            },
            include: {
              likes: true,
              author: {
                include: {
                  followers: true,
                  following: true
                }
              },
              comments: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          })
          res.json(posts)
        }catch(err){
            console.log('error from GetPostByUserId', err);
            res.status(500).json({error: 'Internal server error'})
        }
    },

    DeletePost: async (req, res) => {
        const { id } = req.params;
        
        const post = await prisma.post.findUnique({where: {id}})

        if (!post){
            return res.status(404).json({error: 'Пост не найден'})
        }

        if (post.authorId !== req.user.userId){
            return res.status(403).json({error: 'Нет доступа'})
        }

        try{
            // Удаляем изображение из Cloudinary, если оно есть
            if (post.imageUrl) {
                const { getPublicIdFromUrl, deleteFromCloudinary } = require('../utils/cloudinary.js');
                const publicId = getPublicIdFromUrl(post.imageUrl);
                if (publicId) {
                    await deleteFromCloudinary(publicId);
                }
            }

            const transaction = await prisma.$transaction([
                prisma.comment.deleteMany({where: {postId: id}}),
                prisma.like.deleteMany({where: {postId: id}}),
                prisma.post.delete({where: {id}})

            ])
            res.json(transaction)
        }catch(err){
            console.log(("delete post error", err));
            res.status(500).json({error: "Internal server error"})
        }
    },
    addView: async (req, res) => {
        try {
            const { postId } = req.body;
            const userId = req.user.userId;

            if (!postId) {
                return res.status(400).json({ error: "ID поста обязателен" });
            }

            // Проверяем, существует ли пост
            const existingPost = await prisma.post.findUnique({
                where: { id: postId },
                select: { 
                    id: true,
                    views: true,
                    authorId: true 
                }
            });

            if (!existingPost) {
                return res.status(404).json({ error: "Пост не найден" });
            }

            // Если пользователь уже просматривал пост, не добавляем просмотр
            if (existingPost.views.includes(userId)) {
                return res.json({ 
                    message: "Просмотр уже учтен",
                    viewsCount: existingPost.views.length 
                });
            }

            // Добавляем просмотр (но не от автора поста к своему посту)
            let updatedPost;
            if (existingPost.authorId !== userId) {
                updatedPost = await prisma.post.update({
                    where: { id: postId },
                    data: {
                        views: {
                            push: userId
                        }
                    },
                    select: {
                        id: true,
                        views: true
                    }
                });

                res.json({ 
                    message: "Просмотр добавлен",
                    viewsCount: updatedPost.views.length 
                });
            } else {
                // Автор не может добавить просмотр к своему посту
                res.json({ 
                    message: "Автор не может просматривать свой пост",
                    viewsCount: existingPost.views.length 
                });
            }
        } catch (error) {
            console.error("Error adding view:", error);
            res.status(500).json({ error: "Ошибка при добавлении просмотра" });
        }
    },

    // Новый метод для батчинга просмотров
    addViewsBatch: async (req, res) => {
        try {
            const { postIds } = req.body;
            const userId = req.user.userId;

            console.log('Получен батч просмотров:', { postIds, userId });

            if (!Array.isArray(postIds) || postIds.length === 0) {
                return res.status(400).json({ error: "Массив ID постов обязателен" });
            }

            // Ограничиваем размер батча
            if (postIds.length > 20) {
                return res.status(400).json({ error: "Слишком много постов в батче (максимум 20)" });
            }

            // Получаем все посты, которые существуют и не принадлежат автору
            const allPosts = await prisma.post.findMany({
                where: {
                    id: { in: postIds },
                    authorId: { not: userId } // Исключаем посты автора
                },
                select: { 
                    id: true,
                    views: true
                }
            });

            // Фильтруем посты, которые еще не просматривались пользователем
            const posts = allPosts.filter(post => !post.views.includes(userId));

            console.log('Найдено постов для просмотра:', posts.length);

            if (posts.length === 0) {
                return res.json({ 
                    message: "Нет новых постов для просмотра",
                    processedCount: 0 
                });
            }

            // Массово обновляем просмотры
            const updatePromises = posts.map(post => 
                prisma.post.update({
                    where: { id: post.id },
                    data: {
                        views: {
                            push: userId
                        }
                    }
                })
            );

            await Promise.all(updatePromises);

            console.log('Успешно обновлено просмотров:', posts.length);

            res.json({ 
                message: `Добавлено просмотров: ${posts.length}`,
                processedCount: posts.length,
                postIds: posts.map(p => p.id)
            });

        } catch (error) {
            console.error("Error adding views batch:", error);
            
            // Детальное логирование ошибки
            if (error.name === 'PrismaClientValidationError') {
                console.error("Prisma validation error:", error.message);
                return res.status(400).json({ error: "Ошибка валидации данных" });
            }
            
            if (error.name === 'PrismaClientKnownRequestError') {
                console.error("Prisma known request error:", error.code, error.message);
                return res.status(400).json({ error: "Ошибка базы данных" });
            }
            
            res.status(500).json({ error: "Ошибка при добавлении просмотров" });
        }
    },
}


module.exports = PostController