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
    const tableName = 'users';
    const exists = await tableExists(tableName);

    if (!exists) {
      console.log(`Таблица "${tableName}" не существует. Создание таблицы...`);

      const createTableQuery = `
        CREATE TABLE ${tableName} (
          id SERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL UNIQUE,
          first_name VARCHAR(255),
          last_name VARCHAR(255),
          username VARCHAR(255),
          photo_url VARCHAR(255),
          language_code VARCHAR(10),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;

      await pool.query(createTableQuery);
      console.log(`Таблица "${tableName}" успешно создана.`);
    } else {
      console.log(`Таблица "${tableName}" уже существует.`);
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


const cors = require('cors');
app.use(cors());

// Эндпоинт для обработки запросов от Telegram WebApp
app.post('/webapp', async (req, res) => {
  const { user_id, first_name, last_name, username, photo_url, language_code } = req.body;

  // Проверяем входные данные
  if (!user_id) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    // Проверяем существование пользователя
    const checkUserQuery = 'SELECT * FROM users WHERE user_id = $1';
    const { rows } = await pool.query(checkUserQuery, [user_id]);

    if (rows.length > 0) {
      // Пользователь уже существует, возвращаем его данные
      const user = rows[0];
      console.log('Пользователь найден в базе данных:', user);
      return res.status(200).json({ message: 'Пользователь найден', user });
    }

    // Пользователь не существует, добавляем его в базу данных
    const insertUserQuery =
      'INSERT INTO users (user_id, first_name, last_name, username, photo_url, language_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *';
    const newUser = await pool.query(insertUserQuery, [
      user_id,
      first_name,
      last_name,
      username,
      photo_url,
      language_code
    ]);

    console.log('Пользователь успешно добавлен в базу данных:', newUser.rows[0]);
    return res.status(201).json({ message: 'Пользователь добавлен', user: newUser.rows[0] });
  } catch (err) {
    console.error('Ошибка при работе с базой данных:', err.message);
    return res.status(500).json({ error: 'Database error' });
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
