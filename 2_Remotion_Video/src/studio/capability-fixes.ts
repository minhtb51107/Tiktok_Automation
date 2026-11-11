import type {StudioJob} from '../../../1_nest_backend/src/studio/progress';
import type {StudioItem} from '../../../1_nest_backend/src/studio/studio.contracts';
import {cleanSourceProjection} from '../../../1_nest_backend/src/studio/source-quality';

// Job status is persisted workflow state, not a heartbeat from a running worker.
export function technicalJobView(job: Pick<StudioJob,'status'|'completed'|'total'>) {
  const labels: Record<string,string> = {
    QUEUED:'Đang chờ', RUNNING:'Đang xử lý — trạng thái đã lưu',
    WAITING_REVIEW:'Chờ duyệt', SUCCEEDED:'✓ Hoàn tất',
    FAILED:'✕ Thất bại', CANCELLED:'Đã hủy',
  };
  const measured = typeof job.total==='number' && Number.isFinite(job.total) && job.total>0
    && typeof job.completed==='number' && Number.isFinite(job.completed) && job.completed>=0;
  return {
    label: labels[job.status] || 'Trạng thái chưa xác định',
    percent: measured ? Math.min(100,Math.floor(job.completed! / job.total! * 100)) : null,
    pending: job.status==='RUNNING' || job.status==='QUEUED',
    workerEvidence:'Bản ghi đã lưu; chưa xác minh worker đang hoạt động.',
  };
}

export function restoreSourceText(item: Pick<StudioItem,'originalText'|'contentMapping'>&{rawExtraction?:StudioItem['rawExtraction']}) {
  const mapping=item.contentMapping;
  // A review-required header is not evidence: never guess by removing a first line.
  const verified=mapping?.status==='VERIFIED';
  const clean=(text:string)=>item.rawExtraction?cleanSourceProjection({...item.rawExtraction,bodyText:text}).text:text;
  return {
    displayText: clean(verified ? mapping.bodyText : item.originalText),
    spokenText: clean(verified && !mapping.includeTopicInTts ? mapping.bodyText : item.originalText),
  };
}
