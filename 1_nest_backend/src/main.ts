import './config/backend-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { validateRuntimeConfig } from './config/runtime-config';
import { operatorBoundary } from './studio/production-harness';

async function bootstrap() {
  const config = validateRuntimeConfig(process.env);
  if (process.env.STUDIO_OPERATOR_ONLY === '1' &&
      (!process.env.STUDIO_DATA_ROOT || (process.env.STUDIO_OPERATOR_TOKEN || '').length < 32))
    throw Error('Operator mode requires an explicit Studio data root and a dedicated bearer token (minimum 32 characters)');
  const app = await NestFactory.create(AppModule);
  app.use(operatorBoundary);

  // 1. Tối ưu Bắt lỗi toàn cục (Global Exception Filter)
  app.useGlobalFilters(new HttpExceptionFilter());

  // 2. Tối ưu Logging & Transform Response
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // 3. Tối ưu Validation dữ liệu đầu vào (Global Validation Pipe)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Tự động loại bỏ các field thừa không khai báo trong DTO
      transform: true, // Tự động ép kiểu dữ liệu
    }),
  );

  await app.listen(config.port, '127.0.0.1');
}
bootstrap();
