import { MongoClient, Db, MongoClientOptions } from 'mongodb';
import { logger } from '@/lib/logger';
import { validateMongoDBConfig } from './config';

/**
 * Singleton instance of MongoClient
 */
let mongoClient: MongoClient | null = null;

/**
 * Singleton instance of the database
 */
let mongoDatabase: Db | null = null;

/**
 * Flag to track connection state
 */
let isConnecting = false;

/**
 * Helper function to check if client is still connected
 */
async function isClientConnected(client: MongoClient | null): Promise<boolean> {
  if (!client) return false;
  try {
    await client.db('admin').command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets or creates the MongoDB client singleton
 * Establishes connection on first call
 * @returns Promise<MongoClient> The MongoDB client instance
 * @throws Error if connection fails after retry attempts
 */
export async function getMongoClient(): Promise<MongoClient> {
  // Return existing client if already connected
  if (await isClientConnected(mongoClient)) {
    logger.debug('Returning existing MongoDB client connection');
    return mongoClient!;
  }

  mongoClient = null;

  // Prevent multiple simultaneous connection attempts
  if (isConnecting) {
    logger.debug('Connection attempt already in progress, waiting...');
    // Wait for connection to complete
    let attempts = 0;
    while (isConnecting && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    if (await isClientConnected(mongoClient)) {
      return mongoClient!;
    }
  }

  isConnecting = true;

  try {
    const config = validateMongoDBConfig();

    logger.debug('Attempting MongoDB connection', {
      host: config.uri.replace(/mongodb\+srv:\/\/.*@/, 'mongodb+srv://***@'),
      database: config.database,
      maxPoolSize: config.maxPoolSize,
    });

    const clientOptions: MongoClientOptions = {
      maxPoolSize: config.maxPoolSize,
      minPoolSize: 1,
      maxIdleTimeMS: 60000,
      retryWrites: true,
      retryReads: true,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    };

    mongoClient = new MongoClient(config.uri, clientOptions);

    // Establish connection
    await mongoClient.connect();

    logger.info('Successfully connected to MongoDB', {
      uri: config.uri.replace(/mongodb\+srv:\/\/.*@/, 'mongodb+srv://***@'),
      database: config.database,
    });

    // Test the connection
    await mongoClient.db('admin').command({ ping: 1 });
    logger.debug('MongoDB ping successful');

    // Set up event listeners for connection events
    mongoClient.on('connectionClosed', () => {
      logger.debug('MongoDB connection closed');
    });

    mongoClient.on('error', (error) => {
      logger.error('MongoDB client error', { error: error.message });
    });

    mongoClient.on('connectionPoolClosed', () => {
      logger.debug('MongoDB connection pool closed');
    });

    return mongoClient;
  } catch (error) {
    logger.error('Failed to connect to MongoDB', {
      error: error instanceof Error ? error.message : String(error),
    });
    mongoClient = null;
    throw error;
  } finally {
    isConnecting = false;
  }
}

/**
 * Gets the MongoDB database instance
 * Automatically connects if not already connected
 * @returns Promise<Db> The MongoDB database instance
 * @throws Error if connection fails
 */
export async function getMongoDatabase(): Promise<Db> {
  // Return existing database if client is connected
  if (mongoDatabase && await isClientConnected(mongoClient)) {
    logger.debug('Returning existing MongoDB database instance');
    return mongoDatabase;
  }

  mongoClient = null;
  mongoDatabase = null;

  try {
    const client = await getMongoClient();
    const config = validateMongoDBConfig();

    mongoDatabase = client.db(config.database);

    logger.debug('Retrieved MongoDB database instance', {
      database: config.database,
    });

    return mongoDatabase;
  } catch (error) {
    logger.error('Failed to get MongoDB database', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Checks if MongoDB is currently connected
 * @returns boolean True if connected, false otherwise
 */
export async function isMongoConnected(): Promise<boolean> {
  if (!mongoClient) {
    logger.debug('MongoDB connection status check', { connected: false });
    return false;
  }

  try {
    await mongoClient.db('admin').command({ ping: 1 });
    logger.debug('MongoDB connection status check', { connected: true });
    return true;
  } catch {
    logger.debug('MongoDB connection status check', { connected: false });
    mongoClient = null;
    return false;
  }
}

/**
 * Gracefully closes the MongoDB connection
 * Cleans up resources and removes singleton instances
 * @returns Promise<void>
 */
export async function closeMongoConnection(): Promise<void> {
  try {
    if (mongoClient) {
      logger.debug('Closing MongoDB connection');
      await mongoClient.close();
      logger.debug('MongoDB connection closed successfully');
    }

    mongoClient = null;
    mongoDatabase = null;
    isConnecting = false;
  } catch (error) {
    logger.error('Error closing MongoDB connection', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Set up process termination handlers for graceful shutdown
 * This function should be called once during application startup
 */
export function setupMongoDBShutdownHandlers(): void {
  const handleShutdown = async () => {
    logger.debug('Process shutdown signal received, closing MongoDB connection');
    await closeMongoConnection();
  };

  // Handle SIGTERM (termination signal)
  process.on('SIGTERM', handleShutdown);

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', handleShutdown);

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    logger.error('Uncaught exception, closing MongoDB connection', {
      error: error instanceof Error ? error.message : String(error),
    });
    await closeMongoConnection();
    process.exit(1);
  });

  logger.debug('MongoDB shutdown handlers registered');
}
