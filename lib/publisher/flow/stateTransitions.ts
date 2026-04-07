import { isPublishSuccessUrl } from '../ui/submit.js';

export function resolveBoardIdFromEntryUrl(boardUrl: string): string {
  try {
    const id = new URL(boardUrl).searchParams.get('id');
    return id || 'gonggu';
  } catch {
    return 'gonggu';
  }
}

export function assertSubmitStepsPresent(stepCount: number): void {
  if (stepCount <= 0) {
    throw new Error('PUBLISHER_PLAYBOOK_INVALID: submit step missing');
  }
}

export function assertVerifiedPublishRedirect(finalUrl: string, boardId: string): void {
  if (!isPublishSuccessUrl(finalUrl, boardId)) {
    throw new Error(`PUBLISHER_SUBMIT_REDIRECT_UNVERIFIED: final url "${finalUrl}"`);
  }
}
