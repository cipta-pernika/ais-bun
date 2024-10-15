import { Elysia } from "elysia";
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { cors } from '@elysiajs/cors'

dotenv.config();

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : undefined,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE
});
const app = new Elysia()
  .get("/", async ({ query, set }) => { // Destructure query and set from the request object
    const page = parseInt(query?.page || '1'); // Use destructured query
    const limit = parseInt(query?.limit || '10'); // Use destructured query
    const offset = (page - 1) * limit;

    const [rows] = await connection.execute(
      'SELECT * FROM ais_data_vessels LIMIT ? OFFSET ?',
      [limit.toString(), offset.toString()] // Convert limit and offset to strings
    );

    console.log(rows);

    set.headers = { 'Content-Type': 'application/json' }; // Set response header
    return {
      message: "Data retrieved successfully",
      code: 200,
      data: rows
    }; // Return message, code, and data
  })
  .use(cors())
  .listen(3008);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
