"""Upload this repo to a Hugging Face Space (Docker). Used by .github/workflows/deploy.yml.

    HF_TOKEN=hf_xxx python deploy/push_to_space.py [owner/space-name]

Creates the Space the first time. Default name: <your HF username>/soilsight
"""
import os
import sys
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parents[1]
token = os.environ.get('HF_TOKEN')
if not token:
    sys.exit('HF_TOKEN is not set')
api = HfApi(token=token)
repo_id = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('HF_SPACE') or f"{api.whoami()['name']}/soilsight"

api.create_repo(repo_id, repo_type='space', space_sdk='docker', exist_ok=True)
api.upload_folder(
    folder_path=str(ROOT), repo_id=repo_id, repo_type='space',
    allow_patterns=['Dockerfile', '.dockerignore', 'index.html', 'favicon.svg', 'css/*', 'js/*',
                    'backend/*.py', 'backend/requirements.txt', 'backend/soilsight/*.py', 'backend/artifacts/model.joblib'],
    delete_patterns=['css/*', 'js/*', 'backend/**'],
    commit_message=f"Deploy {os.environ.get('GITHUB_SHA', 'local')[:7]}",
)
api.upload_file(path_or_fileobj=str(ROOT / 'deploy' / 'space_readme.md'), path_in_repo='README.md',
                repo_id=repo_id, repo_type='space', commit_message='Space card')
owner, name = repo_id.split('/')
print(f'Deployed. App: https://{owner.lower()}-{name.lower().replace("_", "-")}.hf.space')
print(f'Space page: https://huggingface.co/spaces/{repo_id}')
