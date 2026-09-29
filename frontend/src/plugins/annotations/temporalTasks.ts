import { LabeledTemporalAnnotationModule } from "./LabeledTemporalModule";
import type { LabeledTemporalAnswer, LabeledTemporalSchema } from "./LabeledTemporalModule";

declare module "../../components/annotator/types" {
  interface AnnotationSchemaMap {
    speaker_diarization: LabeledTemporalSchema<"speaker_diarization">;
    speaker_identification: LabeledTemporalSchema<"speaker_identification">;
    sound_event: LabeledTemporalSchema<"sound_event">;
    speech_segmentation: LabeledTemporalSchema<"speech_segmentation">;
    video_event: LabeledTemporalSchema<"video_event">;
    action_recognition: LabeledTemporalSchema<"action_recognition">;
  }
  interface AnnotationAnswerMap {
    speaker_diarization: LabeledTemporalAnswer;
    speaker_identification: LabeledTemporalAnswer;
    sound_event: LabeledTemporalAnswer;
    speech_segmentation: LabeledTemporalAnswer;
    video_event: LabeledTemporalAnswer;
    action_recognition: LabeledTemporalAnswer;
  }
}

export class SpeakerDiarizationModule extends LabeledTemporalAnnotationModule<"speaker_diarization"> {
  readonly key = "speaker_diarization" as const;
  readonly name = "Speaker diarization";
  readonly defaultChoices: string[] = [];
  readonly allowCustomLabels = true;
}
export class SpeakerIdentificationModule extends LabeledTemporalAnnotationModule<"speaker_identification"> {
  readonly key = "speaker_identification" as const;
  readonly name = "Speaker identification";
  readonly defaultChoices = ["Speaker 1", "Speaker 2"];
  readonly allowCustomLabels = false;
}
export class SoundEventModule extends LabeledTemporalAnnotationModule<"sound_event"> {
  readonly key = "sound_event" as const;
  readonly name = "Sound events";
  readonly defaultChoices = ["Speech", "Music", "Noise"];
  readonly allowCustomLabels = false;
}
export class SpeechSegmentationModule extends LabeledTemporalAnnotationModule<"speech_segmentation"> {
  readonly key = "speech_segmentation" as const;
  readonly name = "Speech / silence segmentation";
  readonly defaultChoices = ["Speech", "Silence"];
  readonly allowCustomLabels = false;
}
export class VideoEventModule extends LabeledTemporalAnnotationModule<"video_event"> {
  readonly key = "video_event" as const;
  readonly name = "Video events";
  readonly defaultChoices = ["Event"];
  readonly allowCustomLabels = false;
}
export class ActionRecognitionModule extends LabeledTemporalAnnotationModule<"action_recognition"> {
  readonly key = "action_recognition" as const;
  readonly name = "Action recognition";
  readonly defaultChoices = ["Action"];
  readonly allowCustomLabels = false;
}

export const temporalTaskModules = [
  new SpeakerDiarizationModule(),
  new SpeakerIdentificationModule(),
  new SoundEventModule(),
  new SpeechSegmentationModule(),
  new VideoEventModule(),
  new ActionRecognitionModule(),
];
