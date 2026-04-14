import { Request, Response, NextFunction } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db';

export const checkHealth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const startTime = Date.now();
    await db.execute(sql`SELECT 1`);
    const dbLatency = Date.now() - startTime;

    res.status(200).json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      services: {
        database: {
          status: 'UP',
          latency: `${dbLatency}ms`,
        },
      },
      // add Redis or Cache checks here later
    });
  } catch (error) {
    next(error);
  }
};
