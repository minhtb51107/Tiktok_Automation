import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method=req.method;
    const url=String(req.url).startsWith('/api/studio/tiktok/oauth/')?String(req.url).split('?')[0]+'?[redacted]':req.url;
    const now = Date.now();

    return next
      .handle()
      .pipe(
        tap(() => this.logger.log(`[${method}] ${url} - Finished in ${Date.now() - now}ms`)),
      );
  }
}
