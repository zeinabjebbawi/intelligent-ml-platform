from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse


class RegisterDuplicateEmailTests(TestCase):
    def test_register_succeeds_for_a_new_email(self):
        res = self.client.post(reverse('register'), {
            'email': 'new-user@example.com', 'password': 'a-valid-password',
        })
        self.assertEqual(res.status_code, 201)
        self.assertTrue(User.objects.filter(email='new-user@example.com').exists())

    def test_register_with_a_taken_email_returns_a_clean_400(self):
        User.objects.create_user(username='taken@example.com', email='taken@example.com', password='whatever123')

        res = self.client.post(reverse('register'), {
            'email': 'taken@example.com', 'password': 'a-valid-password',
        })

        self.assertEqual(res.status_code, 400)
        self.assertIn('email', res.json())
