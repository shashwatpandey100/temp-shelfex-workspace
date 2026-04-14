import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { errorMiddleware } from './middlewares/error.middleware';
import healthRoutes from './routes/health.route';
import authRoutes from './routes/auth.route';
import oauthRoutes from './routes/oauth.route';

const app = express();

// Trust first proxy (nginx/ALB) for accurate req.ip and req.protocol
app.set('trust proxy', 1);

const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'];

app.use(helmet());
app.use(cors({ 
  origin: (origin, callback) => {
    // No Origin header = direct browser navigation (redirects, address bar, GET requests)
    // CORS only applies to cross-origin AJAX — browser redirects (e.g. /oauth/authorize)
    // never send an Origin header, so they must be allowed through.
    // This is safe because CORS controls *browser AJAX*, not server-to-server or curl.
    // Sensitive endpoints are protected by auth tokens, not CORS.
    if (!origin) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true 
}));
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const apiV1 = express.Router();

apiV1.use('/health', healthRoutes);
apiV1.use('/auth', authRoutes);
apiV1.use('/oauth', oauthRoutes);

app.use('/api/v1', apiV1);

app.use(errorMiddleware);

export default app;
