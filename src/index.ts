import { Elysia } from "elysia";
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { cors } from '@elysiajs/cors'
import pg from 'pg';
import fetch from 'node-fetch';

dotenv.config();

const corsOptions = {
  origin: 'http://localhost:3006',
}

// Function to create a database connection
const createDbConnection = async () => {
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

// Function to execute query based on connection type
const executeQuery = async (connection: any, sql: string, params: any[]) => {
  if (process.env.DB_CONNECTION === 'pgsql') {
    // PostgreSQL uses $1, $2, etc. for parameterized queries
    const parameterizedSql = sql.replace(/\?/g, (_, i) => `$${i + 1}`);
    const result = await connection.query(parameterizedSql, params);
    return [result.rows];
  } else {
    // MySQL
    return await connection.execute(sql, params);
  }
};

const app = new Elysia()
  .get("/", async ({ query, set }) => {
    const connection = await createDbConnection();
    const { searchQuery, params } = handleQuery(query, 'mmsi');

    const [rows] = await executeQuery(
      connection,
      `SELECT * FROM ais_data_vessels ${searchQuery} LIMIT ? OFFSET ?`,
      params
    );

    if (process.env.DB_CONNECTION === 'pgsql') {
      await connection.end();
    } else {
      await connection.end();
    }

    set.headers = { 'Content-Type': 'application/json' };
    return { message: "Data retrieved successfully", code: 200, data: rows };
  })
  .get('/api/aisdataposition', async ({ query, set }) => {
    const connection = await createDbConnection();
    const { searchQuery, params } = handleQuery(query, 'mmsi');

    const [rows] = await executeQuery(
      connection,
      `SELECT *
       FROM recent_vessels_positions
       ${searchQuery}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );

    if (process.env.DB_CONNECTION === 'pgsql') {
      await connection.end();
    } else {
      await connection.end();
    }

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

    const [rows] = await executeQuery(connection, sql, params);

    if (process.env.DB_CONNECTION === 'pgsql') {
      await connection.end();
    } else {
      await connection.end();
    }

    set.headers = { 'Content-Type': 'application/json' };
    return { message: "Data retrieved successfully", code: 200, data: rows };
  })
  .get('/api/cctvs', async ({ query, set }) => {
    const connection = await createDbConnection();
    const { terminal_id } = query;

    let sql = 'SELECT * FROM cctvs';
    let params = [];

    if (terminal_id) {
      const ids = terminal_id.split(',').map(id => parseInt(id.trim()));
      if (process.env.DB_CONNECTION === 'pgsql') {
        sql += ' WHERE terminal_id = ANY($1::int[])';
      } else {
        sql += ' WHERE terminal_id IN (?)';
      }
      params.push(ids);
    }

    const [rows] = await executeQuery(connection, sql, params);

    if (process.env.DB_CONNECTION === 'pgsql') {
      await connection.end();
    } else {
      await connection.end();
    }

    set.headers = { 'Content-Type': 'application/json' };
    return { message: "Data retrieved successfully", code: 200, data: rows };
  })
  .get('/api/getTotalKapalDaily', async ({ query, set }) => {
    const connection = await createDbConnection();
    // Default to today's date if no date is provided
    const queryDate = query.date || new Date().toISOString().split('T')[0];

    let sql = `
      SELECT COUNT(DISTINCT adv.mmsi) as total_kapal
      FROM ais_data_positions adp
      INNER JOIN ais_data_vessels adv ON adp.vessel_id = adv.id
      WHERE DATE(adp.created_at) = ?`;
    
    let params = [queryDate];

    const [rows] = await executeQuery(connection, sql, params);

    if (process.env.DB_CONNECTION === 'pgsql') {
      await connection.end();
    } else {
      await connection.end();
    }

    set.headers = { 'Content-Type': 'application/json' };
    return { message: "Data retrieved successfully", code: 200, data: rows };
  })
  .get('/api/summaryTotalKapal', async ({ query, set }) => {
    const connection = await createDbConnection();
    const { date } = query;

    // Get all locations
    const [locations] = await executeQuery(
      connection,
      'SELECT initial_name FROM locations',
      []
    );

    // Fetch data from each location
    const fetchPromises = locations.map(async (location: { initial_name: string }) => {
      try {
        const url = `https://bebun${location.initial_name.toLowerCase()}.cakrawala.id/api/getTotalKapalDaily${date ? `?date=${date}` : ''}`;
        const response = await fetch(url);
        const data = await response.json();
        return {
          location: location.initial_name,
          total_kapal: data.data[0]?.total_kapal || 0
        };
      } catch (error) {
        console.error(`Error fetching data for ${location.initial_name}:`, error);
        return {
          location: location.initial_name,
          total_kapal: 0
        };
      }
    });

    const locationData = await Promise.all(fetchPromises);

    // Calculate total across all locations
    const totalKapal = locationData.reduce((sum, item) => sum + item.total_kapal, 0);

    if (process.env.DB_CONNECTION === 'pgsql') {
      await connection.end();
    } else {
      await connection.end();
    }

    set.headers = { 'Content-Type': 'application/json' };
    return { 
      message: "Data retrieved successfully", 
      code: 200, 
      data: {
        total_kapal: totalKapal,
        details: locationData
      }
    };
  })
  .get('/api/frigate', async ({ query, set }) => {
    const connection = await createDbConnection();
    const { before, after } = query;

    try {
      // First, authenticate with the login API
      const loginResponse = await fetch('https://frigatebau.pernika.net/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user: "appdev",
          password: "appDEV1234"
        })
      });

      // Log login response details
      console.log('Login Response Status:', loginResponse.status);
      const loginResponseText = await loginResponse.text();
      console.log('Login Response Body:', loginResponseText);

      if (!loginResponse.ok) {
        throw new Error(`Login failed with status: ${loginResponse.status}, Response: ${loginResponseText}`);
      }

      // Parse login response after logging
      const loginData = JSON.parse(loginResponseText);
      
      // Use the token from login response for the review API
      const frigateUrl = `https://frigatebau.pernika.net/api/review?reviewed=1&before=${before || ''}&after=${after || ''}`;
      const response = await fetch(frigateUrl, {
        headers: {
          'Authorization': `Bearer ${loginData.token}`
        }
      });
      
      // Check if the response is ok
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // Get the response text first
      const text = await response.text();
      
      // Try to parse the JSON, if it fails we'll have the text to debug
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError: unknown) {
        console.error('Failed to parse response:', text);
        throw new Error(`JSON parse error: ${(parseError as Error).message}`);
      }

      if (process.env.DB_CONNECTION === 'pgsql') {
        await connection.end();
      } else {
        await connection.end();
      }

      set.headers = { 'Content-Type': 'application/json' };
      return { message: "Data retrieved successfully", code: 200, data };
    } catch (error) {
      console.error('Frigate API error:', error);
      set.status = 500;
      return { 
        message: "Error fetching data from Frigate API",
        code: 500,
        error: error instanceof Error ? error.message : String(error),
        // Include the URL that failed (without sensitive data if any)
        url: 'frigatebau.pernika.net/api/review'
      };
    }
  })
  .use(cors(corsOptions))
  .listen(3008);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
