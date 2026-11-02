// Public text snapshots from the five user-supplied exact targets, not synthetic AI output.
export const realNormalizationCases = [
  {
    targetId: 'Dbx5Tv7Epv-',
    input:
      'công việc tphcm\nMọi người có thấy thị trường lao động ở Việt Nam đang bị điên không?',
    expected:
      'công việc Thành phố Hồ Chí Minh Mọi người có thấy thị trường lao động ở Việt Nam đang bị điên không?',
    category: 'EXPAND',
  },
  {
    targetId: 'Db2WUVcoAhp',
    input:
      'Có sốp ơi. Năm nay t mới 22 cái xuân xanh, t chán job văn phòng rùi muốn đi làm pha chế quán trà sữa cho iu đời ko đau mỏi mắt, thì hỏi 5,6 quán xung quanh đều bảo quá tuổi =)))) cay đcđ',
    expected:
      'Có sốp ơi. Năm nay t mới 22 cái xuân xanh, t chán job văn phòng rùi muốn đi làm pha chế quán trà sữa cho iu đời không đau mỏi mắt, thì hỏi 5,6 quán xung quanh đều bảo quá tuổi cay đcđ',
    category: 'EXPAND / OMIT_SPOKEN / REVIEW_AMBIGUOUS',
  },
  {
    targetId: 'Db9fXamGT_e',
    input:
      'Thông cảm đi bạn. Đất nước ta còn nghèo. Mới trải qua 2 cuộc chiến tranh...',
    expected:
      'Thông cảm đi bạn. Đất nước ta còn nghèo. Mới trải qua 2 cuộc chiến tranh...',
    category: 'KEEP',
  },
  {
    targetId: 'Db57skbCXli',
    input:
      'T 28t, có tiếng Nhật, có kn CSKH Nhật, điều phối cv nội bộ, kn assitant manager... ứng tuyển vô vị trí Thư ký Giám đốc nhưng tạch vì cv tuyển đến 26t :)))))',
    expected:
      'T 28t, có tiếng Nhật, có kn CSKH Nhật, điều phối cv nội bộ, kn assitant manager... ứng tuyển vô vị trí Thư ký Giám đốc nhưng tạch vì cv tuyển đến 26t',
    category: 'OMIT_SPOKEN / REVIEW_AMBIGUOUS',
  },
  {
    targetId: 'Db-99ClkxJW',
    input:
      ':)) Công ty t mới tuyển 2 thằng Fresher. \n- Một thằng TOEIC 700 đi kèm bằng tiếng Nhật N4. \n- Một thằng tiếng Nhật N2.\n:))) Fresher thời hiện đại clm mạnh vê lờ. T đách hiểu cái thị trường giờ nó ép con người ta đến mức nào nữa. \n10 năm nữa chắc đám ĐH ra trường phải 3-4 thứ tiếng, thạo ít nhất 7 ngôn ngữ lập trình, từng có project thật ở công xưởng...\n-> Thú thật điều này làm t không muốn đẻ con tí nào. Con t sẽ phải học cắm cmn đầu chỉ để được cái job Fresher?? Và t phải xem đó là tự hào?',
    expected:
      'Công ty t mới tuyển 2 thằng Fresher. - Một thằng TOEIC 700 đi kèm bằng tiếng Nhật N4. - Một thằng tiếng Nhật N2. Fresher thời hiện đại clm mạnh vê lờ. T đách hiểu cái thị trường giờ nó ép con người ta đến mức nào nữa. 10 năm nữa chắc đám đại học ra trường phải 3-4 thứ tiếng, thạo ít nhất 7 ngôn ngữ lập trình, từng có project thật ở công xưởng... Thú thật điều này làm t không muốn đẻ con tí nào. Con t sẽ phải học cắm cmn đầu chỉ để được cái job Fresher?? Và t phải xem đó là tự hào?',
    category: 'EXPAND / KEEP / OMIT_SPOKEN / REVIEW_AMBIGUOUS',
  },
];
