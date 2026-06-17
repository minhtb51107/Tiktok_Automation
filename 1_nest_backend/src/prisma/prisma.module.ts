import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // Thêm dòng này
@Module({
  providers: [PrismaService],
  exports: [PrismaService], // Thêm dòng này
})
export class PrismaModule {}
