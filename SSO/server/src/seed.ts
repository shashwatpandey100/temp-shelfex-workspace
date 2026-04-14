import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { clientApps, users } from './db/schema';
import { hashPassword } from './utils/jwt';
import logger from './utils/logger';

// Seed Database - This script registers client applications and test users.
// Run with: npm run db:seed

async function seedTestUser() {
  try {
    logger.info('Seeding test user...');

    const testUser = {
      email: 'test@shelfex.com',
      username: 'testuser',
      password: '12345', // CHANGE IN PRODUCTION!
      name: 'Test User',
    };

    // Check if user already exists
    const existing = await db.query.users.findFirst({
      where: eq(users.email, testUser.email),
    });

    if (existing) {
      logger.warn(`Test user ${testUser.email} already exists, skipping...`);
      return;
    }

    // Hash password
    const hashedPassword = await hashPassword(testUser.password);

    // Insert user
    await db.insert(users).values({
      email: testUser.email,
      username: testUser.username,
      password: hashedPassword,
      name: testUser.name,
      emailVerified: true, // Pre-verified for testing
    });

    logger.info(`Seeded test user: ${testUser.email}`);
    logger.info(`Username: ${testUser.username}`);
    logger.info(`Password: ${testUser.password}`);
    logger.info(`Email Verified: true`);
  } catch (error) {
    logger.error('Error seeding test user:', error);
    throw error;
  }
}

async function seedClientApps() {
  try {
    logger.info('Starting client apps seeding...');

    const clients = [
      {
        clientId: 'shelfscan',
        clientSecret: 'shelfscan-dev-secret-2025', // CHANGE IN PRODUCTION!
        name: 'ShelfScan',
        allowedRedirectUris: [
          'http://localhost:3000/callback',
          'http://localhost:3000/auth/callback',
          'https://devshelfscan.shelfexecution.com/callback',
          'https://devshelfscan.shelfexecution.com/auth/callback',
        ],
      },
      {
        clientId: 'shelfmuse',
        clientSecret: 'shelfmuse-dev-secret-2025', // CHANGE IN PRODUCTION!
        name: 'ShelfMuse',
        allowedRedirectUris: [
          'http://localhost:3000/callback',
          'http://localhost:3000/auth/callback',
          'https://dev.shelfmuse.tech/callback',
          'https://dev.shelfmuse.tech/auth/callback',
        ],
      },
      {
        clientId: 'shelfintel',
        clientSecret: 'shelfintel-dev-secret-2025', // CHANGE IN PRODUCTION!
        name: 'ShelfIntel',
        allowedRedirectUris: [
          'http://localhost:3000/callback',
          'http://localhost:3000/auth/callback',
        ],
      },
      {
        clientId: 'shelf360',
        clientSecret: 'shelf360-dev-secret-2025', // CHANGE IN PRODUCTION!
        name: 'Shelf360',
        allowedRedirectUris: [
          'http://localhost:3001/auth/callback',
          'https://360.shelfexecution.com/auth/callback',
        ],
      },
    ];

    for (const client of clients) {
      logger.info(`Seeding client: ${client.clientId}`);

      // Hash the client secret
      const hashedSecret = await hashPassword(client.clientSecret);

      // Check if client already exists
      const existing = await db.query.clientApps.findFirst({
        where: eq(clientApps.clientId, client.clientId),
      });

      if (existing) {
        logger.warn(`Client ${client.clientId} already exists, skipping...`);
        continue;
      }

      // Insert client
      await db.insert(clientApps).values({
        clientId: client.clientId,
        clientSecret: hashedSecret,
        name: client.name,
        allowedRedirectUris: client.allowedRedirectUris,
      });

      logger.info(`Seeded ${client.name} (${client.clientId})`);
      logger.info(`Client Secret: ${client.clientSecret}`);
      logger.info(`Allowed URIs: ${client.allowedRedirectUris.join(', ')}`);
    }

    logger.info('\nClient apps seeding completed!');
    logger.info('\nRemember to save these client secrets securely:');
    clients.forEach((c) => {
      logger.info(`   ${c.clientId}: ${c.clientSecret}`);
    });
  } catch (error) {
    logger.error('Error seeding client apps:', error);
    throw error;
  }
}

async function seedAll() {
  try {
    logger.info('Starting database seeding...\n');

    await seedTestUser();
    logger.info('');
    await seedClientApps();

    logger.info('\nDatabase seeding completed successfully!');
    logger.info('\nTest Credentials:');
    logger.info('Email: test@shelfex.com');
    logger.info('Username: testuser');
    logger.info('Password: 12345');

    process.exit(0);
  } catch (error) {
    logger.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seedAll();
