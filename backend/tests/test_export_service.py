import datetime
import io
import json
import tempfile
import threading
import uuid
import zipfile
import pytest
from unittest.mock import MagicMock, patch

from services.export_service import (
    AnnotatorExportEvidence,
    ConsensusPolicy,
    ItemConsensusEvaluation,
    build_export_archive,
    compute_source_fingerprint,
    extract_original_filename,
    render_csv,
    render_jsonl,
    sanitize_filename,
)
from models import Annotation, Annotator, AnnotatorScore, DataUnit, Experiment, ExportJob



def test_sanitize_filename():
    assert sanitize_filename("../../etc/passwd") == "passwd"
    assert sanitize_filename("..\\..\\windows\\system32\\calc.exe") == "calc.exe"
    assert sanitize_filename("normal_audio.wav") == "normal_audio.wav"
    assert sanitize_filename("with spaces & symbols!.png") == "with_spaces___symbols_.png"
    assert sanitize_filename("", fallback="sample_123") == "sample_123"
    assert sanitize_filename("...", fallback="fallback") == "fallback"


def test_extract_original_filename():
    assert extract_original_filename("s3://bucket/path/to/my_file.jpg", "default") == "my_file.jpg"
    assert extract_original_filename("https://example.com/audio/track1.mp3?token=secret", "default") == "track1.mp3"
    assert extract_original_filename("", "sample_fallback") == "sample_fallback"


def test_compute_source_fingerprint_is_deterministic():
    u1_id = uuid.uuid4()
    u2_id = uuid.uuid4()
    t0 = datetime.datetime(2026, 9, 30, 10, 0, 0, tzinfo=datetime.timezone.utc)

    unit1 = DataUnit(id=u1_id, raw_uri="s3://b/1.wav", is_gold=False, metadata_json={"speaker": "A"})
    unit2 = DataUnit(id=u2_id, raw_uri="s3://b/2.wav", is_gold=True, gold_answer={"value": "cat"}, metadata_json={})

    ann1 = Annotation(id=uuid.uuid4(), data_unit_id=u1_id, annotator_id=uuid.uuid4(), answer={"value": "dog"}, submitted_at=t0)
    ann2 = Annotation(id=uuid.uuid4(), data_unit_id=u1_id, annotator_id=uuid.uuid4(), answer={"value": "dog"}, submitted_at=t0)

    fp1 = compute_source_fingerprint([unit1, unit2], {u1_id: [ann1, ann2]}, t0)
    # Order of units list in call should not matter because function sorts by ID
    fp2 = compute_source_fingerprint([unit2, unit1], {u1_id: [ann2, ann1]}, t0)
    assert fp1 == fp2

    # Fingerprint changes if annotation answer changes
    ann1_mod = Annotation(id=ann1.id, data_unit_id=u1_id, annotator_id=ann1.annotator_id, answer={"value": "cat"}, submitted_at=t0)
    fp_mod = compute_source_fingerprint([unit1, unit2], {u1_id: [ann1_mod, ann2]}, t0)
    assert fp1 != fp_mod


def test_consensus_policy_defaults():
    policy = ConsensusPolicy()
    assert policy.min_annotations_for_consensus == 2
    assert policy.low_evidence_threshold == 3
    assert policy.min_gold_items == 5
    assert policy.min_gold_score == 0.70
    assert policy.min_agreement == 0.60
    assert policy.include_low_evidence is False
    assert policy.prior_strength == 2.0


def test_render_jsonl_and_csv():
    records = [{"id": 1, "name": "alice"}, {"id": 2, "name": "bob"}]
    jsonl = render_jsonl(records)
    lines = [json.loads(line) for line in jsonl.strip().split("\n")]
    assert lines == records

    csv_out = render_csv(records, ["id", "name"])
    assert "id,name" in csv_out
    assert "1,alice" in csv_out
    assert "2,bob" in csv_out


