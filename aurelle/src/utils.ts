import { api } from './api';
export function downloadFile(content: string, name: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function awaitJob(jobId: string) {
  for (let i = 0; i < 35; i++) {
    const job = await api(`/ai/jobs/${jobId}`);
    if (!['pending', 'processing'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    'The assistant is taking longer than expected. Your regular workflows remain available.',
  );
}
