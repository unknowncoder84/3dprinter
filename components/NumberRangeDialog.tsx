'use client';

import { useState } from 'react';
import { Hash } from 'lucide-react';
import { Modal, btn } from '@/components/ui/Modal';

export function NumberRangeDialog({ onGenerate, onClose }: { onGenerate: (from: number, to: number) => void; onClose: () => void }) {
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('100');
  const a = Number(from);
  const b = Number(to);
  const valid = Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= 1 && a <= 100 && b <= 100;
  const count = valid ? Math.abs(b - a) + 1 : 0;
  return (
    <Modal
      title="Generate number cards"
      onClose={onClose}
      testId="number-range-dialog"
      footer={
        <>
          <button type="button" className={`${btn.base} ${btn.secondary}`} onClick={onClose}>Cancel</button>
          <button type="button" className={`${btn.base} ${btn.primary}`} disabled={!valid} onClick={() => onGenerate(Math.min(a, b), Math.max(a, b))} data-testid="number-range-generate">
            <Hash className="h-4 w-4" /> Add {count} card{count === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs text-slate-500">Adds missing cards only. Each card uses the number as its alphabet value and an editable English word label. Existing cards and pictures are preserved.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-slate-600">
          From
          <input data-testid="number-range-from" type="number" min={1} max={100} step={1} value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          To
          <input data-testid="number-range-to" type="number" min={1} max={100} step={1} value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500" />
        </label>
      </div>
      {!valid && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">Choose whole numbers from 1 to 100.</p>}
      {valid && <p className="mt-2 rounded bg-green-50 px-2 py-1 text-xs text-green-700">Range contains {count} card{count === 1 ? '' : 's'}. Duplicate numbers are skipped.</p>}
    </Modal>
  );
}
