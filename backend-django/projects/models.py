import uuid
from django.db import models
from django.contrib.auth.models import User


class Project(models.Model):
    MODE_CHOICES = [
        ('guided_manual', 'Guided Manual'),
        ('smart_auto', 'Smart Auto'),
    ]
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('completed', 'Completed'),
        ('archived', 'Archived'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='projects'
    )
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default='guided_manual')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} ({self.user.email})"


class WorkflowState(models.Model):
    # current_step is intentionally a free-text CharField, not a fixed choices
    # enum: it must hold any key from datasets.models.STEP_ORDER (e.g.
    # "cleaning_duplicates", "feature_selection"), and that step list is
    # expected to keep growing as more journey-map pages are built.

    # OneToOne because each project has EXACTLY ONE workflow state at a time
    project = models.OneToOneField(
        Project,
        on_delete=models.CASCADE,
        related_name='workflow_state'
    )
    current_step = models.CharField(max_length=50, default='upload')

    completed_steps = models.JSONField(default=list)   # ["upload", "cleaning_duplicates", ...]

    # needs_redo_steps lists steps invalidated by a cascade delete (the user
    # redid an earlier step, e.g. re-ran outlier removal after already
    # finishing missing-value imputation and encoding). The journey map
    # renders these with a ↺ "needs redo" indicator instead of a checkmark.
    needs_redo_steps = models.JSONField(default=list)

    # step_settings caches the user's in-page choices per step (algorithm,
    # thresholds, chosen imputation method per column, etc.) so navigating
    # away and back — or refreshing — restores what they had selected.
    # Keyed by step name: {"cleaning": {...}, "training": {...}}.
    # Always deep-merged at the step-key level by WorkflowStateView.patch,
    # never overwritten wholesale — see projects/views.py.
    step_settings = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.project.name} — step: {self.current_step}"
