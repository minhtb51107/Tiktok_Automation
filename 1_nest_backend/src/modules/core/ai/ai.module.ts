import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { GeminiService } from './gemini.service';
import { OpenaiService } from './openai.service';
import { GroqService } from './groq.service';
import { HuggingFaceService } from './huggingface.service'; // Đảm bảo có dòng này
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [
    AiService, 
    GeminiService, 
    OpenaiService, 
    GroqService, 
    HuggingFaceService // THÊM DÒNG NÀY VÀO PROVIDERS
  ],
  exports: [AiService] 
})
export class AiModule {}