def test_zip_archive_structure(tmp_path):
    exp_id = uuid.uuid4()
    job_id = uuid.uuid4()
    u1_id = uuid.uuid4()
    t0 = datetime.datetime(2026, 9, 30, 10, 0, 0, tzinfo=datetime.timezone.utc)

    # Mock DB session and experiment
    mock_db = MagicMock()
    mock_experiment = Experiment(
        id=exp_id,
        name="Speech Eval",
        modality="audio",
        label_schema={"annotation_type": "categorical", "choices": ["yes", "no"]},
    )
    job = ExportJob(
        id=job_id,
        experiment_id=exp_id,
        mode="consensus",
        status="running",
        policy=ConsensusPolicy(include_low_evidence=True).model_dump(),
        source_cutoff_at=t0,
        source_fingerprint="abc123sha",
        source_counts={},
        preflight_summary={},
        warnings=[],
    )

    # Unit 1: regular accepted item
    unit1 = DataUnit(id=u1_id, experiment_id=exp_id, raw_uri="s3://test-bucket/clip.wav", is_gold=False, metadata_json={"env": "quiet"})

    mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [unit1]

    # Annotators: 2 annotators with eligible answers
    ann1_id = uuid.uuid4()
    ann2_id = uuid.uuid4()
    ann_user1 = Annotator(id=ann1_id, experiment_id=exp_id, status="active", created_at=t0)
    ann_user2 = Annotator(id=ann2_id, experiment_id=exp_id, status="active", created_at=t0)

    # Wire up mocks
    def mock_query(*models):
        m = MagicMock()
        if models[0] == Annotator:
            m.filter.return_value.order_by.return_value.all.return_value = [ann_user1, ann_user2]
            return m
        elif models[0] == DataUnit:
            m.filter.return_value.order_by.return_value.all.return_value = [unit1]
            return m
        elif models[0] == Annotation:
            if len(models) > 1 and models[1] == DataUnit:
                m.join.return_value.filter.return_value.all.return_value = []
                return m
            a1 = Annotation(id=uuid.uuid4(), data_unit_id=u1_id, annotator_id=ann1_id, answer={"value": "yes"}, submitted_at=t0)
            a2 = Annotation(id=uuid.uuid4(), data_unit_id=u1_id, annotator_id=ann2_id, answer={"value": "yes"}, submitted_at=t0)
            m.join.return_value.filter.return_value.order_by.return_value.all.return_value = [a1, a2]
            m.join.return_value.filter.return_value.count.return_value = 1
            m.filter_by.return_value.count.return_value = 1
            return m
        elif models[0] == AnnotatorScore:
            m.filter_by.return_value.first.return_value = None
            return m
        return m

    mock_db.query.side_effect = mock_query

    # Mock S3 client
    mock_s3 = MagicMock()
    mock_s3.get_object.return_value = {"Body": io.BytesIO(b"RIFFwave_dummy_audio")}

    zip_file_path = str(tmp_path / "test_export.zip")
    size_bytes, sha256_hash = build_export_archive(
        mock_db, mock_experiment, job, mock_s3, "test-bucket", zip_file_path
    )

    assert size_bytes > 0
    assert len(sha256_hash) == 64

    # Verify ZIP contents match consensus contract (Section 4.2)
    with zipfile.ZipFile(zip_file_path, "r") as zf:
        namelist = zf.namelist()
        assert "README.md" in namelist
        assert "manifest.json" in namelist
        assert "dataset/final_annotations.jsonl" in namelist
        assert "dataset/metadata.csv" in namelist
        assert "review/needs_review.jsonl" in namelist
        assert "review/excluded_annotations.jsonl" in namelist
        assert "quality/raw_annotations.jsonl" in namelist
        assert "quality/annotators.csv" in namelist
        assert "quality/items.csv" in namelist
        assert "quality/warnings.json" in namelist
        assert "quality/methodology.json" in namelist
        assert f"media/{u1_id}/clip.wav" in namelist

        # Inspect manifest.json
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        assert manifest["experiment_id"] == str(exp_id)
        assert manifest["export_mode"] == "consensus"
        assert manifest["source_fingerprint"] == "abc123sha"
        assert manifest["algorithm"]["name"] == "quality_weighted_medoid"
        # Verify provenance fields (Finding 6)
        assert "sensitive_data_notice" in manifest
        assert "instructions" in manifest
        assert "overlap_n" in manifest
        assert "gold_ratio" in manifest
        assert "access_mode" in manifest
        assert "metadata_schema" in manifest
        assert "qualification_form" in manifest
        assert "routing_rules" in manifest

        # Inspect final_annotations.jsonl
        final_lines = zf.read("dataset/final_annotations.jsonl").decode("utf-8").strip().split("\n")
        assert len(final_lines) == 1
        final_record = json.loads(final_lines[0])
        assert final_record["data_unit_id"] == str(u1_id)
        assert final_record["answer"] == {"value": "yes"}
        assert final_record["consensus"]["status"] == "low_evidence" or final_record["consensus"]["status"] == "accepted"


