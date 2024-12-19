import mysql from 'mysql2/promise';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Function to create a database connection
export const createDbConnection = async () => {
  if (process.env.DB_CONNECTION === 'pgsql') {
    const pool = new pg.Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : undefined,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE
    });
    return pool;
  } else {
    return await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : undefined,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE
    });
  }
}; 