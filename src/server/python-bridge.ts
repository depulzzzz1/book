import { execFile } from 'child_process';
import path from 'path';

export interface SanitizedManuscriptResult {
  sanitized_html: string;
  plain_excerpt: string;
  word_count: number;
  reading_minutes: number;
  checksum_sha256: string;
  stripped_tags: string[];
}

export interface ReadabilityResult {
  word_count: number;
  sentence_count: number;
  avg_sentence_length: number;
  lexical_diversity: number;
  reading_ease_score: number;
  estimated_minutes: number;
}

export interface RevisionDiffResult {
  added_paragraphs: number;
  removed_paragraphs: number;
  unified_diff: string[];
  changed: boolean;
}

function runPythonDomainCommand<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(process.cwd(), 'litera_core', 'domain_engine.py');
    const child = execFile(
      'python3',
      [scriptPath, command],
      { timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Python domain engine error (${command}): ${stderr || error.message}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()) as T);
        } catch (parseErr) {
          reject(new Error(`Failed to parse Python domain output: ${String(parseErr)}`));
        }
      }
    );

    if (child.stdin) {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    }
  });
}

export async function sanitizeManuscriptViaPython(html: string): Promise<SanitizedManuscriptResult> {
  return runPythonDomainCommand<SanitizedManuscriptResult>('sanitize_html', { html });
}

export async function analyzeReadabilityViaPython(content: string): Promise<ReadabilityResult> {
  return runPythonDomainCommand<ReadabilityResult>('analyze_readability', { content });
}

export async function diffRevisionsViaPython(
  oldHtml: string,
  newHtml: string
): Promise<RevisionDiffResult> {
  return runPythonDomainCommand<RevisionDiffResult>('diff_revisions', {
    old_html: oldHtml,
    new_html: newHtml,
  });
}

export async function scoreRecommendationsViaPython(payload: {
  target_novel_id: string;
  target_genres: string[];
  candidates: Array<{
    id: string;
    genres: string[];
    avg_rating: number;
    view_count: number;
  }>;
  limit?: number;
}): Promise<{ recommendations: Array<{ id: string; recommendation_score: number }> }> {
  return runPythonDomainCommand('recommend_novels', payload);
}
