import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { validateRuntimeConfig } from './config/runtime-config';

async function bootstrap() {
  const config = validateRuntimeConfig(process.env);
  const app = await NestFactory.create(AppModule);

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
