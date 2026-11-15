// Some networks (antivirus HTTPS scanning, certain routers/ISPs) stall when many secure
// connections are opened at the same instant: Node's default fetch opens one per parallel
// request, and most of them hit a 10-second connect timeout. A small pool of reused
// keep-alive connections avoids that entirely (measured: 2/8 → 8/8 requests succeeding).
// Tune with HTTP_MAX_CONNECTIONS (connections per host, default 2).
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(new Agent({
  connections: Math.max(1, Number(process.env.HTTP_MAX_CONNECTIONS || 2)),
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
  connect: { timeout: 8_000 },
}));
