type ZxingBrowserModule = typeof import('@zxing/browser');

let zxingBrowserPromise: Promise<ZxingBrowserModule> | null = null;

async function loadZxingBrowser(): Promise<ZxingBrowserModule> {
  if (!zxingBrowserPromise) {
    zxingBrowserPromise = import('@zxing/browser');
  }
  return zxingBrowserPromise;
}

async function decodeQrFromImageUrl(url: string): Promise<string> {
  const { BrowserQRCodeReader } = await loadZxingBrowser();
  const reader = new BrowserQRCodeReader();
  const decoded = await reader.decodeFromImageUrl(url);
  return decoded.getText();
}

export async function decodeQrFromImageFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    return await decodeQrFromImageUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodeQrFromCanvas(canvas: HTMLCanvasElement): Promise<string> {
  return decodeQrFromImageUrl(canvas.toDataURL('image/png'));
}