def test_format_score_preserves_zero():
    """Finding 7: Legitimate 0.0 scores must not become empty strings."""
    from services.export_service import format_score
    assert format_score(0.0) == "0.0000"
    assert format_score(0.0000) == "0.0000"
    assert format_score(0.8523) == "0.8523"
    assert format_score(None) == ""


def test_data_unit_create_security_validation():
    """Finding 1: raw_uri rejects /proc/self/environ, local files, and path traversal."""
    from schemas import DataUnitCreate
    import pydantic

    # Safe S3 URI and relative keys allowed
    d1 = DataUnitCreate(raw_uri="s3://annotate-it-data/uploads/audio.wav")
    assert d1.raw_uri == "s3://annotate-it-data/uploads/audio.wav"
    d2 = DataUnitCreate(raw_uri="uploads/sample1.wav")
    assert d2.raw_uri == "uploads/sample1.wav"

    # Reject local container path traversal (/proc/self/environ, /etc/passwd)
    with pytest.raises(pydantic.ValidationError):
        DataUnitCreate(raw_uri="/proc/self/environ")

    with pytest.raises(pydantic.ValidationError):
        DataUnitCreate(raw_uri="/etc/passwd")

    with pytest.raises(pydantic.ValidationError):
        DataUnitCreate(raw_uri="file:///proc/self/environ")

    with pytest.raises(pydantic.ValidationError):
        DataUnitCreate(raw_uri="../secret/credentials")

    with pytest.raises(pydantic.ValidationError):
        DataUnitCreate(raw_uri="s3://")


def test_compute_training_readiness_conditions():
    """Finding 2 & 5: Incomplete datasets, unannotated samples, missing media, and warnings block training_ready."""
    from services.export_service import compute_training_readiness, ConsensusPolicy

    policy = ConsensusPolicy()
    clean_counts = {
        "total_samples": 5,
        "annotated_samples": 5,
        "unannotated_samples": 0,
        "gold_samples": 1,
        "consensus_accepted_samples": 4,
        "accepted_samples": 4,
        "low_evidence_samples": 0,
        "insufficient_overlap_samples": 0,
        "low_agreement_samples": 0,
        "tied_samples": 0,
        "no_eligible_annotations_samples": 0,
    }

    # Clean case is training ready
    assert compute_training_readiness("consensus", clean_counts, policy, []) is True

    # Complete mode is never training ready
    assert compute_training_readiness("complete", clean_counts, policy, []) is False

    # Unannotated samples block training_ready
    unannotated_counts = dict(clean_counts, unannotated_samples=1)
    assert compute_training_readiness("consensus", unannotated_counts, policy, []) is False

    # Any warning blocks training_ready
    assert compute_training_readiness("consensus", clean_counts, policy, ["Some warning"]) is False

    # Missing media blocks training_ready
    assert compute_training_readiness("consensus", clean_counts, policy, [], missing_media_count=1) is False

    # Excluded low-evidence blocks training_ready when policy.include_low_evidence=False
    low_ev_counts = dict(clean_counts, low_evidence_samples=2)
    assert compute_training_readiness("consensus", low_ev_counts, policy, []) is False
    # But passes if policy.include_low_evidence=True
    policy_with_low_ev = ConsensusPolicy(include_low_evidence=True)
    assert compute_training_readiness("consensus", low_ev_counts, policy_with_low_ev, []) is True


def test_reclaim_stale_running_jobs():
    """Finding 4: Worker crashes or timeouts reclaim running jobs to prevent permanent stranding."""
    from export_worker import reclaim_stale_running_jobs
    mock_db = MagicMock()
    stale_job = ExportJob(
        id=uuid.uuid4(),
        status="running",
        started_at=datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=2),
    )
    mock_db.query.return_value.filter.return_value.with_for_update.return_value.all.return_value = [stale_job]

    reclaimed = reclaim_stale_running_jobs(mock_db, max_age_seconds=1800)
    assert reclaimed == 1
    assert stale_job.status == "failed"
    assert stale_job.error_code == "worker_timeout"
    assert stale_job.completed_at is not None
    mock_db.commit.assert_called_once()


