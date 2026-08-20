from django.contrib.auth.models import User
from rest_framework import serializers
from .models import UserProfile


class RegisterSerializer(serializers.ModelSerializer):
    # write_only=True means this field is accepted on input but never included in responses
    # You do not want to send the password back in a response ever
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ['email', 'password', 'first_name', 'last_name']

    def create(self, validated_data):
        # create_user hashes the password automatically — never store plain passwords
        # Django requires a username field; we use the email as the username
        user = User.objects.create_user(
            username=validated_data['email'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', '')
        )
        return user


class UserProfileSerializer(serializers.ModelSerializer):
    # source='user.email' means: go into the related User object and get the email field
    # read_only=True means this can only be read, not written through this serializer
    email = serializers.EmailField(source='user.email', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)

    class Meta:
        model = UserProfile
        fields = ['email', 'first_name', 'experience_level', 'onboarding_completed', 'created_at']
        read_only_fields = ['onboarding_completed', 'created_at']

    def update(self, instance, validated_data):
        # When the user sets their experience level, automatically mark onboarding as done
        if 'experience_level' in validated_data:
            instance.experience_level = validated_data['experience_level']
            instance.onboarding_completed = True
            instance.save()
        return instance
