import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { GeminiService } from './gemini.service';
import { OpenaiService } from './openai.service';
import { GroqService } from './groq.service';

@Module({
  providers: [AiService, GeminiService, OpenaiService, GroqService],
  exports: [AiService] 
})
export class AiModule {}
