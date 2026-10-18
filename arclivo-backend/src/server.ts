import './config';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import { assertSafeStartup, config } from './config';
import apiRouter from './routes/api';
import phase2Router from './routes/phase2';
import phase3Router from './routes/phase3';
import phase4Router from './routes/phase4';
import { SchedulerService } from './services/schedulerService';
import { logger } from './utils/logger';

export const app = express();
app.disable('x-powered-by');
if (config.nodeEnv === 'production') app.set('trust proxy', 1);

app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Origin is not allowed by CORS policy.'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
}));
app.use(express.json({ limit: config.requestBodyLimit, strict: true }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => logger.info('http_request', {
    method: req.method,
    path: req.path,
    status: res.statusCode,
    durationMs: Date.now() - start,
  }));
  next();
});

const health = (_req: express.Request, res: express.Response) => res.json({
  service: 'Arclivo Labs AI Email Automation API',
  status: 'online',
  version: '1.1.0',
  timestamp: new Date().toISOString(),
});
app.get('/', health);
app.get('/healthz', health);
app.use('/api', apiRouter);
app.use('/api', phase2Router);
app.use('/api', phase3Router);
app.use('/api', phase4Router);

app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('request_failed', { message: error?.message || 'unknown' });
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large.' });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: 'Malformed JSON request.' });
    return;
  }
  if (error?.message === 'Origin is not allowed by CORS policy.') {
    res.status(403).json({ error: 'Origin is not allowed.' });
    return;
  }
  res.status(500).json({ error: 'Internal server error.' });
});

export function startServer() {
  assertSafeStartup();
  const server = app.listen(config.port, () => {
    logger.info('server_started', { port: config.port, environment: config.nodeEnv });
    SchedulerService.start();
  });

  const shutdown = (signal: string) => {
    logger.info('shutdown_started', { signal });
    SchedulerService.stop();
    const timeout = setTimeout(() => {
      logger.error('shutdown_forced');
      process.exit(1);
    }, 10_000);
    timeout.unref();
    server.close(error => {
      if (error) {
        logger.error('shutdown_failed', { message: error.message });
        process.exitCode = 1;
      }
      clearTimeout(timeout);
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

if (require.main === module) startServer();

export default app;
