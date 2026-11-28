import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";
import type { Pool } from "pg";

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  readonly registry = new Registry();
  readonly enabled: boolean;
  private readonly lag = monitorEventLoopDelay({ resolution: 20 });
  private timer?: ReturnType<typeof setInterval>;
  private pool?: Pool;
  private readonly http = new Histogram({ name: "seminar_http_duration_seconds", help: "HTTP latency by route template", labelNames: ["method", "route", "status"], buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10], registers: [this.registry] });
  private readonly query = new Histogram({ name: "seminar_db_query_duration_seconds", help: "Database query latency without SQL or parameters", buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5], registers: [this.registry] });
  private readonly eventLoop = new Gauge({ name: "seminar_event_loop_lag_p99_seconds", help: "Event loop delay p99 over the last 10 seconds", registers: [this.registry] });
  private readonly connections = new Gauge({ name: "seminar_db_connections", help: "Postgres pool connections", labelNames: ["state"], registers: [this.registry] });
  constructor(@Inject(ConfigService) config: ConfigService) { this.enabled = config.get<boolean>("METRICS_ENABLED") === true; }
  registerPool(pool: Pool): void { this.pool = pool; }
  observeQuery(ms: number): void { if (this.enabled) this.query.observe(ms / 1000); }
  observeHttp(method: string, route: string, status: number, seconds: number): void {
    if (this.enabled) this.http.observe({ method, route, status: String(status) }, seconds);
  }
  onModuleInit(): void {
    if (!this.enabled) return;
    collectDefaultMetrics({ register: this.registry });
    this.lag.enable();
    this.timer = setInterval(() => {
      this.eventLoop.set(this.lag.percentile(99) / 1e9);
      this.lag.reset();
      if (this.pool) {
        this.connections.set({ state: "total" }, this.pool.totalCount);
        this.connections.set({ state: "idle" }, this.pool.idleCount);
        this.connections.set({ state: "waiting" }, this.pool.waitingCount);
      }
    }, 10_000);
    this.timer.unref();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.lag.disable(); this.registry.clear(); }
}