def test_fingerprint_covers_all_exported_provenance_and_evidence():
    """Finding 4: Fingerprint must hash instructions, schemas, qualification forms, answers, and scores."""
    cutoff = datetime.datetime(2026, 9, 30, 12, 0, 0, tzinfo=datetime.timezone.utc)
    u_id = uuid.uuid4()
    unit = DataUnit(id=u_id, raw_uri="s3://b/audio.wav", is_gold=False, metadata_json={})
    exp_id = uuid.uuid4()
    exp = Experiment(
        id=exp_id,
        name="Exp 1",
        instructions="Original instructions",
        label_schema={"annotation_type": "categorical", "choices": ["A", "B"]},
        metadata_schema=[{"name": "speaker", "type": "string"}],
        qualification_form=[{"prompt": "Are you fluent?"}],
        routing_rules=[],
        access_mode="anonymous",
        overlap_n=2,
        gold_ratio=0.1,
    )
    ann_id = uuid.uuid4()
    evidence = {
        ann_id: AnnotatorExportEvidence(
            annotator_id=ann_id,
            export_id="ann_001",
            status="active",
            total_annotations=5,
            gold_items_seen=1,
            raw_mean_gold_score=1.0,
            reliability_weight=1.0,
            rolling_gold_accuracy=1.0,
            rolling_agreement_score=0.9,
            consensus_eligibility=True,
            is_excluded=False,
            exclusion_reasons=[],
            qualification_answers={"q1": "Yes"},
        )
    }

    base_fp = compute_source_fingerprint([unit], {}, cutoff, experiment=exp, annotator_evidence=evidence)

    # 1. Modifying instructions alters fingerprint
    exp_mod_inst = Experiment(
        id=exp_id,
        name="Exp 1",
        instructions="Modified instructions",
        label_schema=exp.label_schema,
        metadata_schema=exp.metadata_schema,
        qualification_form=exp.qualification_form,
        routing_rules=exp.routing_rules,
        access_mode=exp.access_mode,
        overlap_n=exp.overlap_n,
        gold_ratio=exp.gold_ratio,
    )
    fp_inst = compute_source_fingerprint([unit], {}, cutoff, experiment=exp_mod_inst, annotator_evidence=evidence)
    assert fp_inst != base_fp

    # 2. Modifying qualification form alters fingerprint
    exp_mod_qform = Experiment(
        id=exp_id,
        name="Exp 1",
        instructions=exp.instructions,
        label_schema=exp.label_schema,
        metadata_schema=exp.metadata_schema,
        qualification_form=[{"prompt": "New question?"}],
        routing_rules=exp.routing_rules,
        access_mode=exp.access_mode,
        overlap_n=exp.overlap_n,
        gold_ratio=exp.gold_ratio,
    )
    fp_qform = compute_source_fingerprint([unit], {}, cutoff, experiment=exp_mod_qform, annotator_evidence=evidence)
    assert fp_qform != base_fp

    # 3. Modifying annotator qualification answers alters fingerprint
    mod_evidence = dict(evidence)
    mod_evidence[ann_id] = AnnotatorExportEvidence(
        annotator_id=ann_id,
        export_id="ann_001",
        status="active",
        total_annotations=5,
        gold_items_seen=1,
        raw_mean_gold_score=1.0,
        reliability_weight=1.0,
        rolling_gold_accuracy=1.0,
        rolling_agreement_score=0.9,
        consensus_eligibility=True,
        is_excluded=False,
        exclusion_reasons=[],
        qualification_answers={"q1": "No"},  # changed answer
    )
    fp_ans = compute_source_fingerprint([unit], {}, cutoff, experiment=exp, annotator_evidence=mod_evidence)
    assert fp_ans != base_fp


def test_bounded_streaming_aborts_mid_stream_on_size_exceeded():
    """Finding 2: _copy_stream_bounded stops during chunk streaming and raises ArchiveSizeExceeded."""
    from services.export_service import _copy_stream_bounded, ArchiveSizeExceeded

    with tempfile.NamedTemporaryFile(suffix=".zip") as tf:
        dest_mock = io.BytesIO()
        # Source produces 200 KiB of data (chunks of 64 KiB)
        data = b"X" * (200 * 1024)
        source = io.BytesIO(data)

        # Set max_archive_bytes lower than the total data
        with pytest.raises(ArchiveSizeExceeded):
            # Simulate underlying file having size by writing to tf
            def mock_write(b):
                tf.write(b)
                tf.flush()

            dest_mock.write = mock_write
            _copy_stream_bounded(
                source_stream=source,
                dest_stream=dest_mock,
                output_zip_path=tf.name,
                max_archive_bytes=100 * 1024,
                chunk_size=64 * 1024,
            )


def test_bounded_streaming_respects_cancellation_signal():
    """Finding 3: _copy_stream_bounded stops immediately when cancellation event is set."""
    from services.export_service import _copy_stream_bounded, ExportCancelled

    with tempfile.NamedTemporaryFile(suffix=".zip") as tf:
        dest_mock = io.BytesIO()
        source = io.BytesIO(b"X" * (128 * 1024))
        cancel_event = threading.Event()
        cancel_event.set()  # cancellation already requested

        with pytest.raises(ExportCancelled):
            _copy_stream_bounded(
                source_stream=source,
                dest_stream=dest_mock,
                output_zip_path=tf.name,
                max_archive_bytes=10 * 1024 * 1024,
                cancel_event=cancel_event,
                chunk_size=64 * 1024,
            )


