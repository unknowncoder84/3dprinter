/** Triggers a real browser download of the given bytes. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 15000);
}

export function stlBlob(buffer: ArrayBuffer): Blob {
  return new Blob([buffer], { type: 'model/stl' });
}
