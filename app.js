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

async function dropTable(tableName) {
    try {
        const query = `DROP TABLE IF EXISTS ${tableName};`;
        await pool.query(query);
        console.log(`Таблица "${tableName}" успешно удалена.`);
    } catch (err) {
        console.error(`Ошибка при удалении таблицы "${tableName}":`, err.message);
    }
}

// Функция для проверки существования таблицы
async function tableExists(tableName) {
    try {
        const result = await pool.query(
            `SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = $1
            );`,
            [tableName]
        );
        return result.rows[0].exists;
    } catch (err) {
        console.error(`Ошибка при проверке существования таблицы "${tableName}":`, err.message);
        throw err;
    }
}

// Функция для проверки существования полей в таблице
async function columnExists(tableName, columnName) {
    try {
        const query = `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2
      );
    `;
        const result = await pool.query(query, [tableName, columnName]);
        return result.rows[0].exists;
    } catch (err) {
        console.error(`Ошибка при проверке существования столбца "${columnName}" в таблице "${tableName}":`, err.message);
        throw err;
    }
}

// Функция для добавления недостающих полей в таблицу
async function addMissingColumns(tableName, columns) {
    for (const [columnName, columnDefinition] of Object.entries(columns)) {
        const exists = await columnExists(tableName, columnName);
        if (!exists) {
            console.log(`Добавление столбца "${columnName}" в таблицу "${tableName}"...`);
            const alterQuery = `ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition};`;
            await pool.query(alterQuery);
            console.log(`Столбец "${columnName}" успешно добавлен.`);
        } else {
            console.log(`Столбец "${columnName}" уже существует в таблице "${tableName}".`);
        }
    }
}

// Функция для инициализации таблицы experience_levels
async function initializeExperienceLevels() {
    const tableName = 'experience_levels';
    const tableExistsResult = await tableExists(tableName);

    if (!tableExistsResult) {
        console.log(`Таблица "${tableName}" не существует. Создание таблицы...`);
        const createTableQuery = `
      CREATE TABLE ${tableName} (
        level INT PRIMARY KEY,
        min_experience INT NOT NULL,
        max_experience INT NOT NULL
      );
    `;
        await pool.query(createTableQuery);
        console.log(`Таблица "${tableName}" успешно создана.`);

        // Заполнение таблицы начальными данными
        const levels = [
            { level: 0, min_experience: 0, max_experience: 50 },
            { level: 1, min_experience: 51, max_experience: 100 },
            { level: 2, min_experience: 101, max_experience: 300 },
            { level: 3, min_experience: 301, max_experience: 600 },
            { level: 4, min_experience: 601, max_experience: 1000 },
            { level: 5, min_experience: 1001, max_experience: 1500 },
            { level: 6, min_experience: 1501, max_experience: 2100 },
            { level: 7, min_experience: 2101, max_experience: 2800 },
            { level: 8, min_experience: 2801, max_experience: 3600 },
            { level: 9, min_experience: 3601, max_experience: 4500 },
            { level: 10, min_experience: 4501, max_experience: 5500 },
        ];

        for (const { level, min_experience, max_experience } of levels) {
            const insertQuery = `
        INSERT INTO experience_levels (level, min_experience, max_experience)
        VALUES ($1, $2, $3)
        ON CONFLICT (level) DO NOTHING;
      `;
            await pool.query(insertQuery, [level, min_experience, max_experience]);
        }

        console.log(`Таблица "${tableName}" успешно заполнена начальными данными.`);
    } else {
        console.log(`Таблица "${tableName}" уже существует.`);
    }
}

