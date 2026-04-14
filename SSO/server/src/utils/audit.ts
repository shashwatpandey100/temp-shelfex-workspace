import { Request } from 'express';
import { db } from '../db';
import { auditLogs } from '../db/schema';
import logger from './logger';

export async function logAudit(
  action: string,
  req: Request,
  userId?: string | null,
  metadata?: Record<string, unknown>,
) {
  try {
    await db.insert(auditLogs).values({
      userId: userId || null,
      action,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
      metadata: metadata || null,
    });
  } catch (error) {
    // Audit logging should never break the request
    logger.error(`Audit log error: ${error}`);
  }
}
