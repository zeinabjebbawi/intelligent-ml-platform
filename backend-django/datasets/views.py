import os
import json
import pandas as pd
import requests as http_requests
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404
from django.conf import settings
from projects.models import Project
from .models import Dataset, DatasetVersion
from .serializers import DatasetSerializer


class DatasetUploadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, project_id):
        # ── Step 1: Verify the project belongs to this user ──────────
        # user=request.user ensures you cannot upload to someone else's project
        project = get_object_or_404(Project, pk=project_id, user=request.user)

        # ── Step 2: Get the uploaded file ─────────────────────────────
        # request.FILES contains uploaded files (multipart form data)
        file = request.FILES.get('file')
        if not file:
            return Response(
                {"error": "No file provided. Send a CSV file with key 'file'."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # ── Step 3: Validate file type ────────────────────────────────
        if not file.name.endswith('.csv'):
            return Response(
                {"error": "Only CSV files are supported."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # ── Step 4: Create folder on disk ─────────────────────────────
        # Folder structure: media/datasets/user_1/project_<uuid>/
        # exist_ok=True means: do not error if the folder already exists
        save_dir = os.path.join(
            settings.MEDIA_ROOT,
            'datasets',
            f'user_{request.user.id}',
            f'project_{project_id}'
        )
        os.makedirs(save_dir, exist_ok=True)

        # ── Step 5: Save the file to disk ─────────────────────────────
        # file.chunks() reads the file in small pieces rather than all at once
        # This prevents memory issues for large files
        file_path = os.path.join(save_dir, 'original.csv')
        with open(file_path, 'wb') as destination:
            for chunk in file.chunks():
                destination.write(chunk)

        # ── Step 6: Read the file with pandas ─────────────────────────
        # Get basic statistics: row count, column count, column types
        try:
            df = pd.read_csv(file_path)
            row_count = len(df)
            column_count = len(df.columns)

            # Build simple column metadata for each column
            columns_metadata = {}
            for col in df.columns:
                col_type = 'numerical' if pd.api.types.is_numeric_dtype(df[col]) else 'categorical'
                missing_count = int(df[col].isna().sum())
                missing_pct = round(missing_count / len(df) * 100, 2)
                columns_metadata[col] = {
                    'type': col_type,
                    'missing_count': missing_count,
                    'missing_pct': missing_pct
                }
        except Exception as e:
            # If pandas cannot read the file, clean up and return error
            os.remove(file_path)
            return Response(
                {"error": f"Could not read CSV file: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # ── Step 7: Create Dataset record in database ─────────────────
        dataset = Dataset.objects.create(
            project=project,
            original_filename=file.name,
            storage_path=file_path,
            row_count=row_count,
            column_count=column_count,
            columns_metadata=columns_metadata,
            status='uploaded'
        )

        # ── Step 7b: Call FastAPI to profile the dataset ────────────────
        #
        # This is the bridge between Django and FastAPI.
        # Django saved the file. Now we ask FastAPI to analyze it
        # and compute the full health score, column statistics,
        # outlier counts, correlations, and class imbalance info.
        #
        # If FastAPI is running → profiling_result gets stored in the database
        # If FastAPI is NOT running → upload still works, profiling just shows empty
        # The try/except prevents FastAPI being down from breaking the entire upload.
        # ─────────────────────────────────────────────────────────────
        profiling_succeeded = False
        try:
            fastapi_response = http_requests.post(
                # 127.0.0.1, not "localhost" — on a dual-stack machine
                # "localhost" can resolve to ::1 as well as 127.0.0.1, and
                # FastAPI only binds IPv4. Using the literal sidesteps that.
                'http://127.0.0.1:8001/ml/profile',
                json={
                    'file_path': file_path,   # the path we just saved to disk
                    'target_column': None     # user has not chosen target yet
                },
                timeout=60  # wait up to 60 seconds for profiling to complete
            )

            if fastapi_response.status_code == 200:
                profiling_data = fastapi_response.json()
                profiling_result = profiling_data.get('profiling_result', {})
                health_score = profiling_data.get('health_score', {})

                # Update the dataset record with everything FastAPI computed
                dataset.profiling_result = profiling_result
                dataset.health_score = health_score.get('overall', 0)
                dataset.status = 'profiled'
                dataset.save()

                profiling_succeeded = True
                print(f"[FastAPI profiling succeeded] health_score={dataset.health_score}")

            else:
                print(f"[FastAPI returned error {fastapi_response.status_code}]: {fastapi_response.text}")

        except http_requests.exceptions.ConnectionError:
            # FastAPI server is not running — upload still works fine
            print("[FastAPI profiling skipped] FastAPI server not running (port 8001)")

        except Exception as e:
            # Any other unexpected error — do not crash the upload
            print(f"[FastAPI profiling failed] {str(e)}")

        # ── Step 8: Create Version 1 (the original, untouched version) ─
        DatasetVersion.objects.create(
            dataset=dataset,
            version_number=1,
            step_name='upload',
            version_label='Original Dataset',
            file_path=file_path,
            file_size=os.path.getsize(file_path) if os.path.exists(file_path) else 0,
            row_count=row_count,
            col_count=column_count,
        )

        # ── Step 9: Return response to frontend ───────────────────────
        # Include a preview of the first 5 rows so the user can see their data
        # Real datasets almost always contain missing values, which pandas represents
        # as NaN. Python's json module refuses to encode raw NaN (ValueError: "Out of
        # range float values are not JSON compliant"), so we round-trip through
        # DataFrame.to_json(), which correctly converts NaN to JSON null, instead of
        # using to_dict() directly.
        preview = json.loads(df.head(5).to_json(orient='records'))

        return Response({
            "dataset_id": str(dataset.id),
            "filename": file.name,
            "row_count": row_count,
            "column_count": column_count,
            "columns": list(df.columns),
            "columns_metadata": columns_metadata,
            "preview": preview,
            "health_score": dataset.health_score if profiling_succeeded else None,
            "profiling_done": profiling_succeeded,
            "message": (
                "Dataset uploaded and profiled successfully."
                if profiling_succeeded
                else "Dataset uploaded. Start the FastAPI server (port 8001) to enable profiling."
            )
        }, status=status.HTTP_201_CREATED)


class DatasetDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, dataset_id):
        # project__user=request.user is a Django ORM lookup that traverses the relationship:
        # Dataset → Project → User. It ensures you can only view datasets from your own projects.
        # The double underscore (__) means "follow this foreign key relationship"
        dataset = get_object_or_404(Dataset, pk=dataset_id, project__user=request.user)
        serializer = DatasetSerializer(dataset)
        return Response(serializer.data)

    def patch(self, request, dataset_id):
        # Only ever called once, right after the Upload wizard's Step 2/3
        # actually determines target_column/task_type (they're unknown at
        # upload time — see DatasetUploadView's own profiling call above).
        # partial=True since a caller only ever sends these two fields, not
        # the full dataset payload.
        dataset = get_object_or_404(Dataset, pk=dataset_id, project__user=request.user)
        serializer = DatasetSerializer(dataset, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
