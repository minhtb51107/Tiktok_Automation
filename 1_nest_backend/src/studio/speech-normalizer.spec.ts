import { describe, it, expect, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  buildNormalizationRecord,
  clearSpeechNormalizerCache,
  normalizeSpeech,
  prepareTtsInput,
  SPEECH_RULE_COUNT,
} from './speech-normalizer';
import { speechProjection } from './speech-dictionary';
import { StudioService } from './studio.service';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import { sessionReadiness } from './session-readiness';

interface BenchmarkCase {
  id: string;
  group: string;
  input: string;
  expected: string;
  mode?: 'TTS' | 'SCRIPT';
  expectAmbiguous?: string[];
  expectNoWarnings?: boolean;
}

/**
 * 115 Vietnamese social/Threads regression cases covering:
 * - Must-expand teencode, abbreviations, acronyms, context rules, numbers & units
 * - Must-NOT-expand / anti-mistranslation cases (protected tokens, style, ambiguous terms)
 * - Real captured Threads posts & replies (product-mvp-live02)
 */
const BENCHMARK_CASES: BenchmarkCase[] = [
  // ===== 1. Core prompt examples & context-sensitive `k` =====
  { id: 'K01', group: 'k-neg', input: 'k đi', expected: 'không đi' },
  { id: 'K02', group: 'k-neg', input: 'k bt có đc ko', expected: 'không biết có được không' },
  { id: 'K03', group: 'k-neg', input: 'K biết nữa', expected: 'Không biết nữa' },
  { id: 'K04', group: 'k-neg', input: 'đi làm k?', expected: 'đi làm không?' },
  { id: 'K05', group: 'k-neg', input: 'có cần kinh nghiệm k ạ và k có tiếng', expected: 'có cần kinh nghiệm không ạ và không có tiếng' },
  { id: 'K06', group: 'k-neg', input: 'cũng k biết có dây chuyền gì k', expected: 'cũng không biết có dây chuyền gì không' },
  { id: 'K07', group: 'k-money', input: '50k', expected: 'năm mươi nghìn' },
  { id: 'K08', group: 'k-money', input: '50k/tháng', expected: 'năm mươi nghìn một tháng' },
  { id: 'K09', group: 'k-money', input: '200k/ngày', expected: 'hai trăm nghìn một ngày' },
  { id: 'K10', group: 'k-money', input: '20-30k', expected: 'hai mươi đến ba mươi nghìn' },
  { id: 'K11', group: 'k-keep', input: 'Vitamin K rất tốt', expected: 'Vitamin K rất tốt' },
  { id: 'K12', group: 'k-keep', input: 'nhóm k chưa họp', expected: 'nhóm k chưa họp' },
  { id: 'K13', group: 'k-keep', input: 'K-pop rất nổi tiếng', expected: 'K-pop rất nổi tiếng' },
  { id: 'K14', group: 'k-keep', input: 'khu K mới xây', expected: 'khu K mới xây' },
  { id: 'K15', group: 'k-keep', input: 'không khác gì kiếm việc', expected: 'không khác gì kiếm việc' },
  { id: 'K16', group: 'k-keep', input: 'độ K tăng cao', expected: 'độ K tăng cao' },

  // ===== 2. Context-sensitive `bh` =====
  { id: 'BH01', group: 'bh', input: 'bh đi làm?', expected: 'bao giờ đi làm?' },
  { id: 'BH02', group: 'bh', input: 'bh bạn nghỉ phép?', expected: 'bao giờ bạn nghỉ phép?' },
  { id: 'BH03', group: 'bh', input: 'đến bh mới xong?', expected: 'đến bao giờ mới xong?' },
  { id: 'BH04', group: 'bh', input: 'bh tôi đang làm', expected: 'bây giờ tôi đang làm' },
  { id: 'BH05', group: 'bh', input: 'bh đang giờ cao điểm', expected: 'bây giờ đang giờ cao điểm' },
  { id: 'BH06', group: 'bh', input: 'bh mình vẫn ở nhà', expected: 'bây giờ mình vẫn ở nhà' },
  { id: 'BH07', group: 'bh', input: 'chưa làm sx bh nên k biết', expected: 'chưa làm sản xuất bao giờ nên không biết' },
  { id: 'BH08', group: 'bh', input: 'k bh quay lại chỗ đó', expected: 'không bao giờ quay lại chỗ đó' },
  { id: 'BH09', group: 'bh', input: 'chưa bh thấy chuyện lạ vậy', expected: 'chưa bao giờ thấy chuyện lạ vậy' },
  { id: 'BH10', group: 'bh', input: 'cty đóng bh đầy đủ', expected: 'công ty đóng bảo hiểm đầy đủ' },
  { id: 'BH11', group: 'bh', input: 'mua bh y tế ở đâu?', expected: 'mua bảo hiểm y tế ở đâu?' },
  { id: 'BH12', group: 'bh-keep', input: 'cty này k có bh', expected: 'công ty này không có bh', expectAmbiguous: ['bh'] },
  { id: 'BH13', group: 'bh-keep', input: 'cty tuyển vp nhưng k biết bh', expected: 'công ty tuyển văn phòng nhưng không biết bh', expectAmbiguous: ['bh'] },
  { id: 'BH14', group: 'bh-keep', input: 'chưa làm bh đâu', expected: 'chưa làm bh đâu', expectAmbiguous: ['bh'] },

  // ===== 3. Context-sensitive `bt` =====
  { id: 'BT01', group: 'bt', input: 'bt rồi', expected: 'biết rồi' },
  { id: 'BT02', group: 'bt', input: 'mình đã bt rồi', expected: 'mình đã biết rồi' },
  { id: 'BT03', group: 'bt', input: 'k bt nói gì luôn', expected: 'không biết nói gì luôn' },
  { id: 'BT04', group: 'bt', input: 'ai bt đc chuyện ngày mai', expected: 'ai biết được chuyện ngày mai' },
  { id: 'BT05', group: 'bt', input: 'cũng bt thôi', expected: 'cũng bình thường thôi' },
  { id: 'BT06', group: 'bt', input: 'lương ở đây khá bt', expected: 'lương ở đây khá bình thường' },
  { id: 'BT07', group: 'bt', input: 'người bt cũng làm đc', expected: 'người bình thường cũng làm được' },
  { id: 'BT08', group: 'bt-keep', input: 'tối nay làm bt về nhà', expected: 'tối nay làm bt về nhà', expectAmbiguous: ['bt'] },
  { id: 'BT09', group: 'bt-keep', input: 'thầy giao nhiều bt quá', expected: 'thầy giao nhiều bt quá', expectAmbiguous: ['bt'] },

  // ===== 4. Teencode & safe abbreviations =====
  { id: 'TC01', group: 'teencode', input: 'ko đi làm', expected: 'không đi làm' },
  { id: 'TC02', group: 'teencode', input: 'khum hiểu nổi luôn', expected: 'không hiểu nổi luôn' },
  { id: 'TC03', group: 'teencode', input: 'Làm dc k?', expected: 'Làm được không?' },
  { id: 'TC04', group: 'teencode', input: 'Có dc nghỉ cuối tuần k?', expected: 'Có được nghỉ cuối tuần không?' },
  { id: 'TC05', group: 'teencode', input: 'bằng cấp 3 là đc', expected: 'bằng cấp ba là được' },
  { id: 'TC06', group: 'teencode-keep', input: 'Washington DC và AC/DC', expected: 'Washington DC và AC/DC' },
  { id: 'TC07', group: 'teencode', input: 'nma lương hơi thấp', expected: 'nhưng mà lương hơi thấp' },
  { id: 'TC08', group: 'teencode', input: 'nhma môi trường ổn', expected: 'nhưng mà môi trường ổn' },
  { id: 'TC09', group: 'teencode', input: 'Mn ơi cho mình hỏi', expected: 'Mọi người ơi cho mình hỏi' },
  { id: 'TC10', group: 'teencode', input: 'mng thấy cty này sao?', expected: 'mọi người thấy công ty này sao?' },
  { id: 'TC11', group: 'teencode', input: 'ngta hướng dẫn nhiệt tình lắm', expected: 'người ta hướng dẫn nhiệt tình lắm' },
  { id: 'TC12', group: 'teencode', input: 'công nhân bthg vất vả hơn', expected: 'công nhân bình thường vất vả hơn' },
  { id: 'TC13', group: 'teencode', input: 'mình cx chx trc đây làm bao giờ', expected: 'mình cũng chưa trước đây làm bao giờ' },
  { id: 'TC14', group: 'teencode', input: 'công việc đó ntn vậy?', expected: 'công việc đó như thế nào vậy?' },
  { id: 'TC15', group: 'teencode', input: 'hnay đi làm hqua nghỉ', expected: 'hôm nay đi làm hôm qua nghỉ' },
  { id: 'TC16', group: 'teencode', input: 'đag nch với sếp', expected: 'đang nói chuyện với sếp' },
  { id: 'TC17', group: 'teencode', input: 'ae đi ăn cơm chưa', expected: 'anh em đi ăn cơm chưa' },
  { id: 'TC18', group: 'teencode-keep', input: 'làm vị trí AE tại agency', expected: 'làm vị trí AE tại agency' },
  { id: 'TC19', group: 'teencode', input: 'b oi cho mình xin in4 cty dc hông ạ', expected: 'bạn ơi cho mình xin in phô công ty được hông ạ', expectNoWarnings: true },
  { id: 'TC20', group: 'teencode', input: 'có chuyện j thế?', expected: 'có chuyện gì thế?' },
  { id: 'TC21', group: 'teencode', input: 'sao v trời?', expected: 'sao vậy trời?' },
  { id: 'TC22', group: 'teencode', input: 'như v thì ổn', expected: 'như vậy thì ổn' },
  { id: 'TC23', group: 'teencode', input: 'làm kcn 10 năm r.', expected: 'làm khu công nghiệp mười năm rồi.' },
  { id: 'TC24', group: 'teencode-keep', input: 'học ngôn ngữ R và chữ r', expected: 'học ngôn ngữ R và chữ r' },
  { id: 'TC25', group: 'teencode', input: 'công nhân thik làm ca ngày', expected: 'công nhân thích làm ca ngày' },

  // ===== 5. Domain, workplace, places & acronyms =====
  { id: 'AB01', group: 'abbr', input: 'Mình học NNA, làm QA ở KCN', expected: 'Mình học ngôn ngữ Anh, làm kiu ây ở khu công nghiệp' },
  { id: 'AB02', group: 'abbr', input: 'cty fdi tuyển xnk, hr, qc, iqc', expected: 'công ty ép đi ai tuyển xuất nhập khẩu, nhân sự, kiu xi, ai kiu xi' },
  { id: 'AB03', group: 'abbr', input: 'lương ở HN cao hơn TP.HCM', expected: 'lương ở Hà Nội cao hơn Thành phố Hồ Chí Minh' },
  { id: 'AB04', group: 'abbr-keep', input: 'hn trời mưa to quá', expected: 'hn trời mưa to quá', expectAmbiguous: ['hn'] },
  { id: 'AB05', group: 'abbr', input: 'cty tuyển nhân viên vp', expected: 'công ty tuyển nhân viên văn phòng' },
  { id: 'AB06', group: 'abbr-keep', input: 'vp quay về hướng đông', expected: 'vp quay về hướng đông', expectAmbiguous: ['vp'] },
  { id: 'AB07', group: 'abbr', input: 'học đh hoặc cđ xong ra trg', expected: 'học đại học hoặc cao đẳng xong ra trường' },
  { id: 'AB08', group: 'abbr-keep', input: 'ĐH quay về nhà', expected: 'ĐH quay về nhà', expectAmbiguous: ['ĐH'] },
  { id: 'AB09', group: 'abbr', input: 'sv năm 3 đi thực tập', expected: 'sinh viên năm ba đi thực tập' },
  { id: 'AB10', group: 'abbr', input: 'làm hr trg KCN cần bhxh, bhyt, bhtn', expected: 'làm nhân sự trong khu công nghiệp cần bảo hiểm xã hội, bảo hiểm y tế, bảo hiểm thất nghiệp' },
  { id: 'AB11', group: 'abbr', input: 'nộp cv xin đi pv vòng 2', expected: 'nộp xi vi xin đi phỏng vấn vòng hai' },
  { id: 'AB12', group: 'abbr', input: 'điều phối cv nội bộ ở cty', expected: 'điều phối công việc nội bộ ở công ty' },
  { id: 'AB13', group: 'abbr', input: 'chưa có kn và thiếu kn giao tiếp', expected: 'chưa có kinh nghiệm và thiếu kỹ năng giao tiếp' },
  { id: 'AB14', group: 'abbr', input: 'nhập mk sai nên gọi đt hỏi sdt', expected: 'nhập mật khẩu sai nên gọi điện thoại hỏi số điện thoại' },
  { id: 'AB15', group: 'abbr-keep', input: 'mk thấy lương vậy ổn', expected: 'mk thấy lương vậy ổn', expectAmbiguous: ['mk'] },
  { id: 'AB16', group: 'abbr', input: 'nộp hs tuyển nv kho và ctv bán hàng', expected: 'nộp hồ sơ tuyển nhân viên kho và cộng tác viên bán hàng' },
  { id: 'AB17', group: 'abbr', input: 'lương bn tiền một tháng?', expected: 'lương bao nhiêu tiền một tháng?' },
  { id: 'AB18', group: 'abbr', input: 'toàn ng nhà lãnh đạo', expected: 'toàn người nhà lãnh đạo' },
  { id: 'AB19', group: 'abbr', input: 'tốt nghiệp NEU và FTU làm PM với CEO', expected: 'tốt nghiệp en e u và ép tê u làm pi em với xi i âu' },
  { id: 'AB20', group: 'abbr-keep', input: 'neu bạn muốn làm 2 hr', expected: 'neu bạn muốn làm hai hr', expectAmbiguous: ['neu'] },
  { id: 'AB21', group: 'abbr', input: 'KPI quý này đạt 100%', expected: 'ca pi ai quý này đạt một trăm phần trăm' },
  { id: 'AB22', group: 'abbr', input: 'đọc cmt của mn ở VN thấy vui', expected: 'đọc bình luận của mọi người ở Việt Nam thấy vui' },
  { id: 'AB23', group: 'abbr', input: 'bằng THPT hay THCS đều gửi stk được', expected: 'bằng trung học phổ thông hay trung học cơ sở đều gửi số tài khoản được' },

  // ===== 6. Numbers, money, dates, units, phone numbers =====
  { id: 'NU01', group: 'numbers', input: 'tiền bằng là +2tr500 mỗi tháng', expected: 'tiền bằng là cộng hai triệu năm trăm nghìn mỗi tháng' },
  { id: 'NU02', group: 'numbers', input: 'lương 2tr500k phụ cấp', expected: 'lương hai triệu năm trăm nghìn phụ cấp' },
  { id: 'NU03', group: 'numbers', input: 'lương tầm 8-10tr', expected: 'lương tầm tám đến mười triệu' },
  { id: 'NU04', group: 'numbers', input: 'giá 50.000đ hoặc $50', expected: 'giá năm mươi nghìn đồng hoặc năm mươi đô la Mỹ' },
  { id: 'NU05', group: 'numbers', input: 'tăng 3-5% mỗi năm, hiện 5,6%', expected: 'tăng ba đến năm phần trăm mỗi năm, hiện năm phẩy sáu phần trăm' },
  { id: 'NU06', group: 'numbers', input: 'Ngày 08/08/2026 và tháng 10/2026', expected: 'Ngày tám tháng tám năm hai nghìn không trăm hai mươi sáu và tháng mười năm hai nghìn không trăm hai mươi sáu' },
  { id: 'NU07', group: 'numbers', input: 'ngày 25/12 nghỉ lễ', expected: 'ngày hai mươi lăm tháng mười hai nghỉ lễ' },
  { id: 'NU08', group: 'numbers', input: 'làm từ 8h-17h, nghỉ trưa 12h30', expected: 'làm từ tám giờ đến mười bảy giờ, nghỉ trưa mười hai giờ ba mươi' },
  { id: 'NU09', group: 'numbers', input: 'chạy 120km/h, mang 5kg và 500ml nước', expected: 'chạy một trăm hai mươi ki lô mét trên giờ, mang năm ki lô gam và năm trăm mi li lít nước' },
  { id: 'NU10', group: 'numbers', input: 'cao 1m65, đi mất 15p', expected: 'cao một mét sáu mươi lăm, đi mất mười lăm phút' },
  { id: 'NU11', group: 'numbers', input: 'dùng mạng 5G và 4G, hỗ trợ 24/7', expected: 'dùng mạng năm gờ và bốn gờ, hỗ trợ hai mươi bốn trên bảy', expectNoWarnings: true },
  { id: 'NU12', group: 'numbers', input: 'mình sinh 2k2, bạn 2k4', expected: 'mình sinh hai ca hai, bạn hai ca bốn', expectNoWarnings: true },
  { id: 'NU13', group: 'numbers', input: 'gọi 0912.345.678 hoặc +84 912 345 678', expected: 'gọi không chín một hai ba bốn năm sáu bảy tám hoặc cộng tám bốn chín một hai ba bốn năm sáu bảy tám' },
  { id: 'NU14', group: 'numbers', input: 'tổng đài 1900 1234 và số 028 3822 1234', expected: 'tổng đài một chín không không một hai ba bốn và số không hai tám ba tám hai hai một hai ba bốn' },
  { id: 'NU15', group: 'numbers', input: 'chỉ làm 1 ngày/tuần, tới vòng 4-5', expected: 'chỉ làm một ngày một tuần, tới vòng bốn đến năm' },
  { id: 'NU16', group: 'numbers', input: 'TOEIC 700, tiếng Nhật N4 và N2', expected: 'TOEIC bảy trăm, tiếng Nhật en bốn và en hai' },
  { id: 'NU17', group: 'numbers', input: 'hỏi 5,6 quán xung quanh', expected: 'hỏi năm, sáu quán xung quanh' },
  { id: 'NU18', group: 'numbers', input: '3-4 thứ tiếng, lương 1.500.000 đồng', expected: 'ba đến bốn thứ tiếng, lương một triệu năm trăm nghìn đồng' },
  { id: 'NU19', group: 'numbers-keep', input: 'xe tải 20t chạy qua cầu', expected: 'xe tải 20t chạy qua cầu' },
  { id: 'NU20', group: 'numbers-keep', input: 'tỷ lệ 1:10 không dễ đâu', expected: 'tỷ lệ 1:10 không dễ đâu' },

  // ===== 7. Protected tokens & social writing style preservation =====
  { id: 'PR01', group: 'protected', input: 'xem ở https://www.threads.com/@gnrtth/post/DeI-TuzEc_9 nha', expected: 'xem ở https://www.threads.com/@gnrtth/post/DeI-TuzEc_9 nha', expectNoWarnings: true },
  { id: 'PR02', group: 'protected', input: 'nhắn @buiminhhoang1159 với #kcn_hn nhé', expected: 'nhắn @buiminhhoang1159 với #kcn_hn nhé', expectNoWarnings: true },
  { id: 'PR03', group: 'protected', input: 'gửi mail hr@cty-kcn.vn và mã source:abc_123', expected: 'gửi mail hr@cty-kcn.vn và mã source:abc_123', expectNoWarnings: true },
  { id: 'ST01', group: 'style', input: 'okela, toxic thật', expected: 'okela, toxic thật' },
  { id: 'ST02', group: 'style', input: 'đừng flex hay tạo drama nữa nha', expected: 'đừng flex hay tạo drama nữa nha' },
  { id: 'ST03', group: 'style', input: 'chán job văn phòng rùi cho iu đời thui', expected: 'chán job văn phòng rùi cho iu đời thui' },
  { id: 'ST04', group: 'style', input: 'Mất lòng trước, được lòng sau. Đời bạc vcl!', expected: 'Mất lòng trước, được lòng sau. Đời bạc vcl!' },
  { id: 'ST05', group: 'style', input: 't hỏi 5,6 quán =)))) → cay đcđ clm cmn', expected: 't hỏi năm, sáu quán cay đcđ clm cmn', expectAmbiguous: ['t', 'đcđ', 'clm', 'cmn'] },
  { id: 'ST06', group: 'style', input: 'hông biết có vô hong nè', expected: 'hông biết có vô hong nè' },

  // ===== 8. Real Threads posts & replies from product-mvp-live02 =====
  {
    id: 'RT01',
    group: 'real-live02',
    input: 'Có ai vào khu công nghiệp làm trong khối văn phòng hay việc khác ngoài công nhân sản xuất dây chuyền hong? Công vierjc là gì và có yêu cầu gì hong',
    expected: 'Có ai vào khu công nghiệp làm trong khối văn phòng hay việc khác ngoài công nhân sản xuất dây chuyền hong? Công việc là gì và có yêu cầu gì hong',
    expectNoWarnings: true,
  },
  {
    id: 'RT02',
    group: 'real-live02',
    input: 'Mình học NNA, không có kinh nghiệm gì về sản xuất nhưng hiện đang làm được 2 năm ở KCN khối văn phòng, nhân viên QA. Mình thấy làm khối văn phòng okela mà, lương cao hơn trên HN, toxic hay không cũng tùy môi trường thôi. Cơm bao 2 bữa rồi',
    expected: 'Mình học ngôn ngữ Anh, không có kinh nghiệm gì về sản xuất nhưng hiện đang làm được hai năm ở khu công nghiệp khối văn phòng, nhân viên kiu ây. Mình thấy làm khối văn phòng okela mà, lương cao hơn trên Hà Nội, toxic hay không cũng tùy môi trường thôi. Cơm bao hai bữa rồi',
    expectNoWarnings: true,
  },
  {
    id: 'RT03',
    group: 'real-live02',
    input: 'đa số vp trong kcn sẽ yêu cầu bằng cấp hoặc là có kinh nghiệm. \nít thì cũng phải có ngoại ngữ, tiếng Trung, Anh, Hàn gì đó \ncòn không thì tìm mấy công việc bên kho á, nhập hàng xuất hàng các thứ thao tác máy tính có lẽ sẽ đỡ vất vả hơn làm sản xuất dưới chuyền.',
    expected: 'đa số văn phòng trong khu công nghiệp sẽ yêu cầu bằng cấp hoặc là có kinh nghiệm. \nít thì cũng phải có ngoại ngữ, tiếng Trung, Anh, Hàn gì đó \ncòn không thì tìm mấy công việc bên kho á, nhập hàng xuất hàng các thứ thao tác máy tính có lẽ sẽ đỡ vất vả hơn làm sản xuất dưới chuyền.',
    expectNoWarnings: true,
  },
  {
    id: 'RT04',
    group: 'real-live02',
    input: 'Khối vp thì t thấy hay yc bằng cấp nha, cũng có vị trí k yc nhưng k nhiều, nếu k yc bằng cấp và chấp nhận cả k kinh nghiệm nữa thì lương sẽ thấp ý. T thấy vào sản xuất họ ít yc bằng cấp hơn mà t chưa làm sx bh nên cũng k biết có dây chuyền gì k',
    expected: 'Khối văn phòng thì t thấy hay yêu cầu bằng cấp nha, cũng có vị trí không yêu cầu nhưng không nhiều, nếu không yêu cầu bằng cấp và chấp nhận cả không kinh nghiệm nữa thì lương sẽ thấp ý. T thấy vào sản xuất họ ít yêu cầu bằng cấp hơn mà t chưa làm sản xuất bao giờ nên cũng không biết có dây chuyền gì không',
    expectAmbiguous: ['t', 'T'],
    expectNoWarnings: true,
  },
  {
    id: 'RT05',
    group: 'real-live02',
    input: 'Trong kcn thì đa số là các cty fdi nên nếu có ngoại ngữ hỗ trợ thì rất nhiều vị trí. Trợ lý phiên dịch, trợ lý bộ phận, xnk, thu mua, nghiệp vụ, tổng vụ, hr, các văn phòng xưởng …',
    expected: 'Trong khu công nghiệp thì đa số là các công ty ép đi ai nên nếu có ngoại ngữ hỗ trợ thì rất nhiều vị trí. Trợ lý phiên dịch, trợ lý bộ phận, xuất nhập khẩu, thu mua, nghiệp vụ, tổng vụ, nhân sự, các văn phòng xưởng …',
    expectNoWarnings: true,
  },
  {
    id: 'RT06',
    group: 'real-live02',
    input: 'Mn ơi để làm hr trg KCN thì có cần kinh nghiệm k ạ và k có tiếng',
    expected: 'Mọi người ơi để làm nhân sự trong khu công nghiệp thì có cần kinh nghiệm không ạ và không có tiếng',
    expectNoWarnings: true,
  },
  {
    id: 'RT07',
    group: 'real-live02',
    input: 'Nhiều cty yc vị trí công nhân cần tiếng Trung để đọc hiểu được bao bì sản phẩm nh lương sẽ cao hơn công nhân bthg và sẽ ít vất vả hơn nè',
    expected: 'Nhiều công ty yêu cầu vị trí công nhân cần tiếng Trung để đọc hiểu được bao bì sản phẩm nhưng lương sẽ cao hơn công nhân bình thường và sẽ ít vất vả hơn nè',
    expectNoWarnings: true,
  },
  {
    id: 'RT08',
    group: 'real-live02',
    input: 'có cần cái đầu lạnh chịu thị phi.... vân vân mây mây, có Qc,QA cần bằng cấp 3 là đc',
    expected: 'có cần cái đầu lạnh chịu thị phi.... vân vân mây mây, có kiu xi,kiu ây cần bằng cấp ba là được',
    expectNoWarnings: true,
  },
  {
    id: 'RT09',
    group: 'real-live02',
    input: 'C làm kcn 10 năm r. Văn phòng, nếu e có ngoại ngữ lên làm vp, đừng làm công nhân vất vả',
    expected: 'C làm khu công nghiệp mười năm rồi. Văn phòng, nếu e có ngoại ngữ lên làm văn phòng, đừng làm công nhân vất vả',
    expectNoWarnings: true,
  },
  {
    id: 'RT10',
    group: 'real-live02',
    input: 'Bộ phận mình đang thiếu 1 bạn làm IQC không phải ngồi chuyền san xuất nma mình ở Quang Châu Bắc Giang cơ huhu',
    expected: 'Bộ phận mình đang thiếu một bạn làm ai kiu xi không phải ngồi chuyền san xuất nhưng mà mình ở Quang Châu Bắc Giang cơ huhu',
    expectNoWarnings: true,
  },
];

