import { Elysia } from "elysia";
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { cors } from '@elysiajs/cors'

dotenv.config();

const corsOptions = {
  origin: 'http://localhost:3006',
}

// Function to create a database connection
const createDbConnection = async () => {
  return await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : undefined,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
  });
};

// Function to handle common query logic
const handleQuery = (query: any, searchField: string) => {
  const { [searchField]: searchValue } = query;
  const page = parseInt(query?.page || '1');
  const limit = parseInt(query?.limit || '10');
  const offset = (page - 1) * limit;

  let searchQuery = '';
  let params = [limit.toString(), offset.toString()];

  if (searchValue) {
    searchQuery = `WHERE ${searchField} ${searchField === 'mmsi' ? '=' : 'LIKE'} ?`;
    params.unshift(searchField === 'mmsi' ? searchValue : `%${searchValue}%`);
  }

  return { searchQuery, params, limit, offset };
};

const app = new Elysia()
  .get("/", async ({ query, set }) => {
    const connection = await createDbConnection();
    const { searchQuery, params } = handleQuery(query, 'mmsi');

    const [rows] = await connection.execute(
      `SELECT * FROM ais_data_vessels ${searchQuery} LIMIT ? OFFSET ?`,
      params
    );

    await connection.end();

    set.headers = { 'Content-Type': 'application/json' };
    return { message: "Data retrieved successfully", code: 200, data: rows };
  })
  .get('/api/aisdataposition', async ({ query, set }) => {
    const connection = await createDbConnection();
    const { searchQuery, params } = handleQuery(query, 'mmsi');

    const [rows] = await connection.execute(
      `SELECT *
       FROM recent_vessels_positions
       ${searchQuery}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );

    await connection.end();

    set.headers = { 'Content-Type': 'application/json' };
    return { message: "Data retrieved successfully", code: 200, data: rows };
  })
  .get('/api/tersus', async ({ query, set }) => {
    const connection = await createDbConnection();
    const { name } = query;

    let sql = 'SELECT * FROM terminals';
    let params = [];

    if (name) {
      sql += ' WHERE name LIKE ?';
      params.push(`%${name}%`);
    }

    const [rows] = await connection.execute(sql, params);

    await connection.end();

    set.headers = { 'Content-Type': 'application/json' };
    return { message: "Data retrieved successfully", code: 200, data: rows };
  })
  .get('api/cctvs', async ({ query, set }) => {
    const connection = await createDbConnection();
    const { terminal_id } = query;

    let sql = 'SELECT * FROM cctvs';
    let params = [];

    if (terminal_id) {
      const ids = terminal_id.split(',').map(id => parseInt(id.trim()));
      sql += ' WHERE terminal_id IN (?)';
      params.push(ids);
    }

    const [rows] = await connection.execute(sql, params);

    await connection.end();

    set.headers = { 'Content-Type': 'application/json' };
    return { message: "Data retrieved successfully", code: 200, data: rows };
  
   
    
    
  })
  .use(cors(corsOptions))
  .listen(3008);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
