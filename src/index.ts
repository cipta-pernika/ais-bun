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

// Helper function to move the camera
const moveCamera = async (direction: { pan: number, tilt?: number }, set: any) => {
  const merekCamera = process.env.MEREK_CAMERA;
  const urlCamera = process.env.CAMERA_URL;
  let xmlData = '';
  let url = '';

  if (merekCamera === 'hikvision') {
    xmlData = `<PTZData version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
                <pan> ${direction.pan} </pan>
                ${direction.tilt ? `<tilt> ${direction.tilt} </tilt>` : ''}
                <Momentary>
                  <duration> 1000 </duration>
                </Momentary>
              </PTZData>`;
    url = `${urlCamera}/ISAPI/PTZCtrl/channels/1/momentary`;
  } else if (merekCamera === 'tiandy') {
    xmlData = `<PTZData>
                <pan>${direction.pan}</pan>
                <tilt>${direction.tilt || 0}</tilt>
                <zoom/>
              </PTZData>`;
    url = `${urlCamera}/ISAPI/PTZCtrl/channels/1/continuous`;

    const myHeaders = new Headers();
    myHeaders.append("Accept", "application/xml, text/xml, */*; q=0.01");
    myHeaders.append("Accept-Language", "en-US,en;q=0.9,id-ID;q=0.8,id;q=0.7");
    myHeaders.append("Cache-Control", "max-age=0");
    myHeaders.append("Connection", "keep-alive");
    myHeaders.append("Content-Type", "application/xml; charset=UTF-8");
    myHeaders.append("Cookie", "live_port=3002; user=admin; V2_Session_331a1bf7=06hklv8p67QXveJ0FM91FW9MeMFhN2Aa");
    myHeaders.append("HttpSession", "06hklv8p67QXveJ0FM91FW9MeMFhN2Aa");
    myHeaders.append("If-Modified-Since", "0");
    myHeaders.append("Origin", "http://192.168.18.65");
    myHeaders.append("Referer", "http://192.168.18.65/?t=9612958877");
    myHeaders.append("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
    myHeaders.append("X-Requested-With", "XMLHttpRequest");

    const response = await fetch(url, {
      method: 'PUT',
      headers: myHeaders,
      body: xmlData
    });

    if (!response.ok) {
      url = `${urlCamera}/CGI/PTZCtrl/channels/1/continuous`;
      const cgiResponse = await fetch(url, {
        method: 'PUT',
        headers: myHeaders,
        body: xmlData
      });

      if (!cgiResponse.ok) {
        set.status = cgiResponse.status;
        return { success: false, message: `Request failed with status code: ${cgiResponse.status}` };
      }
    }

    const stopXmlData = '<PTZData><pan>0</pan><tilt>0</tilt><zoom/></PTZData>';
    await fetch(url, {
      method: 'PUT',
      headers: myHeaders,
      body: stopXmlData
    });
  } else {
    set.status = 400;
    return { success: false, message: 'Kamera tidak ditemukan atau tidak didukung.' };
  }

  set.headers = { 'Content-Type': 'application/json' };
  return { success: true };
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
      const frigateUrl = `https://frigatebau.pernika.net/api/review?reviewed=1&before=${before || ''}&after=${after || ''}`;
      const response = await fetch(frigateUrl);
      
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
  .get('/api/frigatevod', async ({ query, set }) => {
    const connection = await createDbConnection();
    const { start, end } = query;

    try {
      const frigateUrl = `https://frigatebau.pernika.net/vod/static64/start/${start}/end/${end}/master.m3u8`;
      const response = await fetch(frigateUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.text();

      if (process.env.DB_CONNECTION === 'pgsql') {
        await connection.end();
      } else {
        await connection.end();
      }

      set.headers = { 'Content-Type': 'application/json' };
      return { 
        message: "Video data retrieved successfully", 
        code: 200, 
        data: {
          url: frigateUrl,
          content: data
        }
      };
    } catch (error) {
      console.error('Frigate VOD API error:', error);
      set.status = 500;
      return { 
        message: "Error fetching video data from Frigate API",
        code: 500,
        error: error instanceof Error ? error.message : String(error),
        url: 'frigatebau.pernika.net/vod'
      };
    }
  })
  .post('/api/camleft', async ({ set }) => {
    return await moveCamera({ pan: -20 }, set);
  })
  .post('/api/camright', async ({ set }) => {
    return await moveCamera({ pan: 20 }, set);
  })
  .post('/api/camleftdown', async ({ set }) => {
    return await moveCamera({ pan: -20, tilt: -20 }, set);
  })
  .use(cors(corsOptions))
  .listen(3008);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
