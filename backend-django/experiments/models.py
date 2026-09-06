import uuid
from django.db import models
from projects.models import Project
from datasets.models import DatasetVersion


class Experiment(models.Model):
    TASK_TYPE_CHOICES = [
        ('classification', 'Classification'),
        ('regression', 'Regression'),
        ('clustering', 'Clustering'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('running', 'Running'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
        # The three below back PRISM Auto Mode (backend-fastapi/auto_mode/):
        # 'paused' — waiting on a human-in-the-loop checkpoint response.
        # 'paused_restart' — the FastAPI process restarted mid-run; the
        #   graph's own checkpoint was recovered but is deliberately NOT
        #   auto-resumed until a human explicitly confirms.
        # 'aborted' — the user rejected a checkpoint. Every version already
        #   registered up to that point is kept; only the run itself stops.
        ('paused', 'Paused'),
        ('paused_restart', 'Paused (Restart)'),
        ('aborted', 'Aborted'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='experiments'
    )
    # Points to the specific processed version used for training
    dataset_version = models.ForeignKey(
        DatasetVersion,
        on_delete=models.SET_NULL,
        null=True,
        related_name='experiments'
    )
    task_type = models.CharField(max_length=20, choices=TASK_TYPE_CHOICES)
    target_column = models.CharField(max_length=100, blank=True, default='')
    algorithm = models.CharField(max_length=100, blank=True, default='')

    # hyperparameters: {"n_estimators": 100, "max_depth": 5}
    hyperparameters = models.JSONField(default=dict)

    # metrics: {"accuracy": 0.91, "f1_score": 0.87, "precision": 0.89, "recall": 0.85}
    # OR for regression: {"rmse": 12.4, "mae": 9.1, "r2": 0.88}
    metrics = models.JSONField(default=dict)

    # feature_importance: {"glucose": 0.35, "bmi": 0.22, "age": 0.18}
    feature_importance = models.JSONField(default=dict)

    # confusion_matrix: [[50, 5], [8, 37]] — only for classification
    confusion_matrix = models.JSONField(default=dict)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    train_test_split = models.FloatField(default=0.6)  # 60% train / 40% test
    # Which auto_mode/graph.py node this run is currently on (or paused at)
    # — e.g. "feature_select", "train". Empty for a non-Auto-Mode Experiment.
    current_node = models.CharField(max_length=50, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.algorithm} — {self.task_type} ({self.status})"


class AgentDecision(models.Model):
    DECISION_TYPE_CHOICES = [
        ('cleaning_recommendation', 'Cleaning Recommendation'),
        ('goal_detection', 'Goal Detection'),
        ('model_selection', 'Model Selection'),
        ('tournament_winner', 'Tournament Winner'),
        ('insight_generation', 'Insight Generation'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    experiment = models.ForeignKey(
        Experiment,
        on_delete=models.CASCADE,
        related_name='agent_decisions'
    )
    decision_type = models.CharField(max_length=50, choices=DECISION_TYPE_CHOICES)

    # input_context: what data the agent had when making this decision
    # {"health_score": 74, "missing_values_pct": 0.12, "task_detected": "classification"}
    input_context = models.JSONField(default=dict)

    # decision_output: what the agent decided
    # {"selected_model": "RandomForest", "reason": "nonlinear patterns detected"}
    decision_output = models.JSONField(default=dict)

    reasoning = models.TextField(blank=True, default='')

    # The three fields below back PRISM Auto Mode's human-in-the-loop
    # checkpoints (backend-fastapi/auto_mode/). requires_confirmation=True
    # marks this row as a real HITL checkpoint (as opposed to a routine,
    # non-blocking decision like encoding/scaling); confirmed stays None
    # until the user actually responds (True=approved/edited,
    # False=rejected — rejecting aborts the whole Auto Mode run, but the
    # decision row itself is kept as the historical record of what was
    # proposed and why). user_override holds whatever the user changed if
    # they edited rather than approved outright.
    requires_confirmation = models.BooleanField(default=False)
    confirmed = models.BooleanField(null=True, default=None)
    user_override = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{self.decision_type} — {self.experiment}"


class InsightCard(models.Model):
    SEVERITY_CHOICES = [
        ('critical', 'Critical'),
        ('warning', 'Warning'),
        ('strength', 'Strength'),
        ('tip', 'Tip'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    experiment = models.ForeignKey(
        Experiment,
        on_delete=models.CASCADE,
        related_name='insight_cards'
    )
    card_type = models.CharField(max_length=50)  # "feature_importance", "imbalance", etc.
    severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES)
    title = models.CharField(max_length=200)
    message = models.TextField()

    # detail stores supporting data for the card (chart data, numbers, etc.)
    # {"feature": "glucose", "importance_score": 0.35, "chart_data": [...]}
    detail = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.severity.upper()}] {self.title}"


class WhatIfSimulation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    experiment = models.ForeignKey(
        Experiment,
        on_delete=models.CASCADE,
        related_name='simulations'
    )
    # input_values: the feature values the user set
    # {"glucose": 180, "bmi": 32, "age": 52, "pregnancies": 2}
    input_values = models.JSONField(default=dict)

    # prediction: the model's output for those values
    # {"label": "Diabetic", "probability": 0.81, "class_probabilities": {"Diabetic": 0.81, "Not Diabetic": 0.19}}
    prediction = models.JSONField(default=dict)

    confidence = models.FloatField(null=True, blank=True)

    # feature_contributions: how much each feature contributed to this prediction
    # {"glucose": 0.42, "bmi": 0.28, "age": 0.18}
    feature_contributions = models.JSONField(default=dict)

    scenario_label = models.CharField(max_length=50, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Simulation — {self.scenario_label or 'unnamed'} ({self.experiment})"


class Report(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='reports'
    )
    experiment = models.ForeignKey(
        Experiment,
        on_delete=models.SET_NULL,
        null=True,
        related_name='reports'
    )
    # content stores the full structured report data
    content = models.JSONField(default=dict)
    summary = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Report — {self.project.name} ({self.created_at.date()})"


class TrainedModel(models.Model):
    """
    One durable row per real training run — Manual Mode's own
    POST /training/train call (see backend-fastapi/training_router.py) or
    Auto Mode's train node — registered here the same way DatasetVersion
    rows are registered for pipeline steps (datasets/version_views.py's
    VersionRegisterView): the frontend calls this endpoint right after the
    FastAPI call that actually did the training succeeds, since FastAPI
    itself never talks to Django directly for Manual Mode training the way
    Auto Mode's runner.py does for Experiment.

    Before this existed, "model history" lived ONLY in the browser's own
    localStorage (prism_training_<file_path>__history) — invisible from any
    other browser/device, and "Delete" in the UI only ever removed the
    localStorage entry, never any durable record. This table is the real
    source of truth now; the frontend still keeps a localStorage copy as a
    fast, resilient local cache (same "Django optional" principle used
    everywhere else in this project).
    """
    STATUS_CHOICES = [
        ('trained', 'Trained'),
        ('deleted', 'Deleted'),
    ]
    TASK_TYPE_CHOICES = [
        ('classification', 'Classification'),
        ('regression', 'Regression'),
        ('clustering', 'Clustering'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='trained_models'
    )
    # Which processed dataset version this was trained against — null when
    # the training input was still the raw upload, or that version has
    # since been cascade-deleted by a redo of an earlier step.
    dataset_version = models.ForeignKey(
        DatasetVersion,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='trained_models'
    )

    # model_id/model_file mirror training_router.py's own values exactly —
    # the short uuid4[:8] and the .pkl path it wrote on FastAPI's disk — so
    # Download keeps working long after the browser tab that trained it
    # is gone.
    model_id = models.CharField(max_length=20)
    model_file = models.CharField(max_length=500)
    algorithm = models.CharField(max_length=100, blank=True, default='')  # e.g. "decision_tree"
    display_name = models.CharField(max_length=200, blank=True, default='')

    task_type = models.CharField(max_length=20, choices=TASK_TYPE_CHOICES)
    target_column = models.CharField(max_length=200, blank=True, default='')

    # hyperparameters: whatever model_params this run was trained with
    # {"n_estimators": 100, "max_depth": 5}
    hyperparameters = models.JSONField(default=dict)

    # metrics: the task-appropriate subset of /train's response —
    # {"accuracy": 0.91, "f1": 0.87, ...} or {"r2": 0.88, "rmse": 12.4, ...}
    # or {"n_clusters": 3, "inertia": 402.1, "entropy": 0.91}
    metrics = models.JSONField(default=dict)

    # confusion_matrix: [[50, 5], [8, 37]] — classification only, empty dict
    # for regression/clustering
    confusion_matrix = models.JSONField(default=dict)

    # feature_importance: [{"feature": "glucose", "importance": 0.35}, ...]
    # — only populated for the model types training_router.py's own
    # _model_specific_viz computes this for (random_forest, svm, xgboost)
    feature_importance = models.JSONField(default=dict)

    # result_data: the FULL raw /training/train response (model_viz, class
    # names, threshold arrays, cv scores, cluster preview rows, ...) — its
    # shape genuinely varies by task_type/split_method/algorithm, not worth
    # a column each. This is what lets a model restored on a browser that
    # never trained it still render exactly like it originally did, instead
    # of just showing its headline metrics.
    result_data = models.JSONField(default=dict)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='trained')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.algorithm or 'model'} ({self.task_type}) — {self.project.name} [{self.status}]"
