import { Composition, registerRoot } from 'remotion';
import { SeriousTimelinePreview } from '../video-pipeline/TimelinePreviewComposition';
import { EMPTY_SERIOUS_PREVIEW } from '../video-pipeline/preview-defaults';

// Isolated registration, same component/props/timeline as Studio's Player.
registerRoot(() => <Composition id="SeriousTimelinePreview" component={SeriousTimelinePreview}
  fps={30} width={1080} height={1920} defaultProps={EMPTY_SERIOUS_PREVIEW}
  calculateMetadata={({props})=>({durationInFrames:props.timeline.totalFrames,
    fps:props.timeline.fps,width:props.timeline.width,height:props.timeline.height})}/>);