// Функция для инициализации таблицы battles
async function initializeBattlesTable() {
    //dropTable('battles');
    const tableName = 'battles';
    try {
        const tableExistsResult = await tableExists(tableName);

        if (!tableExistsResult) {
            console.log(`Таблица "${tableName}" не существует. Создание таблицы...`);

            // Создаем расширение pgcrypto для поддержки UUID
            await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

            // Создаем таблицу battles
            const createTableQuery = `
                CREATE TABLE ${tableName} (
                    id VARCHAR(255) PRIMARY KEY,
                    name VARCHAR(255) NOT NULL, -- Название боя
                    creator_id BIGINT NOT NULL REFERENCES game_users(user_id), -- ID создателя боя
                    opponent_id BIGINT REFERENCES game_users(user_id), -- ID противника (может быть NULL)
                    status VARCHAR(50), -- Статус боя (например, 'waiting', 'in_progress', 'finished')
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- Время создания боя
                );
            `;
            await pool.query(createTableQuery);
            console.log(`Таблица "${tableName}" успешно создана.`);
        } else {
            console.log(`Таблица "${tableName}" уже существует.`);
        }
    } catch (err) {
        console.error(`Ошибка при инициализации таблицы "${tableName}":`, err.message);
        throw err; // Передаем ошибку дальше
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
          strength INT DEFAULT 15,
          agility INT DEFAULT 10,
          intuition INT DEFAULT 10,
          endurance INT DEFAULT 10,
          intelligence INT DEFAULT 10,
          wisdom INT DEFAULT 10,
          upgrade_points INT DEFAULT 5,
          level INT DEFAULT 0,         -- Уровень персонажа
          experience INT DEFAULT 0,    -- Текущий опыт
          health INT DEFAULT 100,      -- Текущее здоровье
          max_health INT DEFAULT 150,  -- Максимальное здоровье
          mana INT DEFAULT 50,         -- Текущая мана
          max_mana INT DEFAULT 50,     -- Максимальная мана
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
            await pool.query(createCharacterTableQuery);
            console.log(`Таблица "${characterTable}" успешно создана.`);
        } else {
            console.log(`Таблица "${characterTable}" уже существует.`);
        }

        // Проверка и добавление недостающих полей в таблицу characters
        const characterColumns = {
            strength: 'strength INT DEFAULT 15',
            agility: 'agility INT DEFAULT 10',
            intuition: 'intuition INT DEFAULT 10',
            endurance: 'endurance INT DEFAULT 10',
            intelligence: 'intelligence INT DEFAULT 10',
            wisdom: 'wisdom INT DEFAULT 10',
            upgrade_points: 'upgrade_points INT DEFAULT 5',
            level: 'level INT DEFAULT 0',
            experience: 'experience INT DEFAULT 0',
            health: 'health INT DEFAULT 100',
            max_health: 'max_health INT DEFAULT 150',
            mana: 'mana INT DEFAULT 50',
            max_mana: 'max_mana INT DEFAULT 50',
        };
        await addMissingColumns(characterTable, characterColumns);

        // Инициализация таблицы experience_levels
        await initializeExperienceLevels();
        await initializeBattlesTable();
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
    methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
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
            let character = characterResult.rows[0];

            // Обновляем уровень персонажа на основе опыта
            const updateLevelQuery = `
        UPDATE characters
        SET level = (
          SELECT level
          FROM experience_levels
          WHERE $1 BETWEEN min_experience AND max_experience
        )
        WHERE user_id = $2
        RETURNING *;
      `;
            const updatedCharacterResult = await pool.query(updateLevelQuery, [character.experience, user_id]);
            character = updatedCharacterResult.rows[0];

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
            'INSERT INTO characters (user_id, level, experience, health, max_health, mana, max_mana) VALUES ($1, 0, 0, 100, 100,  50, 50) RETURNING *';
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

        // Получаем данные об уровнях опыта из таблицы experience_levels
        const getExperienceLevelsQuery = 'SELECT * FROM experience_levels ORDER BY level ASC';
        const experienceLevelsResult = await pool.query(getExperienceLevelsQuery);
        const experienceLevels = Array.isArray(experienceLevelsResult.rows) ? experienceLevelsResult.rows : [];

        // Находим текущий уровень персонажа
        const currentLevelData = experienceLevels.find(
            (level) => character.experience >= level.min_experience && character.experience <= level.max_experience
        ) || { level: 0, max_experience: 0 };

        res.json({
            user: { user_id: user.user_id, photo_url: user.photo_url },
            character: {
                ...character,
                currentLevel: currentLevelData.level,
                experienceToNextLevel: currentLevelData.max_experience - character.experience,
            },
            experience_levels: experienceLevels,
        });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});
