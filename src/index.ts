import { Elysia } from "elysia";
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { cors } from '@elysiajs/cors'

dotenv.config();

const corsOptions = {
  origin: 'http://localhost:3006',
}

const app = new Elysia()
  .get("/", async ({ query, set }) => {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : undefined,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE
    });
    const { mmsi, vessel_name } = query;
    const page = parseInt(query?.page || '1');
    const limit = parseInt(query?.limit || '10');
    const offset = (page - 1) * limit;

    let searchQuery = '';
    let params = [limit.toString(), offset.toString()];

    if (mmsi) {
      searchQuery = 'WHERE mmsi = ?';
      params.unshift(mmsi);
    } else if (vessel_name) {
      searchQuery = 'WHERE vessel_name LIKE ?';
      params.unshift(`%${vessel_name}%`);
    }

    const [rows] = await connection.execute(
      `SELECT * FROM ais_data_vessels ${searchQuery} LIMIT ? OFFSET ?`,
      params
    );

    await connection.end();

    set.headers = { 'Content-Type': 'application/json' };
    return {
      message: "Data retrieved successfully",
      code: 200,
      data: rows
    };
  })
  .get('/api/aisdataposition', async ({ query, set }) => {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : undefined,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE
    });
    const { mmsi, vessel_name } = query;
    const page = parseInt(query?.page || '1');
    const limit = parseInt(query?.limit || '10');
    const offset = (page - 1) * limit;

    let searchQuery = '';
    let params = [limit.toString(), offset.toString()];

    if (mmsi) {
      searchQuery = 'WHERE v.mmsi = ?';
      params.unshift(mmsi);
    } else if (vessel_name) {
      searchQuery = 'WHERE v.vessel_name LIKE ?';
      params.unshift(`%${vessel_name}%`);
    }

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
    return {
      message: "Data retrieved successfully",
      code: 200,
      data: rows
    };
  })
  .use(cors(corsOptions))
  .listen(3008);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
