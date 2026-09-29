from .labeled_temporal import ClusterAlignedTemporalType, LabeledTemporalType


class SpeakerDiarizationType(ClusterAlignedTemporalType):
    key = "speaker_diarization"
    name = "Speaker diarization"
    required_media_capabilities = frozenset({"audio-content"})
    supports_choices = False


class SpeakerIdentificationType(LabeledTemporalType):
    key = "speaker_identification"
    name = "Speaker identification"
    required_media_capabilities = frozenset({"audio-content"})


class SoundEventType(LabeledTemporalType):
    key = "sound_event"
    name = "Sound events"
    required_media_capabilities = frozenset({"audio-content"})


class SpeechSegmentationType(LabeledTemporalType):
    key = "speech_segmentation"
    name = "Speech / silence segmentation"
    required_media_capabilities = frozenset({"audio-content"})


class VideoEventType(LabeledTemporalType):
    key = "video_event"
    name = "Video events"
    required_media_capabilities = frozenset({"visual-content"})


class ActionRecognitionType(LabeledTemporalType):
    key = "action_recognition"
    name = "Action recognition"
    required_media_capabilities = frozenset({"visual-content"})


TEMPORAL_TASK_TYPES = (
    SpeakerDiarizationType,
    SpeakerIdentificationType,
    SoundEventType,
    SpeechSegmentationType,
    VideoEventType,
    ActionRecognitionType,
)
