import path from 'path';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { adminRouter } from './src/server/routes/adminRouter.ts';
import { authRouter } from './src/server/routes/authRouter.ts';
import { catalogRouter } from './src/server/routes/catalogRouter.ts';
import { communityRouter } from './src/server/routes/communityRouter.ts';
import { readerRouter } from './src/server/routes/readerRouter.ts';
import { studioRouter } from './src/server/routes/studioRouter.ts';
import { verifyCsrfForCookieAuth } from './src/server/security.ts';
import { ensureLiteraSeed } from './src/server/seed.ts';
import { processDuePublicationEvents } from './src/server/worker.ts';

dotenv.config();

export function createLiteraApp() {
  const app = express();

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(verifyCsrfForCookieAuth);

  // Serve generated editorial cover & library photography reliably in dev & production
  app.use('/assets/editorial', express.static(path.resolve(process.cwd(), 'src', 'assets', 'images')));

  // Lazy idempotent seed guard on API entry
  let seedPromise: Promise<void> | null = null;
  app.use('/api', async (req, _res, next) => {
    if (req.path === '/health') {
      next();
      return;
    }
    if (!seedPromise) {
      seedPromise = ensureLiteraSeed().catch((err) => {
        console.error('Seed initialization warning:', err);
        seedPromise = null;
      });
    }
    await seedPromise;
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'litera-api' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/reader', readerRouter);
  app.use('/api/studio', studioRouter);
  app.use('/api/community', communityRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', catalogRouter);

  return app;
}

async function startServer() {
  const app = createLiteraApp();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`LITERA Digital Literature Ecosystem listening on http://localhost:${PORT}`);
  });

  const workerTimer = setInterval(() => {
    void processDuePublicationEvents();
  }, 20_000);
  workerTimer.unref();

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${PORT} is currently in use; retrying bind in 1000ms...`);
      setTimeout(() => {
        server.close();
        server.listen(PORT, '0.0.0.0');
      }, 1000);
    } else {
      console.error('Server error:', err);
    }
  });
}

if (process.env.VITEST !== 'true') {
  startServer().catch((err) => {
    console.error('Failed to start LITERA server:', err);
    process.exit(1);
  });
}
