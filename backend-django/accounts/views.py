from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated, AllowAny
from .serializers import RegisterSerializer, UserProfileSerializer


class RegisterView(APIView):
    # AllowAny overrides the global IsAuthenticated setting
    # Registration must be accessible without a token (obviously, the user does not have one yet)
    permission_classes = [AllowAny]

    def post(self, request):
        # request.data contains the JSON body of the incoming request
        serializer = RegisterSerializer(data=request.data)

        # is_valid() checks all rules: email format, min password length, etc.
        if serializer.is_valid():
            user = serializer.save()
            # 201 Created is the correct HTTP status for a successful creation
            return Response(
                {"message": "Account created successfully.", "user_id": user.id},
                status=status.HTTP_201_CREATED
            )
        # If validation failed, return the errors so the frontend knows what went wrong
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ProfileView(APIView):
    # This endpoint requires a valid JWT — the user must be logged in
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # request.user is automatically populated by the JWT authentication
        # middleware, which reads the token from the Authorization header
        serializer = UserProfileSerializer(request.user.profile)
        return Response(serializer.data)

    def put(self, request):
        # partial=True means not all fields are required — the user can update just experience_level
        serializer = UserProfileSerializer(
            request.user.profile,
            data=request.data,
            partial=True
        )
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
