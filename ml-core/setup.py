from setuptools import setup

setup(
    name='ml-core',
    version='1.0.0',
    description='ML core for IntelliML',
    py_modules=['cleaning', 'models', 'evaluation', 'pipelines'],
    python_requires='>=3.9',
    install_requires=[
        'numpy>=1.21', 'pandas>=1.3', 'scikit-learn>=1.0', 'scipy>=1.7',
    ],
)
