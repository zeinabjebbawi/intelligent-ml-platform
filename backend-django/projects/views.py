from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404
from .models import Project, WorkflowState
from .serializers import ProjectSerializer, WorkflowStateSerializer


class ProjectListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # filter(user=request.user) ensures a user can only see THEIR OWN projects
        # This is the critical security check — without it, any logged-in user
        # could list all projects from all users
        projects = Project.objects.filter(user=request.user)
        # many=True tells the serializer this is a list, not a single object
        serializer = ProjectSerializer(projects, many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = ProjectSerializer(data=request.data)
        if serializer.is_valid():
            # save(user=request.user) passes the user to the model's create method
            # This is how we link the new project to the logged-in user
            project = serializer.save(user=request.user)

            # Every new project automatically gets a WorkflowState
            # starting at the "upload" step with no completed steps yet
            WorkflowState.objects.create(
                project=project,
                current_step='upload',
                completed_steps=[],
                needs_redo_steps=[],
                step_settings={}
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ProjectDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_object(self, pk, user):
        # get_object_or_404 does two things:
        # 1. Finds the project by its UUID primary key
        # 2. Also checks that user=user — if the project belongs to someone else,
        #    this returns 404 (not found) instead of 403 (forbidden)
        #    This is a security best practice — don't reveal that a resource EXISTS
        #    if the requester is not allowed to see it
        return get_object_or_404(Project, pk=pk, user=user)

    def get(self, request, pk):
        project = self.get_object(pk, request.user)
        serializer = ProjectSerializer(project)
        return Response(serializer.data)

    def put(self, request, pk):
        project = self.get_object(pk, request.user)
        # partial=True allows updating only some fields (e.g., just the name)
        serializer = ProjectSerializer(project, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        project = self.get_object(pk, request.user)
        project.delete()
        # 204 No Content is the correct HTTP status for a successful deletion
        return Response({"message": "Project deleted."}, status=status.HTTP_204_NO_CONTENT)


class WorkflowStateView(APIView):
    """
    GET   /api/projects/<uuid:project_id>/workflow/  — current step, completed
          steps, steps needing redo, and cached per-step settings.
    PATCH /api/projects/<uuid:project_id>/workflow/  — update any subset of
          those fields. step_settings is deep-merged one key level down
          (per step name), never overwritten wholesale, so a PATCH saving
          the Cleaning page's settings can't wipe out Training's cached
          settings and vice versa.
    """
    permission_classes = [IsAuthenticated]

    def get_workflow(self, project_id, user):
        project = get_object_or_404(Project, pk=project_id, user=user)
        # get_or_create rather than a hard 404: every project created through
        # ProjectListCreateView already has one, but this keeps the endpoint
        # safe for any project that predates this feature.
        workflow, _ = WorkflowState.objects.get_or_create(project=project)
        return workflow

    def get(self, request, project_id):
        workflow = self.get_workflow(project_id, request.user)
        return Response(WorkflowStateSerializer(workflow).data)

    def patch(self, request, project_id):
        workflow = self.get_workflow(project_id, request.user)
        data = request.data

        if 'current_step' in data:
            workflow.current_step = data['current_step']
        if 'completed_steps' in data:
            workflow.completed_steps = data['completed_steps']
        if 'needs_redo_steps' in data:
            workflow.needs_redo_steps = data['needs_redo_steps']
        if 'step_settings' in data and isinstance(data['step_settings'], dict):
            merged = dict(workflow.step_settings)
            for step_key, step_val in data['step_settings'].items():
                if isinstance(step_val, dict) and isinstance(merged.get(step_key), dict):
                    merged[step_key] = {**merged[step_key], **step_val}
                else:
                    merged[step_key] = step_val
            workflow.step_settings = merged

        workflow.save()
        return Response(WorkflowStateSerializer(workflow).data)
