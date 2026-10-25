import { Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { ThreadsSeriousModule } from '../../workflows/threads-serious/threads-serious.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ThreadsSeriousModule],
  providers: [DiscordService],
  exports: [DiscordService]
})
export class DiscordModule {}
