import type {
  VideoProject,
  SourceReference,
  ContentAuthor,
} from '../video-pipeline/contracts';
export interface StudioItem {
  editorial?:{planId:string;sectionId:string;kind:import('../data-engine/editorial-contracts').EditorialKind;stage:string;parentId:string|null;permalink:string|null};
  contentMapping?:{topic:string|null;bodyText:string;status:'VERIFIED'|'REVIEW_REQUIRED';evidence:{type:'DOM'|'USER_CONFIRMED';detail:string;sourceUrl:string};includeTopicInTts:boolean};
  spokenApproval?:import('./voice.types').SpokenApproval;
  voiceSettings?:import('./voice.types').VoiceSettings;
  metadataObservations?: {
    observedAt: string;
    record: import('./public-types').PublicRecord;
  }[];
  inclusion?: 'TARGET' | 'EXPLICIT_CONTEXT' | 'MANUAL';
  sourceId?: string;
  rawExtraction?: import('./public-types').PublicRecord;
  metadata?: import('./public-types').PublicRecord;
  id: string;
  sourceReference: SourceReference;
  sourceUrl: string;
  author: ContentAuthor;
  originalText: string;
  spokenText: string;
  displayText: string;
  mediaReferences: string[];
  selected: boolean;
  order: number;
  revision: number;
  manualLocks: string[];
}
export interface StudioSession {
  productionOrigin?: import('../video-pipeline/contracts').ProductionOrigin;
  sourceImages?: Record<string,import('./source-images').LocalSourceImage>;
  mediaRights?: Record<string,{status:'UNKNOWN'|'OWNED'|'LICENSED'|'PERMISSION';evidence:string;at:string}>;
  editor?: import('./editor.types').EditorSettings;
  studioMedia?: import('./editor.types').StudioMediaAsset[];
  aiBillingBlocked?:boolean;
  voiceRuntime?:import('./voice.types').VoiceRuntime;
  voiceAssets?:import('./voice.types').VoiceAsset[];
  voiceJobs?:import('./voice.types').VoiceJob[];
  voiceBatch?:import('./voice.types').VoiceBatch;
  scriptProposals?: import('./normalization.types').TextProposal[];
  scope?: 'TARGET_ONLY' | 'WITH_CONTEXT';
  derivedFrom?: string;
  archivedItems?: StudioItem[];
  sourceRun?: {
    runId: string;
    startedAt: string;
    completedAt: string;
    elapsedMs: number;
  };
  reports?: import('./stage-report').StageReport[];
  attempts?: import('./public-types').SourceAttempt[];
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  status: 'IDLE' | 'READY' | 'PARTIAL' | 'ERROR';
  errors: string[];
  elapsedMs?: number;
  project: VideoProject;
  items: StudioItem[];
}
