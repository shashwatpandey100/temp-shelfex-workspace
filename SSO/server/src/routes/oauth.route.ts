import { Router } from 'express';
import { authorize, token } from '../controllers/oauth.controller';

const router = Router();

router.get('/authorize', authorize);
router.post('/token', token);

export default router;
