// Explicitly SYNTHETIC TEST DATA. Never represented as real Threads observations.
const url = (id) => 'https://www.threads.com/@data04_test/post/' + id;
function fixture(id = 'ROOT_B') {
  const rid = value => id==='ROOT_A' ? 'A_'+value : value;
  const root = {
    id,
    url: url(id),
    author: { handle: 'data04_test', name: 'SYNTHETIC TEST DATA' },
    originalText:
      'SYNTHETIC TEST DATA. Tôi từng đi làm công ty và muốn chia sẻ kinh nghiệm công việc. Mỗi ngày đi đường rất lâu, nhưng điều quan trọng là trao đổi rõ kỳ vọng với đồng nghiệp.',
    publishedAt: '2026-11-01T00:00:00Z',
    engagement: { likes: 500, replies: 300, reposts: 20, shares: null },
    provenance: {
      documentUrl: url(id),
      observedAt: '2026-11-02T00:00:00Z',
      synthetic: true,
      method: 'TEST DATA',
    },
  };
  const comment = (id, parent, text) => ({
    '@type': 'Comment',
    url: url(id),
    author: { url: 'https://www.threads.com/@data04_test' },
    parentItem: url(parent),
    text,
  });
  const jsonLd = [
    {
      '@type': 'DiscussionForumPosting',
      url: root.url,
      text: root.originalText,
      comment: [
        comment(
          rid('R1'),
          id,
          'Tôi từng đi làm công ty, mỗi ngày mất ba giờ đi đường.',
        ),
        comment(rid('R2'), rid('R1'), 'Nhưng công ty sai vì không giải thích rõ.'),
        comment(rid('R3'), id, '😂😂'),
      ],
    },
    comment('UNRELATED', 'OTHER', 'TEST DATA unrelated context'),
  ];
  return {
    root,
    doc: {
      url: root.url,
      observedAt: root.provenance.observedAt,
      synthetic: true,
      visibleUrls: ['R1', 'R2', 'R3'].map(rid).concat(['UNRELATED','CONTEXT']).map(url),
      jsonLd,
    },
  };
}
module.exports = { fixture, url };
