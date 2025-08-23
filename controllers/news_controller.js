const axios = require('axios');

// Кэш для новостей
let newsCache = {
  headlines: null,
  headlinesTime: null,
  search: new Map()
};

const CACHE_DURATION = 30 * 60 * 1000; // 30 минут
const API_KEY = 'c3aee40fa7bd44689311929ecb336252';

const NewsController = {
  // Получение топ новостей
  getHeadlines: async (req, res) => {
    try {
      const { lang = 'ru', category = 'technology' } = req.query;
      const cacheKey = `${lang}-${category}`;

      // Проверяем кэш
      if (newsCache.headlines && 
          newsCache.headlinesTime && 
          Date.now() - newsCache.headlinesTime < CACHE_DURATION &&
          newsCache.headlines[cacheKey]) {
        console.log('Возвращаем новости из кэша');
        return res.json(newsCache.headlines[cacheKey]);
      }

      // Запрос к NewsAPI через backend
      console.log('Запрашиваем новости с NewsAPI...');
      const response = await axios.get('https://newsapi.org/v2/everything', {
        params: {
          language: lang,
          q: category,
          sortBy: 'publishedAt',
          pageSize: 10,
          apiKey: API_KEY
        },
        headers: {
          'User-Agent': 'MirChan/1.0'
        }
      });

      // Сохраняем в кэш
      if (!newsCache.headlines) {
        newsCache.headlines = {};
      }
      newsCache.headlines[cacheKey] = response.data;
      newsCache.headlinesTime = Date.now();

      res.json(response.data);
    } catch (error) {
      console.error('Ошибка при получении новостей:', error.message);
      
      // В случае ошибки возвращаем демо-новости
      const mockNews = {
        articles: [
          {
            author: "TechCrunch",
            content: "Искусственный интеллект продолжает развиваться невероятными темпами...",
            description: "Новые технологии ИИ меняют мир программирования и разработки.",
            publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            source: { id: "techcrunch", name: "TechCrunch" },
            title: "ИИ революционизирует разработку программного обеспечения",
            url: "https://techcrunch.com/ai-development",
            urlToImage: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=400&h=200&fit=crop"
          },
          {
            author: "Wired",
            content: "React 19 приносит долгожданные улучшения в производительности...",
            description: "React 19 и Next.js 15 приносят множество улучшений для разработчиков.",
            publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
            source: { id: "wired", name: "Wired" },
            title: "React 19: что нового для веб-разработчиков",
            url: "https://wired.com/react-19-features",
            urlToImage: "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=400&h=200&fit=crop"
          },
          {
            author: "TechNews",
            content: "Облачные технологии становятся всё более доступными для стартапов...",
            description: "Новые сервисы делают облачную разработку проще и дешевле.",
            publishedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
            source: { id: "technews", name: "TechNews" },
            title: "Облачные платформы 2025: обзор лучших решений",
            url: "https://technews.com/cloud-2025",
            urlToImage: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&h=200&fit=crop"
          },
          {
            author: "DevToday",
            content: "TypeScript 5.4 принес значительные улучшения в производительность...",
            description: "Статистика использования и новые фичи TypeScript 5.4.",
            publishedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
            source: { id: "devtoday", name: "DevToday" },
            title: "TypeScript 5.4: улучшения производительности и новый синтаксис",
            url: "https://devtoday.com/typescript-5-4",
            urlToImage: "https://images.unsplash.com/photo-1516116216624-53e697fedbea?w=400&h=200&fit=crop"
          },
          {
            author: "JavaScript Weekly",
            content: "React Native и Flutter продолжают конкуренцию за рынок мобильной разработки...",
            description: "Сравнение популярных фреймворков для мобильной разработки.",
            publishedAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
            source: { id: "jsweekly", name: "JavaScript Weekly" },
            title: "Мобильная разработка 2025: React Native vs Flutter",
            url: "https://jsweekly.com/mobile-development-2025",
            urlToImage: "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=400&h=200&fit=crop"
          }
        ],
        status: 'ok',
        totalResults: 5
      };

      res.json(mockNews);
    }
  },

  // Поиск новостей
  searchNews: async (req, res) => {
    try {
      const { q, pageSize = 5 } = req.query;
      
      if (!q) {
        return res.status(400).json({ error: 'Параметр q обязателен' });
      }

      const cacheKey = `search-${q}-${pageSize}`;
      
      // Проверяем кэш для поиска
      if (newsCache.search.has(cacheKey)) {
        const cached = newsCache.search.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_DURATION) {
          console.log('Возвращаем результаты поиска из кэша');
          return res.json(cached.data);
        }
      }

      // Запрос к NewsAPI
      const response = await axios.get('https://newsapi.org/v2/everything', {
        params: {
          q,
          language: 'ru',
          sortBy: 'publishedAt',
          pageSize: parseInt(pageSize),
          apiKey: API_KEY
        },
        headers: {
          'User-Agent': 'MirChan/1.0'
        }
      });

      // Сохраняем в кэш
      newsCache.search.set(cacheKey, {
        data: response.data,
        timestamp: Date.now()
      });

      res.json(response.data);
    } catch (error) {
      console.error('Ошибка при поиске новостей:', error.message);
      res.status(500).json({ 
        error: 'Ошибка при поиске новостей',
        articles: [],
        status: 'error',
        totalResults: 0
      });
    }
  }
};

module.exports = NewsController;
