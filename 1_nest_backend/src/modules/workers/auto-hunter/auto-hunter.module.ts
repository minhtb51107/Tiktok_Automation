import { Module } from '@nestjs/common';
import { HunterService } from './hunter.service';
import { HunterSeriousService } from './hunter-serious.service';

// Import các Module chứa các Service mà HunterService cần:
import { ScraperModule } from '../../core/scraper/scraper.module';
import { AiModule } from '../../core/ai/ai.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { DiscordModule } from '../../core/notification/discord.module';

@Module({
  imports: [
    ScraperModule, // 👈 Sửa lỗi ScraperService ở index [0]
    AiModule,      // Cho AiService
    PrismaModule,  // Cho PrismaService
    DiscordModule, // Cho DiscordService
  ],
  providers: [HunterService, HunterSeriousService],
  exports: [HunterService, HunterSeriousService],
})
export class AutoHunterModule {}