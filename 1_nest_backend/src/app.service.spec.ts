import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;

  // Khởi tạo môi trường trước mỗi lần test
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AppService],
    }).compile();

    service = module.get<AppService>(AppService);
  });

  // Test case 1: Kiểm tra xem service có được khởi tạo thành công không
  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Test case 2: Kiểm tra hàm cơ bản (Ví dụ giả định hàm getHello() trả về 'Hello World!')
  it('should return "Hello World!"', () => {
    // Giả sử trong app.service.ts của bạn có hàm getHello()
    // Nếu không có, bạn có thể xóa test case này
    if (service.getHello) {
      expect(service.getHello()).toBe('Hello World!');
    }
  });
});