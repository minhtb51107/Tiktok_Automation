import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { GeminiService } from './gemini.service';
import { OpenaiService } from './openai.service';
import { GroqService } from './groq.service';

@Module({
  // Khai báo tất cả các service AI bạn đang có
  providers: [AiService, GeminiService, OpenaiService, GroqService],
  // BẮT BUỘC: Export AiService để các Module khác (như Threads) có thể xài được
  exports: [AiService] 
})
export class AiModule {}