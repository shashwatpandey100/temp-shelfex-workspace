import { cleanEnv, str, port } from 'envalid';

const validateEnv = () => {
  cleanEnv(process.env, {
    NODE_ENV: str(),
    PORT: port(),
    DATABASE_URL: str(),
    ACCESS_TOKEN_SECRET: str(),
    REFRESH_TOKEN_SECRET: str(),
    CORS_ORIGIN: str(),
    FRONTEND_URL: str(),
    EMAIL_VERIFICATION_REQUIRED: str(),
    RESEND_API_KEY: str(),
    RESEND_FROM_EMAIL: str(),
  });
};

export default validateEnv;
