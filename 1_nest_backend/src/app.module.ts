import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  // Recovery baseline: operational modules remain intentionally dormant.
  // Importing Watcher, Discord, Auto Hunter, Uploader, or workflow modules here
  // would start external side effects during bootstrap and offline tests.
  imports: [],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
