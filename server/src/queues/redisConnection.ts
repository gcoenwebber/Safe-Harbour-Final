import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Create Redis connection for BullMQ
 */
export function createRedisConnection(): Redis {
    const connection = new Redis(REDIS_URL, {
        maxRetriesPerRequest: null, // Required for BullMQ
        enableReadyCheck: false
    });

    connection.on('connect', () => {
        console.log('📡 Redis connected');
    });

    connection.on('error', (err) => {
        console.error('❌ Redis connection error:', err.message);
    });

    return connection;
}

// Singleton connection for queue operations
let _connection: Redis | null = null;

export function getRedisConnection(): Redis | null {
    // Skip Redis if not configured
    if (!process.env.REDIS_URL) {
        return null;
    }

    if (!_connection) {
        _connection = createRedisConnection();
    }
    return _connection;
}

export default getRedisConnection;
