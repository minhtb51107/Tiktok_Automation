import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber } from 'class-validator';

export class CreateThreadsDramaDto {
  @IsString()
  @IsNotEmpty({ message: 'URL bài viết Threads không được để trống' })
  threadUrl: string;

  @IsString()
  @IsOptional()
  voiceStyle?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  customKeywords?: string[];

  @IsNumber()
  @IsOptional()
  maxDurationInSeconds?: number;
}