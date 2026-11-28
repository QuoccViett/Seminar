import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from "@nestjs/common";
import { defer, firstValueFrom, Observable } from "rxjs";
import { RuntimeCache } from "../../common/services/runtime-cache.service.js";

/** Guards chạy trước interceptor; chỉ dùng cho các snapshot dashboard ADMIN. */
@Injectable()
export class DashboardCacheInterceptor implements NestInterceptor {
  constructor(@Inject(RuntimeCache) private readonly cache: RuntimeCache) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ originalUrl: string }>();
    return defer(() => this.cache.remember(`dashboard:${request.originalUrl}`, this.cache.ttl("dashboard"), () => firstValueFrom(next.handle())));
  }
}
