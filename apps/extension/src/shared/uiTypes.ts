import type { ToastTone } from '@v2rb/ui';
import type { AppSnapshot } from './protocol';

export type PushToast = (message: string, tone?: ToastTone) => void;

export interface SectionProps {
  snapshot: AppSnapshot;
  onSnapshot: (snapshot: AppSnapshot) => void;
  push: PushToast;
}
