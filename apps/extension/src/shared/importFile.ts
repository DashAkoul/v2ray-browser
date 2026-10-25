import { rpc } from './client';
import type { AppSnapshot } from './protocol';

export interface FileImportResult {
  snapshot: AppSnapshot;
  added: number;
  skipped: number;
  failures: number;
  kind: 'bundle' | 'profiles';
}

interface AddResponse {
  snapshot: AppSnapshot;
  added: number;
  duplicates: number;
  failures: Array<{ input: string; error: { message: string } }>;
}

export async function importContent(content: string): Promise<FileImportResult> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('File is empty');
  if (trimmed.startsWith('{')) {
    try {
      const json: unknown = JSON.parse(trimmed);
      if (typeof json === 'object' && json !== null && (json as Record<string, unknown>)['format'] === 'v2ray-browser.export') {
        const response = await rpc<{ snapshot: AppSnapshot; added: number; skipped: number }>({
          type: 'profile/import-bundle',
          bundle: json,
          mode: 'merge',
        });
        return { ...response, failures: 0, kind: 'bundle' };
      }
    } catch {
      // Not valid JSON; the parser will report a useful error below.
    }
  }
  const response = await rpc<AddResponse>({ type: 'profile/add', input: trimmed, source: 'file' });
  return {
    snapshot: response.snapshot,
    added: response.added,
    skipped: response.duplicates,
    failures: response.failures.length,
    kind: 'profiles',
  };
}

export async function importFile(file: File): Promise<FileImportResult> {
  const content = await file.text();
  return importContent(content);
}
