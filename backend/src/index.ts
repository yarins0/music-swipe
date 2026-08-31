import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';

import authRouter from './routes/auth';
import usersRouter from './routes/users';
import sessionsRouter from './routes/sessions';
import swipesRouter from './routes/swipes';
import { globalRateLimiter } from './middleware/rateLimit';

const app = express();
const PORT = process.env.PORT ?? 3000;

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') ?? [
  'http://localhost:3000',
  'http://localhost:19000',
];

app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(globalRateLimiter);

app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/sessions', sessionsRouter);
app.use('/swipes', swipesRouter);

// Render polls this path to decide whether the instance is live.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`MusicSwipe backend running on port ${PORT}`);
});

export default app;
