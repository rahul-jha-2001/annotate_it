import { LabeledTemporalAnnotationModule } from "./LabeledTemporalModule";
import type { AnnotationModuleContext } from "../contracts";
import { catalogBundlePaths, catalogSamples, defineCatalogPreset } from "../catalog/fixtures";
import type { AnnotationCatalogPreset } from "../catalog/types";
import type { LabeledTemporalAnswer, LabeledTemporalSchema } from "./LabeledTemporalModule";

interface TemporalCatalogDetails {
  slug: string; title: string; summary: string; useCases: string[]; modality: "audio" | "video";
  choices: string[]; samples: Array<{ filename: string; metadata: Record<string, string | number | boolean>; goldAnswer?: unknown }>;
}

function temporalCatalog<KeyT extends string>(
  module: LabeledTemporalAnnotationModule<KeyT>, context: AnnotationModuleContext, details: TemporalCatalogDetails,
): AnnotationCatalogPreset<LabeledTemporalSchema<KeyT>>[] {
  const schema = { ...module.defaultSchema(context), choices: details.choices };
  return [defineCatalogPreset({
    slug: details.slug, title: details.title, summary: details.summary, family: details.modality === "audio" ? "Speech & audio" : "Video temporal",
    useCases: details.useCases, modality: details.modality, schema,
    samples: catalogSamples(details.slug, details.samples),
    metadataDescription: "Language, difficulty, and content type describe and route each sample.",
    scoringDescription: "Gold and agreement scores combine temporal overlap with matching region labels.",
    ...catalogBundlePaths(details.slug),
  })];
}

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
  readonly supportedModalities = ["audio"] as const;
  readonly defaultChoices: string[] = [];
  readonly allowCustomLabels = true;
  catalogPresets(context: AnnotationModuleContext): AnnotationCatalogPreset<LabeledTemporalSchema<typeof this.key>>[] { return temporalCatalog(this, context, {
    slug: "speaker-diarization", title: "Speaker diarization", summary: "Mark every speaker turn and assign a consistent speaker label.",
    useCases: ["Meeting analytics", "Call-center separation", "Conversation research"], modality: "audio", choices: [],
    samples: [
      { filename: "conversation_001.wav", metadata: { language: "English", difficulty: 2, content_type: "Conversation" } },
      { filename: "conversation_002.wav", metadata: { language: "English", difficulty: 2, content_type: "Conversation" } },
    ],
  }); }
}
export class SpeakerIdentificationModule extends LabeledTemporalAnnotationModule<"speaker_identification"> {
  readonly key = "speaker_identification" as const;
  readonly name = "Speaker identification";
  readonly supportedModalities = ["audio"] as const;
  readonly defaultChoices = ["Speaker 1", "Speaker 2"];
  readonly allowCustomLabels = false;
  catalogPresets(context: AnnotationModuleContext): AnnotationCatalogPreset<LabeledTemporalSchema<typeof this.key>>[] { return temporalCatalog(this, context, {
    slug: "speaker-identification", title: "Speaker identification", summary: "Mark speech turns and identify each known or unknown speaker.",
    useCases: ["Interview attribution", "Known-speaker tracking", "Media indexing"], modality: "audio", choices: ["Rahul", "Priya", "Unknown"],
    samples: [
      { filename: "interview_001.wav", metadata: { language: "English", difficulty: 2, content_type: "Interview" } },
      { filename: "interview_002.wav", metadata: { language: "English", difficulty: 2, content_type: "Interview" } },
    ],
  }); }
}
export class SoundEventModule extends LabeledTemporalAnnotationModule<"sound_event"> {
  readonly key = "sound_event" as const;
  readonly name = "Sound events";
  readonly supportedModalities = ["audio"] as const;
  readonly defaultChoices = ["Speech", "Music", "Noise"];
  readonly allowCustomLabels = false;
  catalogPresets(context: AnnotationModuleContext): AnnotationCatalogPreset<LabeledTemporalSchema<typeof this.key>>[] { return temporalCatalog(this, context, {
    slug: "sound-event", title: "Sound event detection", summary: "Find and label overlapping acoustic events on a waveform.",
    useCases: ["Acoustic monitoring", "Media indexing", "Safety-event detection"], modality: "audio", choices: this.defaultChoices,
    samples: [
      { filename: "street_001.wav", metadata: { language: "None", difficulty: 2, content_type: "Ambient" } },
      { filename: "street_002.wav", metadata: { language: "None", difficulty: 2, content_type: "Ambient" } },
    ],
  }); }
}
export class SpeechSegmentationModule extends LabeledTemporalAnnotationModule<"speech_segmentation"> {
  readonly key = "speech_segmentation" as const;
  readonly name = "Speech / silence segmentation";
  readonly supportedModalities = ["audio"] as const;
  readonly defaultChoices = ["Speech", "Silence"];
  readonly allowCustomLabels = false;
  catalogPresets(context: AnnotationModuleContext): AnnotationCatalogPreset<LabeledTemporalSchema<typeof this.key>>[] { return temporalCatalog(this, context, {
    slug: "speech-segmentation", title: "Speech / silence segmentation", summary: "Partition an audio recording into speech and silence regions.",
    useCases: ["Voice activity detection", "Audio cleanup", "Speech analytics"], modality: "audio", choices: this.defaultChoices,
    samples: [
      { filename: "recording_001.wav", metadata: { language: "English", difficulty: 1, content_type: "Speech" } },
      { filename: "recording_002.wav", metadata: { language: "English", difficulty: 1, content_type: "Speech" } },
    ],
  }); }
}
export class VideoEventModule extends LabeledTemporalAnnotationModule<"video_event"> {
  readonly key = "video_event" as const;
  readonly name = "Video events";
  readonly supportedModalities = ["video"] as const;
  readonly defaultChoices = ["Event"];
  readonly allowCustomLabels = false;
  catalogPresets(context: AnnotationModuleContext): AnnotationCatalogPreset<LabeledTemporalSchema<typeof this.key>>[] { return temporalCatalog(this, context, {
    slug: "video-event", title: "Video event detection", summary: "Mark when defined events begin and end in a video.",
    useCases: ["Surveillance review", "Scene indexing", "Event retrieval"], modality: "video", choices: ["Scene change", "Object enters", "Object exits"],
    samples: [
      { filename: "security_001.mp4", metadata: { language: "None", difficulty: 2, content_type: "Surveillance" } },
      { filename: "security_002.mp4", metadata: { language: "None", difficulty: 2, content_type: "Surveillance" } },
    ],
  }); }
}
export class ActionRecognitionModule extends LabeledTemporalAnnotationModule<"action_recognition"> {
  readonly key = "action_recognition" as const;
  readonly name = "Action recognition";
  readonly supportedModalities = ["video"] as const;
  readonly defaultChoices = ["Action"];
  readonly allowCustomLabels = false;
  catalogPresets(context: AnnotationModuleContext): AnnotationCatalogPreset<LabeledTemporalSchema<typeof this.key>>[] { return temporalCatalog(this, context, {
    slug: "action-recognition", title: "Action recognition", summary: "Mark time ranges where people or objects perform named actions.",
    useCases: ["Human activity", "Sports analysis", "Behavior datasets"], modality: "video", choices: ["Walking", "Running", "Sitting"],
    samples: [
      { filename: "person_001.mp4", metadata: { language: "None", difficulty: 2, content_type: "Motion" } },
      { filename: "person_002.mp4", metadata: { language: "None", difficulty: 2, content_type: "Motion" } },
    ],
  }); }
}

export const temporalTaskModules = [
  new SpeakerDiarizationModule(),
  new SpeakerIdentificationModule(),
  new SoundEventModule(),
  new SpeechSegmentationModule(),
  new VideoEventModule(),
  new ActionRecognitionModule(),
];
