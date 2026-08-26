import uuid
from django.db import models
from projects.models import Project


# Canonical step ordering for the whole journey map. Shared by DatasetVersion
# (to decide which version a step should load) and by projects.views'
# WorkflowState endpoints (to decide what a cascade delete invalidates).
# Steps NOT in this dict (unrecognized step_name) sort last via .get(x, 99).
STEP_ORDER = {
    'upload':              1,
    'diagnose':            2,
    'cleaning_duplicates': 3,
    'cleaning_outliers':   4,
    'cleaning_missing':    5,
    'encoding':            6,
    'feature_engineering': 7,
    'sampling':            8,
    'data_readiness':      9,
    'feature_selection':   10,
    'training':            11,
    'feature_impact':      12,
    'learning_curve':      13,
    'simulator':           14,
    'report':              15,
}


class Dataset(models.Model):
    STATUS_CHOICES = [
        ('uploaded', 'Uploaded'),
        ('profiling', 'Profiling'),
        ('profiled', 'Profiled'),
        ('error', 'Error'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='datasets'
    )
    original_filename = models.CharField(max_length=255)
    storage_path = models.CharField(max_length=500)  # path to original file on disk
    row_count = models.IntegerField(null=True, blank=True)
    column_count = models.IntegerField(null=True, blank=True)

    # columns_metadata stores per-column info:
    # {"age": {"type": "numerical", "missing_pct": 0.05}, "gender": {"type": "categorical"}}
    columns_metadata = models.JSONField(default=dict)

    # profiling_result stores the full statistical profile from ML Core:
    # {"missing_values": {...}, "outliers": {...}, "correlations": {...}}
    profiling_result = models.JSONField(default=dict)

    health_score = models.FloatField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='uploaded')
    upload_timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-upload_timestamp']

    def __str__(self):
        return f"{self.original_filename} (project: {self.project.name})"


class DatasetVersion(models.Model):
    # Kept as a class attribute too (mirrors the module-level STEP_ORDER above)
    # so callers that already have a DatasetVersion class handy can use
    # DatasetVersion.STEP_ORDER instead of a separate import.
    STEP_ORDER = STEP_ORDER

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dataset = models.ForeignKey(
        Dataset,
        on_delete=models.CASCADE,
        related_name='versions'
    )
    version_number = models.PositiveIntegerField()  # 1, 2, 3, 4 — per dataset, always increasing

    # step_name identifies which journey-map step produced this version
    # (a key into STEP_ORDER above, e.g. "cleaning_outliers"). step_order is
    # derived from it automatically in save() so version history can always
    # be sorted/filtered purely numerically, even if STEP_ORDER changes later.
    step_name = models.CharField(max_length=50, default='upload')
    step_order = models.IntegerField(editable=False, default=0)

    # version_label is the human-readable name shown in the UI's versions
    # bar / history panel, e.g. "Duplicate Removed", "Outliers Removed".
    version_label = models.CharField(max_length=200, default='Version')

    file_path = models.CharField(max_length=500, default='')  # path to this specific version file on disk
    file_size = models.BigIntegerField(default=0)
    row_count = models.IntegerField(default=0)
    col_count = models.IntegerField(default=0)

    # summary stores a short, step-specific result description shown in the
    # version history panel, e.g. {"rows_removed": 87, "duplicate_groups": 34}
    summary = models.JSONField(default=dict)

    # transformations_applied stores what was done to create this version:
    # {"fill_missing": "mean", "encoding": "label_encoder", "removed_duplicates": 3}
    transformations_applied = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['step_order', 'created_at']
        unique_together = ['dataset', 'version_number']  # prevents duplicate version numbers

    def save(self, *args, **kwargs):
        # step_order is always derived from step_name, never set directly —
        # this is what lets VersionForStepView filter/sort purely by number
        # while the UI and API still talk in readable step names.
        self.step_order = self.STEP_ORDER.get(self.step_name, 99)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"v{self.version_number} ({self.step_name}) — {self.dataset.original_filename}"
