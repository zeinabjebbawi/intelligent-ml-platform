from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404

from projects.models import Project
from .models import Experiment, AgentDecision
from .serializers import ExperimentSerializer, AgentDecisionSerializer


def _get_project(project_id, user):
    # get_object_or_404(..., user=user) rather than a raw pk lookup — same
    # security pattern used everywhere else in this codebase (datasets/
    # version_views.py, projects/views.py): a project belonging to someone
    # else returns 404, not 403, so its existence is never revealed to a
    # requester who isn't its owner.
    return get_object_or_404(Project, pk=project_id, user=user)


def _get_experiment(project_id, experiment_id, user):
    project = _get_project(project_id, user)
    return get_object_or_404(Experiment, pk=experiment_id, project=project)


class AutoModeStartView(APIView):
    """
    POST /api/projects/<uuid:project_id>/automode/run/
    Body: {task_type, target_column?}

    Creates one Experiment row per Auto Mode run — this IS the run-level
    audit record backend-fastapi/auto_mode/runner.py polls/updates via
    django_client.py. Called once, from node_intake.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, project_id):
        project = _get_project(project_id, request.user)
        experiment = Experiment.objects.create(
            project=project,
            task_type=request.data.get('task_type', 'classification'),
            target_column=request.data.get('target_column', '') or '',
            status='running',
        )
        return Response(ExperimentSerializer(experiment).data, status=status.HTTP_201_CREATED)


class AutoModeRunDetailView(APIView):
    """
    GET   /api/projects/<uuid:project_id>/automode/run/<uuid:experiment_id>/
          — full run record + every logged decision, for a "past runs" /
          audit view (separate from FastAPI's own live-polling endpoint,
          which is what the running frontend modal actually polls).
    PATCH /api/projects/<uuid:project_id>/automode/run/<uuid:experiment_id>/
          — update any subset of {status, current_node, metrics,
          feature_importance, confusion_matrix, algorithm, hyperparameters}.
          Called from django_client.update_experiment() — best-effort from
          the FastAPI side, so this endpoint stays simple/permissive rather
          than validating every field combination.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id, experiment_id):
        experiment = _get_experiment(project_id, experiment_id, request.user)
        return Response(ExperimentSerializer(experiment).data)

    def patch(self, request, project_id, experiment_id):
        experiment = _get_experiment(project_id, experiment_id, request.user)
        for field in ('status', 'current_node', 'metrics', 'feature_importance',
                      'confusion_matrix', 'algorithm', 'hyperparameters'):
            if field in request.data:
                setattr(experiment, field, request.data[field])
        experiment.save()
        return Response(ExperimentSerializer(experiment).data)


class AutoModeDecisionLogView(APIView):
    """
    POST /api/projects/<uuid:project_id>/automode/run/<uuid:experiment_id>/decisions/
    Body: {decision_type, input_context, decision_output, reasoning, requires_confirmation?}

    Appends one AgentDecision row. Called from django_client.log_decision()
    after every big-decision node — this is the durable, cross-session
    audit trail (LangGraph's own SQLite checkpointer is a separate,
    internal-only pause/resume mechanism, not this).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, project_id, experiment_id):
        experiment = _get_experiment(project_id, experiment_id, request.user)
        decision = AgentDecision.objects.create(
            experiment=experiment,
            decision_type=request.data.get('decision_type', 'cleaning_recommendation'),
            input_context=request.data.get('input_context') or {},
            decision_output=request.data.get('decision_output') or {},
            reasoning=request.data.get('reasoning', ''),
            requires_confirmation=bool(request.data.get('requires_confirmation', False)),
        )
        return Response(AgentDecisionSerializer(decision).data, status=status.HTTP_201_CREATED)


class AutoModeDecisionResolveView(APIView):
    """
    PATCH /api/projects/<uuid:project_id>/automode/run/<uuid:experiment_id>/decisions/<uuid:decision_id>/
    Body: {confirmed: bool, user_override?: dict}

    Records the human's response to a HITL checkpoint decision. Called
    from django_client.resolve_decision() — purely an audit-trail update;
    the actual pipeline resume happens via FastAPI's own
    POST /auto-mode/resume/{run_id}, not through this endpoint.
    """
    permission_classes = [IsAuthenticated]

    def patch(self, request, project_id, experiment_id, decision_id):
        experiment = _get_experiment(project_id, experiment_id, request.user)
        decision = get_object_or_404(AgentDecision, pk=decision_id, experiment=experiment)
        decision.confirmed = request.data.get('confirmed')
        decision.user_override = request.data.get('user_override') or {}
        decision.save()
        return Response(AgentDecisionSerializer(decision).data)