describe('Vietnamese TTS Normalization Engine V3 — offline regression (115+ cases)', () => {
  it('has at least 100 distinct regression cases and reports rule inventory', () => {
    expect(BENCHMARK_CASES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(BENCHMARK_CASES.map((c) => c.id)).size).toBe(
      BENCHMARK_CASES.length,
    );
    expect(SPEECH_RULE_COUNT.tokenRules).toBeGreaterThan(50);
    expect(SPEECH_RULE_COUNT.contextRules).toBeGreaterThan(20);
  });

  it.each(BENCHMARK_CASES)(
    '[$id / $group] normalizes accurately, preserves originalText, and is idempotent',
    (c) => {
      const res = normalizeSpeech(c.input, { mode: c.mode ?? 'TTS' });
      expect(res.valid).toBe(true);
      expect(res.originalText).toBe(c.input);
      expect(res.spokenText).toBe(c.expected);
      if (c.expectAmbiguous) {
        for (const term of c.expectAmbiguous) {
          expect(res.ambiguousTerms.map((a) => a.term)).toContain(term);
        }
      }
      if (c.expectNoWarnings) {
        expect(res.warnings).toEqual([]);
      }
      // Strict idempotency: running the engine again produces byte-identical output.
      const again = normalizeSpeech(res.spokenText, { mode: c.mode ?? 'TTS' });
      expect(again.spokenText).toBe(res.spokenText);
      expect(again.changes).toEqual([]);
    },
  );

  it('fulfills Output Contract with exact change positions, rule IDs, hash, cacheHit and immutability', () => {
    clearSpeechNormalizerCache();
    const item = {
      originalText: 'Mình học NNA, làm QA ở KCN, lương 50k/tháng',
      displayText: 'Mình học NNA, làm QA ở KCN, lương 50k/tháng',
      spokenText: 'Mình học NNA, làm QA ở KCN, lương 50k/tháng',
    };
    const record = buildNormalizationRecord(item);
    expect(record.originalText).toBe(item.originalText);
    expect(record.displayText).toBe(item.displayText);
    expect(record.ttsInputText).toBe(
      'Mình học ngôn ngữ Anh, làm kiu ây ở khu công nghiệp, lương năm mươi nghìn một tháng',
    );
    expect(record.ttsInputHash).toBe(
      createHash('sha256').update(record.ttsInputText).digest('hex'),
    );
    expect(record.normalizationVersion).toContain('vi-speech-norm/3');
    expect(record.normalizationVersion).toContain('vi-social-speech/3');
    expect(record.normalizationVersion).toContain('vi-speech-policy/3');
    expect(record.normalizationVersion).toContain('vi-numbers-2');
    for (const ch of record.normalizationChanges) {
      expect(item.spokenText.slice(ch.start, ch.end)).toBe(ch.before);
      expect(ch.ruleId).toMatch(/^(ABBR|PRON|NUM|CTX|TEEN|PHRASE|TYPO|PLACE|SYM|OVERRIDE)-/);
    }
    // Cache hit on identical call, miss on different overrides
    const first = speechProjection('cty ko cmt');
    const second = speechProjection('cty ko cmt');
    const overridden = speechProjection('cty ko cmt', { cty: 'xưởng' });
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.text).toBe('công ty không bình luận');
    expect(overridden.cacheHit).toBe(false);
    expect(overridden.text).toBe('xưởng không bình luận');
  });

  it('keeps existing V2 WAVs valid when TTS input is unchanged and marks only changed scenes STALE', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'v3-wav-compat-'));
    const service = new StudioService({} as ScraperService);
    let synthCalls = 0;
    const ready = {
      status: 'READY',
      python: 'MOCK',
      packageVersion: 'MOCK',
      imports: {},
      voices: [{ id: 'my_yen', label: 'My Yen' }],
      declaredVoices: [{ id: 'my_yen', label: 'My Yen' }],
      model: 'MOCK',
      modelVersion: 'MOCK',
      device: 'MOCK',
      gpuAvailable: null,
      ffmpeg: true,
      ffprobe: true,
      blockers: [],
      checkedAt: new Date().toISOString(),
    };
    Object.assign(service, {
      root,
      voice: {
        preflight: async () => ready,
        generate: async (sessionId: string, text: string) => {
          synthCalls++;
          const dir = path.join(root, 'audio', sessionId, 'assets');
          await fs.mkdir(dir, { recursive: true });
          const name = `v3-${synthCalls}.wav`;
          await fs.writeFile(path.join(dir, name), `RIFF:${text}`);
          return {
            filePath: `audio/${sessionId}/assets/${name}`,
            durationMs: 12000,
            cacheKey: `v3-key-${synthCalls}`,
            cacheHit: false,
          };
        },
        close: () => {},
      },
    });
    const fetchSpy = jest.spyOn(global, 'fetch');
    try {
      const sha = (t: string) => createHash('sha256').update(t).digest('hex');
      const v2Scenes = [
        {
          id: 'scene-0',
          spokenText:
            'Có ai vào khu công nghiệp làm trong khối văn phòng hay việc khác ngoài công nhân sản xuất dây chuyền hong? Công việc là gì và có yêu cầu gì hong',
          v2Tts:
            'Có ai vào khu công nghiệp làm trong khối văn phòng hay việc khác ngoài công nhân sản xuất dây chuyền hong? Công việc là gì và có yêu cầu gì hong',
        },
        {
          id: 'scene-1',
          spokenText:
            'Mình học ngôn ngữ Anh, không có kinh nghiệm gì về sản xuất nhưng hiện đang làm được 2 năm ở khu công nghiệp khối văn phòng, nhân viên kiu ây. Mình thấy làm khối văn phòng okela mà, lương cao hơn trên Hà Nội, toxic hay không cũng tùy môi trường thôi. Cơm bao 2 bữa rồi',
          v2Tts:
            'Mình học ngôn ngữ Anh, không có kinh nghiệm gì về sản xuất nhưng hiện đang làm được hai năm ở khu công nghiệp khối văn phòng, nhân viên kiu ây. Mình thấy làm khối văn phòng okela mà, lương cao hơn trên Hà Nội, toxic hay không cũng tùy môi trường thôi. Cơm bao hai bữa rồi',
        },
        {
          id: 'scene-3',
          spokenText:
            'Khối văn phòng thì t thấy hay yêu cầu bằng cấp nha, cũng có vị trí k yêu cầu nhưng k nhiều, nếu k yêu cầu bằng cấp và chấp nhận cả k kinh nghiệm nữa thì lương sẽ thấp ý. T thấy vào sản xuất họ ít yêu cầu bằng cấp hơn mà t chưa làm sản xuất bh nên cũng k biết có dây chuyền gì k',
          v2Tts:
            'Khối văn phòng thì t thấy hay yêu cầu bằng cấp nha, cũng có vị trí k yêu cầu nhưng k nhiều, nếu k yêu cầu bằng cấp và chấp nhận cả k kinh nghiệm nữa thì lương sẽ thấp ý. T thấy vào sản xuất họ ít yêu cầu bằng cấp hơn mà t chưa làm sản xuất bh nên cũng k biết có dây chuyền gì k',
        },
      ];
      let s = await service.create();
      for (const sc of v2Scenes) {
        s = await service.mutate(s.id, {
          revision: s.revision,
          manual: { text: sc.spokenText, author: 'Real', comments: '' },
        });
      }
      // Seed existing V2 WAVs on disk & manifest (must never be overwritten).
      const audioDir = path.join(root, 'audio', s.id, 'assets');
      await fs.mkdir(audioDir, { recursive: true });
      const loaded = await service.load(s.id);
      loaded.voiceRuntime = ready as any;
      loaded.voiceAssets = [];
      for (let idx = 0; idx < v2Scenes.length; idx++) {
        const item = loaded.items[idx];
        item.voiceSettings = { voice: 'my_yen', speed: 1.3 };
        const wavName = `legacy-v2-${idx}.wav`;
        await fs.writeFile(path.join(audioDir, wavName), `OLD_V2_WAV_${idx}`);
        loaded.voiceAssets.push({
          id: `asset-v2-${idx}`,
          purpose: 'DRAFT',
          itemId: item.id,
          itemRevision: item.revision,
          textHash: sha(item.spokenText),
          spokenText: item.spokenText,
          ttsInputText: v2Scenes[idx].v2Tts,
          ttsInputHash: sha(v2Scenes[idx].v2Tts),
          numberReadingVersion: 'vi-numbers-1 / vi-social-speech/2',
          voice: 'my_yen',
          speed: 1.3,
          model: 'MOCK',
          modelVersion: 'MOCK / MOCK',
          cacheKey: `legacy-${idx}`,
          durationMs: 10000,
          filePath: `audio/${s.id}/assets/${wavName}`,
          uri: `/api/studio/sessions/${s.id}/audio/asset-v2-${idx}`,
          createdAt: '2026-11-17T00:00:00.000Z',
          approvedAt: null,
          status: 'GENERATED',
          cacheHit: false,
        });
      }
      await fs.writeFile(
        path.join(root, s.id + '.json'),
        JSON.stringify(loaded, null, 2),
      );
      // Run V3 automatic normalization across the session.
      const normalized = await service.normalizeAutomaticDraft(
        s.id,
        loaded.revision,
      );
      // Scenes 0 & 1: TTS input unchanged -> NOT STALE, original/display untouched!
      expect(normalized.voiceAssets?.[0].status).toBe('GENERATED');
      expect(normalized.voiceAssets?.[1].status).toBe('GENERATED');
      // Scene 3: `k` -> `không`, `bh` -> `bao giờ` -> marked STALE!
      expect(normalized.voiceAssets?.[2].status).toBe('STALE');
      expect(normalized.items[2].originalText).toBe(v2Scenes[2].spokenText);
      expect(normalized.items[2].displayText).toBe(v2Scenes[2].spokenText);
      expect(normalized.items[2].spokenText).toContain('không yêu cầu');
      expect(normalized.items[2].spokenText).toContain('sản xuất bao giờ');
      // sessionReadiness agrees: scenes 0 & 1 are DRAFT (ready), scene 3 is MISSING.
      const readiness = await sessionReadiness(normalized, root);
      expect(readiness.items.map((r) => r.voice)).toEqual([
        'DRAFT',
        'DRAFT',
        'MISSING',
      ]);
      // Trigger voiceAction on all 3 scenes: ONLY scene 3 calls Kokoro (synthCalls === 1)!
      let cur = normalized;
      for (const item of cur.items) {
        cur = await service.voiceAction(s.id, item.id, {
          revision: cur.revision,
          action: 'GENERATE',
          voice: 'my_yen',
          speed: 1.3,
          draft: true,
        });
      }
      expect(synthCalls).toBe(1);
      // Old WAV files on disk are completely untouched!
      for (let idx = 0; idx < v2Scenes.length; idx++) {
        const bytes = await fs.readFile(
          path.join(audioDir, `legacy-v2-${idx}.wav`),
          'utf8',
        );
        expect(bytes).toBe(`OLD_V2_WAV_${idx}`);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('processes 500 social comments offline with low latency, bounded memory, and zero network calls', () => {
    clearSpeechNormalizerCache();
    const fetchSpy = jest.spyOn(global, 'fetch');
    try {
      const start = Date.now();
      const beforeHeap = process.memoryUsage().heapUsed;
      for (let i = 0; i < 500; i++) {
        const sample = BENCHMARK_CASES[i % BENCHMARK_CASES.length];
        const out = prepareTtsInput(`${sample.input} #post_${i}`);
        expect(out.valid).toBe(true);
      }
      const elapsedMs = Date.now() - start;
      const heapDeltaMb =
        (process.memoryUsage().heapUsed - beforeHeap) / (1024 * 1024);
      expect(elapsedMs).toBeLessThan(5000);
      expect(heapDeltaMb).toBeLessThan(64);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
