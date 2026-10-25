import { IsString, IsNotEmpty, IsUrl } from 'class-validator';

export class GenerateThreadsDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng cung cấp url bài viết Threads' })
  // Nếu url bắt buộc phải là dạng link web, bạn có thể bật thêm @IsUrl()
  url: string;
}