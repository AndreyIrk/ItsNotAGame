const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Настройка подключения к базе данных
const caPath = path.resolve(__dirname, 'certs', 'ca.pem'); // Путь к файлу ca.pem

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Отключаем проверку SSL (временно)
    // ca: fs.readFileSync(caPath).toString() // Раскомментируйте для использования корневого сертификата
  }
});

// Функция для проверки существования таблицы
async function tableExists(tableName) {
  try {
    const query = `
      SELECT EXISTS (
        SELECT FROM pg_catalog.pg_tables
        WHERE schemaname = 'public' AND tablename = $1
      );
    `;
    const result = await pool.query(query, [tableName]);
    return result.rows[0].exists;
  } catch (err) {
    console.error(`Ошибка при проверке существования таблицы "${tableName}":`, err.message);
    throw err;
  }
}

// Инициализация базы данных
async function initializeDatabase() {
  try {
    // Создание таблицы users
    const userTable = 'game_users';
    const userTableExists = await tableExists(userTable);
    if (!userTableExists) {
      console.log(`Таблица "${userTable}" не существует. Создание таблицы...`);
      const createUserTableQuery = `
        CREATE TABLE ${userTable} (
          id SERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL UNIQUE,
          photo_url VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await pool.query(createUserTableQuery);
      console.log(`Таблица "${userTable}" успешно создана.`);
    } else {
      console.log(`Таблица "${userTable}" уже существует.`);
    }

    // Создание таблицы characters
    const characterTable = 'characters';
    const characterTableExists = await tableExists(characterTable);
    if (!characterTableExists) {
      console.log(`Таблица "${characterTable}" не существует. Создание таблицы...`);
      const createCharacterTableQuery = `
        CREATE TABLE ${characterTable} (
          id SERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL UNIQUE REFERENCES game_users(user_id),
          strength INT DEFAULT 10,
          agility INT DEFAULT 10,
          intuition INT DEFAULT 10,
          endurance INT DEFAULT 10,
          intelligence INT DEFAULT 10,
          wisdom INT DEFAULT 10,
          upgrade_points INT DEFAULT 0,
          level INT DEFAULT 0,         -- Уровень персонажа
          experience INT DEFAULT 0,    -- Текущий опыт
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await pool.query(createCharacterTableQuery);
      console.log(`Таблица "${characterTable}" успешно создана.`);
    } else {
      console.log(`Таблица "${characterTable}" уже существует.`);
    }
  } catch (err) {
    console.error('Ошибка при инициализации базы данных:', err.message);
  }
}

// Проверка подключения к базе данных и инициализация таблицы
pool.connect(async (err) => {
  if (err) {
    console.error('Ошибка подключения к базе данных:', err.message);
    return;
  }
  console.log('Успешное подключение к базе данных');

  // Инициализация базы данных
  await initializeDatabase();
});

// Инициализация Express-сервера
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware для обработки JSON
app.use(bodyParser.json());

// Настройка CORS
const cors = require('cors');
app.use(cors({
  origin: ['https://itsnotagame.netlify.app'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Эндпоинт для обработки запросов от Telegram WebApp
app.post('/webapp', async (req, res) => {
  const { user_id, photo_url } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    // Проверяем существование пользователя в таблице users
    const checkUserQuery = 'SELECT * FROM game_users WHERE user_id = $1';
    const { rows } = await pool.query(checkUserQuery, [user_id]);

    if (rows.length > 0) {
      // Пользователь уже существует
      const user = rows[0];
      console.log('Пользователь найден в базе данных:', user);

      // Получаем характеристики персонажа из таблицы characters
      const getCharacterQuery = 'SELECT * FROM characters WHERE user_id = $1';
      const characterResult = await pool.query(getCharacterQuery, [user_id]);
      const character = characterResult.rows[0];

      return res.status(200).json({
        message: 'Пользователь найден',
        user: { user_id: user.user_id, photo_url: user.photo_url },
        character: character,
      });
    }

    // Пользователь не существует, создаем нового
    const insertUserQuery =
      'INSERT INTO game_users (user_id, photo_url) VALUES ($1, $2) RETURNING *';
    const newUser = await pool.query(insertUserQuery, [user_id, photo_url]);

    // Создаем запись в таблице characters
    const insertCharacterQuery =
      'INSERT INTO characters (user_id, level, experience) VALUES ($1, 1, 0) RETURNING *';
    const newCharacter = await pool.query(insertCharacterQuery, [user_id]);

    console.log('Пользователь успешно добавлен в базу данных:', newUser.rows[0]);
    console.log('Характеристики персонажа созданы:', newCharacter.rows[0]);

    return res.status(201).json({
      message: 'Пользователь добавлен',
      user: { user_id: newUser.rows[0].user_id, photo_url: newUser.rows[0].photo_url },
      character: newCharacter.rows[0],
    });
  } catch (err) {
    console.error('Ошибка при работе с базой данных:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Эндпоинт для получения данных пользователя по user_id
app.get('/webapp/:user_id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM game_users WHERE user_id = $1', [req.params.user_id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];

    // Получаем характеристики персонажа из таблицы characters
    const getCharacterQuery = 'SELECT * FROM characters WHERE user_id = $1';
    const characterResult = await pool.query(getCharacterQuery, [req.params.user_id]);
    const character = characterResult.rows[0];

    res.json({
      user: { user_id: user.user_id, photo_url: user.photo_url },
      character: character,
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Пример эндпоинта для проверки работоспособности сервера
app.get('/', (req, res) => {
  res.send('Telegram WebApp Server is running!');
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});