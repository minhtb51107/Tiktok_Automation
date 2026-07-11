const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Giả lập class TtsService để test hàm
class TtsServiceTest {
    constructor() {
        // Đường dẫn tới thư mục lưu audio (giả lập publicDir của bạn)
        this.publicDir = path.join(__dirname, 'test_output');
        
        if (!fs.existsSync(this.publicDir)) {
            fs.mkdirSync(this.publicDir, { recursive: true });
        }
    }

    async getKokoroBuffer(text, gender, part, total) {
        // ĐƯỜNG DẪN ĐẾN FILE PYTHON CỦA BẠN
        const scriptPath = 'D:/LCOM108_NMLT/code/100_bai_code/tep_chua_python/Kokoro-Vietnamese/make_tts.py';
        
        // File tạm để nhận kết quả từ Python
        const tempFile = path.join(this.publicDir, `temp_part_${part}.wav`);

        try {
            // Ép ký tự xuống dòng hoặc nháy kép để không lỗi dòng lệnh command line
            const cleanedText = text.replace(/"/g, '\\"').replace(/\n/g, ' ');
            
            // Chuẩn hóa đường dẫn file để tránh lỗi dấu gạch chéo trên Windows
            const safeTempFile = tempFile.replace(/\\/g, '/');
            
            const command = `python "${scriptPath}" "${cleanedText}" "${gender}" "${safeTempFile}"`;
            
            console.log(`🤖 [KOKORO OFFLINE] Đang gửi câu ${part}/${total} sang Python xử lý...`);
            
            // Chạy lệnh shell
            const result = execSync(command).toString().trim();

            if (result.includes("SUCCESS") && fs.existsSync(tempFile)) {
                const buffer = fs.readFileSync(tempFile);
                fs.unlinkSync(tempFile); // Xóa file tạm
                return buffer;
            } else {
                throw new Error(`Python trả về kết quả không mong đợi: ${result}`);
            }
        } catch (error) {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            throw new Error(`Lỗi thực thi Kokoro Python: ${error.message}`);
        }
    }

    // Hàm giả lập quá trình xử lý băm câu và hàn file giống hàm generateAudio của bạn
    async testGenerateAudio(text, fileName, gender) {
        try {
            console.log("✂️ Bắt đầu xử lý thử nghiệm văn bản...");
            
            // Giả lập băm text thành 2 câu để test tính năng lặp và nối buffer
            const chunks = [
                "Xin chào anh ạ! Đây là câu thứ nhất được chạy offline hoàn toàn.",
                "Hệ thống đã kết nối thành công giữa nốt ji ét và mô hình cô cô rô python."
            ];
            
            const audioBuffers = [];

            for (let i = 0; i < chunks.length; i++) {
                const buffer = await this.getKokoroBuffer(chunks[i], gender, i + 1, chunks.length);
                audioBuffers.push(buffer);
            }

            // Hàn các buffer lại thành file âm thanh cuối cùng
            const finalBuffer = Buffer.concat(audioBuffers);
            const filePath = path.join(this.publicDir, fileName);
            fs.writeFileSync(filePath, finalBuffer);

            console.log(`\n✅ THÀNH CÔNG RỰC RỠ!`);
            console.log(`🔗 File âm thanh tổng hợp đã được lưu tại: ${filePath}`);
        } catch (err) {
            console.error(`❌ Test thất bại: ${err.message}`);
        }
    }
}

// Tiến hành chạy thử nghiệm
const tester = new TtsServiceTest();
tester.testGenerateAudio(
    "Văn bản chạy thử", 
    "ket_qua_kokoro.wav", 
    "female" // Giọng nữ
);