//Бои
app.get('/battles', async (req, res) => {
    try {
        // Получаем параметр status из query-параметров (по умолчанию 'waiting')
        const status = req.query.status;

        // Формируем SQL-запрос с фильтрацией по статусу
        const query = `
        SELECT id, name, creator_id, opponent_id, status, created_at
        FROM battles
        WHERE status = $1;
      `;

        // Выполняем запрос с передачей параметра status
        const { rows } = await pool.query(query, [status]);

        // Возвращаем результат
        res.json({ battles: rows }); // Используем ключ "battles"
    } catch (err) {
        console.error('Ошибка при выполнении запроса:', err.message);
        res.status(500).json({ error: 'Database error', details: err.message });
    }
});


app.post('/battles', async (req, res) => {
    const { user_id } = req.body;

    // Проверка входных данных
   // if (!user_id || typeof user_id !== 'number') {
  //      return res.status(400).json({ error: 'Invalid or missing user_id' });
  //  }

    try {
        // Генерация уникального battleId
        const battleId = `Battle-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const battleName = `Battle-${Date.now()}`;
        
        console.log(`Creating new battle with ID: ${battleId} for user ID: ${user_id}`);

        // Вставка нового боя в базу данных
        const insertQuery = `
            INSERT INTO battles (id, name, creator_id, status)
            VALUES ($1, $2, $3, 'waiting')
            RETURNING id, name, creator_id, status, created_at;
        `;
        const { rows } = await pool.query(insertQuery, [battleId, battleName, user_id]);

        // Возвращаем созданный бой
        res.json({ battle: rows[0] });

    } catch (err) {
        console.error('Ошибка при создании боя:', err.message);
        res.status(500).json({ error: `Database error: ${err.message}` });
    }
});

app.post('/battles/:battle_id/join', async (req, res) => {
    const { battle_id } = req.params;
    const { user_id } = req.body;

    try {
        // Проверяем, существует ли бой и доступен ли он для присоединения
        const checkQuery = 'SELECT * FROM battles WHERE id = $1 AND opponent_id IS NULL';
        const { rows } = await pool.query(checkQuery, [battle_id]);

        const isCreatorQuery = 'SELECT creator_id FROM battles WHERE id = $1';
        const { rows: creatorRows } = await pool.query(isCreatorQuery, [battle_id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Battle not found or already has an opponent' });
        }

        if (creatorRows[0]?.creator_id === user_id) {
            return res.status(400).json({ error: 'You cannot join your own battle' });
        }

        // Присоединяем пользователя к бою
        const updateQuery = `
        UPDATE battles
        SET opponent_id = $1, status = 'in_progress'
        WHERE id = $2
        RETURNING *;
      `;
        const { rows: updatedRows } = await pool.query(updateQuery, [user_id, battle_id]);
        res.json({ battle: updatedRows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/battles/:battle_id/delete', async (req, res) => {
    const { battle_id } = req.params;
    //const battleId = parseInt(battle_id, 10);

    if (isNaN(battle_id)) {
        return res.status(400).json({ error: 'Invalid battle ID' });
    }

    console.log(`Attempting to delete battle with ID: ${battle_id}`);

    try {
        // Начинаем транзакцию
        const client = await pool.connect();
        await client.query('BEGIN');

        // Проверяем существование боя
        const checkQuery = 'SELECT * FROM battles WHERE id = $1 AND status = $2';
        const { rows } = await client.query(checkQuery, [battle_id, 'waiting']);
        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Battle not found or cannot be canceled' });
        }

        // Удаляем бой
        const deleteQuery = 'DELETE FROM battles WHERE id = $1';
        await client.query(deleteQuery, [battle_id]);

        // Завершаем транзакцию
        await client.query('COMMIT');
        res.json({ message: 'Battle successfully canceled' });

    } catch (err) {
        console.error('Ошибка при удалении боя:', err.message);
        res.status(500).json({ error: `Database error: ${err.message}` });
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