import { buildApp } from './app';
import { createContext } from './context';

const ctx = createContext(process.env);
const app = buildApp({ ...ctx, logger: true });
const port = Number(process.env.INGEST_PORT || 8787);
const host = process.env.INGEST_HOST || '0.0.0.0';
app
  .listen({ port, host })
  .then(() => app.log.info(`fairway ingest (${ctx.mode} mode, mids=${ctx.mids.name}, ${ctx.pools.length} pools) on http://localhost:${port}`))
  .catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
