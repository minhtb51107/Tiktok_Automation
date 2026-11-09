import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { GeminiService } from './providers/gemini.service';
import { GroqService } from './providers/groq.service';
import { OpenaiService } from './providers/openai.service';
import { HuggingFaceService } from './providers/huggingface.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [
    AiService,
    GeminiService,
    OpenaiService,
    GroqService,
    HuggingFaceService,
  ],
  exports: [AiService],
})
export class AiModule {}