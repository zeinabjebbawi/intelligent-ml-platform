import { useState, useEffect } from 'react';
import CleaningPage from './pages/Cleaning';
import UploadPage from './pages/Upload';
import DiagnosePage from './pages/Diagnose';
import { authAPI, projectsAPI } from './api';

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY harness — not the real app shell.
// There is no routing / journey-map system in this project yet (that code
// lives in a separate conversation and hasn't been added here). This just
// lets you load a CSV that already exists on disk and view the real
// CleaningPage component against it. Replace this file once the actual
// App.jsx / JourneyMap.jsx routing is brought in.
//
// It now also bootstraps a real Django user + project on load (silently
// registers/logs in a fixed dev account, reuses one project) so the
// Cleaning page's version-history bar has a real projectId + JWT to persist
// against. This is throwaway plumbing for local testing only — the real
// app will get projectId from actual login + a project picker, not this.
// ─────────────────────────────────────────────────────────────────────────────

const DEV_EMAIL    = 'cleaning_dev@example.com';
const DEV_PASSWORD = 'dev-preview-pass-1234';
const DEV_PROJECT_NAME = 'Cleaning Page Preview';

async function bootstrapDevProject() {
  // Log in; if the dev account doesn't exist yet, register it then log in.
  let loginRes;
  try {
    loginRes = await authAPI.login({ username: DEV_EMAIL, password: DEV_PASSWORD });
  } catch {
    await authAPI.register({ email: DEV_EMAIL, password: DEV_PASSWORD, first_name: 'Dev' });
    loginRes = await authAPI.login({ username: DEV_EMAIL, password: DEV_PASSWORD });
  }
  localStorage.setItem('access_token', loginRes.data.access);
  localStorage.setItem('refresh_token', loginRes.data.refresh);

  // Reuse the dev project if one already exists, otherwise create it.
  const { data: projects } = await projectsAPI.list();
  const existing = projects.find(p => p.name === DEV_PROJECT_NAME);
  if (existing) return existing.id;

  const { data: created } = await projectsAPI.create({
    name: DEV_PROJECT_NAME,
    mode: 'guided_manual',
  });
  return created.id;
}

function LoadDatasetForm({ onLoad, bootstrapError }) {
  const [path, setPath] = useState('');

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f8fafc', fontFamily: 'system-ui, sans-serif',
    }}>
      <form
        onSubmit={(e) => { e.preventDefault(); if (path.trim()) onLoad(path.trim()); }}
        style={{
          background: 'white', border: '1px solid #e2e8f0', borderRadius: 16,
          padding: '32px 36px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', width: 480,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6, color: '#1e293b' }}>
          IntelliML — Cleaning Page Preview
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
          Enter the full path to a CSV file already saved on this computer.
          The FastAPI server (port 8001) must be running and must be able to
          read this path directly — it does not need to be uploaded through Django.
        </p>
        {bootstrapError && (
          <div style={{
            background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444',
            borderRadius: 10, padding: '10px 14px', marginBottom: 16,
            color: '#ef4444', fontSize: 12,
          }}>
            ⚠ Couldn't reach Django (port 8080) to set up version history: {bootstrapError}.
            The Cleaning page will still work, but the versions bar won't persist
            across refresh until Django is running.
          </div>
        )}
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="C:/Users/you/Desktop/my_dataset.csv"
          style={{
            width: '100%', padding: '10px 14px', fontSize: 13,
            border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 16,
            boxSizing: 'border-box',
          }}
        />
        <button
          type="submit"
          disabled={!path.trim()}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
            background: path.trim() ? '#6366f1' : '#c7d2fe', color: 'white',
            fontWeight: 700, fontSize: 14, cursor: path.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Load Dataset →
        </button>
      </form>
    </div>
  );
}

function App() {
  const [stage, setStage] = useState('upload'); // 'upload' | 'diagnose' | 'load-cleaning' | 'cleaning'
  const [filePath, setFilePath] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [bootstrapError, setBootstrapError] = useState('');
  const [uploadMeta, setUploadMeta] = useState(null);

  useEffect(() => {
    bootstrapDevProject()
      .then(setProjectId)
      .catch(e => setBootstrapError(e.message || 'unknown error'));
  }, []);

  // Upload.jsx and Diagnose.jsx are both self-contained (client-side CSV
  // parsing, no server-visible file path), so this harness just chains them:
  // Upload's "Confirm & Start Diagnosis" -> Diagnose. Diagnose.jsx has no
  // "continue" action of its own (not part of its spec), so this harness adds
  // a small dev-only link below it to keep testing the existing Cleaning page.
  if (stage === 'upload') {
    return (
      <UploadPage
        projectData={{ projectId }}
        onUpdateData={setUploadMeta}
        onNext={() => setStage('diagnose')}
      />
    );
  }

  if (stage === 'diagnose') {
    return (
      <div>
        <DiagnosePage projectData={{ projectId, ...uploadMeta }} />
        <div style={{ textAlign: 'center', padding: '10px 0', background: '#0a0e15' }}>
          <button onClick={() => setStage('load-cleaning')} style={{
            background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)',
            borderRadius: 8, padding: '6px 14px', fontSize: 11, cursor: 'pointer',
          }}>(dev harness) Skip to Cleaning page test →</button>
        </div>
      </div>
    );
  }

  if (stage === 'load-cleaning' || !filePath) {
    return (
      <div>
        {uploadMeta && (
          <div style={{
            maxWidth: 480, margin: '16px auto 0', fontSize: 12, color: '#64748b',
            textAlign: 'center', fontFamily: 'system-ui, sans-serif',
          }}>
            Upload step confirmed: {uploadMeta.datasetFilename} · {uploadMeta.taskType} ·{' '}
            {uploadMeta.targetColumn ? `target "${uploadMeta.targetColumn}"` : 'no target'}.
            Diagnose.jsx isn't built yet — enter a real on-disk CSV path below to continue into Cleaning.
          </div>
        )}
        <LoadDatasetForm onLoad={(p) => { setFilePath(p); setStage('cleaning'); }} bootstrapError={bootstrapError} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <CleaningPage
        projectData={{ filePath, projectId }}
        onNext={() => { setFilePath(null); setStage('load-cleaning'); }}
        onUpdateData={(update) => {
          if (update.cleanedFilePath) setFilePath(update.cleanedFilePath);
        }}
      />
    </div>
  );
}

export default App;