def test_worker_reclaims_expired_lease():
    """Jobs with an expired lease are reclaimed."""
    from export_worker import reclaim_stale_running_jobs

    mock_db = MagicMock()
    now = datetime.datetime.now(datetime.timezone.utc)
    expired_job = ExportJob(
        id=uuid.uuid4(),
        status="running",
        started_at=now - datetime.timedelta(minutes=10),
        lease_expires_at=now - datetime.timedelta(seconds=10),  # expired lease
        worker_id="worker-old",
    )
    mock_db.query.return_value.filter.return_value.with_for_update.return_value.all.return_value = [expired_job]

    reclaimed = reclaim_stale_running_jobs(mock_db)
    assert reclaimed == 1
    assert expired_job.status == "failed"
    assert expired_job.error_code == "worker_timeout"


def test_job_heartbeat_renews_live_lease():
    from export_worker import JobHeartbeat

    heartbeat = JobHeartbeat(
        job_id=uuid.uuid4(),
        worker_id="worker-current",
        interval=0,
        lease_duration=60,
    )
    db = MagicMock()
    update = db.query.return_value.filter.return_value.update

    def stop_after_renewal(*_args, **_kwargs):
        heartbeat.stop()
        return 1

    update.side_effect = stop_after_renewal
    session_context = MagicMock()
    session_context.__enter__.return_value = db

    with patch("export_worker.SessionLocal", return_value=session_context):
        heartbeat.run()

    update.assert_called_once()
    db.commit.assert_called_once()
    assert heartbeat.lost_lease is False


def test_upload_archive_cancels_after_upload_and_removes_object(tmp_path):
    from export_worker import upload_archive_with_cancellation
    from services.export_service import ExportCancelled

    archive = tmp_path / "export.zip"
    archive.write_bytes(b"zip content")
    cancel_event = threading.Event()
    fake_s3 = MagicMock()

    def cancel_during_upload(*_args, **_kwargs):
        cancel_event.set()

    fake_s3.upload_fileobj.side_effect = cancel_during_upload

    with pytest.raises(ExportCancelled):
        upload_archive_with_cancellation(
            s3=fake_s3,
            archive_path=str(archive),
            bucket="exports",
            key="exports/job.zip",
            cancel_event=cancel_event,
            lease_was_lost=lambda: False,
        )

    fake_s3.delete_object.assert_called_once_with(Bucket="exports", Key="exports/job.zip")


def test_ready_finalization_requires_a_live_lease():
    from export_worker import finalize_ready_job

    db = MagicMock()
    query = db.query.return_value
    query.filter.return_value.update.return_value = 1
    now = datetime.datetime.now(datetime.timezone.utc)

    finalized = finalize_ready_job(
        db=db,
        job_id=uuid.uuid4(),
        worker_id="worker-current",
        object_uri="s3://exports/exports/job.zip",
        size_bytes=123,
        sha256_hash="abc",
        now=now,
    )

    assert finalized is True
    filters = query.filter.call_args.args
    assert any(
        "lease_expires_at" in str(condition) and ">" in str(condition)
        for condition in filters
    )

def test_upload_archive_reader_interrupts_mid_upload(tmp_path):

    from export_worker import upload_archive_with_cancellation
    from services.export_service import ExportCancelled

    archive = tmp_path / "export.zip"
    archive.write_bytes(b"zip content")
    cancel_event = threading.Event()
    fake_s3 = MagicMock()
    read_after_cancel_completed = False

    def consume_until_cancelled(stream, *_args, **_kwargs):
        nonlocal read_after_cancel_completed
        stream.read(1)
        cancel_event.set()
        stream.read(1)
        read_after_cancel_completed = True

    fake_s3.upload_fileobj.side_effect = consume_until_cancelled
    with pytest.raises(ExportCancelled):
        upload_archive_with_cancellation(
            s3=fake_s3,
            archive_path=str(archive),
            bucket="exports",
            key="exports/job.zip",
            cancel_event=cancel_event,
            lease_was_lost=lambda: False,
        )

    fake_s3.delete_object.assert_called_once_with(Bucket="exports", Key="exports/job.zip")
    assert read_after_cancel_completed is False
