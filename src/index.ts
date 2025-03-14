import { Elysia } from "elysia";
import dotenv from 'dotenv';
import { cors } from '@elysiajs/cors';
import fetch from 'node-fetch';
import { createDbConnection } from './dbConnection';
import { moveCamera } from './cameraControl';
import { createRedisClient } from './redisClient';

dotenv.config();

const corsOptions = {
  origin: 'http://localhost:3006',
}

// Function to handle common query logic
const handleQuery = (query: any, searchField: string) => {
  const { [searchField]: searchValue } = query;
  const page = parseInt(query?.page || '1');
  const limit = parseInt(query?.limit || '10');
  const offset = (page - 1) * limit;

  let searchQuery = '';
  let params = [limit.toString(), offset.toString()];

  if (searchValue) {
    searchQuery = `WHERE ${searchField} ${searchField === 'mmsi' || searchField === 'vessel_name' ? '=' : 'LIKE'} ?`;
    params.unshift(searchField === 'mmsi' || searchField === 'vessel_name' ? searchValue : `%${searchValue}%`);
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

// Create a helper function for caching
const cachedQuery = async (cacheKey: string, queryFn: () => Promise<any>, redisClient: any, cacheDuration: number = 300) => {
  // Check cache first
  const cachedData = await redisClient.get(cacheKey);
  if (cachedData) {
    return JSON.parse(cachedData);
  }

  // Execute query if not in cache
  const result = await queryFn();

  // Cache the result
  await redisClient.set(cacheKey, JSON.stringify(result), { EX: cacheDuration });

  return result;
};

const app = new Elysia()
  .get("/", async ({ query, set }) => {
    const connection = await createDbConnection();
    const redisClient = createRedisClient();
    const { searchQuery, params } = handleQuery(query, query.vessel_name ? 'vessel_name' : 'mmsi');
    const cacheKey = `vessels:${JSON.stringify(query)}`;

    const result = await cachedQuery(
      cacheKey,
      async () => {
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

        return { message: "Data retrieved successfully", code: 200, data: rows };
      },
      redisClient
    );

    set.headers = { 'Content-Type': 'application/json' };
    return result;
  })
  .get('/api/aisdataposition', async ({ query, set }) => {
    const connection = await createDbConnection();
    const redisClient = createRedisClient();
    const { searchQuery, params } = handleQuery(query, 'mmsi');
    const cacheKey = `vessel_positions:${JSON.stringify(query)}`;

    const result = await cachedQuery(
      cacheKey,
      async () => {
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

        return { message: "Data retrieved successfully", code: 200, data: rows };
      },
      redisClient
    );

    set.headers = { 'Content-Type': 'application/json' };
    return result;
  })
  .get('/api/tersus', async ({ query, set }) => {
    const connection = await createDbConnection();
    const redisClient = createRedisClient();
    const { name } = query;
    const cacheKey = `terminals:${name || 'all'}`;

    const result = await cachedQuery(
      cacheKey,
      async () => {
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

        return { message: "Data retrieved successfully", code: 200, data: rows };
      },
      redisClient
    );

    set.headers = { 'Content-Type': 'application/json' };
    return result;
  })
  .get('/api/cctvs', async ({ query, set }) => {
    const connection = await createDbConnection();
    const redisClient = createRedisClient();
    const { terminal_id } = query;
    const cacheKey = `cctvs:${terminal_id || 'all'}`;

    const result = await cachedQuery(
      cacheKey,
      async () => {
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

        return { message: "Data retrieved successfully", code: 200, data: rows };
      },
      redisClient
    );

    set.headers = { 'Content-Type': 'application/json' };
    return result;
  })
  .get('/api/getTotalKapalDaily', async ({ query, set }) => {
    const connection = await createDbConnection();
    const redisClient = createRedisClient();
    const queryDate = query.date || new Date().toISOString().split('T')[0];
    const cacheKey = `totalKapalDaily:${queryDate}`;

    // Check cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
        set.headers = { 'Content-Type': 'application/json' };
        return { message: "Data retrieved successfully", code: 200, data: JSON.parse(cachedData) };
    }

    let sql = `
      SELECT COUNT(DISTINCT adp.vessel_id) as total_kapal
      FROM ais_data_positions adp
      WHERE DATE(adp.timestamp) = ?`;

    let params = [queryDate];

    const [rows] = await executeQuery(connection, sql, params);

    if (process.env.DB_CONNECTION === 'pgsql') {
        await connection.end();
    } else {
        await connection.end();
    }

    // Cache the result for 5 minutes using set with EX option
    await redisClient.set(cacheKey, JSON.stringify(rows), { EX: 300 });

    set.headers = { 'Content-Type': 'application/json' };
    return { message: "Data retrieved successfully", code: 200, data: rows };
  })
  .get('/api/summaryTotalKapal', async ({ query, set }) => {
    const connection = await createDbConnection();
    const redisClient = createRedisClient();
    const { date } = query;
    const cacheKey = `summaryTotalKapal:${date || 'default'}`;

    // Check cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
        set.headers = { 'Content-Type': 'application/json' };
        return JSON.parse(cachedData);
    }

    // Check cache first
    const cachedLocations = await redisClient.get('locations');
    if (cachedLocations) {
        return JSON.parse(cachedLocations);
    }

    const [locations] = await executeQuery(
        connection,
        'SELECT initial_name FROM locations',
        []
    );

    // Cache the result for 5 minutes using set with EX option
    await redisClient.set('locations', JSON.stringify(locations), { EX: 300 });

    // Fetch data from each location with timeout
    const fetchPromises = locations.map(async (location: { initial_name: string }) => {
        try {
            const url = `https://bebun${location.initial_name.toLowerCase()}.cakrawala.id/api/getTotalKapalDaily${date ? `?date=${date}` : ''}`;

            // Set a timeout for the fetch request
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 seconds timeout

            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

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

    const result = {
        message: "Data retrieved successfully",
        code: 200,
        data: {
            total_kapal: totalKapal,
            details: locationData
        }
    };

    // Cache the result for 5 minutes using set with EX option
    await redisClient.set(cacheKey, JSON.stringify(result), { EX: 300 });

    set.headers = { 'Content-Type': 'application/json' };
    return result;
  })
  .get('/api/frigate', async ({ query, set }) => {
    const connection = await createDbConnection();
    const { before, after } = query;

    try {
      const urlFrigate = process.env.URL_FRIGATE;
      const frigateUrl = `${urlFrigate}/api/review?reviewed=1&before=${before || ''}&after=${after || ''}`;
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
      const urlFrigate = process.env.URL_FRIGATE;
      console.error('Frigate API error:', error);
      set.status = 500;
      return {
        message: "Error fetching data from Frigate API",
        code: 500,
        error: error instanceof Error ? error.message : String(error),
        // Include the URL that failed (without sensitive data if any)
        url: `${urlFrigate}/api/review`
      };
    }
  })
  .get('/api/frigatevod', async ({ query, set }) => {
    const connection = await createDbConnection();
    const { start, end } = query;

    try {
        
      const urlFrigate = process.env.URL_FRIGATE;
      const camName = process.env.CAM_NAME;
      const frigateUrl = `${urlFrigate}/vod/${camName}/start/${start}/end/${end}/master.m3u8`;
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
      const urlFrigate = process.env.URL_FRIGATE;
      const camName = process.env.CAM_NAME;
      console.error('Frigate VOD API error:', error);
      set.status = 500;
      return {
        message: "Error fetching video data from Frigate API",
        code: 500,
        error: error instanceof Error ? error.message : String(error),
        url: `${urlFrigate}/vod/${camName}`
      };
    }
  })
  .post('/api/camleft', async ({ set }) => {
    set.headers = { 'Content-Type': 'application/json' };
    return await moveCamera({ pan: -20 }, set);
  })
  .post('/api/camright', async ({ set }) => {
    return await moveCamera({ pan: 20 }, set);
  })
  .post('/api/camleftdown', async ({ set }) => {
    return await moveCamera({ pan: -20, tilt: -20 }, set);
  })
  .get('/api/getTotalKegiatan', async ({ query, set }) => {
    const connection = await createDbConnection();
    const redisClient = createRedisClient();
    // Calculate start date as 3 days before the query date
    const endDate = query.date || new Date().toISOString().split('T')[0];
    const startDate = new Date(new Date(endDate).setDate(new Date(endDate).getDate() - 3)).toISOString().split('T')[0];

    const cacheKey = `totalKegiatan:${startDate}:${endDate}`;

    // Check cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
        set.headers = { 'Content-Type': 'application/json' };
        return JSON.parse(cachedData);
    }

    let sql = `
    SELECT COUNT(gi.mmsi) as total_kegiatan
    FROM geofence_images gi
    INNER JOIN ais_data_vessels adv ON gi.mmsi = adv.mmsi
    WHERE DATE(gi.timestamp) BETWEEN ? AND ?`;

    let params = [startDate, endDate];

    const [rows] = await executeQuery(connection, sql, params);

    if (process.env.DB_CONNECTION === 'pgsql') {
      await connection.end();
    } else {
      await connection.end();
    }

    // Cache the result for 5 minutes using set with EX option
    await redisClient.set(cacheKey, JSON.stringify(rows), { EX: 300 });

    set.headers = { 'Content-Type': 'application/json' };
    return { message: "Data retrieved successfully", code: 200, data: rows };
  })
  .get('/api/summaryTotalKegiatan', async ({ query, set }) => {
    const connection = await createDbConnection();
    const redisClient = createRedisClient();
    const { date } = query;

    const cacheKey = `summaryTotalKegiatan:${date || 'default'}`;

    // Check cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
        set.headers = { 'Content-Type': 'application/json' };
        return JSON.parse(cachedData);
    }

    // Get all locations
    const [locations] = await executeQuery(
      connection,
      'SELECT initial_name FROM locations',
      []
    );

    // Fetch data from each location with a limit on concurrent requests
    const fetchLocationData = async (location: { initial_name: string }) => {
      try {
        const url = `https://bebun${location.initial_name.toLowerCase()}.cakrawala.id/api/getTotalKegiatan${date ? `?date=${date}` : ''}`;

        // Set a timeout for the fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 seconds timeout

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        const data = await response.json();
        return {
          location: location.initial_name,
          total_kegiatan: data.data[0]?.total_kegiatan || 0
        };
      } catch (error) {
        console.error(`Error fetching data for ${location.initial_name}:`, error);
        return {
          location: location.initial_name,
          total_kegiatan: 0
        };
      }
    };

    // Limit concurrent fetches to prevent overwhelming the server
    const maxConcurrentRequests = 3;
    const locationData = [];
    for (let i = 0; i < locations.length; i += maxConcurrentRequests) {
      const chunk = locations.slice(i, i + maxConcurrentRequests);
      const results = await Promise.all(chunk.map(fetchLocationData));
      locationData.push(...results);
    }

    // Calculate total across all locations
    const totalKegiatan = locationData.reduce((sum, item) => sum + item.total_kegiatan, 0);

    if (process.env.DB_CONNECTION === 'pgsql') {
      await connection.end();
    } else {
      await connection.end();
    }

    // Cache the result for 5 minutes using set with EX option
    await redisClient.set(cacheKey, JSON.stringify({
      message: "Data retrieved successfully",
      code: 200,
      data: {
        total_kegiatan: totalKegiatan,
        details: locationData
      }
    }), { EX: 300 });

    set.headers = { 'Content-Type': 'application/json' };
    return {
      message: "Data retrieved successfully",
      code: 200,
      data: {
        total_kegiatan: totalKegiatan,
        details: locationData
      }
    };
  })
  .get('/api/syncasset', async ({ set }) => {
    const connection = await createDbConnection();

    const [rows] = await executeQuery(
      connection,
      'SELECT * FROM assets',
      []
    );

    if (process.env.DB_CONNECTION === 'pgsql') {
      await connection.end();
    } else {
      await connection.end();
    }

    set.headers = { 'Content-Type': 'application/json' };
    return { message: "Data retrieved successfully", code: 200, data: rows };
  })
  .use(cors(corsOptions))
  .listen(process.env.PORT || 3008);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
